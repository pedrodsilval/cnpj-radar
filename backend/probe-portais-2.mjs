// Segunda rodada de sondagem — candidatos alternativos
import { chromium } from 'playwright';

const TIMEOUT = 10_000;

async function probe(label, url) {
  console.log(`\n[${label}] ${url}`);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
      ignoreHTTPSErrors: true,
      locale: 'pt-BR',
    });
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      const finalUrl = page.url();
      const title = await page.title();
      const body = (await page.textContent('body') ?? '').replace(/\s+/g, ' ').slice(0, 300);
      const inputs = await page.locator('input:not([type=hidden])').count();
      console.log(`  OK → ${finalUrl} | title: "${title}" | inputs: ${inputs}`);
      console.log(`  body: ${body}`);
    } catch (err) {
      console.log(`  ERRO: ${err.message.split('\n')[0]}`);
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  await probe('SEFAZ-BA sefaznet',          'https://sefaznet.sefaz.ba.gov.br/');
  await probe('SEFAZ-BA sistemas',          'https://sistemas.sefaz.ba.gov.br/');
  await probe('SEFAZ-BA certidao ASP',      'https://www.sefaz.ba.gov.br/scripts/certidao/certidao.asp');
  await probe('SEFAZ-BA certidao scripts',  'https://portal.sefaz.ba.gov.br/scripts/certidao/');
  await probe('SEFAZ-BA e-fisco certidao',  'https://e-fisco.sefaz.ba.gov.br/certidao/');
  await probe('Salvador portal principal',  'https://www.salvador.ba.gov.br/');
  await probe('Salvador NFSE',              'https://nfse.salvador.ba.gov.br/');
  await probe('Salvador cacv',              'https://cacv.salvador.ba.gov.br/');
  await probe('Salvador sefin sem www',     'https://sefin.salvador.ba.gov.br/');
  await probe('Salvador ISS',              'https://iss.salvador.ba.gov.br/');
  await probe('Salvador giss',             'https://giss.online/prefeitura/salvador-ba/');
}

main().catch(console.error);
