import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TarefasService } from '../tarefas/tarefas.service';

export interface FunilConversao {
  status: string;
  label: string;
  total: number;
}

export interface RelatorioConsultor {
  nome: string;
  consultas: number;
  leads: number;
  convertidos: number;
  taxaConversao: number;
}

export interface ConsultasPorMes {
  mes: string;  // YYYY-MM
  total: number;
}

export interface DashboardDto {
  periodoDias: number;
  consultasPeriodo: number;
  consultasDelta: number | null;   // variação % vs. janela anterior de mesmo tamanho (null = base 0)
  totalLeads: number;
  leadsAtivos: number;
  totalClientes: number;
  taxaConversaoLeads: number;
  oportunidadesParadas: number;
  alertasCertidoesCriticos: number;
  tarefasPendentes: number;
  consultasPorMes: ConsultasPorMes[];
  topCnaes: { codigo: string; descricao: string; total: number }[];
  topConsultores: { nome: string; total: number }[];
}

export interface AcoesPrioritariasDto {
  certidoes: { empresa: string; cnpj: string | null; tipo: string; status: string; validade: string | null; diasRestantes: number | null }[];
  tarefas: { id: string; titulo: string; prioridade: string; responsavel: string | null; dataLimite: string | null; atrasada: boolean }[];
  oportunidades: { empresa: string; cnpj: string; status: string; diasParado: number }[];
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly ds: DataSource,
    private readonly tarefasService: TarefasService,
  ) {}

  async resumo(dias = 30): Promise<DashboardDto> {
    const agora = new Date();

    const [
      consultasMesRaw,
      leadsRaw,
      clientesRaw,
      oportunidadesRaw,
      alertasRaw,
      consultasPorMesRaw,
      topCnaesRaw,
    ] = await Promise.all([
      // Consultas na janela selecionada + na janela anterior de mesmo tamanho (p/ o delta).
      this.ds.query<{ atual: string; anterior: string }[]>(`
        SELECT
          COUNT(*) FILTER (WHERE consultado_em >= NOW() - make_interval(days => $1))::int AS atual,
          COUNT(*) FILTER (WHERE consultado_em >= NOW() - make_interval(days => $1 * 2)
                             AND consultado_em <  NOW() - make_interval(days => $1))::int AS anterior
        FROM consultas
        WHERE consultado_em >= NOW() - make_interval(days => $1 * 2)
      `, [dias]),

      this.ds.query<{ total: string; clientes: string; ativos: string }[]>(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'convertido')::int AS clientes,
          COUNT(*) FILTER (WHERE status NOT IN ('convertido','descartado'))::int AS ativos
        FROM leads
      `),

      this.ds.query<{ total: string }[]>(`SELECT COUNT(*)::int AS total FROM clientes`),

      this.ds.query<{ total: string }[]>(`
        SELECT COUNT(*)::int AS total FROM leads
        WHERE status NOT IN ('convertido','descartado')
          AND atualizado_em < NOW() - INTERVAL '30 days'
      `).catch(() => [{ total: '0' }] as { total: string }[]),

      this.ds.query<{ total: string }[]>(`
        SELECT COUNT(*)::int AS total FROM certidoes
        WHERE status = 'IRREGULAR'
           OR (validade IS NOT NULL AND validade::date <= CURRENT_DATE + INTERVAL '7 days' AND status = 'REGULAR')
      `),

      this.ds.query<{ mes: string; total: string }[]>(`
        SELECT
          TO_CHAR(consultado_em, 'YYYY-MM') AS mes,
          COUNT(*)::int                      AS total
        FROM consultas
        WHERE consultado_em >= date_trunc('month', NOW()) - INTERVAL '5 months'
        GROUP BY mes
        ORDER BY mes ASC
      `),

      this.ds.query<{ codigo: string; descricao: string; total: string }[]>(`
        SELECT
          e.cnae_principal_codigo         AS codigo,
          MAX(e.cnae_principal_descricao) AS descricao,
          COUNT(DISTINCT c.id)::int       AS total
        FROM consultas c
        JOIN empresas e ON e.cnpj = c.cnpj
        WHERE c.consultado_em >= NOW() - make_interval(days => $1)
          AND e.cnae_principal_codigo IS NOT NULL
        GROUP BY e.cnae_principal_codigo
        ORDER BY total DESC
        LIMIT 5
      `, [dias]),
    ]);

    const tarefasPendentes = await this.tarefasService.contarPendentes();

    const totalLeads    = Number(leadsRaw[0]?.total    ?? 0);
    const leadsAtivos   = Number(leadsRaw[0]?.ativos   ?? 0);
    const totalClientes = Number(leadsRaw[0]?.clientes ?? 0) + Number(clientesRaw[0]?.total ?? 0);

    // Série fixa dos últimos 6 meses (mês atual + 5 anteriores), com zero-fill: meses sem
    // consultas somem no GROUP BY e distorceriam o gráfico ("buracos" e barras fora de ordem).
    const meses6: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
      meses6.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const mapConsultas = new Map(consultasPorMesRaw.map(r => [r.mes, Number(r.total)]));
    const consultasPorMes = meses6.map(mes => ({ mes, total: mapConsultas.get(mes) ?? 0 }));

    // top consultores: quem mais criou consultas no mês (via usuario_id na tabela consultas se existir, senão placeholder)
    const topConsultoresRaw = await this.ds.query<{ nome: string; total: string }[]>(`
      SELECT
        COALESCE(u.nome, 'Sem identificação') AS nome,
        COUNT(c.id)::int AS total
      FROM consultas c
      LEFT JOIN usuarios u ON u.id::text = c.usuario_id::text
      WHERE c.consultado_em >= NOW() - make_interval(days => $1)
      GROUP BY COALESCE(u.nome, 'Sem identificação')
      ORDER BY total DESC
      LIMIT 5
    `, [dias]).catch(() => [] as { nome: string; total: string }[]);

    const consultasPeriodo  = Number(consultasMesRaw[0]?.atual    ?? 0);
    const consultasAnterior = Number(consultasMesRaw[0]?.anterior ?? 0);
    const consultasDelta = consultasAnterior > 0
      ? Math.round(((consultasPeriodo - consultasAnterior) / consultasAnterior) * 100)
      : null;

    return {
      periodoDias:              dias,
      consultasPeriodo,
      consultasDelta,
      totalLeads,
      leadsAtivos,
      totalClientes,
      taxaConversaoLeads:       totalLeads > 0 ? Math.round((Number(leadsRaw[0]?.clientes ?? 0) / totalLeads) * 100) : 0,
      oportunidadesParadas:     Number(oportunidadesRaw[0]?.total       ?? 0),
      alertasCertidoesCriticos: Number(alertasRaw[0]?.total             ?? 0),
      tarefasPendentes,
      consultasPorMes,
      topCnaes:                 topCnaesRaw.map(r => ({ codigo: r.codigo, descricao: r.descricao ?? r.codigo, total: Number(r.total) })),
      topConsultores:           topConsultoresRaw.map(r => ({ nome: r.nome, total: Number(r.total) })),
    };
  }

  // Itens concretos para o bloco "Precisa de ação hoje" — transforma as contagens do
  // resumo em uma lista de trabalho acionável (nome do cliente, prazo, prioridade).
  async acoesPrioritarias(): Promise<AcoesPrioritariasDto> {
    const [certRaw, tarRaw, oportRaw] = await Promise.all([
      this.ds.query<{ cnpj: string | null; tipo: string; status: string; validade: string | null; empresa: string }[]>(`
        SELECT c.cnpj, c.tipo, c.status, c.validade,
               COALESCE(e.razao_social, c.cnpj) AS empresa
        FROM certidoes c
        LEFT JOIN empresas e ON e.cnpj = c.cnpj
        WHERE c.status = 'IRREGULAR'
           OR (c.validade IS NOT NULL AND c.validade::date <= CURRENT_DATE + INTERVAL '7 days' AND c.status = 'REGULAR')
        ORDER BY (c.status = 'IRREGULAR') DESC, c.validade::date ASC NULLS LAST
        LIMIT 8
      `).catch(() => []),

      this.ds.query<{ id: string; titulo: string; prioridade: string; responsavel: string | null; dataLimite: string | null }[]>(`
        SELECT id, titulo, prioridade,
               responsavel_nome AS responsavel,
               TO_CHAR(data_limite, 'YYYY-MM-DD') AS "dataLimite"
        FROM tarefas
        WHERE status IN ('pendente','em_andamento')
        ORDER BY (data_limite IS NULL) ASC, data_limite ASC,
                 CASE prioridade WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END
        LIMIT 8
      `).catch(() => []),

      this.ds.query<{ cnpj: string; status: string; empresa: string; dias: string }[]>(`
        SELECT l.cnpj, l.status,
               COALESCE(e.razao_social, l.cnpj) AS empresa,
               EXTRACT(DAY FROM (NOW() - l.atualizado_em))::int AS dias
        FROM leads l
        LEFT JOIN empresas e ON e.cnpj = l.cnpj
        WHERE l.status NOT IN ('convertido','descartado')
          AND l.atualizado_em < NOW() - INTERVAL '30 days'
        ORDER BY l.atualizado_em ASC
        LIMIT 8
      `).catch(() => []),
    ]);

    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const diasAte = (v: string | null): number | null => {
      if (!v) return null;
      return Math.round((new Date(v + 'T00:00:00').getTime() - hoje.getTime()) / 86400000);
    };

    return {
      certidoes: certRaw.map(r => ({
        empresa: r.empresa, cnpj: r.cnpj, tipo: r.tipo, status: r.status,
        validade: r.validade, diasRestantes: r.status === 'IRREGULAR' ? null : diasAte(r.validade),
      })),
      tarefas: tarRaw.map(r => ({
        id: r.id, titulo: r.titulo, prioridade: r.prioridade, responsavel: r.responsavel,
        dataLimite: r.dataLimite, atrasada: r.dataLimite ? (diasAte(r.dataLimite) ?? 1) < 0 : false,
      })),
      oportunidades: oportRaw.map(r => ({
        empresa: r.empresa, cnpj: r.cnpj, status: r.status, diasParado: Number(r.dias),
      })),
    };
  }

  async funilConversao(): Promise<FunilConversao[]> {
    const ORDEM = ['novo', 'em_contato', 'proposta_enviada', 'convertido', 'descartado'];
    const LABELS: Record<string, string> = {
      novo:             'Novo',
      em_contato:       'Em contato',
      proposta_enviada: 'Proposta enviada',
      convertido:       'Convertido',
      descartado:       'Descartado',
    };

    const rows = await this.ds.query<{ status: string; total: string }[]>(
      `SELECT status, COUNT(*)::int AS total FROM leads GROUP BY status`,
    );

    const map = new Map(rows.map(r => [r.status, Number(r.total)]));
    return ORDEM.map(s => ({ status: s, label: LABELS[s] ?? s, total: map.get(s) ?? 0 }));
  }

  async relatorioConsultores(de: string, ate: string): Promise<RelatorioConsultor[]> {
    const rows = await this.ds.query<{
      nome: string; consultas: string; leads: string; convertidos: string;
    }[]>(`
      SELECT
        COALESCE(u.nome, 'Sem identificação')                              AS nome,
        COUNT(DISTINCT c.id)::int                                          AS consultas,
        COUNT(DISTINCT l.id)::int                                          AS leads,
        COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'convertido')::int  AS convertidos
      FROM consultas c
      LEFT JOIN usuarios u  ON u.id::text = c.usuario_id::text
      LEFT JOIN leads   l  ON l.cnpj = c.cnpj
      WHERE c.consultado_em >= $1
        AND c.consultado_em <  $2::date + INTERVAL '1 day'
      GROUP BY COALESCE(u.nome, 'Sem identificação')
      ORDER BY consultas DESC
    `, [de, ate]);

    return rows.map(r => {
      const leads = Number(r.leads);
      const conv  = Number(r.convertidos);
      return {
        nome:          r.nome,
        consultas:     Number(r.consultas),
        leads,
        convertidos:   conv,
        taxaConversao: leads > 0 ? Math.round((conv / leads) * 100) : 0,
      };
    });
  }
}
