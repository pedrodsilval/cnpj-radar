import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { CnaeConfig } from './entities/cnae-config.entity';
import { Campanha, StatusCampanha } from './entities/campanha.entity';

export interface Indicadores {
  totalEmpresas: number;
  totalLeads: number;
  cnaesUnicos: number;
  percentualMei: number;
  abertasUltimos12Meses: number;
  topUfs: { uf: string; total: number }[];
}

export interface CnaeItem {
  codigo: string;
  descricao: string;
  totalEmpresas: number;
  totalLeads: number;
  percentualMei: number;
  prioritario: boolean;
  segmento: string | null;
  ofertaSugerida: string | null;
}

export interface UpsertCnaeConfigDto {
  codigo: string;
  descricao: string;
  segmento?: string;
  ofertaSugerida?: string;
  prioritario?: boolean;
}

export interface CriarCampanhaDto {
  titulo: string;
  segmento?: string;
  cnaeCodigo?: string;
  descricao?: string;
  ofertaSugerida?: string;
  dataInicio?: string;
  dataFim?: string;
}

export interface AtualizarCampanhaDto {
  titulo?: string;
  segmento?: string;
  cnaeCodigo?: string;
  descricao?: string;
  ofertaSugerida?: string;
  status?: StatusCampanha;
  dataInicio?: string;
  dataFim?: string;
}

@Injectable()
export class PainelService {
  constructor(
    @InjectRepository(CnaeConfig)
    private readonly cnaeConfigRepo: Repository<CnaeConfig>,
    @InjectRepository(Campanha)
    private readonly campanhaRepo: Repository<Campanha>,
    private readonly dataSource: DataSource,
  ) {}

  async indicadores(uf?: string): Promise<Indicadores> {
    const ufFilter = uf ? `AND e.uf = '${uf.toUpperCase()}'` : '';

    const [[totais], topUfsRaw] = await Promise.all([
      this.dataSource.query<{ total_empresas: string; total_mei: string; abertas_12m: string }[]>(`
        SELECT
          COUNT(*)::int AS total_empresas,
          COUNT(*) FILTER (WHERE e.optante_mei = true)::int AS total_mei,
          COUNT(*) FILTER (WHERE e.data_inicio_atividade >= to_char(NOW() - INTERVAL '12 months', 'YYYY-MM-DD'))::int AS abertas_12m
        FROM empresas e
        WHERE 1=1 ${ufFilter}
      `),
      this.dataSource.query<{ uf: string; total: string }[]>(`
        SELECT e.uf, COUNT(*)::int AS total
        FROM empresas e
        WHERE e.uf IS NOT NULL ${ufFilter}
        GROUP BY e.uf
        ORDER BY total DESC
        LIMIT 10
      `),
    ]);

    const [{ total_leads }] = await this.dataSource.query<{ total_leads: string }[]>(`
      SELECT COUNT(*)::int AS total_leads FROM leads l
      JOIN empresas e ON e.cnpj = l.cnpj
      WHERE 1=1 ${ufFilter}
    `);

    const [{ cnae_unicos }] = await this.dataSource.query<{ cnae_unicos: string }[]>(`
      SELECT COUNT(DISTINCT e.cnae_principal_codigo)::int AS cnae_unicos
      FROM empresas e
      WHERE e.cnae_principal_codigo IS NOT NULL ${ufFilter}
    `);

    const totalEmpresas = Number(totais.total_empresas);
    const totalMei      = Number(totais.total_mei);

    return {
      totalEmpresas,
      totalLeads:            Number(total_leads),
      cnaesUnicos:           Number(cnae_unicos),
      percentualMei:         totalEmpresas > 0 ? Math.round((totalMei / totalEmpresas) * 100) : 0,
      abertasUltimos12Meses: Number(totais.abertas_12m),
      topUfs:                topUfsRaw.map((r) => ({ uf: r.uf, total: Number(r.total) })),
    };
  }

