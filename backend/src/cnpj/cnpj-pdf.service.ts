import { Injectable } from '@nestjs/common';
import path from 'path';
import PDFDocument from 'pdfkit';
import type { CnpjDadosNormalizados, CnpjSucesso } from './cnpj.types';

// Inter — todos os pesos via @fontsource/inter (woff2, compatível com PDFKit/fontkit)
const INTER_DIR      = path.resolve(require.resolve('@fontsource/inter/package.json'), '../files');
const INTER_REGULAR  = path.join(INTER_DIR, 'inter-latin-400-normal.woff');
const INTER_SEMI     = path.join(INTER_DIR, 'inter-latin-600-normal.woff');
const INTER_BOLD     = path.join(INTER_DIR, 'inter-latin-700-normal.woff');
const INTER_EXTRABOLD = path.join(INTER_DIR, 'inter-latin-800-normal.woff');
const INTER_BLACK    = path.join(INTER_DIR, 'inter-latin-900-normal.woff');

// ─── Paleta Everest ───────────────────────────────────────────────────────────
const C_DEPTH   = '#172554';
const C_PRIMARY = '#2563eb';
const C_ACCENT  = '#D4AF37';
const C_DANGER  = '#D94F2B';
const C_SURFACE = '#FFFFFF';
const C_GRAY    = '#6B7280';
const C_DARK    = '#111827';
const C_ROW_ALT = '#EFF6FF';
const C_BORDER  = '#DBEAFE';

// ─── Layout ───────────────────────────────────────────────────────────────────
const PAGE_W   = 595.28;
const MARGIN_L = 50;
const MARGIN_R = 50;
const CW       = PAGE_W - MARGIN_L - MARGIN_R;

const HEADER_H  = 68;
const BANNER_H  = 82;
const CONTENT_Y = HEADER_H + BANNER_H + 18;

const LABEL_W  = 155;
const VALUE_X  = MARGIN_L + LABEL_W + 8;
const VALUE_W  = PAGE_W - VALUE_X - MARGIN_R;
const ROW_H    = 17;
const FOOTER_H = 42;

const MINI_H   = 35;   // altura do mini-cabeçalho nas páginas 2+

// ─── Disclaimer ───────────────────────────────────────────────────────────────
const DISCLAIMER =
  'Os dados apresentados neste relatório são de natureza cadastral e refletem as ' +
  'informações disponíveis na fonte consultada na data indicada acima. ' +
  'SITUAÇÃO CADASTRAL ATIVA NÃO IMPLICA REGULARIDADE FISCAL. ' +
  'A comprovação de regularidade depende da emissão e análise de certidões específicas ' +
  '(CND Federal, PGFN, FGTS, Estadual, Municipal, entre outras), ' +
  'que devem ser obtidas junto aos órgãos competentes.';

// ─── Helpers de formatação ────────────────────────────────────────────────────

function str(val: string | null | undefined): string {
  return val || 'Não informado';
}

function formatarData(iso: string | null): string {
  if (!iso) return 'Não informado';
  const [y, m, d] = iso.split('-');
  return y && m && d ? `${d}/${m}/${y}` : 'Não informado';
}

