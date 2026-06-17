// Varre links do NFSe Salvador e tenta rotas públicas conhecidas
import { chromium } from 'playwright';

const TIMEOUT = 12_000;

async function probe(label, url) {
  console.log(`\n[${label}] ${url}`);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
      ignoreHTTPSErrors: true, locale: 'pt-BR',
    });
    const page = await ctx.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      const finalUrl = page.url();
      const title = await page.title();
      const inputs = await page.locator('input:not([type=hidden])').count();
      console.log(`  → ${finalUrl} | "${title}" | inputs: ${inputs}`);
      const body = (await page.textContent('body') ?? '').replace(/\s+/g, ' ').slice(0, 300);
      console.log(`  ${body}`);
    } catch (err) {
      console.log(`  ERRO: ${err.message.split('\n')[0]}`);
    }
  } finally {
    await browser.close();
  }
}

async function varreNfse() {
  console.log('\n=== NFSe Salvador — links da página de login ===');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'pt-BR' });
    const page = await ctx.newPage();
    await page.goto('https://nfse.salvador.ba.gov.br/', { waitUntil: 'networkidle', timeout: 20_000 });
    console.log(`URL: ${page.url()} | Title: "${await page.title()}"`);

    // Todos os links da página
    const links = await page.locator('a').all();
    console.log(`Links (${links.length}):`);
    for (const a of links) {
      const href = await a.getAttribute('href') ?? '';
      const text = (await a.textContent() ?? '').replace(/\s+/g, ' ').trim();
      if (href && href !== '#' && !href.startsWith('javascript')) {
        console.log(`  [${text.slice(0,50)}] → ${href}`);
      }
    }

    // HTML completo da página (pode revelar rotas)
    const html = await page.content();
    const hrefs = [...html.matchAll(/href=["']([^"']+)["']/g)]
      .map(m => m[1])
      .filter(h => !h.startsWith('#') && !h.startsWith('javascript') && h.length > 1);
    const unique = [...new Set(hrefs)];
    console.log(`\nTodos os hrefs únicos (${unique.length}):`);
    unique.forEach(h => console.log(`  ${h}`));
  } finally {
    await browser.close();
  }
}

async function main() {
  await varreNfse();

  // Rotas públicas comuns em sistemas de NFSe ASP.NET
  const base = 'https://nfse.salvador.ba.gov.br';
  const rotas = [
    '/NotaFiscal/Publica', '/ConsultaPublica', '/Publico',
    '/CCM', '/CCM/Consulta', '/CCM/ConsultaPublica',
    '/CND', '/CND/Emitir', '/CND/Consultar',
    '/Contribuinte/Consulta', '/Fiscal/Consulta',
    '/Default.aspx', '/Home.aspx',
    '/NFS-e/Consulta', '/Nota/Consulta',
  ];
  for (const rota of rotas) {
    await probe(`NFSe${rota}`, `${base}${rota}`);
  }
}

main().catch(console.error);
