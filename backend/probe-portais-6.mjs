// Sexta rodada — EmissaoCertidao SEFAZ-BA + Salvador Digital com JS
import { chromium } from 'playwright';

async function probeEmissaoCertidao() {
  console.log('\n' + '='.repeat(55));
  console.log('[SEFAZ-BA EmissaoCertidao.aspx]');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', ignoreHTTPSErrors: true, locale: 'pt-BR' });
    const page = await ctx.newPage();
    await page.goto('https://servicos.sefaz.ba.gov.br/sistemas/DSCRE/Modulos/Publico/EmissaoCertidao.aspx', { waitUntil: 'networkidle', timeout: 20_000 });
    console.log(`  → ${page.url()}`);
    console.log(`  Title: "${await page.title()}"`);
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
    const selects = await page.locator('select').all();
    for (const sel of selects) {
      const n = await sel.getAttribute('name') ?? '';
      const i = await sel.getAttribute('id') ?? '';
      console.log(`    <select name="${n}" id="${i}">`);
    }
    const body = (await page.textContent('body') ?? '').replace(/\s+/g, ' ').slice(0, 800);
    console.log(`  Body: ${body}`);
  } finally {
    await browser.close();
  }
}

async function probeSalvadorDigital(path, label) {
  console.log('\n' + '='.repeat(55));
  const url = `https://salvadordigital.salvador.ba.gov.br${path}`;
  console.log(`[Salvador Digital — ${label}] ${url}`);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', locale: 'pt-BR' });
    const page = await ctx.newPage();
    // SPA React — aguarda o app renderizar (espera elemento principal aparecer)
    await page.goto(url, { waitUntil: 'networkidle', timeout: 25_000 });
    // Aguarda mais um pouco para o React hidratação
    await page.waitForTimeout(2000);
    console.log(`  → ${page.url()}`);
    console.log(`  Title: "${await page.title()}"`);
    const inputs = await page.locator('input').all();
    console.log(`  Inputs (${inputs.length}):`);
    for (const inp of inputs.slice(0, 8)) {
      const t = await inp.getAttribute('type') ?? 'text';
      const n = await inp.getAttribute('name') ?? '';
      const i = await inp.getAttribute('id') ?? '';
      const p = await inp.getAttribute('placeholder') ?? '';
      console.log(`    <input type="${t}" name="${n}" id="${i}" placeholder="${p}">`);
    }
    const links = await page.locator('a').all();
    const relevantes = [];
    for (const a of links) {
      const href = (await a.getAttribute('href') ?? '');
      const text = (await a.textContent() ?? '').replace(/\s+/g, ' ').trim();
      if (/certid|cnd|debit|fiscal|inscri|municipal|regular|negativa|emit|consul|alvara|iss|nfse/i.test(href + text)) {
        relevantes.push(`[${text.slice(0,60)}] → ${href}`);
      }
    }
    if (relevantes.length) {
      console.log(`  Links relevantes (${relevantes.length}):`);
      relevantes.slice(0, 15).forEach(l => console.log(`    ${l}`));
    }
    const body = (await page.textContent('body') ?? '').replace(/\s+/g, ' ').slice(0, 800);
    console.log(`  Body: ${body}`);
  } finally {
    await browser.close();
  }
}

async function main() {
  await probeEmissaoCertidao();
  await probeSalvadorDigital('/', 'home');
  await probeSalvadorDigital('/servicos', 'servicos');
  await probeSalvadorDigital('/certidao-negativa', 'certidao-negativa');
  await probeSalvadorDigital('/divida-ativa', 'divida-ativa');
}

main().catch(console.error);
