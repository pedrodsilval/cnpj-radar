import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { sanitizeCnpj } from '../common/utils/cnpj.util';
import { Empresa } from '../cnpj/entities/empresa.entity';
import { Socio } from '../cnpj/entities/socio.entity';
import { Lead, LeadStatus } from './entities/lead.entity';
import { HistoricoStatus } from './entities/historico-status.entity';
import { ScoresService } from './scores.service';

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

function buildProposta(lead: Lead, empresa: Empresa | null): PropostaResponse {
  const inativa  = empresa && empresa.situacaoCadastral !== 'ATIVA';
  const mei      = empresa?.optanteMei === true;
  const atencao  = lead.scoreAtencao ?? 0;
  const comercial = lead.scoreComercial ?? 0;

  let tipo: 'proposta' | 'diagnostico';
  let resumo: string;
  let proximosPassos: string[];

  if (inativa) {
    tipo = 'diagnostico';
    resumo = `Empresa com situação cadastral "${empresa!.situacaoCadastral}". Não indicada para abordagem comercial no momento.`;
    proximosPassos = [
      "Registrar empresa como inativa na base de leads",
      "Verificar histórico de relacionamento com a Everest/FK's",
      "Aguardar eventual reabertura ou sucessão societária",
    ];
  } else if (mei) {
    tipo = 'diagnostico';
    resumo = 'Empresa MEI. Abordagem educacional recomendada com foco na migração para ME/EPP.';
    proximosPassos = [
      'Apresentar vantagens da formalização como Microempresa',
      'Preparar comparativo de custos MEI vs. ME',
      'Agendar reunião de orientação tributária gratuita',
    ];
  } else if (atencao >= 40) {
    tipo = 'diagnostico';
    resumo = `Score de atenção de ${atencao}/100 indica pontos críticos a verificar antes de qualquer proposta formal.`;
    proximosPassos = [
      'Verificar certidões fiscais e trabalhistas',
      'Levantar e regularizar pendências cadastrais',
      'Agendar diagnóstico tributário antes de proposta',
    ];
  } else if (comercial >= 70) {
    tipo = 'proposta';
    resumo = `Score comercial de ${comercial}/100 indica alta aderência ao portfólio Everest/FK's. Abordagem consultiva prioritária.`;
    proximosPassos = [
      'Contato inicial com o responsável pela empresa',
      "Apresentação dos serviços Everest/FK's",
      'Elaborar proposta formal de honorários',
    ];
  } else {
    tipo = 'proposta';
    resumo = `Score comercial de ${comercial}/100 indica aderência moderada. Verificar aderência antes de proposta formal.`;
    proximosPassos = [
      'Contato exploratório para entender necessidades',
      'Verificar aderência ao portfólio de serviços',
      'Agendar reunião de diagnóstico',
    ];
  }

  const nomeDisplay = empresa?.razaoSocial ?? lead.cnpj;
  const titulo = tipo === 'proposta'
    ? `Proposta Comercial — ${nomeDisplay}`
    : `Diagnóstico Inicial — ${nomeDisplay}`;

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
