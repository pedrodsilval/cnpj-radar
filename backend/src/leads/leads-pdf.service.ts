import { Injectable } from '@nestjs/common';
import path from 'path';
import PDFDocument from 'pdfkit';
import type { PropostaResponse } from './leads.service';

const INTER_DIR       = path.resolve(require.resolve('@fontsource/inter/package.json'), '../files');
const INTER_REGULAR   = path.join(INTER_DIR, 'inter-latin-400-normal.woff');
const INTER_BOLD      = path.join(INTER_DIR, 'inter-latin-700-normal.woff');
const INTER_EXTRABOLD = path.join(INTER_DIR, 'inter-latin-800-normal.woff');
const INTER_BLACK     = path.join(INTER_DIR, 'inter-latin-900-normal.woff');

const C_DEPTH   = '#172554';
const C_PRIMARY = '#2563eb';
const C_ACCENT  = '#D4AF37';
const C_DANGER  = '#D94F2B';
const C_GRAY    = '#6B7280';
const C_DARK    = '#111827';
const C_SURFACE = '#FFFFFF';
const C_ROW_ALT = '#EFF6FF';
const C_BORDER  = '#DBEAFE';

const PAGE_W  = 595.28;
const MARGIN  = 50;
const CW      = PAGE_W - MARGIN * 2;

function bufferFromDoc(doc: PDFKit.PDFDocument): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function formatarCnpj(cnpj: string): string {
  if (/^\d{14}$/.test(cnpj))
    return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  return cnpj;
}

