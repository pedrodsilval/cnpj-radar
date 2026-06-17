import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { sanitizeCnpj } from '../common/utils/cnpj.util';
import { Empresa } from '../cnpj/entities/empresa.entity';
import { Socio } from '../cnpj/entities/socio.entity';
import { Lead, LeadStatus } from './entities/lead.entity';
import { HistoricoStatus } from './entities/historico-status.entity';
import { ScoresService } from './scores.service';
import { LeadsPdfService } from './leads-pdf.service';

export interface PropostaResponse {
  tipo: 'proposta' | 'diagnostico';
  titulo: string;
  cnpj: string;
  razaoSocial: string;
  scores: { cadastral: number | null; comercial: number | null; atencao: number | null };
  recomendacao: string | null;
  resumo: string;
  proximosPassos: string[];
  geradoEm: string;
}

// ─── Helpers para buildProposta ───────────────────────────────────────────────

function idadeAnos(dataInicio: string | null): number | null {
  if (!dataInicio) return null;
  return (Date.now() - new Date(dataInicio).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
}

function porteLabel(porte: string | null): string {
  if (!porte) return 'empresa';
  const p = porte.toUpperCase();
  if (p.includes('GRANDE'))                                         return 'grande empresa';
  if (p.includes('MEDIO') || p.includes('MÉDIA') || p.includes('MEDIA')) return 'empresa de médio porte';
  if (p.includes('EPP') || p.includes('PEQUENA'))                   return 'empresa de pequeno porte (EPP)';
  if (p.includes('MICRO'))                                           return 'microempresa (ME)';
  return 'empresa';
}

function setorCnae(codigo: string | null): string {
  if (!codigo) return 'setor não informado';
  const sec = parseInt(codigo.substring(0, 2), 10);
  if (isNaN(sec)) return 'setor não informado';
  if (sec >= 1  && sec <= 3)  return 'agropecuária';
  if (sec >= 5  && sec <= 9)  return 'mineração';
  if (sec >= 10 && sec <= 33) return 'indústria';
  if (sec === 35)             return 'energia';
  if (sec >= 36 && sec <= 39) return 'saneamento/meio ambiente';
  if (sec >= 41 && sec <= 43) return 'construção civil';
  if (sec >= 45 && sec <= 47) return 'comércio';
  if (sec >= 49 && sec <= 53) return 'transporte e logística';
  if (sec >= 55 && sec <= 56) return 'hospedagem e alimentação';
  if (sec >= 58 && sec <= 63) return 'comunicação e tecnologia';
  if (sec >= 64 && sec <= 66) return 'serviços financeiros';
  if (sec === 68)             return 'mercado imobiliário';
  if (sec >= 69 && sec <= 75) return 'serviços profissionais';
  if (sec >= 77 && sec <= 82) return 'serviços administrativos';
  if (sec === 85)             return 'educação';
  if (sec >= 86 && sec <= 88) return 'saúde';
  if (sec >= 90 && sec <= 93) return 'cultura e entretenimento';
  if (sec >= 94 && sec <= 96) return 'outros serviços';
  return 'setor de serviços';
}

function capitalLabel(capital: number | null): string {
  if (!capital || capital <= 0) return 'capital social não declarado';
  if (capital < 1_000)          return `capital social de R$ ${capital.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
  if (capital < 10_000)         return `capital social de R$ ${(capital / 1000).toFixed(0)}k`;
  if (capital < 1_000_000)      return `capital de R$ ${(capital / 1000).toFixed(0)}k`;
  return `capital de R$ ${(capital / 1_000_000).toFixed(1)}M`;
}

function contatoDisponivel(empresa: Empresa | null): string {
  if (!empresa) return '';
  if (empresa.email && empresa.telefone) return `Contatos disponíveis: ${empresa.email} / ${empresa.telefone}.`;
  if (empresa.email)                    return `E-mail disponível: ${empresa.email}.`;
  if (empresa.telefone)                 return `Telefone disponível: ${empresa.telefone}.`;
  return 'Nenhum contato registrado na Receita Federal — buscar contato via redes sociais ou site.';
}

// ─── Lógica principal ─────────────────────────────────────────────────────────

function buildProposta(lead: Lead, empresa: Empresa | null): PropostaResponse {
  const situacao  = empresa?.situacaoCadastral ?? 'DESCONHECIDA';
  const ativa     = situacao === 'ATIVA';
  const mei       = empresa?.optanteMei === true;
  const simples   = empresa?.optanteSimples === true;
  const atencao   = lead.scoreAtencao  ?? 0;
  const comercial = lead.scoreComercial ?? 0;
  const anos      = idadeAnos(empresa?.dataInicioAtividade ?? null);
  const setor     = setorCnae(empresa?.cnaePrincipalCodigo ?? null);
  const pLabel    = porteLabel(empresa?.porte ?? null);
  const capLabel  = capitalLabel(empresa?.capitalSocial ?? null);
  const nome      = empresa?.razaoSocial ?? lead.cnpj;
  const regiao    = empresa?.uf === 'BA' ? 'Salvador/BA' : (empresa?.municipio ? `${empresa.municipio}/${empresa.uf}` : null);
  const cnaDesc   = empresa?.cnaePrincipalDescricao ?? null;
  const contato   = contatoDisponivel(empresa);

  let tipo: 'proposta' | 'diagnostico';
  let titulo: string;
  let resumo: string;
  let proximosPassos: string[];

  // ── 1. Empresa inativa ──────────────────────────────────────────────────────
  if (!ativa && empresa) {
    tipo = 'diagnostico';

    const motivoMap: Record<string, string> = {
      BAIXADA:   'encerrada (baixada)',
      INAPTA:    'inapta (omissão de declarações)',
      SUSPENSA:  'com inscrição suspensa',
      NULA:      'nula (erro de cadastro)',
    };
    const motivoLabel = motivoMap[situacao] ?? `com situação "${situacao}"`;

    titulo = `Diagnóstico — ${nome} (${situacao})`;
    resumo = `${nome} é uma ${pLabel} no setor de ${setor}` +
      (regiao ? `, sediada em ${regiao},` : '') +
      ` com situação cadastral ${motivoLabel}.` +
      (anos ? ` Possui ${Math.floor(anos)} ano${Math.floor(anos) !== 1 ? 's' : ''} de registro.` : '') +
      ' Não recomendada para abordagem comercial no momento.';

    if (situacao === 'INAPTA') {
      proximosPassos = [
        'Verificar pendências fiscais que motivaram a inaptidão (omissão de DIRPJ/DEFIS)',
        "Avaliar interesse do responsável em regularizar — oferecer serviço de reativação Everest/FK's",
        'Se houver interesse, levantar pendências junto à Receita Federal (e-CAC)',
        'Elaborar orçamento de regularização antes de qualquer proposta de honorários contínuos',
      ];
    } else if (situacao === 'SUSPENSA') {
      proximosPassos = [
        'Verificar motivo da suspensão junto à Receita Federal',
        'Avaliar possibilidade de reativação com o responsável legal',
        'Oferecer consultoria de regularização cadastral e fiscal',
      ];
    } else {
      proximosPassos = [
        'Registrar como inativa na base de leads — não priorizar para abordagem',
        'Monitorar reabertura (nova empresa na mesma razão social ou sócios)',
        "Manter registro para histórico de relacionamento com a Everest/FK's",
      ];
    }

  // ── 2. MEI ──────────────────────────────────────────────────────────────────
  } else if (ativa && mei) {
    tipo   = 'diagnostico';
    titulo = `Diagnóstico MEI — ${nome}`;
    const anosStr = anos ? `${Math.floor(anos)} ano${Math.floor(anos) !== 1 ? 's' : ''} como MEI` : 'tempo de MEI não informado';
    resumo = `${nome} é um MEI no setor de ${setor}` +
      (cnaDesc ? ` (${cnaDesc})` : '') +
      (regiao ? `, em ${regiao},` : '') +
      ` com ${anosStr}.` +
      ` ${capLabel.charAt(0).toUpperCase() + capLabel.slice(1)}.` +
      ' Abordagem educacional recomendada com foco na migração para ME/EPP, que amplia o acesso a serviços contábeis completos e benefícios fiscais.';
    proximosPassos = [
      `Contato inicial com o responsável: ${contato || 'buscar contato via redes sociais'}`,
      'Apresentar os limites do MEI (R$81k/ano) e os riscos de ultrapassar o teto',
      'Preparar comparativo MEI × ME: custos, benefícios e obrigações',
      "Oferecer reunião gratuita de orientação tributária — gancho para conversão em cliente Everest/FK's",
      'Monitorar faturamento: se próximo do limite, acelerar abordagem',
    ];

  // ── 3. Atenção crítica (≥ 60) ───────────────────────────────────────────────
  } else if (ativa && atencao >= 60) {
    tipo   = 'diagnostico';
    titulo = `Diagnóstico Urgente — ${nome}`;
    resumo = `${nome} é uma ${pLabel} no setor de ${setor}` +
      (cnaDesc ? ` (${cnaDesc})` : '') +
      (regiao ? `, em ${regiao},` : '') +
      ` com score de atenção de ${atencao}/100 — nível crítico.` +
      (anos ? ` Opera há ${Math.floor(anos)} ano${Math.floor(anos) !== 1 ? 's' : ''}.` : '') +
      ` ${capLabel.charAt(0).toUpperCase() + capLabel.slice(1)}.` +
      ' Pendências significativas identificadas. Diagnóstico obrigatório antes de qualquer proposta.';
    proximosPassos = [
      `Primeiro contato: ${contato || 'buscar contato via redes sociais ou site'}`,
      'Solicitar acesso ao e-CAC para levantamento completo de pendências fiscais',
      'Verificar situação das certidões: FGTS, CND Federal, Dívida Ativa, Trabalhista (CNDT) e Estadual',
      'Levantar débitos com Receita Federal, PGFN e Secretaria Estadual de Fazenda',
      'Apresentar diagnóstico de regularidade e orçamento de regularização antes de honorários contínuos',
    ];

  // ── 4. Atenção elevada (40–59) ───────────────────────────────────────────────
  } else if (ativa && atencao >= 40) {
    tipo   = 'diagnostico';
    titulo = `Diagnóstico Inicial — ${nome}`;
    resumo = `${nome} é uma ${pLabel} no setor de ${setor}` +
      (cnaDesc ? ` (${cnaDesc})` : '') +
      (regiao ? `, em ${regiao},` : '') +
      ` com score de atenção de ${atencao}/100 — pontos de verificação identificados.` +
      (simples ? ' Optante pelo Simples Nacional.' : '') +
      (anos ? ` Opera há ${Math.floor(anos)} ano${Math.floor(anos) !== 1 ? 's' : ''}.` : '') +
      ` ${capLabel.charAt(0).toUpperCase() + capLabel.slice(1)}.` +
      ' Recomendado diagnóstico de regularidade antes de qualquer proposta formal.';
    proximosPassos = [
      `Contato com o responsável: ${contato || 'buscar contato via redes sociais'}`,
      'Oferecer diagnóstico tributário e fiscal gratuito ou a custo simbólico',
      'Verificar regularidade de certidões (FGTS, CND Federal, Estadual)',
      'Identificar regime tributário atual e avaliar enquadramento correto',
      `Após diagnóstico: elaborar proposta de honorários mensais para ${pLabel}`,
    ];

  // ── 5. Alta aderência comercial (≥ 70) ──────────────────────────────────────
  } else if (ativa && comercial >= 70) {
    tipo   = 'proposta';
    titulo = `Proposta Comercial — ${nome}`;
    const regimeStr = mei ? 'MEI' : simples ? 'Simples Nacional' : 'Lucro Presumido/Real';
    resumo = `${nome} é uma ${pLabel} no setor de ${setor}` +
      (cnaDesc ? ` (${cnaDesc})` : '') +
      (regiao ? `, em ${regiao},` : '') +
      ` com score comercial de ${comercial}/100 — alta aderência ao portfólio Everest/FK's.` +
      ` Regime tributário: ${regimeStr}.` +
      (anos ? ` Opera há ${Math.floor(anos)} ano${Math.floor(anos) !== 1 ? 's' : ''}.` : '') +
      ` ${capLabel.charAt(0).toUpperCase() + capLabel.slice(1)}.` +
      ' Abordagem consultiva prioritária — empresa com perfil ideal para os serviços contábeis da Everest/FK\'s.';
    proximosPassos = [
      `Contato prioritário: ${contato || 'buscar contato via redes sociais ou site'}`,
      `Apresentar portfólio Everest/FK's com ênfase nos serviços para ${setor}`,
      simples
        ? 'Avaliar enquadramento no Simples Nacional e oportunidades de economia tributária'
        : 'Comparar regimes tributários (Simples × Lucro Presumido × Lucro Real)',
      'Elaborar proposta formal de honorários com escopo detalhado',
      'Definir responsável interno e cronograma de onboarding',
    ];

  // ── 6. Aderência moderada (40–69) ───────────────────────────────────────────
  } else if (ativa && comercial >= 40) {
    tipo   = 'proposta';
    titulo = `Proposta Comercial — ${nome}`;
    const regimeStr = simples ? 'Simples Nacional' : 'Lucro Presumido/Real';
    resumo = `${nome} é uma ${pLabel} no setor de ${setor}` +
      (cnaDesc ? ` (${cnaDesc})` : '') +
      (regiao ? `, em ${regiao},` : '') +
      ` com score comercial de ${comercial}/100 — aderência moderada.` +
      ` Regime tributário presumido: ${regimeStr}.` +
      (anos ? ` Opera há ${Math.floor(anos)} ano${Math.floor(anos) !== 1 ? 's' : ''}.` : '') +
      ` ${capLabel.charAt(0).toUpperCase() + capLabel.slice(1)}.` +
      ' Recomendada abordagem consultiva para validar aderência antes de proposta formal.';
    proximosPassos = [
      `Contato exploratório: ${contato || 'buscar contato via redes sociais ou site'}`,
      `Entender necessidades específicas da empresa no setor de ${setor}`,
      'Verificar se há contabilidade atual e condições de migração',
      "Apresentar diferenciais Everest/FK's para o segmento",
      'Se houver interesse, elaborar proposta customizada com escopo e honorários',
    ];

  // ── 7. Baixa aderência ──────────────────────────────────────────────────────
  } else {
    tipo   = 'proposta';
    titulo = `Análise Comercial — ${nome}`;
    resumo = `${nome} é uma ${pLabel} no setor de ${setor}` +
      (cnaDesc ? ` (${cnaDesc})` : '') +
      (regiao ? `, em ${regiao},` : '') +
      ` com score comercial de ${comercial}/100 — aderência baixa ao perfil atual.` +
      (anos ? ` Opera há ${Math.floor(anos)} ano${Math.floor(anos) !== 1 ? 's' : ''}.` : '') +
      ` ${capLabel.charAt(0).toUpperCase() + capLabel.slice(1)}.` +
      ' Recomendado contato exploratório antes de investir em abordagem formal.';
    proximosPassos = [
      `Verificar contato disponível: ${contato || 'sem contato registrado na Receita'}`,
      'Pesquisar a empresa em redes sociais e site para entender o perfil atual',
      'Contato exploratório para mapear necessidade real',
      'Avaliar se o perfil justifica abordagem formal ou arquivar para reavaliação',
    ];
  }

  return {
    tipo,
    titulo,
    cnpj: lead.cnpj,
    razaoSocial: empresa?.razaoSocial ?? lead.cnpj,
    scores: { cadastral: lead.scoreCadastral, comercial: lead.scoreComercial, atencao: lead.scoreAtencao },
    recomendacao: lead.recomendacao,
    resumo,
    proximosPassos,
    geradoEm: new Date().toISOString(),
  };
}