  async listarCnaes(uf?: string): Promise<CnaeItem[]> {
    const ufFilter = uf ? `AND e.uf = '${uf.toUpperCase()}'` : '';

    const rows = await this.dataSource.query<{
      codigo: string;
      descricao: string;
      total_empresas: string;
      total_leads: string;
      total_mei: string;
    }[]>(`
      SELECT
        e.cnae_principal_codigo                                          AS codigo,
        MAX(e.cnae_principal_descricao)                                  AS descricao,
        COUNT(DISTINCT e.id)::int                                        AS total_empresas,
        COUNT(DISTINCT l.id)::int                                        AS total_leads,
        COUNT(DISTINCT e.id) FILTER (WHERE e.optante_mei = true)::int   AS total_mei
      FROM empresas e
      LEFT JOIN leads l ON l.cnpj = e.cnpj
      WHERE e.cnae_principal_codigo IS NOT NULL ${ufFilter}
      GROUP BY e.cnae_principal_codigo
      ORDER BY total_empresas DESC
    `);

    const configs = await this.cnaeConfigRepo.find();
    const configMap = new Map(configs.map((c) => [c.codigo, c]));

    return rows.map((r) => {
      const cfg = configMap.get(r.codigo);
      const totalEmpresas = Number(r.total_empresas);
      const totalMei      = Number(r.total_mei);
      return {
        codigo:        r.codigo,
        descricao:     r.descricao ?? r.codigo,
        totalEmpresas,
        totalLeads:    Number(r.total_leads),
        percentualMei: totalEmpresas > 0 ? Math.round((totalMei / totalEmpresas) * 100) : 0,
        prioritario:   cfg?.prioritario ?? false,
        segmento:      cfg?.segmento ?? null,
        ofertaSugerida: cfg?.ofertaSugerida ?? null,
      };
    });
  }

  async listarCnaeConfig(): Promise<CnaeConfig[]> {
    return this.cnaeConfigRepo.find({ order: { segmento: 'ASC', codigo: 'ASC' } });
  }

  async upsertCnaeConfig(dto: UpsertCnaeConfigDto): Promise<CnaeConfig> {
    let cfg = await this.cnaeConfigRepo.findOne({ where: { codigo: dto.codigo } });
    if (!cfg) cfg = this.cnaeConfigRepo.create({ codigo: dto.codigo });
    cfg.descricao      = dto.descricao;
    cfg.segmento       = dto.segmento       ?? cfg.segmento       ?? null;
    cfg.ofertaSugerida = dto.ofertaSugerida ?? cfg.ofertaSugerida ?? null;
    cfg.prioritario    = dto.prioritario    ?? cfg.prioritario    ?? true;
    return this.cnaeConfigRepo.save(cfg);
  }

  async removerCnaeConfig(codigo: string): Promise<void> {
    await this.cnaeConfigRepo.delete({ codigo });
  }

  // ── Campanhas ──────────────────────────────────────────────────────────────

  async listarCampanhas(status?: StatusCampanha): Promise<Campanha[]> {
    const where = status ? { status } : {};
    return this.campanhaRepo.find({ where, order: { criadoEm: 'DESC' } });
  }

  async criarCampanha(dto: CriarCampanhaDto): Promise<Campanha> {
    const nova = this.campanhaRepo.create({
      titulo: dto.titulo,
      segmento: dto.segmento ?? null,
      cnaeCodigo: dto.cnaeCodigo ?? null,
      descricao: dto.descricao ?? null,
      ofertaSugerida: dto.ofertaSugerida ?? null,
      dataInicio: dto.dataInicio ?? null,
      dataFim: dto.dataFim ?? null,
      status: 'ativa',
    });
    return this.campanhaRepo.save(nova);
  }

  async atualizarCampanha(id: string, dto: AtualizarCampanhaDto): Promise<Campanha> {
    const campanha = await this.campanhaRepo.findOne({ where: { id } });
    if (!campanha) throw new NotFoundException('Campanha não encontrada.');
    Object.assign(campanha, dto);
    return this.campanhaRepo.save(campanha);
  }

  async removerCampanha(id: string): Promise<void> {
    await this.campanhaRepo.delete({ id });
  }
}
