import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { extname, join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { chromium } from 'playwright';
import { sanitizeCnpj } from '../common/utils/cnpj.util';
import { Empresa } from '../cnpj/entities/empresa.entity';
import {
  Certidao,
  CertidaoTipo,
  CertidaoStatus,
  CertidaoOrigem,
  CERTIDAO_LABELS,
  CERTIDAO_AUTOMATIZAVEL,
} from '../database/entities/certidao.entity';
import { RegistrarDto, AtualizarStatusDto } from './certidoes.dto';
import { CertidoesScraperService } from './certidoes-scraper.service';
import { Anexo } from '../database/entities/anexo.entity';
import { Lead } from '../leads/entities/lead.entity';

export interface ChecklistItem {
  tipo: CertidaoTipo;
  label: string;
  status: CertidaoStatus;
  validade: string | null;
  diasParaVencer: number | null;
  automatizavel: boolean;
  certidaoId: string | null;
  dataConsulta: Date | null;
  urlArquivo: string | null;
}

const TODOS_TIPOS = Object.values(CertidaoTipo);

function diasParaVencer(validade: string | null): number | null {
  if (!validade) return null;
  const diff = new Date(validade).getTime() - Date.now();
  return Math.ceil(diff / 86_400_000);
}

@Injectable()
export class CertidoesService {
  constructor(
    @InjectRepository(Certidao)
    private readonly certidaoRepo: Repository<Certidao>,
    @InjectRepository(Anexo)
    private readonly anexoRepo: Repository<Anexo>,
    @InjectRepository(Empresa)
    private readonly empresaRepo: Repository<Empresa>,
    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,
    private readonly scraper: CertidoesScraperService,
  ) {}

  private async resolverEmpresa(cnpj: string): Promise<Empresa> {
    const sanitized = sanitizeCnpj(cnpj);
    const empresa = await this.empresaRepo.findOne({ where: { cnpj: sanitized } });
    if (!empresa) {
      throw new NotFoundException('Empresa não encontrada. Consulte o CNPJ antes de gerenciar certidões.');
    }
    return empresa;
  }

  async registrar(cnpj: string, dto: RegistrarDto): Promise<Certidao> {
    const empresa = await this.resolverEmpresa(cnpj);
    const sanitized = sanitizeCnpj(cnpj);

    let certidao = await this.certidaoRepo.findOne({
      where: { empresaId: empresa.id, tipo: dto.tipo },
    });

    if (!certidao) {
      certidao = this.certidaoRepo.create({ empresaId: empresa.id, cnpj: sanitized });
    }

    certidao.tipo = dto.tipo;
    certidao.status = dto.status ?? CertidaoStatus.NAO_CONSULTADA;
    certidao.validade = dto.validade ?? null;
    certidao.observacoes = dto.observacoes ?? null;
    certidao.responsavelId = dto.responsavelId ?? null;
    certidao.urlArquivo = dto.urlArquivo ?? null;

    return this.certidaoRepo.save(certidao);
  }

  async listarPorEmpresa(cnpj: string): Promise<Certidao[]> {
    const empresa = await this.resolverEmpresa(cnpj);
    return this.certidaoRepo.find({
      where: { empresaId: empresa.id },
      order: { tipo: 'ASC' },
    });
  }

  async atualizarStatus(id: string, dto: AtualizarStatusDto): Promise<Certidao> {
    const certidao = await this.certidaoRepo.findOne({ where: { id } });
    if (!certidao) throw new NotFoundException('Certidão não encontrada.');

    certidao.status = dto.status;
    if (dto.validade !== undefined) certidao.validade = dto.validade;
    if (dto.observacoes !== undefined) certidao.observacoes = dto.observacoes;
    if (dto.dataConsulta !== undefined) certidao.dataConsulta = dto.dataConsulta;
    if (dto.origem !== undefined) certidao.origem = dto.origem;
    if (dto.urlArquivo !== undefined) certidao.urlArquivo = dto.urlArquivo;

    return this.certidaoRepo.save(certidao);
  }

  async checklist(cnpj: string): Promise<ChecklistItem[]> {
    const empresa = await this.resolverEmpresa(cnpj);
    const existentes = await this.certidaoRepo.find({ where: { empresaId: empresa.id } });
    const mapa = new Map(existentes.map((c) => [c.tipo, c]));

    return TODOS_TIPOS.map((tipo) => {
      const c = mapa.get(tipo);
      return {
        tipo,
        label: CERTIDAO_LABELS[tipo],
        status: c?.status ?? CertidaoStatus.NAO_CONSULTADA,
        validade: c?.validade ?? null,
        diasParaVencer: diasParaVencer(c?.validade ?? null),
        automatizavel: CERTIDAO_AUTOMATIZAVEL[tipo],
        certidaoId: c?.id ?? null,
        dataConsulta: c?.dataConsulta ?? null,
        urlArquivo: c?.urlArquivo ?? null,
      };
    });
  }

  async alertas(diasAntecedencia = 30): Promise<Certidao[]> {
    const dataLimite = new Date();
    dataLimite.setDate(dataLimite.getDate() + diasAntecedencia);
    const isoLimite = dataLimite.toISOString().slice(0, 10);

    const irregulares = await this.certidaoRepo.find({
      where: { status: CertidaoStatus.IRREGULAR },
      order: { atualizadoEm: 'DESC' },
      take: 100,
    });

    const vencendo = await this.certidaoRepo
      .createQueryBuilder('c')
      .where('c.status = :status', { status: CertidaoStatus.REGULAR })
      .andWhere('c.validade IS NOT NULL')
      .andWhere('c.validade <= :limite', { limite: isoLimite })
      .orderBy('c.validade', 'ASC')
      .take(100)
      .getMany();

    const seen = new Set<string>();
    return [...irregulares, ...vencendo].filter((c) => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  }

  async consultarAutomatico(cnpj: string): Promise<Record<string, unknown>> {
    const empresa = await this.resolverEmpresa(cnpj);
    const sanitized = sanitizeCnpj(cnpj);
    const resultados: Record<string, unknown> = {};

    const scrapers: Partial<Record<CertidaoTipo, () => Promise<import('./certidoes-scraper.service').ResultadoScraper>>> = {
      [CertidaoTipo.FGTS_CRF]:           () => this.scraper.consultarFgts(sanitized),
      [CertidaoTipo.CNDT_TRABALHISTA]:    () => this.scraper.consultarCndt(sanitized),
      [CertidaoTipo.CND_FEDERAL]:         () => this.scraper.consultarCndFederal(sanitized),
      [CertidaoTipo.DIVIDA_ATIVA]:        () => this.scraper.consultarCndFederal(sanitized),
      [CertidaoTipo.INSCRICAO_ESTADUAL]:  () => this.scraper.consultarInscricaoEstadual(sanitized, empresa.uf),
      [CertidaoTipo.ESTADUAL]:            () => this.scraper.consultarCndEstadual(sanitized, empresa.uf),
      [CertidaoTipo.MUNICIPAL]:           () => this.scraper.consultarCertidaoMunicipal(sanitized, empresa.uf, empresa.municipio),
      [CertidaoTipo.INSCRICAO_MUNICIPAL]: () => this.scraper.consultarInscricaoMunicipal(sanitized, empresa.uf, empresa.municipio),
    };

    for (const tipo of TODOS_TIPOS) {
      const scraperFn = scrapers[tipo];

      if (!scraperFn) {
        resultados[tipo] = 'requer_acao_manual';
        await this.upsertCertidao(empresa.id, sanitized, tipo, CertidaoStatus.CONSULTA_MANUAL, null, CertidaoOrigem.AUTOMATICO);
        continue;
      }

      const resultado = await scraperFn();
      resultados[tipo] = resultado;

      const novoStatus = resultado.status === 'REGULAR'     ? CertidaoStatus.REGULAR
                       : resultado.status === 'IRREGULAR'   ? CertidaoStatus.IRREGULAR
                       : CertidaoStatus.INDISPONIVEL;

      await this.upsertCertidao(empresa.id, sanitized, tipo, novoStatus, resultado.validade, CertidaoOrigem.AUTOMATICO, resultado.urlArquivo ?? null);
    }

    return resultados;
  }

  async anexarPdf(
    certidaoId: string,
    file: Express.Multer.File,
  ): Promise<Anexo> {
    const certidao = await this.certidaoRepo.findOne({ where: { id: certidaoId } });
    if (!certidao) throw new NotFoundException('Certidão não encontrada.');

    const uploadDir = join(process.cwd(), 'uploads', 'certidoes');
    if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

    const ext = extname(file.originalname) || '.pdf';
    const filename = `${certidaoId}-${Date.now()}${ext}`;
    const filepath = join(uploadDir, filename);

    writeFileSync(filepath, file.buffer);

    const url = `/uploads/certidoes/${filename}`;
    const anexo = this.anexoRepo.create({
      empresaId: certidao.empresaId,
      certidaoId,
      nomeArquivo: file.originalname,
      url,
    });
    const salvo = await this.anexoRepo.save(anexo);

    // Atualiza urlArquivo na certidão
    certidao.urlArquivo = url;
    await this.certidaoRepo.save(certidao);

    return salvo;
  }

  async listarAnexos(certidaoId: string): Promise<Anexo[]> {
    const certidao = await this.certidaoRepo.findOne({ where: { id: certidaoId } });
    if (!certidao) throw new NotFoundException('Certidão não encontrada.');
    return this.anexoRepo.find({
      where: { certidaoId },
      order: { uploadedEm: 'DESC' },
    });
  }

  async consultarLote(cnpjs?: string[]): Promise<{
    total: number;
    consultados: number;
    erros: string[];
  }> {
    let lista: string[];

    if (cnpjs && cnpjs.length > 0) {
      lista = cnpjs.map(sanitizeCnpj);
    } else {
      const leads = await this.leadRepo.find({ select: { cnpj: true } });
      lista = [...new Set(leads.map((l) => l.cnpj))];
    }

    const erros: string[] = [];
    let consultados = 0;

    for (const cnpj of lista) {
      try {
        await this.consultarAutomatico(cnpj);
        consultados++;
      } catch (err) {
        erros.push(`${cnpj}: ${err}`);
      }
      // Delay entre consultas para não sobrecarregar os portais
      await new Promise((r) => setTimeout(r, 3_000));
    }

    return { total: lista.length, consultados, erros };
  }

  async gerarRelatorioPendencias(): Promise<Buffer> {
    const leads = await this.leadRepo.find({ select: { cnpj: true } });
    const cnpjs = [...new Set(leads.map((l) => l.cnpj))];

    interface ItemPendente { label: string; status: string; validade: string | null; diasParaVencer: number | null }
    interface EmpresaPendente { cnpj: string; razaoSocial: string; itens: ItemPendente[] }

    const empresasPendentes: EmpresaPendente[] = [];

    for (const cnpj of cnpjs) {
      let empresa: Empresa | null;
      try { empresa = await this.resolverEmpresa(cnpj); } catch { continue; }

      const checklist = await this.checklist(cnpj);
      const pendentes = checklist.filter((i) => {
        if (i.status === CertidaoStatus.IRREGULAR) return true;
        if (i.diasParaVencer !== null && i.diasParaVencer <= 30) return true;
        if (i.status === CertidaoStatus.NAO_CONSULTADA) return true;
        return false;
      });

      if (pendentes.length === 0) continue;

      empresasPendentes.push({
        cnpj,
        razaoSocial: empresa.razaoSocial,
        itens: pendentes.map((i) => ({
          label: i.label,
          status: i.status,
          validade: i.validade,
          diasParaVencer: i.diasParaVencer,
        })),
      });
    }

    const dataGeracao = new Date().toLocaleString('pt-BR', { timeZone: 'America/Bahia' });

    function statusLabel(s: string): string {
      const m: Record<string, string> = {
        IRREGULAR: 'Irregular', NAO_CONSULTADA: 'Não consultada',
        REGULAR: 'Vencendo', CONSULTA_MANUAL: 'Manual necessária',
        INDISPONIVEL: 'Indisponível', EXIGE_CERTIFICADO: 'Exige certificado',
      };
      return m[s] ?? s;
    }

    function statusColor(s: string): string {
      if (s === 'IRREGULAR') return '#c0392b';
      if (s === 'NAO_CONSULTADA') return '#6b7280';
      return '#d97706';
    }

    function formatCnpj(c: string): string {
      if (/^\d{14}$/.test(c)) return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
      return c;
    }

    function descValidade(dias: number | null, validade: string | null): string {
      if (!validade) return '';
      if (dias === null) return `Válida até ${validade}`;
      if (dias < 0) return `Vencida há ${Math.abs(dias)} dia(s)`;
      if (dias === 0) return 'Vence hoje';
      if (dias <= 30) return `Vence em ${dias} dia(s)`;
      return '';
    }

    const blocos = empresasPendentes.map((emp) => `
      <div class="empresa">
        <div class="empresa-header">
          <span class="cnpj">${formatCnpj(emp.cnpj)}</span>
          <span class="razao">${emp.razaoSocial}</span>
        </div>
        <table>
          <thead><tr><th>Certidão</th><th>Status</th><th>Validade</th></tr></thead>
          <tbody>
            ${emp.itens.map((i) => `
              <tr>
                <td>${i.label}</td>
                <td><span class="pill" style="color:${statusColor(i.status)}">${statusLabel(i.status)}</span></td>
                <td class="validade">${descValidade(i.diasParaVencer, i.validade)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`).join('');

    const semPendencias = empresasPendentes.length === 0
      ? '<p class="ok">Nenhuma pendência encontrada. Todas as certidões estão regulares.</p>'
      : '';

    const html = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#1a1a1a;padding:44px 50px;line-height:1.5}
  .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #172554;padding-bottom:12px;margin-bottom:24px}
  .header-left h1{font-size:15px;font-weight:800;color:#172554}
  .header-left p{font-size:10px;color:#6b7280;margin-top:2px}
  .header-right{text-align:right;font-size:10px;color:#6b7280;line-height:1.7}
  .resumo{background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px 14px;margin-bottom:20px;font-size:11px;color:#1e40af;font-weight:600}
  .empresa{margin-bottom:20px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden}
  .empresa-header{background:#172554;padding:8px 12px;display:flex;gap:12px;align-items:baseline}
  .cnpj{font-weight:700;color:#D4AF37;font-size:11px;white-space:nowrap}
  .razao{color:#e0e7ff;font-size:12px;font-weight:600}
  table{width:100%;border-collapse:collapse}
  th{background:#f8fafc;padding:6px 12px;text-align:left;font-size:10px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.3px;border-bottom:1px solid #e5e7eb}
  td{padding:7px 12px;border-bottom:1px solid #f1f5f9;font-size:11.5px;color:#374151}
  tr:last-child td{border-bottom:none}
  tr:nth-child(even) td{background:#fafafa}
  .pill{font-weight:700;font-size:11px}
  .validade{color:#6b7280}
  .ok{text-align:center;padding:40px;color:#6b7280;font-size:13px}
  .footer{margin-top:32px;border-top:1px solid #e5e7eb;padding-top:10px;font-size:10px;color:#9ca3af;display:flex;justify-content:space-between}
</style></head><body>
<div class="header">
  <div class="header-left">
    <h1>Relatório de Pendências — Certidões</h1>
    <p>Certidões irregulares, vencendo em 30 dias ou ainda não consultadas</p>
  </div>
  <div class="header-right">
    <span>Everest/FK's</span><br>
    <span>${dataGeracao}</span><br>
    <span>Uso interno</span>
  </div>
</div>
${empresasPendentes.length > 0 ? `<div class="resumo">${empresasPendentes.length} empresa(s) com pendências — ${empresasPendentes.reduce((s, e) => s + e.itens.length, 0)} item(s) no total</div>` : ''}
${blocos}${semPendencias}
<div class="footer">
  <span>Radar Empresarial Everest/FK's — Uso interno</span>
  <span>Gerado em ${dataGeracao}</span>
</div>
</body></html>`;

    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' } });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }

  private async upsertCertidao(
    empresaId: string,
    cnpj: string,
    tipo: CertidaoTipo,
    status: CertidaoStatus,
    validade: string | null,
    origem: CertidaoOrigem,
    urlArquivo: string | null = null,
  ): Promise<void> {
    let c = await this.certidaoRepo.findOne({ where: { empresaId, tipo } });
    if (!c) c = this.certidaoRepo.create({ empresaId, cnpj });
    c.tipo = tipo;
    c.status = status;
    c.validade = validade;
    c.dataConsulta = new Date();
    c.origem = origem;
    if (urlArquivo) c.urlArquivo = urlArquivo;
    await this.certidaoRepo.save(c);
  }
}
