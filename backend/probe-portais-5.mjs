// Quinta rodada — candidatos mais promissores identificados
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
      const links = await page.locator('a').all();
      const relevantes = [];
      for (const a of links) {
        const href = (await a.getAttribute('href') ?? '');
        const text = (await a.textContent() ?? '').replace(/\s+/g, ' ').trim();
        if (/certid|cnd|debit|fiscal|contribuin|inscri|municipal|regular|negativa|emit|consul/i.test(href + text)) {
          relevantes.push(`[${text.slice(0,70)}] → ${href}`);
        }
      }
      if (relevantes.length) {
        console.log(`  Links (${relevantes.length}):`);
        relevantes.slice(0, 15).forEach(l => console.log(`    ${l}`));
      }
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
  // SEFAZ-BA — candidato público de consulta de débitos
  await probe(
    'SEFAZ-BA ConsultaDebitos Publico',
    'https://servicos.sefaz.ba.gov.br/sistemas/DSCRE/Modulos/Publico/ConsultaDebitos.aspx',
  );

  // SEFAZ-BA — carta de serviços CND (página informativa que pode linkar o formulário real)
  await probe(
    'SEFAZ-BA cartadeservicos CND',
    'https://portal.sefaz.ba.gov.br/scripts/cartadeservicos/index.asp?id=emissao_de_certidao_de_debitos_tributarios_negativa_de_ipva_e_de_baixa_de_inscricao',
  );

  // SEFAZ-BA — Certidões ICMS (âncora do menu)
  await probe(
    'SEFAZ-BA inspetoria certidoes ICMS',
    'https://www.sefaz.ba.gov.br/inspetoria-eletronica/icms/',
  );

  // Salvador Digital — portal de serviços municipais
  await probe('Salvador Digital',          'https://salvadordigital.salvador.ba.gov.br/');
  await probe('Salvador Digital servicos', 'https://salvadordigital.salvador.ba.gov.br/servicos');
  await probe('Salvador Digital divida',   'https://salvadordigital.salvador.ba.gov.br/divida-ativa');
  await probe('Salvador Digital certidao', 'https://salvadordigital.salvador.ba.gov.br/certidao');
}

main().catch(console.error);
