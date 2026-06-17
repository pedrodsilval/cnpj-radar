// Script de teste rápido do scraper IE — roda fora do NestJS
// Uso: node test-ie.mjs <cnpj>
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const cnpj = process.argv[2] ?? '30327128000125';
const cnpjLimpo = cnpj.replace(/\D/g, '');

const sefazLinks = {
  AC: 'https://www.sefaz.ac.gov.br/', AL: 'https://www.sefaz.al.gov.br/',
  AM: 'https://www.sefaz.am.gov.br/', AP: 'https://www.sefaz.ap.gov.br/',
  CE: 'https://cagece.sefaz.ce.gov.br/', DF: 'https://www.sefaz.df.gov.br/',
  ES: 'https://internet.sefaz.es.gov.br/', GO: 'https://www.sefaz.go.gov.br/',
  MA: 'https://sistemas1.sefaz.ma.gov.br/portalsefaz/', MG: 'https://www.fazenda.mg.gov.br/',
  MS: 'https://www.sefaz.ms.gov.br/', MT: 'https://www.sefaz.mt.gov.br/',
  PA: 'https://app.sefa.pa.gov.br/', PB: 'https://www.receita.pb.gov.br/',
  PE: 'https://www.sefaz.pe.gov.br/', PI: 'https://www.sefaz.pi.gov.br/',
  PR: 'https://celepar7cpe.pr.gov.br/cfc-internet/', RJ: 'https://www.fazenda.rj.gov.br/',
  RN: 'https://www.set.rn.gov.br/', RO: 'https://www.sefin.ro.gov.br/',
  RR: 'https://www.sefaz.rr.gov.br/', RS: 'https://www.sefaz.rs.gov.br/',
  SC: 'https://sat.sef.sc.gov.br/', SE: 'https://www.sefaz.se.gov.br/',
  SP: 'https://www.fazenda.sp.gov.br/cadweb/', TO: 'https://sefaz.to.gov.br/',
};

async function gerarPdf(page, cnpjLimpo) {
  try {
    await page.addStyleTag({
      content: `input[type=submit],input[type=button],input[type=reset],button,.botao,[id*="btn"],[id*="Btn"],nav,header,footer,.menu,.navbar{display:none!important;}`,
    });
    const uploadDir = join(__dirname, 'uploads', 'certidoes');
    if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });
    const filename = `ie-${cnpjLimpo}-${Date.now()}.pdf`;
    const filepath = join(uploadDir, filename);
    await page.pdf({ path: filepath, format: 'A4', printBackground: true, margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' } });
    console.log(`PDF gerado: ${filename}`);
    return `/uploads/certidoes/${filename}`;
  } catch (err) {
    console.warn(`Não foi possível gerar PDF: ${err}`);
    return null;
  }
}

function parseIe(texto) {
  const t = texto.toLowerCase();
  const matchIe = texto.match(/Inscri[çc]ão Estadual:\s*([\d.]+)/i);
  const numeroIe = matchIe ? matchIe[1].replace(/\./g, '') : null;

  if (t.includes('cancelad') || t.includes('inativ') || t.includes('suspend') || t.includes('encerrad') || t.includes('baixad')) {
    return { status: 'IRREGULAR', mensagem: numeroIe ? `IE ${numeroIe} com situação irregular.` : 'IE com situação irregular.' };
  }
  if (t.includes('inscrição estadual') || t.includes('inscricao estadual') || t.includes('dados da empresa')) {
    return { status: 'REGULAR', mensagem: numeroIe ? `IE ativa. Número: ${numeroIe}.` : 'Empresa com IE ativa na Bahia.' };
  }
  return { status: 'INDISPONIVEL', mensagem: 'Resposta não reconhecida. Texto body: ' + texto.slice(0, 300) };
}

async function testarIe() {
  console.log(`\n=== Testando IE para CNPJ ${cnpjLimpo} (UF: BA) ===\n`);
  const urlFormulario = 'https://portal.sefaz.ba.gov.br/scripts/cadastro/cadastroBa/consultaBa.asp';

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
      locale: 'pt-BR',
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { 'Accept-Language': 'pt-BR,pt;q=0.9' },
    });
    const page = await context.newPage();

    console.log('1. Abrindo portal SEFAZ-BA...');
    await page.goto(urlFormulario, { waitUntil: 'networkidle', timeout: 30_000 });
    console.log(`   URL atual: ${page.url()}`);

    console.log(`2. Preenchendo CNPJ ${cnpjLimpo}...`);
    await page.locator('input[name="CGC"]').fill(cnpjLimpo);

    console.log('3. Clicando em Consultar e aguardando navegação...');
    await Promise.all([
      page.waitForNavigation({ timeout: 20_000 }),
      page.locator('input[name="B1"]').click(),
    ]);

    const paginaUrl = page.url();
    const texto = (await page.textContent('body') ?? '').replace(/\s+/g, ' ');
    console.log(`   URL após submit: ${paginaUrl}`);
    console.log(`   Primeiros 400 chars do body: ${texto.slice(0, 400)}\n`);

    if (paginaUrl.includes('consulta_vazia')) {
      console.log('RESULTADO: INDISPONIVEL');
      console.log('Mensagem: Empresa não localizada no cadastro ICMS-BA. Prestadores de serviços não são obrigados a ter IE.');
      return;
    }

    const resultado = parseIe(texto);
    console.log(`RESULTADO: ${resultado.status}`);
    console.log(`Mensagem: ${resultado.mensagem}`);

    if (resultado.status === 'REGULAR' || resultado.status === 'IRREGULAR') {
      console.log('\n4. Gerando PDF...');
      const url = await gerarPdf(page, cnpjLimpo);
      console.log(`urlArquivo: ${url}`);
    }
  } finally {
    await browser.close();
  }
}

testarIe().catch(console.error);
