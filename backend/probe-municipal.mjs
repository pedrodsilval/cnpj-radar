// Sonda portais de Certidão Municipal e Inscrição Municipal de Salvador/BA
import { chromium } from 'playwright';

const TIMEOUT = 12_000;
const CNPJ = '01871335000148';

async function probe(label, url) {
  console.log(`\n${'='.repeat(55)}`);
  console.log(`[${label}] ${url}`);
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

      // Links relevantes
      const links = await page.locator('a').all();
      const rel = [];
      for (const a of links) {
        const href = await a.getAttribute('href') ?? '';
        const text = (await a.textContent() ?? '').replace(/\s+/g, ' ').trim();
        if (/certid|cnd|inscri|municipal|contribuin|fiscal|alvara|ccm|iss|debito|negativa|regularid/i.test(href + ' ' + text) && text.length < 80) {
          rel.push(`  [${text.slice(0,60)}] → ${href}`);
        }
      }
      if (rel.length) { console.log(`  Links (${rel.length}):`); rel.slice(0,12).forEach(l => console.log(l)); }

      const body = (await page.textContent('body') ?? '').replace(/\s+/g, ' ').slice(0, 350);
      console.log(`  Body: ${body}`);
    } catch (err) {
      console.log(`  ERRO: ${err.message.split('\n')[0]}`);
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  // NFSe Salvador — áreas públicas possíveis
  await probe('NFSe Salvador — ConsultaPublica', 'https://nfse.salvador.ba.gov.br/ConsultaPublica/');
  await probe('NFSe Salvador — Certidao',        'https://nfse.salvador.ba.gov.br/Certidao/');
  await probe('NFSe Salvador — CND',             'https://nfse.salvador.ba.gov.br/CND/');
  await probe('NFSe Salvador — Consulta',        'https://nfse.salvador.ba.gov.br/Consulta/');
  await probe('NFSe Salvador — Public',          'https://nfse.salvador.ba.gov.br/Public/');

  // Outros domínios de Salvador
  await probe('Salvador SEFIN direto',           'https://sefin.salvador.ba.gov.br/');
  await probe('Salvador ISS direto',             'https://iss.salvador.ba.gov.br/');
  await probe('Salvador tributos',               'https://tributos.salvador.ba.gov.br/');
  await probe('Salvador fazenda',                'https://fazenda.salvador.ba.gov.br/');
  await probe('Salvador prefeitura serviços',    'https://www.salvador.ba.gov.br/servicos-municipais/');
  await probe('Salvador Digital API',            'https://api.salvadordigital.salvador.ba.gov.br/');

  // Sistemas conhecidos de certidão municipal para cidades BA
  await probe('Equiplano (usado por munic BA)',  'https://servicos.salvador.ba.gov.br/certidao/');
  await probe('Betha sistemas Salvador',         'https://e-gov.betha.com.br/certidao/?cd_municipio=2927408');
}

main().catch(console.error);
