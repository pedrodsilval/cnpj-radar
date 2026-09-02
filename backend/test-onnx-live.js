// Teste isolado (nao faz parte do app): mede o tempo real de captura-ate-
// resposta do solver ONNX local contra o captcha ao vivo do CNDT/TST, sem
// precisar de token de autenticacao nem passar pela API HTTP inteira.
// Uso: node test-onnx-live.js
const { chromium } = require('playwright');
const ort = require('onnxruntime-node');
const { Jimp } = require('jimp');
const path = require('path');

const CHARSET = '0123456789abcdefghijklmnopqrstuvwxyz';
const CAPTCHA_LENGTH = 6;
const IMG_H = 32;
const IMG_W = 128;
const CTC_BLANK = CHARSET.length;
const MODEL_PATH = path.join(__dirname, 'assets', 'captcha_cnn.onnx');

async function resolver(session, imageSrc) {
  const base64 = imageSrc.replace(/^data:image\/\w+;base64,/, '').trim();
  const buffer = Buffer.from(base64, 'base64');
  const img = await Jimp.read(buffer);
  img.greyscale();
  img.resize({ w: IMG_W, h: IMG_H });

  const { data } = img.bitmap;
  const tensorData = new Float32Array(IMG_H * IMG_W);
  for (let i = 0; i < IMG_H * IMG_W; i++) {
    tensorData[i] = data[i * 4] / 127.5 - 1.0;
  }

  const inputTensor = new ort.Tensor('float32', tensorData, [1, 1, IMG_H, IMG_W]);
  const results = await session.run({ image: inputTensor });
  const logits = results['logits'];
  const dims = logits.dims;
  const W = dims[0];
  const numClasses = dims[2];
  const logitsData = logits.data;

  let anterior = null;
  const chars = [];
  const confs = [];
  for (let t = 0; t < W; t++) {
    const offset = t * numClasses;
    let maxIdx = 0, maxVal = -Infinity;
    for (let c = 0; c < numClasses; c++) {
      const v = logitsData[offset + c];
      if (v > maxVal) { maxVal = v; maxIdx = c; }
    }
    let sumExp = 0;
    for (let c = 0; c < numClasses; c++) sumExp += Math.exp(logitsData[offset + c] - maxVal);
    const prob = 1 / sumExp;
    if (maxIdx !== anterior && maxIdx !== CTC_BLANK) {
      chars.push(CHARSET[maxIdx]);
      confs.push(prob);
    }
    anterior = maxIdx;
  }
  const token = chars.join('');
  if (token.length !== CAPTCHA_LENGTH) return { token, confidence: 0 };
  return { token, confidence: Math.min(...confs) };
}

async function main() {
  const count = parseInt(process.argv[2] || '5', 10);
  const delayMs = parseInt(process.argv[3] || '0', 10);
  console.log(`Testando solver ONNX local contra ${count} captchas reais do CNDT/TST (atraso proposital antes do submit: ${delayMs}ms)...`);

  const session = await ort.InferenceSession.create(MODEL_PATH, { executionProviders: ['cpu'] });
  console.log('Modelo ONNX carregado.\n');

  // Mesmo contexto + evasoes de novaPage() em certidoes-scraper.service.ts,
  // pra isolar se o problema em producao e o fingerprint do browser ou o
  // IP de origem (Render). Rodando isto da minha maquina (IP diferente),
  // se ainda assim funcionar bem, isola a causa pro IP, nao pro fingerprint.
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    locale: 'pt-BR',
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: { 'Accept-Language': 'pt-BR,pt;q=0.9' },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const fakePlugin = { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' };
        return Object.assign([fakePlugin], { length: 1, item: () => fakePlugin, namedItem: () => fakePlugin });
      },
    });
    if (!window.chrome) {
      window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}), app: {} };
    }
    const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (parameter) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter.call(this, parameter);
    };
  });
  const page = await context.newPage();

  let acertos = 0, avaliados = 0;
  const tempos = [];

  for (let i = 0; i < count; i++) {
    try {
      await page.goto('https://cndt-certidao.tst.jus.br/gerarCertidao.faces', { waitUntil: 'networkidle', timeout: 30000 });
      await page.locator('#gerarCertidaoForm\\:cpfCnpj').fill('41530027000173');
      await page.waitForTimeout(500);

      const src = await page.locator('img#idImgBase64').getAttribute('src');
      if (!src || !src.startsWith('data:image')) {
        console.log(`  [${i + 1}/${count}] imagem nao encontrada, pulando`);
        continue;
      }

      const t0 = Date.now();
      const { token, confidence } = await resolver(session, src);
      const deltaMs = Date.now() - t0;
      tempos.push(deltaMs);

      if (token.length !== CAPTCHA_LENGTH) {
        console.log(`  [${i + 1}/${count}] modelo nao decodificou 6 chars (${token}), pulando`);
        continue;
      }

      // Atraso proposital ENTRE resolver (resposta ja definida, correta pra
      // essa imagem) e submeter -- testa se o token do captcha expira no
      // servidor com o tempo, independente da resposta estar certa.
      if (delayMs > 0) await page.waitForTimeout(delayMs);

      await page.locator('#idCampoResposta').fill(token.toLowerCase());
      await page.locator('#gerarCertidaoForm\\:btnEmitirCertidao').click();
      await page.waitForTimeout(2000);

      const texto = ((await page.innerText('body')) || '').toLowerCase();
      const rejeitado = texto.includes('captcha') || texto.includes('código de validação inválido') || (texto.includes('caracteres') && texto.includes('incorret'));
      const aceito = !rejeitado;

      avaliados++;
      if (aceito) acertos++;

      console.log(`  [${i + 1}/${count}] [${aceito ? 'OK ' : 'ERR'}] previsto=${token} confianca=${confidence.toFixed(2)} tempo_inferencia=${deltaMs}ms`);
    } catch (err) {
      console.log(`  Erro na iteracao ${i + 1}: ${err}`);
    }
    await page.waitForTimeout(1500);
  }

  await browser.close();

  const media = tempos.length ? (tempos.reduce((a, b) => a + b, 0) / tempos.length) : 0;
  console.log(`\n-- Resultado --`);
  console.log(`  Avaliados: ${avaliados}, Acertos: ${acertos}${avaliados ? ` (${(100 * acertos / avaliados).toFixed(1)}%)` : ''}`);
  console.log(`  Tempo medio de inferencia (so o preprocess+ONNX, sem rede): ${media.toFixed(0)}ms`);
}

main();
