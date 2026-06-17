// Quarta rodada — varre links do sefaz.ba.gov.br e testa SINTEGRA + BrasilAPI estadual
import { chromium } from 'playwright';

const TIMEOUT = 12_000;

async function probe(label, url) {
  console.log(`\n${'='.repeat(55)}`);
  console.log(`[${label}] ${url}`);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
      ignoreHTTPSErrors: true, locale: 'pt-BR',
    });
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      console.log(`  → ${page.url()} | "${await page.title()}"`);

      const inputs = await page.locator('input:not([type=hidden])').count();
      console.log(`  Inputs: ${inputs}`);

      // Todos os links com palavras-chave fiscais
      const links = await page.locator('a').all();
      const relevantes = [];
      for (const a of links) {
        const href = (await a.getAttribute('href') ?? '');
        const text = (await a.textContent() ?? '').replace(/\s+/g, ' ').trim();
        if (/certid|cnd|debit|fiscal|contribuin|inscri|municipal|regular|negativa/i.test(href + text)) {
          relevantes.push(`[${text.slice(0,60)}] → ${href}`);
        }
      }
      if (relevantes.length) {
        console.log(`  Links relevantes:`);
        relevantes.slice(0, 20).forEach(l => console.log(`    ${l}`));
      } else {
        const body = (await page.textContent('body') ?? '').replace(/\s+/g, ' ').slice(0, 400);
        console.log(`  Body: ${body}`);
      }
    } catch (err) {
      console.log(`  ERRO: ${err.message.split('\n')[0]}`);
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  // Navega no sefaz.ba.gov.br buscando link de CND
  await probe('SEFAZ-BA home',              'https://www.sefaz.ba.gov.br/');
  await probe('SEFAZ-BA contribuintes',     'https://www.sefaz.ba.gov.br/contribuintes/');
  await probe('SEFAZ-BA certidoes pagina',  'https://www.sefaz.ba.gov.br/certidao');
  await probe('SEFAZ-BA portal contribuinte','https://portal.sefaz.ba.gov.br/contribuinte/');

  // SINTEGRA BA (certidão de situação fiscal estadual)
  await probe('SINTEGRA BA',                'https://www.sintegra.ba.gov.br/');
  await probe('SINTEGRA nacional',          'http://www.sintegra.gov.br/');

  // Salvador — busca por portal público de CND/IM sem login
  await probe('Salvador portal servicos',   'https://www.salvador.ba.gov.br/servicos');
  await probe('Salvador portal fiscal',     'https://www.salvador.ba.gov.br/fiscal');
  await probe('Salvador tributos online',   'https://tributariosonline.salvador.ba.gov.br/');
  await probe('Salvador nfse certidao pub', 'https://nfse.salvador.ba.gov.br/CertidaoPublica/');
  await probe('Salvador nfse cnae pub',     'https://nfse.salvador.ba.gov.br/Publica/');
}

main().catch(console.error);
