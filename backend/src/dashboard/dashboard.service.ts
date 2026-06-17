import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TarefasService } from '../tarefas/tarefas.service';

export interface ConsultasPorMes {
  mes: string;  // YYYY-MM
  total: number;
}

export interface DashboardDto {
  totalConsultasMes: number;
  totalLeads: number;
  totalClientes: number;
  taxaConversaoLeads: number;
  oportunidadesParadas: number;
  alertasCertidoesCriticos: number;
  tarefasPendentes: number;
  consultasPorMes: ConsultasPorMes[];
  topCnaes: { codigo: string; descricao: string; total: number }[];
  topConsultores: { nome: string; total: number }[];
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly ds: DataSource,
    private readonly tarefasService: TarefasService,
  ) {}

  async resumo(): Promise<DashboardDto> {
    const agora = new Date();
    const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString();

    const [
      consultasMesRaw,
      leadsRaw,
      clientesRaw,
      oportunidadesRaw,
      alertasRaw,
      consultasPorMesRaw,
      topCnaesRaw,
    ] = await Promise.all([
      this.ds.query<{ total: string }[]>(`
        SELECT COUNT(*)::int AS total FROM consultas WHERE consultado_em >= $1
      `, [inicioMes]),

      this.ds.query<{ total: string; clientes: string }[]>(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'convertido')::int AS clientes
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
        WHERE consultado_em >= NOW() - INTERVAL '6 months'
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
        WHERE c.consultado_em >= NOW() - INTERVAL '30 days'
          AND e.cnae_principal_codigo IS NOT NULL
        GROUP BY e.cnae_principal_codigo
        ORDER BY total DESC
        LIMIT 5
      `),
    ]);

    const tarefasPendentes = await this.tarefasService.contarPendentes();

    const totalLeads    = Number(leadsRaw[0]?.total    ?? 0);
    const totalClientes = Number(leadsRaw[0]?.clientes ?? 0) + Number(clientesRaw[0]?.total ?? 0);

    // top consultores: quem mais criou consultas no mês (via usuario_id na tabela consultas se existir, senão placeholder)
    const topConsultoresRaw = await this.ds.query<{ nome: string; total: string }[]>(`
      SELECT
        COALESCE(u.nome, 'Sem identificação') AS nome,
        COUNT(c.id)::int AS total
      FROM consultas c
      LEFT JOIN usuarios u ON u.id::text = c.usuario_id::text
      WHERE c.consultado_em >= NOW() - INTERVAL '30 days'
      GROUP BY COALESCE(u.nome, 'Sem identificação')
      ORDER BY total DESC
      LIMIT 5
    `).catch(() => [] as { nome: string; total: string }[]);

    return {
      totalConsultasMes:        Number(consultasMesRaw[0]?.total        ?? 0),
      totalLeads,
      totalClientes,
      taxaConversaoLeads:       totalLeads > 0 ? Math.round((Number(leadsRaw[0]?.clientes ?? 0) / totalLeads) * 100) : 0,
      oportunidadesParadas:     Number(oportunidadesRaw[0]?.total       ?? 0),
      alertasCertidoesCriticos: Number(alertasRaw[0]?.total             ?? 0),
      tarefasPendentes,
      consultasPorMes:          consultasPorMesRaw.map(r => ({ mes: r.mes, total: Number(r.total) })),
      topCnaes:                 topCnaesRaw.map(r => ({ codigo: r.codigo, descricao: r.descricao ?? r.codigo, total: Number(r.total) })),
      topConsultores:           topConsultoresRaw.map(r => ({ nome: r.nome, total: Number(r.total) })),
    };
  }
}
