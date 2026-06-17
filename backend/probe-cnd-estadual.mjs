// CND Estadual — baixa o arquivo do Relatorio.aspx (download direto)
import { chromium } from 'playwright';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CNPJ = (process.argv[2] ?? '01871335000148').replace(/\D/g, '');

async function main() {
  console.log(`\nCND Estadual SEFAZ-BA — CNPJ ${CNPJ}`);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
      ignoreHTTPSErrors: true, locale: 'pt-BR',
      acceptDownloads: true,
    });
    const page = await ctx.newPage();

    // Intercepta window.open para bloquear o popup e capturar a URL
    await page.addInitScript(() => {
      window.open = function(url) {
        window.__capturedPopupUrl = url;
        return null;
      };
    });

    console.log('1. Abrindo formulário...');
    await page.goto(
      'https://servicos.sefaz.ba.gov.br/sistemas/DSCRE/Modulos/Publico/EmissaoCertidao.aspx',
      { waitUntil: 'networkidle', timeout: 25_000 },
    );

    console.log('2. Preenchendo CNPJ...');
    await page.locator('#PHConteudo_TxtNumCNPJ').fill(CNPJ);
    await page.locator('#PHConteudo_TxtNumCNPJ').dispatchEvent('change');
    await page.waitForTimeout(300);

    console.log('3. Clicando em Imprimir e aguardando resposta AJAX...');
    await Promise.all([
      page.waitForResponse(r => r.url().includes('sefaz.ba.gov.br'), { timeout: 20_000 }),
      page.locator('#PHConteudo_btnImprimir').click(),
    ]);
    await page.waitForTimeout(2000);

    const relUrl = await page.evaluate(() => window.__capturedPopupUrl ?? null);
    const urlAbsoluta = relUrl
      ? new URL(relUrl, 'https://servicos.sefaz.ba.gov.br/sistemas/DSCRE/Modulos/Publico/EmissaoCertidao.aspx').href
      : 'https://servicos.sefaz.ba.gov.br/sistemas/DSCRE/Relatorios/Relatorio.aspx';
    console.log(`4. URL do relatório: ${urlAbsoluta}`);

    // Abre nova aba com acceptDownloads, aguarda o download
    const paginaRelatorio = await ctx.newPage();
    const [download] = await Promise.all([
      paginaRelatorio.waitForEvent('download', { timeout: 20_000 }),
      paginaRelatorio.goto(urlAbsoluta, { waitUntil: 'commit', timeout: 20_000 }).catch(() => {}),
    ]);

    console.log(`5. Download iniciado: ${download.suggestedFilename()}`);

    const uploadDir = join(__dirname, 'uploads', 'certidoes');
    if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

    const ext = extname(download.suggestedFilename()) || '.pdf';
    const destino = join(uploadDir, `cnd-estadual-${CNPJ}-${Date.now()}${ext}`);
    await download.saveAs(destino);
    console.log(`6. Arquivo salvo: ${destino}`);

    // Verifica tamanho
    const { statSync } = await import('fs');
    const stat = statSync(destino);
    console.log(`   Tamanho: ${stat.size} bytes`);

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
