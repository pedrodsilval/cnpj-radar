import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PDFParse } from 'pdf-parse';
import { chromium } from 'playwright';
import { Empresa } from '../cnpj/entities/empresa.entity';
import { PgdasDeclaracao } from './entities/pgdas-declaracao.entity';
import { SupabaseStorageService } from '../common/supabase-storage.service';
import { parsePgdasTexto, calcularAlertaEnquadramento } from './pgdas.parser';
import type { AlertaEnquadramentoPublico, PgdasDeclaracaoPublica } from './pgdas.dto';

@Injectable()
export class PgdasService {
  constructor(
    @InjectRepository(Empresa)
    private readonly empresaRepo: Repository<Empresa>,
    @InjectRepository(PgdasDeclaracao)
    private readonly pgdasRepo: Repository<PgdasDeclaracao>,
    private readonly storage: SupabaseStorageService,
  ) {}

  async uploadDeclaracao(empresaId: string, arquivo: Express.Multer.File): Promise<PgdasDeclaracaoPublica> {
    const empresa = await this.empresaRepo.findOne({ where: { id: empresaId } });
    if (!empresa) throw new NotFoundException(`Empresa ${empresaId} não encontrada.`);

    const parser = new PDFParse({ data: arquivo.buffer });
    const { text } = await parser.getText();

    const extraido = (() => {
      try {
        return parsePgdasTexto(text);
      } catch (err) {
        throw new BadRequestException((err as Error).message);
      }
    })();

    if (extraido.cnpjDeclarado !== empresa.cnpj) {
      throw new BadRequestException(
        `O CNPJ Matriz do PGDAS-D (${extraido.cnpjDeclarado}) não corresponde ao CNPJ desta empresa (${empresa.cnpj}).`,
      );
    }

    const url = await this.storage.uploadPdf(arquivo.buffer, `pgdas-${empresaId}`);

    const existente = await this.pgdasRepo.findOne({
      where: { empresaId, periodoApuracao: extraido.periodoApuracao },
    });

    const declaracao = this.pgdasRepo.create({
      ...(existente ?? {}),
      empresaId,
      periodoApuracao: extraido.periodoApuracao,
      rbt12: extraido.rbt12,
      receitaBrutaMes: extraido.receitaBrutaMes,
      cnpjDeclarado: extraido.cnpjDeclarado,
      nomeArquivo: arquivo.originalname,
      urlArquivo: url,
    });

    return this.paraPublico(await this.pgdasRepo.save(declaracao));
  }

  async listarPorEmpresa(empresaId: string): Promise<PgdasDeclaracaoPublica[]> {
    const declaracoes = await this.pgdasRepo.find({
      where: { empresaId },
      order: { periodoApuracao: 'DESC' },
    });
    return declaracoes.map((d) => this.paraPublico(d));
  }

  async listarAlertas(): Promise<AlertaEnquadramentoPublico[]> {
    const ultimas = await this.pgdasRepo
      .createQueryBuilder('p')
      .distinctOn(['p.empresa_id'])
      .orderBy('p.empresa_id')
      .addOrderBy('p.periodo_apuracao', 'DESC')
      .getMany();

    if (ultimas.length === 0) return [];

    const empresas = await this.empresaRepo.find({ where: { id: In(ultimas.map((d) => d.empresaId)) } });
    const empresaPorId = new Map(empresas.map((e) => [e.id, e]));

    const alertas: AlertaEnquadramentoPublico[] = [];
    for (const declaracao of ultimas) {
      const empresa = empresaPorId.get(declaracao.empresaId);
      if (!empresa) continue;
      const alerta = calcularAlertaEnquadramento(empresa.porte, Number(declaracao.rbt12), declaracao.periodoApuracao);
      if (!alerta) continue;
      alertas.push({
        empresaId: empresa.id,
        cnpj: empresa.cnpj,
        razaoSocial: empresa.razaoSocial,
        porte: empresa.porte,
        ...alerta,
      });
    }

    return alertas.sort((a, b) => b.rbt12 - a.rbt12);
  }

  async gerarRelatorioEnquadramento(): Promise<Buffer> {
    const alertas = await this.listarAlertas();
    const dataGeracao = new Date().toLocaleString('pt-BR', { timeZone: 'America/Bahia' });

    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const formatCnpj = (c: string) => (/^\d{14}$/.test(c) ? c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : c);
    const formatMoeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const formatPeriodo = (p: string) => { const [ano, mes] = p.split('-'); return `${mes}/${ano}`; };
    const tipoLabel = (t: string) => (t === 'IMEDIATO' ? 'Reenquadramento imediato' : 'Reenquadramento em janeiro');

    const linhas = alertas.map((a) => `
      <tr>
        <td class="razao">${esc(a.razaoSocial)}<br><span class="cnpj">${esc(formatCnpj(a.cnpj))}</span></td>
        <td>${esc(formatPeriodo(a.periodoApuracao))}</td>
        <td>${esc(formatMoeda(a.rbt12))}</td>
        <td>${esc(formatMoeda(a.excedente))}</td>
        <td><span class="pill" style="color:${a.tipo === 'IMEDIATO' ? '#c0392b' : '#d97706'}">${esc(tipoLabel(a.tipo))}</span></td>
      </tr>`).join('');

    const semAlertas = alertas.length === 0
      ? '<p class="ok">Nenhuma empresa ME excedeu o limite de R$ 360.000,00 no último PGDAS-D enviado.</p>'
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
  table{width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden}
  thead tr{background:#172554}
  th{padding:8px 12px;text-align:left;font-size:10px;font-weight:700;color:#e0e7ff;text-transform:uppercase;letter-spacing:.3px}
  td{padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:11.5px;color:#374151;vertical-align:top}
  tr:last-child td{border-bottom:none}
  tr:nth-child(even) td{background:#fafafa}
  .razao{font-weight:600;color:#1a1a1a}
  .cnpj{font-weight:700;color:#936900;font-size:10.5px}
  .pill{font-weight:700;font-size:11px;white-space:nowrap}
  .ok{text-align:center;padding:40px;color:#6b7280;font-size:13px}
  .footer{margin-top:32px;border-top:1px solid #e5e7eb;padding-top:10px;font-size:10px;color:#9ca3af;display:flex;justify-content:space-between}
</style></head><body>
<div class="header">
  <div class="header-left">
    <h1>Relatório de Enquadramento — Simples Nacional</h1>
    <p>Microempresas com RBT12 acima do limite de R$ 360.000,00 (LC 123/2006, art. 3º)</p>
  </div>
  <div class="header-right">
    <span>Everest/FK's</span><br>
    <span>${dataGeracao}</span><br>
    <span>Uso interno</span>
  </div>
</div>
${alertas.length > 0 ? `<div class="resumo">${alertas.length} empresa(s) ME acima do limite — calculado a partir do último PGDAS-D enviado de cada uma</div>` : ''}
${alertas.length > 0 ? `<table>
  <thead><tr><th>Empresa</th><th>Período</th><th>RBT12</th><th>Excedente</th><th>Reenquadramento</th></tr></thead>
  <tbody>${linhas}</tbody>
</table>` : semAlertas}
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

  private paraPublico(d: PgdasDeclaracao): PgdasDeclaracaoPublica {
    return {
      id: d.id,
      periodoApuracao: d.periodoApuracao,
      rbt12: Number(d.rbt12),
      receitaBrutaMes: d.receitaBrutaMes === null ? null : Number(d.receitaBrutaMes),
      nomeArquivo: d.nomeArquivo,
      criadoEm: d.criadoEm,
    };
  }
}