@Injectable()
export class LeadsService {
  constructor(
    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,
    @InjectRepository(Empresa)
    private readonly empresaRepo: Repository<Empresa>,
    @InjectRepository(Socio)
    private readonly socioRepo: Repository<Socio>,
    @InjectRepository(HistoricoStatus)
    private readonly historicoRepo: Repository<HistoricoStatus>,
    private readonly scoresService: ScoresService,
    private readonly leadsPdfService: LeadsPdfService,
  ) {}

  async salvarLead(cnpj: string): Promise<Lead> {
    const sanitized = sanitizeCnpj(cnpj);

    const empresa = await this.empresaRepo.findOne({ where: { cnpj: sanitized } });
    if (!empresa) {
      throw new NotFoundException(
        'CNPJ não encontrado na base local. Consulte primeiro em GET /cnpj/:cnpj.',
      );
    }

    const socios = await this.socioRepo.find({ where: { empresaId: empresa.id } });
    const { scoreCadastral, scoreComercial, scoreAtencao, recomendacao } = this.scoresService.calcular(
      empresa,
      socios.length,
    );

    let lead = await this.leadRepo.findOne({ where: { cnpj: sanitized } });
    if (!lead) {
      lead = this.leadRepo.create({ cnpj: sanitized });
    }

    lead.empresaId = empresa.id;
    lead.scoreCadastral = scoreCadastral;
    lead.scoreComercial = scoreComercial;
    lead.scoreAtencao = scoreAtencao;
    lead.recomendacao = recomendacao;

    return this.leadRepo.save(lead);
  }

