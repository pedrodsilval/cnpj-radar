// Sonda portais de certidões estadual/municipal para mapear URLs e comportamento
// Uso: node probe-portais.mjs
import { chromium } from 'playwright';

const CNPJ = '01871335000148'; // Comercial Baiano Ltda — empresa de comércio BA com IE ativa

async function probe(label, url, fn) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
      ignoreHTTPSErrors: true,
      locale: 'pt-BR',
    });
    const page = await context.newPage();
    console.log(`\n${'='.repeat(60)}`);
    console.log(`PORTAL: ${label}`);
    console.log(`URL: ${url}`);
    console.log('='.repeat(60));
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 25_000 });
      console.log(`URL final: ${page.url()}`);
      const title = await page.title();
      console.log(`Title: ${title}`);
      if (fn) await fn(page);
      const body = (await page.textContent('body') ?? '').replace(/\s+/g, ' ').slice(0, 600);
      console.log(`Body (600 chars): ${body}`);
      // Procura campos de input e botões relevantes
      const inputs = await page.locator('input:not([type=hidden])').all();
      console.log(`\nInputs encontrados: ${inputs.length}`);
      for (const inp of inputs.slice(0, 8)) {
        const type = await inp.getAttribute('type') ?? 'text';
        const name = await inp.getAttribute('name') ?? '';
        const id   = await inp.getAttribute('id') ?? '';
        const placeholder = await inp.getAttribute('placeholder') ?? '';
        console.log(`  <input type="${type}" name="${name}" id="${id}" placeholder="${placeholder}">`);
      }
      const selects = await page.locator('select').all();
      console.log(`Selects: ${selects.length}`);
      const buttons = await page.locator('button, input[type=submit], input[type=button]').all();
      console.log(`Botões: ${buttons.length}`);
      for (const btn of buttons.slice(0, 5)) {
        const text = await btn.textContent() ?? await btn.getAttribute('value') ?? '';
        console.log(`  Botão: "${text.trim()}"`);
      }
    } catch (err) {
      console.log(`ERRO: ${err.message}`);
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  // 1. Certidão Estadual BA — SEFAZ-BA
  await probe(
    'SEFAZ-BA — CND Estadual (portal principal)',
    'https://www.sefaz.ba.gov.br/certidao/',
  );

  await probe(
    'SEFAZ-BA — CND Estadual (efisco)',
    'https://efisco.sefaz.ba.gov.br/ssat_cons_ext/PREmitirCertidaoDebitoEstadual.asp',
  );

  await probe(
    'SEFAZ-BA — CND Estadual (portal novo)',
    'https://portal.sefaz.ba.gov.br/portalsefaz/faces/pages_certidao/certidao.jsp',
  );

  // 2. Certidão Municipal — Prefeitura de Salvador (SEFIN)
  await probe(
    'SEFIN Salvador — portal principal',
    'https://www.sefin.salvador.ba.gov.br/',
  );

  await probe(
    'SEFIN Salvador — CND Municipal',
    'https://www.sefin.salvador.ba.gov.br/certidao/',
  );

  await probe(
    'Salvador — ISS Online / CND',
    'https://issonline.salvador.ba.gov.br/',
  );

  await probe(
    'Salvador — Serviços Municipais',
    'https://servicos.salvador.ba.gov.br/',
  );

  // 3. Inscrição Municipal — Salvador
  await probe(
    'Salvador — Inscrição Municipal (SEFIN)',
    'https://www.sefin.salvador.ba.gov.br/inscricao-municipal/',
  );

  await probe(
    'Salvador — Consulta CCM / Alvará',
    'https://issonline.salvador.ba.gov.br/consulta-ccm/',
  );
}

main().catch(console.error);