function formatarDataHora(iso: string): string {
  const dt = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${p(dt.getUTCDate())}/${p(dt.getUTCMonth() + 1)}/${dt.getUTCFullYear()}` +
    ` às ${p(dt.getUTCHours())}:${p(dt.getUTCMinutes())}`
  );
}

function formatarCnpj(cnpj: string): string {
  if (/^\d{14}$/.test(cnpj)) {
    return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  return cnpj;
}

function formatarCnae(codigo: string | null): string {
  if (!codigo) return 'Não informado';
  const c = codigo.replace(/\D/g, '');
  if (c.length !== 7) return codigo;
  return `${c.slice(0, 4)}-${c.slice(4, 5)}/${c.slice(5)}`;
}

function formatarCep(cep: string | null): string {
  if (!cep) return 'Não informado';
  const d = cep.replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : cep;
}

function formatarTelefone(tel: string | null): string {
  if (!tel) return 'Não informado';
  const d = tel.replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return tel;
}

function formatarCapital(val: number | null): string {
  if (val === null) return 'Não informado';
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarBoolean(val: boolean | null): string {
  if (val === null) return 'Não informado';
  return val ? 'Sim' : 'Não';
}

function formatarEndereco(e: CnpjDadosNormalizados['endereco']): string {
  const partes = [
    e.logradouro,
    e.numero,
    e.complemento,
    e.bairro,
    e.municipio && e.uf ? `${e.municipio}/${e.uf}` : (e.municipio ?? e.uf),
    e.cep ? `CEP ${formatarCep(e.cep)}` : null,
  ].filter((p): p is string => Boolean(p));
  return partes.length > 0 ? partes.join(', ') : 'Não informado';
}

// ─── Serviço ──────────────────────────────────────────────────────────────────

@Injectable()
export class CnpjPdfService {
  gerarPdf(resultado: CnpjSucesso): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        margins: { top: 0, left: 0, right: 0, bottom: 50 },
        size: 'A4',
        bufferPages: true,
        info: {
          Title: 'Relatório Cadastral de CNPJ',
          Author: "Everest/FK's — Radar Empresarial",
        },
      });

      doc.registerFont('regular',   INTER_REGULAR);
      doc.registerFont('semibold',  INTER_SEMI);
      doc.registerFont('bold',      INTER_BOLD);
      doc.registerFont('extrabold', INTER_EXTRABOLD);
      doc.registerFont('black',     INTER_BLACK);

      const consultadoEm  = new Date(resultado.metadados.consultadoEm);
      // pageAdded: shapes only — doc.text() here corrupts the internal text cursor
      // when called during a mid-content page break. Margins set here are read by
      // PDFKit *after* the event fires, so content starts in the correct position.
      doc.on('pageAdded', () => {
        doc.rect(0, 0, PAGE_W, MINI_H).fill(C_DEPTH);
        doc.rect(0, doc.page.height - FOOTER_H, PAGE_W, FOOTER_H).fill(C_DEPTH);
        doc.page.margins.top    = MINI_H + 8;
        doc.page.margins.bottom = FOOTER_H + 8;
        doc.y = MINI_H + 8;
      });

      const chunks: Buffer[] = [];
      doc.on('data',  (chunk: Buffer) => chunks.push(chunk));
      doc.on('end',   () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      this.renderizar(doc, resultado, consultadoEm);
      this.renderTextosPaginados(doc, resultado.dados, consultadoEm);
      doc.end();
    });
  }

  private renderizar(
    doc: PDFKit.PDFDocument,
    { dados, metadados }: CnpjSucesso,
    consultadoEm: Date,
  ): void {
    // Rodapé pré-desenhado na página 1 (antes de qualquer conteúdo)
    this.renderRodape(doc);
    doc.page.margins.bottom = FOOTER_H + 8;

    // ── Cabeçalho (Midnight Blue) ──────────────────────────────────────────────
    doc.rect(0, 0, PAGE_W, HEADER_H).fill(C_DEPTH);

    doc.fillColor(C_ACCENT).font('black').fontSize(20)
       .text('RADAR', MARGIN_L, 14, { lineBreak: false });
    doc.fillColor(C_SURFACE).font('extrabold').fontSize(9)
       .text('EMPRESARIAL', MARGIN_L, 37, { lineBreak: false });
    doc.fillColor(C_GRAY).font('regular').fontSize(8)
       .text("Everest/FK's", MARGIN_L, 50, { lineBreak: false });

    doc.fillColor(C_SURFACE).font('semibold').fontSize(8.5)
       .text('Relatório Cadastral de CNPJ', PAGE_W - MARGIN_R - 185, 18, {
         width: 185, align: 'right', lineBreak: false,
       });
    doc.fillColor(C_GRAY).font('regular').fontSize(8)
       .text(consultadoEm.toLocaleDateString('pt-BR'), PAGE_W - MARGIN_R - 185, 31, {
         width: 185, align: 'right', lineBreak: false,
       });

    // ── Banner da empresa ──────────────────────────────────────────────────────
    const bannerGrad = doc.linearGradient(0, HEADER_H, PAGE_W, HEADER_H)
      .stop(0, '#1e40af')
      .stop(1, '#2563eb');
    doc.rect(0, HEADER_H, PAGE_W, BANNER_H).fill(bannerGrad as unknown as string);

    const isAtiva      = dados.situacaoCadastral === 'ATIVA';
    const badgeColor   = isAtiva ? C_ACCENT  : C_DANGER;
    const badgeTxtColor = isAtiva ? C_DEPTH  : C_SURFACE;

    doc.rect(MARGIN_L, HEADER_H + 14, 52, 14).fill(badgeColor);
    doc.fillColor(badgeTxtColor).font('semibold').fontSize(7)
       .text(dados.situacaoCadastral || 'N/D', MARGIN_L + 1, HEADER_H + 18, {
         width: 50, align: 'center', lineBreak: false,
       });

    doc.fillColor(C_SURFACE).font('extrabold').fontSize(13)
       .text(dados.razaoSocial, MARGIN_L + 62, HEADER_H + 12, {
         width: CW - 62, lineBreak: false,
       });

    const infoStr = [
      formatarCnpj(dados.cnpj),
      dados.porte,
      dados.endereco.municipio && dados.endereco.uf
        ? `${dados.endereco.municipio}/${dados.endereco.uf}`
        : null,
    ].filter(Boolean).join('   ·   ');

    doc.fillColor(C_SURFACE).font('regular').fontSize(8.5)
       .text(infoStr, MARGIN_L + 62, HEADER_H + 52, {
         width: CW - 62, lineBreak: false,
       });

    // ── Área de conteúdo ───────────────────────────────────────────────────────
    doc.y = CONTENT_Y;
    doc.x = MARGIN_L;

    // Aviso de dados simulados
    if (metadados.simulado) {
      const top = doc.y;
      doc.rect(MARGIN_L, top, CW, 22).fill('#FEF2F2');
      doc.rect(MARGIN_L, top, 3, 22).fill(C_DANGER);
      doc.fillColor(C_DANGER).font('bold').fontSize(8.5)
         .text('[DADOS SIMULADOS — não usar para decisão real]',
               MARGIN_L + 10, top + 7, { lineBreak: false });
      doc.y = top + 30;
    }

    // ── Seção: Dados Cadastrais ────────────────────────────────────────────────
    this.secao(doc, 'DADOS CADASTRAIS');

    let r = 0;
    this.row(doc, 'CNPJ',               formatarCnpj(dados.cnpj), r++);
    this.row(doc, 'Razão Social',        dados.razaoSocial, r++);
    this.row(doc, 'Nome Fantasia',       str(dados.nomeFantasia), r++);
    this.row(doc, 'Situação Cadastral',  str(dados.situacaoCadastral), r++);
    this.row(doc, 'Data da Situação',    formatarData(dados.situacaoCadastralData), r++);
    this.row(doc, 'Natureza Jurídica',   str(dados.naturezaJuridica), r++);
    this.row(doc, 'Tipo',                str(dados.tipo), r++);
    this.row(doc, 'Porte',               str(dados.porte), r++);
    this.row(doc, 'CNAE Principal',
      dados.cnaePrincipal
        ? `${formatarCnae(dados.cnaePrincipal.codigo)} — ${dados.cnaePrincipal.descricao}`
        : 'Não informado',
      r++,
    );
    this.row(doc, 'Endereço',            formatarEndereco(dados.endereco), r++);
    this.row(doc, 'E-mail',              str(dados.email), r++);
    this.row(doc, 'Telefone',            formatarTelefone(dados.telefone), r++);
    this.row(doc, 'Capital Social',      formatarCapital(dados.capitalSocial), r++);
    this.row(doc, 'Simples Nacional',    formatarBoolean(dados.optanteSimples), r++);
    if (dados.dataOpcaoSimples) {
      this.row(doc, 'Data Opção Simples',  formatarData(dados.dataOpcaoSimples), r++);
    }
    if (dados.dataExclusaoSimples) {
      this.row(doc, 'Data Exclusão Simples', formatarData(dados.dataExclusaoSimples), r++);
    }
    this.row(doc, 'MEI',                 formatarBoolean(dados.optanteMei), r++);
    this.row(doc, 'Início das Atividades', formatarData(dados.dataInicioAtividade), r++);
    if (dados.motivoSituacaoCadastral) {
      this.row(doc, 'Motivo da Situação', str(dados.motivoSituacaoCadastral), r++);
    }
    if (dados.situacaoEspecial) {
      this.row(doc, 'Situação Especial',  str(dados.situacaoEspecial), r++);
      if (dados.situacaoEspecialData) {
        this.row(doc, 'Data Situação Especial', formatarData(dados.situacaoEspecialData), r++);
      }
    }

    if (dados.cnaesSecundarios.length > 0) {
      doc.y += 4;
      doc.fillColor(C_GRAY).font('bold').fontSize(8.5)
         .text('CNAEs Secundários:', MARGIN_L + 5, doc.y);
      for (const c of dados.cnaesSecundarios) {
        doc.fillColor(C_DARK).font('regular').fontSize(8.5)
           .text(`· ${formatarCnae(c.codigo)} — ${c.descricao}`, MARGIN_L + 15, doc.y);
      }
      doc.y += 4;
    }

    // ── Seção: QSA ─────────────────────────────────────────────────────────────
    doc.y += 6;
    this.secao(doc, 'QUADRO DE SÓCIOS E ADMINISTRADORES (QSA)');

    if (dados.socios.length === 0) {
      doc.fillColor(C_GRAY).font('regular').fontSize(9)
         .text('Quadro societário não informado.', MARGIN_L + 5, doc.y);
    } else {
      dados.socios.forEach((s, i) => {
        const y = doc.y;
        if (i % 2 === 0) {
          doc.rect(MARGIN_L, y - 1, CW, 30).fill(C_ROW_ALT);
        }
        doc.fillColor(C_DARK).font('bold').fontSize(9)
           .text(`${i + 1}.  ${s.nome}`, MARGIN_L + 5, y);
        doc.fillColor(C_GRAY).font('regular').fontSize(8.5)
           .text(
             [str(s.qualificacao), s.faixaEtaria ? `Faixa etária: ${s.faixaEtaria}` : null]
               .filter(Boolean).join('   ·   '),
             MARGIN_L + 15, doc.y,
           );
        // Only enforce minimum height when still on the same page (doc.y >= y).
        // If doc.y < y, a page break occurred and doc.y is already at the new page top.
        if (doc.y >= y && doc.y < y + 28) doc.y = y + 28;
      });
    }

    // ── Seção: Procedência ─────────────────────────────────────────────────────
    doc.y += 10;
    this.secao(doc, 'PROCEDÊNCIA DOS DADOS');

    doc.fillColor(C_GRAY).font('bold').fontSize(8.5)
       .text('Fonte: ', MARGIN_L + 5, doc.y, { continued: true });
    doc.fillColor(C_DARK).font('regular').text(metadados.fonte);

    doc.fillColor(C_GRAY).font('bold').fontSize(8.5)
       .text('Consultado em: ', MARGIN_L + 5, doc.y, { continued: true });
    doc.fillColor(C_DARK).font('regular').text(formatarDataHora(metadados.consultadoEm));

    doc.moveDown(0.3);
    doc.fillColor(C_GRAY).font('regular').fontSize(8)
       .text(metadados.observacaoDefasagem, MARGIN_L + 5, doc.y, { width: CW - 5 });

    // ── Seção: Aviso importante ────────────────────────────────────────────────
    doc.y += 12;
    this.secao(doc, 'AVISO IMPORTANTE');
    doc.fillColor('#374151').font('regular').fontSize(8)
       .text(DISCLAIMER, MARGIN_L + 5, doc.y, { width: CW - 5, align: 'justify' });

    // ── Seção: Links oficiais ──────────────────────────────────────────────────
    doc.y += 12;
    this.secao(doc, 'LINKS OFICIAIS');
    const links = metadados.linksOficiais;
    const linksRotulos: [string, string][] = [
      ['Receita Federal',          links.receitaFederal],
      ['Consulta de CNPJ',         links.consultaCnpj],
      ['Certidão Negativa Federal', links.cndFederal],
      ['PGFN (Regularize)',        links.pgfn],
      ['FGTS (CRF)',               links.fgts],
      ['Diário Oficial da União',  links.diarioOficial],
    ];
    for (const [rotulo, url] of linksRotulos) {
      doc.fillColor(C_GRAY).font('semibold').fontSize(8)
         .text(`${rotulo}:  `, MARGIN_L + 5, doc.y, { continued: true });
      doc.fillColor(C_PRIMARY).font('regular').fontSize(8)
         .text(url, { width: CW - 10, link: url, underline: true });
    }
  }

  private renderRodape(doc: PDFKit.PDFDocument): void {
    const prevBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const footerY = doc.page.height - FOOTER_H;
    doc.rect(0, footerY, PAGE_W, FOOTER_H).fill(C_DEPTH);
    doc.page.margins.bottom = prevBottom;
  }

  private renderTextosPaginados(
    doc: PDFKit.PDFDocument,
    dados: CnpjDadosNormalizados,
    consultadoEm: Date,
  ): void {
    const range = doc.bufferedPageRange();
    const totalPages = range.count;
    const geradoEm = consultadoEm.toLocaleString('pt-BR');
    const cnpjFormatado = formatarCnpj(dados.cnpj);

    for (let i = 0; i < totalPages; i++) {
      doc.switchToPage(range.start + i);

      if (i > 0) {
        doc.page.margins.top = 0;
        doc.fillColor(C_SURFACE).font('semibold').fontSize(8.5)
           .text(dados.razaoSocial, MARGIN_L, 11, {
             width: CW - 130,
             lineBreak: false,
           });
        doc.fillColor(C_GRAY).font('regular').fontSize(8)
           .text(cnpjFormatado, PAGE_W - MARGIN_R - 130, 11, {
             width: 130,
             align: 'right',
             lineBreak: false,
           });
      }

      doc.page.margins.bottom = 0;
      const footerY = doc.page.height - FOOTER_H;

      doc.fillColor(C_ACCENT).font('extrabold').fontSize(8)
         .text("Radar Empresarial · Everest/FK's", MARGIN_L, footerY + 16, {
           lineBreak: false,
         });
      doc.fillColor(C_GRAY).font('regular').fontSize(7.5)
         .text(
           `Página ${i + 1} de ${totalPages}`,
           PAGE_W / 2 - 40, footerY + 16,
           { width: 80, align: 'center', lineBreak: false },
         );
      doc.fillColor(C_GRAY).font('regular').fontSize(7.5)
         .text(geradoEm, PAGE_W - MARGIN_R - 200, footerY + 16, {
           width: 200, align: 'right', lineBreak: false,
         });
    }
  }

  private secao(doc: PDFKit.PDFDocument, titulo: string): void {
    if (doc.y + 40 > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
    const y = doc.y + 2;
    doc.rect(MARGIN_L, y, 3, 13).fill(C_ACCENT);
    doc.fillColor(C_DEPTH).font('extrabold').fontSize(8.5)
       .text(titulo, MARGIN_L + 10, y + 1);
    doc.y = y + 16;
    doc.moveTo(MARGIN_L + 10, doc.y)
       .lineTo(PAGE_W - MARGIN_R, doc.y)
       .strokeColor(C_BORDER).lineWidth(0.5).stroke();
    doc.y += 8;
  }

  private row(doc: PDFKit.PDFDocument, label: string, value: string, index: number): void {
    const y = doc.y;

    if (index % 2 === 0) {
      doc.rect(MARGIN_L, y - 1, CW, ROW_H).fill(C_ROW_ALT);
    }

    doc.fillColor(C_GRAY).font('semibold').fontSize(8.5)
       .text(label, MARGIN_L + 5, y, { width: LABEL_W, lineBreak: false });

    doc.fillColor(C_DARK).font('regular').fontSize(8.5)
       .text(value, VALUE_X, y, { width: VALUE_W });

    if (doc.y >= y && doc.y < y + ROW_H) doc.y = y + ROW_H;
  }
}