  async listarLeads(): Promise<Lead[]> {
    return this.leadRepo.find({ order: { salvoEm: 'DESC' } });
  }

  async buscarLead(id: string): Promise<Lead> {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      throw new NotFoundException('ID inválido. Para buscar por CNPJ use GET /leads/cnpj/:cnpj.');
    }
    const lead = await this.leadRepo.findOne({ where: { id } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    return lead;
  }

  async buscarLeadPorCnpj(cnpj: string): Promise<Lead> {
    const sanitized = sanitizeCnpj(cnpj);
    const lead = await this.leadRepo.findOne({ where: { cnpj: sanitized } });
    if (!lead) throw new NotFoundException('Nenhum lead salvo para este CNPJ.');
    return lead;
  }

  async gerarProposta(id: string): Promise<PropostaResponse> {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) throw new NotFoundException('ID inválido.');

    const lead = await this.leadRepo.findOne({ where: { id } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');

    const empresa = lead.empresaId
      ? await this.empresaRepo.findOne({ where: { id: lead.empresaId } })
      : null;

    return buildProposta(lead, empresa);
  }

  async gerarPropostaPdf(id: string): Promise<Buffer> {
    const proposta = await this.gerarProposta(id);
    return this.leadsPdfService.gerarPdf(proposta);
  }

  async atualizarStatus(id: string, novoStatus: string): Promise<Lead> {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) throw new NotFoundException('ID inválido.');

    const validos = Object.values(LeadStatus);
    if (!validos.includes(novoStatus as LeadStatus)) {
      throw new BadRequestException(`Status inválido. Valores aceitos: ${validos.join(', ')}`);
    }

    const lead = await this.leadRepo.findOne({ where: { id } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');

    const statusAnterior = lead.status;
    lead.status = novoStatus as LeadStatus;
    const salvo = await this.leadRepo.save(lead);

    await this.historicoRepo.save(
      this.historicoRepo.create({
        leadId: id,
        campoAlterado: 'status',
        valorAnterior: statusAnterior,
        valorNovo: novoStatus,
        alteradoPor: null,
      }),
    );

    return salvo;
  }
}