@Injectable()
export class LeadsPdfService {
  async gerarPdf(proposta: PropostaResponse): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: 0, compress: true });

    doc.registerFont('Regular',   INTER_REGULAR);
    doc.registerFont('Bold',      INTER_BOLD);
    doc.registerFont('ExtraBold', INTER_EXTRABOLD);
    doc.registerFont('Black',     INTER_BLACK);

    const isProposta = proposta.tipo === 'proposta';
    const corTipo    = isProposta ? C_ACCENT : C_PRIMARY;

    // ── Header ─────────────────────────────────────────────────────────────────
    doc.rect(0, 0, PAGE_W, 56).fill(C_DEPTH);
    doc.font('Black').fontSize(13).fillColor(C_SURFACE)
       .text('Everest/FK\'s', MARGIN, 16, { continued: true });
    doc.font('Regular').fontSize(9).fillColor('#93c5fd')
       .text('  |  Plataforma de Inteligência Comercial', { continued: false });
    doc.font('Regular').fontSize(7.5).fillColor('#93c5fd')
       .text(
         `Gerado em ${new Date(proposta.geradoEm).toLocaleString('pt-BR')}`,
         MARGIN, 38,
       );

    // ── Banner ─────────────────────────────────────────────────────────────────
    const bannerY = 56;
    doc.rect(0, bannerY, PAGE_W, 72).fill(C_ROW_ALT);
    doc.rect(0, bannerY, 5, 72).fill(corTipo);

    doc.font('Bold').fontSize(8).fillColor(corTipo)
       .text(isProposta ? 'PROPOSTA COMERCIAL' : 'DIAGNÓSTICO INICIAL', MARGIN + 8, bannerY + 12);
    doc.font('Black').fontSize(16).fillColor(C_DEPTH)
       .text(proposta.razaoSocial, MARGIN + 8, bannerY + 24, { width: CW - 8 });
    doc.font('Regular').fontSize(9).fillColor(C_GRAY)
       .text(`CNPJ ${formatarCnpj(proposta.cnpj)}`, MARGIN + 8, bannerY + 48);

    // ── Scores ─────────────────────────────────────────────────────────────────
    let y = bannerY + 72 + 20;
    const scoreW = (CW - 16) / 3;
    const scores = [
      { label: 'Score Cadastral', val: proposta.scores.cadastral, danger: false },
      { label: 'Score Comercial', val: proposta.scores.comercial, danger: false },
      { label: 'Atenção',         val: proposta.scores.atencao,   danger: true  },
    ];
    scores.forEach((s, i) => {
      const x   = MARGIN + i * (scoreW + 8);
      const val = s.val ?? 0;
      const cor = s.danger
        ? (val >= 40 ? C_DANGER : C_GRAY)
        : (val >= 70 ? C_ACCENT : val >= 40 ? C_PRIMARY : C_GRAY);

      doc.roundedRect(x, y, scoreW, 52, 6).strokeColor(C_BORDER).lineWidth(1).stroke();
      doc.font('Bold').fontSize(7.5).fillColor(C_GRAY)
         .text(s.label.toUpperCase(), x, y + 10, { width: scoreW, align: 'center' });
      doc.font('Black').fontSize(22).fillColor(cor)
         .text(s.val !== null ? String(s.val) : '—', x, y + 22, { width: scoreW, align: 'center' });
    });
    y += 52 + 18;

    const FOOTER_Y = doc.page.height - 36;

    function paginaCheia(margem = 80): boolean {
      return y > FOOTER_Y - margem;
    }

    function novaSecao(titulo: string, cor: string) {
      if (paginaCheia()) {
        doc.addPage();
        // mini-cabeçalho nas páginas seguintes
        doc.rect(0, 0, PAGE_W, 30).fill(C_DEPTH);
        doc.font('Black').fontSize(9).fillColor(C_SURFACE)
           .text('Everest/FK\'s', MARGIN, 10, { continued: true });
        doc.font('Regular').fontSize(8).fillColor('#93c5fd')
           .text(`  |  ${proposta.titulo}`, { continued: false });
        y = 46;
      }
      doc.font('Bold').fontSize(8).fillColor(cor).text(titulo, MARGIN, y);
      y += 13;
      doc.roundedRect(MARGIN, y, CW, 1).fill(C_BORDER);
      y += 8;
    }

    function rodape() {
      const pageH = doc.page.height;
      doc.rect(0, pageH - 36, PAGE_W, 36).fill(C_DEPTH);
      doc.font('Regular').fontSize(7).fillColor('#93c5fd')
         .text(
           'Este documento é de uso interno. Everest/FK\'s Contabilidade — Salvador/BA.',
           MARGIN, pageH - 24, { width: CW, align: 'center' },
         );
    }

    // ── Resumo ─────────────────────────────────────────────────────────────────
    novaSecao('RESUMO DA ANÁLISE', corTipo);
    doc.font('Regular').fontSize(9.5).fillColor(C_DEPTH)
       .text(proposta.resumo, MARGIN, y, { width: CW });
    y += doc.heightOfString(proposta.resumo, { width: CW }) + 16;

    // ── Base da análise — fatores ──────────────────────────────────────────────
    if (proposta.fatoresConsiderados?.length) {
      novaSecao('BASE DESTA ANÁLISE', C_PRIMARY);
      const COR_IMP: Record<string, string> = {
        positivo: '#059669', atencao: '#d97706', negativo: '#dc2626', info: '#2563eb',
      };
      const BADGE_IMP: Record<string, string> = {
        positivo: '✓', atencao: '⚠', negativo: '✗', info: 'ℹ',
      };
      proposta.fatoresConsiderados.forEach(f => {
        if (paginaCheia(50)) { doc.addPage(); y = 30; }
        const cor = COR_IMP[f.impacto] ?? C_GRAY;
        const icon = BADGE_IMP[f.impacto] ?? '•';
        doc.font('Bold').fontSize(7.5).fillColor(C_GRAY)
           .text(`${f.categoria.toUpperCase()}   `, MARGIN, y, { continued: true });
        doc.font('Bold').fontSize(7.5).fillColor(cor)
           .text(`${icon} ${f.valor}`, { continued: false });
        y += 12;
        doc.font('Regular').fontSize(8.5).fillColor(C_DARK)
           .text(f.detalhe, MARGIN + 8, y, { width: CW - 8 });
        y += doc.heightOfString(f.detalhe, { width: CW - 8 }) + 8;
      });
      y += 4;
    }

    // ── Serviços sugeridos ─────────────────────────────────────────────────────
    if (proposta.servicosSugeridos?.length) {
      novaSecao('SERVIÇOS RELEVANTES PARA ESTA EMPRESA', C_ACCENT);
      proposta.servicosSugeridos.forEach(s => {
        if (paginaCheia(40)) { doc.addPage(); y = 30; }
        doc.font('Regular').fontSize(9).fillColor(C_DARK)
           .text(`• ${s}`, MARGIN + 4, y, { width: CW - 4 });
        y += doc.heightOfString(`• ${s}`, { width: CW - 4 }) + 4;
      });
      y += 8;
    }

    // ── Recomendação ───────────────────────────────────────────────────────────
    if (proposta.recomendacao) {
      novaSecao('RECOMENDAÇÃO', C_PRIMARY);
      doc.font('Regular').fontSize(9.5).fillColor(C_DEPTH)
         .text(proposta.recomendacao, MARGIN, y, { width: CW });
      y += doc.heightOfString(proposta.recomendacao, { width: CW }) + 16;
    }

    // ── Próximos passos ────────────────────────────────────────────────────────
    novaSecao('PRÓXIMOS PASSOS', C_DEPTH);
    proposta.proximosPassos.forEach((passo, i) => {
      if (paginaCheia(40)) { doc.addPage(); y = 30; }
      doc.circle(MARGIN + 8, y + 6, 8).fill(C_PRIMARY);
      doc.font('Bold').fontSize(8).fillColor(C_SURFACE)
         .text(String(i + 1), MARGIN, y + 2, { width: 16, align: 'center' });
      doc.font('Regular').fontSize(9.5).fillColor(C_DEPTH)
         .text(passo, MARGIN + 22, y, { width: CW - 22 });
      y += Math.max(18, doc.heightOfString(passo, { width: CW - 22 })) + 6;
    });

    // ── Rodapé em todas as páginas ─────────────────────────────────────────────
    const totalPaginas = doc.bufferedPageRange().count;
    for (let p = 0; p < totalPaginas; p++) {
      doc.switchToPage(p);
      rodape();
    }

    return bufferFromDoc(doc);
  }
}
