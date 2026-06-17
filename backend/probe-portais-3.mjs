// Terceira rodada — foco nos portais promissores
import { chromium } from 'playwright';

const TIMEOUT = 12_000;

async function probe(label, url, extraFn) {
  console.log(`\n${'='.repeat(55)}`);
  console.log(`[${label}]`);
  console.log(`URL: ${url}`);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
      ignoreHTTPSErrors: true, locale: 'pt-BR',
    });
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      console.log(`  → ${page.url()}`);
      console.log(`  Title: "${await page.title()}"`);

      // Todos os inputs
      const inputs = await page.locator('input:not([type=hidden])').all();
      console.log(`  Inputs (${inputs.length}):`);
      for (const inp of inputs) {
        const t = await inp.getAttribute('type') ?? 'text';
        const n = await inp.getAttribute('name') ?? '';
        const i = await inp.getAttribute('id') ?? '';
        const p = await inp.getAttribute('placeholder') ?? '';
        const v = await inp.getAttribute('value') ?? '';
        console.log(`    <input type="${t}" name="${n}" id="${i}" placeholder="${p}" value="${v}">`);
      }

      // Links que contenham certidao, cnd, iss, inscricao, municipal, debito
      const links = await page.locator('a').all();
      const relevantes = [];
      for (const a of links) {
        const href = (await a.getAttribute('href') ?? '').toLowerCase();
        const text = (await a.textContent() ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
        if (/certid|cnd|iss|inscri|municipal|debito|fiscal|cadastr|contribuin|alvara|nfse/.test(href + text)) {
          relevantes.push({ href: await a.getAttribute('href'), text });
        }
      }
      if (relevantes.length) {
        console.log(`  Links relevantes (${relevantes.length}):`);
        for (const l of relevantes.slice(0, 15)) {
          console.log(`    [${l.text.slice(0, 60)}] → ${l.href}`);
        }
      }

      if (extraFn) await extraFn(page);

      const body = (await page.textContent('body') ?? '').replace(/\s+/g, ' ').slice(0, 500);
      console.log(`  Body: ${body}`);
    } catch (err) {
      console.log(`  ERRO: ${err.message.split('\n')[0]}`);
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  // SEFAZ-BA novo portal
  await probe('SEFAZ-BA servicos (novo portal)', 'https://servicos.sefaz.ba.gov.br/');
  await probe('SEFAZ-BA servicos certidao', 'https://servicos.sefaz.ba.gov.br/certidao/');
  await probe('SEFAZ-BA servicos cnd', 'https://servicos.sefaz.ba.gov.br/cnd/');
  await probe('SEFAZ-BA servicos contribuinte', 'https://servicos.sefaz.ba.gov.br/contribuinte/');

  // NFSe / SEFIN Salvador — detalhar inputs e links
  await probe('NFSe Salvador (página inicial)', 'https://nfse.salvador.ba.gov.br/');
  await probe('NFSe Salvador — CND', 'https://nfse.salvador.ba.gov.br/cnd/');
  await probe('NFSe Salvador — consulta CCM', 'https://nfse.salvador.ba.gov.br/ccm/');
  await probe('NFSe Salvador — consulta contribuinte', 'https://nfse.salvador.ba.gov.br/Contribuinte/');
  await probe('NFSe Salvador — certidao', 'https://nfse.salvador.ba.gov.br/certidao/');
}

main().catch(console.error);
