import { Injectable, Logger } from '@nestjs/common';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { chromium, Browser, Page } from 'playwright';
import { CredenciaisService } from '../credenciais/credenciais.service';
import { CredencialTipo } from '../credenciais/credencial.entity';

// pdf-parse é CJS sem export default compatível com nodenext — require com tipagem explícita
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse: (buf: Buffer) => Promise<{ text: string }> = require('pdf-parse');

export interface ResultadoScraper {
  status: 'REGULAR' | 'IRREGULAR' | 'INDISPONIVEL' | 'ERRO';
  validade: string | null;
  mensagem: string;
  urlArquivo?: string | null;
}

@Injectable()
export class CertidoesScraperService {
  private readonly logger = new Logger(CertidoesScraperService.name);

  constructor(private readonly credenciais: CredenciaisService) {}

  private async comBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
      ],
    });
    try {
      return await fn(browser);
    } finally {
      await browser.close();
    }
  }

  private async novaPage(browser: Browser, acceptDownloads = false) {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
      locale: 'pt-BR',
      acceptDownloads,
      extraHTTPHeaders: { 'Accept-Language': 'pt-BR,pt;q=0.9' },
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    return context.newPage();
  }

  // ---------------------------------------------------------------------------
  // FGTS / CRF — Caixa Econômica Federal
  // Portal: https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf
  // ---------------------------------------------------------------------------
  async consultarFgts(cnpj: string): Promise<ResultadoScraper> {
    const cnpjLimpo = cnpj.replace(/\D/g, '');

    return this.comBrowser(async (browser) => {
      const page = await this.novaPage(browser, true); // acceptDownloads: true para o PDF do CRF

      try {
        await page.goto(
          'https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf',
          { waitUntil: 'networkidle', timeout: 30_000 },
        );

        const campoInscricao = page.locator('input[id*="inscricao"], input[name*="inscricao"], input[id*="Inscricao"]').first();
        await campoInscricao.fill(cnpjLimpo);

        await Promise.all([
          page.waitForResponse((r) => r.url().includes('caixa.gov.br'), { timeout: 20_000 }),
          page.locator('[id="mainForm:btnConsultar"]').dispatchEvent('click'),
        ]);

        const conteudo = (await page.textContent('body')) ?? '';
        const resultado = this.parseFgts(conteudo);

        // Se regular, baixa o PDF do CRF (para salvar e extrair data de validade real)
        if (resultado.status === 'REGULAR') {
          const { validade, urlArquivo } = await this.baixarCertificadoCrf(page, cnpjLimpo);
          if (validade) {
            resultado.validade = validade;
            resultado.mensagem = `Empresa regular perante o FGTS (CRF). Válido até ${validade}.`;
          }
          resultado.urlArquivo = urlArquivo;
        }

        return resultado;
      } catch (err) {
        this.logger.error(`FGTS scraper erro para ${cnpj}: ${err}`);
        return { status: 'INDISPONIVEL', validade: null, mensagem: `Erro ao acessar portal FGTS: ${err}` };
      }
    });
  }

  private async baixarCertificadoCrf(
    page: Page,
    cnpjLimpo: string,
  ): Promise<{ validade: string | null; urlArquivo: string | null }> {
    try {
      // O link dispara um AJAX A4J — aguarda a resposta que re-renderiza a página
      const linkCrf = page
        .locator('a')
        .filter({ hasText: /certificado.*fgts|crf|regularidade/i })
        .first();

      if ((await linkCrf.count()) === 0) {
        this.logger.warn('CRF: link do certificado não encontrado na página.');
        const texto = await page.textContent('body') ?? '';
        return { validade: this.extrairValidadeCrf(texto), urlArquivo: null };
      }

      await Promise.all([
        page.waitForResponse((r) => r.url().includes('caixa.gov.br'), { timeout: 20_000 }),
        linkCrf.dispatchEvent('click'),
      ]);

      // Extrai validade do texto renderizado pelo AJAX
      const texto = (await page.textContent('body') ?? '').replace(/\s+/g, ' ').trim();
      const validade = this.extrairValidadeCrf(texto);

      // Esconde botões de navegação do portal antes de gerar o PDF
      await page.addStyleTag({
        content: `
          input[type=submit], input[type=button], input[type=reset],
          button, a.rich-button, .rich-button, .botao,
          [id*="btnVoltar"], [id*="btnVisualizar"], [id*="btnImprimir"]
          { display: none !important; }
        `,
      });

      // Gera PDF do certificado renderizado via Playwright
      const uploadDir = join(process.cwd(), 'uploads', 'certidoes');
      if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });
      const filename = `crf-${cnpjLimpo}-${Date.now()}.pdf`;
      const filepath = join(uploadDir, filename);

      await page.pdf({
        path: filepath,
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      });

      this.logger.log(`CRF: PDF gerado em ${filename}, validade=${validade}`);
      return { validade, urlArquivo: `/uploads/certidoes/${filename}` };
    } catch (err) {
      this.logger.warn(`CRF: não foi possível gerar o certificado: ${err}`);
      try {
        const texto = (await page.textContent('body') ?? '').replace(/\s+/g, ' ');
        return { validade: this.extrairValidadeCrf(texto), urlArquivo: null };
      } catch {
        return { validade: null, urlArquivo: null };
      }
    }
  }

  private extrairValidadeCrf(texto: string): string | null {
    // Extrai todas as datas DD/MM/AAAA do certificado
    const todas = [...texto.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)];
    if (todas.length === 0) return null;

    const hoje = Date.now();
    const datas = todas
      .map(([, d, m, y]) => ({ iso: `${y}-${m}-${d}`, ts: new Date(`${y}-${m}-${d}`).getTime() }))
      .filter(({ ts }) => !isNaN(ts));

    if (datas.length === 0) return null;

    // Se houver data futura, é a validade direta
    const futuras = datas.filter(({ ts }) => ts > hoje);
    if (futuras.length > 0) {
      futuras.sort((a, b) => b.ts - a.ts);
      return futuras[0].iso;
    }

    // Todas as datas são passadas: a maior é a emissão — CRF vale 90 dias por lei
    datas.sort((a, b) => b.ts - a.ts);
    const emissao = new Date(datas[0].ts);
    emissao.setDate(emissao.getDate() + 90);
    return emissao.toISOString().slice(0, 10);
  }

  private parseFgts(html: string): ResultadoScraper {
    const texto = html.toLowerCase();

    // Frase exclusiva da página de resultado (não aparece no formulário inicial)
    const ehResultado = texto.includes('situação de regularidade do empregador');
    if (!ehResultado) {
      return { status: 'INDISPONIVEL', validade: null, mensagem: 'Portal FGTS não retornou página de resultado.' };
    }

    if (texto.includes('esta regular') || texto.includes('está regular')) {
      // Portal não exibe data de validade do CRF na tela — validade está no PDF do certificado
      return { status: 'REGULAR', validade: null, mensagem: 'Empresa regular perante o FGTS (CRF).' };
    }

    if (texto.includes('irregular') || texto.includes('pendência') || texto.includes('débito') || texto.includes('debito')) {
      return { status: 'IRREGULAR', validade: null, mensagem: 'Empresa com pendências no FGTS.' };
    }

    if (texto.includes('não encontrado') || texto.includes('nao encontrado') || texto.includes('não cadastrado')) {
      return { status: 'INDISPONIVEL', validade: null, mensagem: 'CNPJ não encontrado no sistema FGTS.' };
    }

    return { status: 'INDISPONIVEL', validade: null, mensagem: 'Resposta do portal FGTS não reconhecida.' };
  }

  // ---------------------------------------------------------------------------
  // CNDT Trabalhista — TST
  // Portal: https://cndt-certidao.tst.jus.br/gerarCertidao.faces
  // CAPTCHA: imagem base64 embutida no src da <img id="idImgBase64">
  // Estratégia: 2captcha (se chave cadastrada) → Whisper como fallback
  // ---------------------------------------------------------------------------
  async consultarCndt(cnpj: string): Promise<ResultadoScraper> {
    const cnpjLimpo = cnpj.replace(/\D/g, '');
    const chave2captcha = await this.credenciais.obterValor(CredencialTipo.API_2CAPTCHA);

    if (chave2captcha) {
      this.logger.log('CNDT: usando 2captcha (chave cadastrada).');
      return this.consultarCndtCom2captcha(cnpjLimpo, chave2captcha);
    }

    this.logger.log('CNDT: chave 2captcha não cadastrada — usando Whisper (áudio).');
    return this.consultarCndtComWhisper(cnpjLimpo);
  }

  // CNDT via 2captcha — resolve o CAPTCHA de imagem usando serviço pago
  private async consultarCndtCom2captcha(cnpjLimpo: string, apiKey: string): Promise<ResultadoScraper> {
    return this.comBrowser(async (browser) => {
      const page = await this.novaPage(browser, true);

      for (let tentativa = 1; tentativa <= 3; tentativa++) {
        try {
          await page.goto('https://cndt-certidao.tst.jus.br/gerarCertidao.faces', {
            waitUntil: 'networkidle',
            timeout: 30_000,
          });

          await page.locator('#gerarCertidaoForm\\:cpfCnpj').fill(cnpjLimpo);

          const imageSrc = await page.locator('img#idImgBase64').getAttribute('src') ?? '';
          if (!imageSrc) {
            this.logger.warn(`CNDT 2captcha tentativa ${tentativa}: imagem CAPTCHA não encontrada.`);
            continue;
          }

          const respostaCaptcha = await this.resolver2captchaImagem(imageSrc, apiKey);
          if (!respostaCaptcha) {
            this.logger.warn(`CNDT 2captcha tentativa ${tentativa}: sem resposta do serviço.`);
            continue;
          }

          this.logger.log(`CNDT 2captcha tentativa ${tentativa}: resposta "${respostaCaptcha}"`);
          await page.locator('#idCampoResposta').fill(respostaCaptcha);
          await Promise.all([
            page.waitForResponse((r) => r.url().includes('tst.jus.br'), { timeout: 20_000 }),
            page.locator('#gerarCertidaoForm\\:btnEmitirCertidao').click(),
          ]);

          const texto = (await page.textContent('body') ?? '').replace(/\s+/g, ' ');
          const resultado = this.parseCndt(texto);

          if (resultado.status === 'INDISPONIVEL' && resultado.mensagem.includes('CAPTCHA')) {
            this.logger.warn(`CNDT 2captcha tentativa ${tentativa}: CAPTCHA rejeitado.`);
            continue;
          }

          if (resultado.status === 'REGULAR' || resultado.status === 'IRREGULAR') {
            resultado.urlArquivo = await this.gerarPdfCndt(page, cnpjLimpo);
          }

          return resultado;
        } catch (err) {
          this.logger.warn(`CNDT 2captcha tentativa ${tentativa} erro: ${err}`);
          if (tentativa === 3) {
            return { status: 'INDISPONIVEL', validade: null, mensagem: `Erro ao consultar CNDT (2captcha) após 3 tentativas: ${err}` };
          }
        }
      }

      return { status: 'INDISPONIVEL', validade: null, mensagem: 'CNDT: CAPTCHA não resolvido pelo 2captcha após 3 tentativas.' };
    });
  }

  // CNDT via Whisper — fallback offline usando transcrição de áudio
  private async consultarCndtComWhisper(cnpjLimpo: string): Promise<ResultadoScraper> {
    return this.comBrowser(async (browser) => {
      const page = await this.novaPage(browser, true);

      for (let tentativa = 1; tentativa <= 3; tentativa++) {
        try {
          await page.goto('https://cndt-certidao.tst.jus.br/gerarCertidao.faces', {
            waitUntil: 'networkidle',
            timeout: 30_000,
          });

          await page.locator('#gerarCertidaoForm\\:cpfCnpj').fill(cnpjLimpo);

          await page.locator('button:has-text("Ouvir")').click();
          await page.waitForTimeout(500);
          const audioSrc = await page.locator('#idAudioCaptcha').getAttribute('src') ?? '';

          if (!audioSrc) {
            this.logger.warn(`CNDT Whisper tentativa ${tentativa}: áudio CAPTCHA não disponível.`);
            continue;
          }

          const respostaCaptcha = await this.resolverCaptchaAudio(audioSrc);
          this.logger.log(`CNDT Whisper tentativa ${tentativa}: transcreveu "${respostaCaptcha}"`);

          if (!respostaCaptcha) {
            this.logger.warn(`CNDT Whisper tentativa ${tentativa}: transcrição vazia.`);
            continue;
          }

          await page.locator('#idCampoResposta').fill(respostaCaptcha);
          await Promise.all([
            page.waitForResponse((r) => r.url().includes('tst.jus.br'), { timeout: 20_000 }),
            page.locator('#gerarCertidaoForm\\:btnEmitirCertidao').click(),
          ]);

          const texto = (await page.textContent('body') ?? '').replace(/\s+/g, ' ');
          const resultado = this.parseCndt(texto);

          if (resultado.status === 'INDISPONIVEL' && resultado.mensagem.includes('CAPTCHA')) {
            this.logger.warn(`CNDT Whisper tentativa ${tentativa}: CAPTCHA rejeitado ("${respostaCaptcha}").`);
            continue;
          }

          if (resultado.status === 'REGULAR' || resultado.status === 'IRREGULAR') {
            resultado.urlArquivo = await this.gerarPdfCndt(page, cnpjLimpo);
          }

          return resultado;
        } catch (err) {
          this.logger.warn(`CNDT Whisper tentativa ${tentativa} erro: ${err}`);
          if (tentativa === 3) {
            return { status: 'INDISPONIVEL', validade: null, mensagem: `Erro ao consultar CNDT (Whisper) após 3 tentativas: ${err}` };
          }
        }
      }

      return {
        status: 'INDISPONIVEL',
        validade: null,
        mensagem: 'CNDT TST: CAPTCHA não resolvido. Cadastre uma chave 2captcha em Configurações para automação confiável.',
      };
    });
  }

  // Submete imagem CAPTCHA ao 2captcha e retorna o texto resolvido
  private async resolver2captchaImagem(imageSrc: string, apiKey: string): Promise<string | null> {
    const base64 = imageSrc.replace(/^data:image\/\w+;base64,/, '');

    try {
      const submitRes = await fetch('https://2captcha.com/in.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: apiKey, method: 'base64', body: base64, json: 1 }),
      });
      const submitJson = (await submitRes.json()) as { status: number; request: string };
      if (submitJson.status !== 1) {
        this.logger.warn(`2captcha submit erro: ${JSON.stringify(submitJson)}`);
        return null;
      }

      const captchaId = submitJson.request;
      // Aguarda resolução (máx 60s, polling a cada 5s)
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 5_000));
        const resRes = await fetch(
          `https://2captcha.com/res.php?key=${apiKey}&action=get&id=${captchaId}&json=1`,
        );
        const resJson = (await resRes.json()) as { status: number; request: string };
        if (resJson.status === 1) return resJson.request;
        if (resJson.request !== 'CAPCHA_NOT_READY') {
          this.logger.warn(`2captcha result erro: ${JSON.stringify(resJson)}`);
          return null;
        }
      }

      this.logger.warn('2captcha: timeout — sem resposta em 60s.');
      return null;
    } catch (err) {
      this.logger.warn(`2captcha erro de rede: ${err}`);
      return null;
    }
  }

  // Transcreve o WAV base64 do CAPTCHA de áudio via Whisper (offline)
  private async resolverCaptchaAudio(wavBase64: string): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { pipeline, env } = require('@xenova/transformers');

    // Cache do modelo em uploads/whisper-cache para não baixar a cada reinício
    env.cacheDir = join(process.cwd(), 'uploads', 'whisper-cache');

    const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
      language: 'portuguese',
      task: 'transcribe',
    });

    const wavBuffer = Buffer.from(wavBase64.replace(/^data:audio\/\w+;base64,\s*/, ''), 'base64');

    // Whisper espera Float32Array de amostras PCM a 16kHz — converte o WAV
    const float32 = this.wavBufferToFloat32(wavBuffer);
    const resultado = await transcriber(float32, { language: 'pt', task: 'transcribe' });
    const transcricao: string = Array.isArray(resultado) ? resultado[0]?.text ?? '' : (resultado as { text: string }).text ?? '';

    this.logger.log(`CNDT Whisper transcreveu: "${transcricao}"`);
    return this.transcreverCaptchaPt(transcricao);
  }

  // Converte WAV PCM para Float32Array a 16kHz (necessário para o Whisper)
  private wavBufferToFloat32(buf: Buffer): Float32Array {
    // Lê sample rate real do header (offset 24)
    const srcSampleRate = buf.readUInt32LE(24);
    const bitsPerSample = buf.readUInt16LE(34);

    // Encontra o chunk "data" dinamicamente
    let dataOffset = 44;
    let dataSize   = buf.length - 44;
    let pos = 12;
    while (pos + 8 <= buf.length) {
      const id   = buf.slice(pos, pos + 4).toString('ascii');
      const size = buf.readUInt32LE(pos + 4);
      if (id === 'data') {
        dataOffset = pos + 8;
        dataSize   = Math.min(size, buf.length - dataOffset);
        break;
      }
      pos += 8 + size;
    }

    const bytesPerSample = bitsPerSample / 8;
    const totalSamples   = Math.floor(dataSize / bytesPerSample);

    // Decodifica amostras PCM para float
    const pcm = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      const s = buf.readInt16LE(dataOffset + i * bytesPerSample);
      pcm[i] = s / 32768;
    }

    // Resample para 16kHz se necessário (Whisper exige 16kHz)
    const targetRate = 16_000;
    if (srcSampleRate === targetRate) return pcm;

    const ratio     = srcSampleRate / targetRate;
    const newLength = Math.floor(totalSamples / ratio);
    const resampled = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const idx  = i * ratio;
      const lo   = Math.floor(idx);
      const hi   = Math.min(lo + 1, totalSamples - 1);
      const frac = idx - lo;
      resampled[i] = pcm[lo] * (1 - frac) + pcm[hi] * frac;
    }

    this.logger.log(`CNDT WAV: ${srcSampleRate}Hz → 16000Hz, ${totalSamples} → ${newLength} amostras`);
    return resampled;
  }

  // Mapeia transcrição em português para os caracteres do CAPTCHA
  private transcreverCaptchaPt(texto: string): string {
    const normalizado = texto
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // remove acentos
      .replace(/[^a-z0-9\s]/g, ' ')
      .trim();

    // Substitui palavras por caracteres antes de extrair letras/dígitos
    const mapa: Record<string, string> = {
      'zero': '0', 'um': '1', 'dois': '2', 'tres': '3', 'quatro': '4',
      'cinco': '5', 'seis': '6', 'sete': '7', 'oito': '8', 'nove': '9',
      'a': 'a', 'be': 'b', 'ce': 'c', 'de': 'd', 'e': 'e', 'efe': 'f',
      'ge': 'g', 'aga': 'h', 'i': 'i', 'jota': 'j', 'ka': 'k', 'ele': 'l',
      'eme': 'm', 'ene': 'n', 'o': 'o', 'pe': 'p', 'que': 'q', 'erre': 'r',
      'esse': 's', 'te': 't', 'u': 'u', 've': 'v', 'dublio': 'w', 'xis': 'x',
      'ipsilon': 'y', 'ze': 'z', 'zeta': 'z',
    };

    let resultado = normalizado;
    // Substitui palavras longas primeiro (ex: "quatro" antes de "que")
    const chaves = Object.keys(mapa).sort((a, b) => b.length - a.length);
    for (const palavra of chaves) {
      resultado = resultado.replace(new RegExp(`\\b${palavra}\\b`, 'g'), mapa[palavra]);
    }

    // Remove espaços e extrai apenas alfanuméricos
    return resultado.replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
  }

  private parseCndt(texto: string): ResultadoScraper {
    const t = texto.toLowerCase();

    if (t.includes('negativa de débitos trabalhistas') || t.includes('não constam')) {
      const validade = this.extrairData(texto);
      return { status: 'REGULAR', validade, mensagem: 'Certidão Negativa de Débitos Trabalhistas (CNDT) emitida.' };
    }

    if (t.includes('positiva') || t.includes('débitos') || t.includes('pendências')) {
      return { status: 'IRREGULAR', validade: null, mensagem: 'Empresa com débitos trabalhistas registrados no TST.' };
    }

    if (t.includes('não encontrado') || t.includes('nao encontrado') || t.includes('cnpj inválido')) {
      return { status: 'INDISPONIVEL', validade: null, mensagem: 'CNPJ não encontrado no sistema CNDT.' };
    }

    if (t.includes('captcha') || t.includes('caracteres') && t.includes('incorret')) {
      return { status: 'INDISPONIVEL', validade: null, mensagem: 'CNDT: CAPTCHA inválido.' };
    }

    return { status: 'INDISPONIVEL', validade: null, mensagem: 'CNDT TST: resposta não reconhecida.' };
  }

  private async gerarPdfCndt(page: import('playwright').Page, cnpjLimpo: string): Promise<string | null> {
    try {
      await page.addStyleTag({
        content: `
          input[type=submit], input[type=button], button,
          .botao, [id*="btn"], nav, header, footer
          { display: none !important; }
        `,
      });

      const uploadDir = join(process.cwd(), 'uploads', 'certidoes');
      if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });
      const filename = `cndt-${cnpjLimpo}-${Date.now()}.pdf`;
      const filepath = join(uploadDir, filename);

      await page.pdf({
        path: filepath,
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      });

      this.logger.log(`CNDT: PDF gerado em ${filename}`);
      return `/uploads/certidoes/${filename}`;
    } catch (err) {
      this.logger.warn(`CNDT: não foi possível gerar PDF: ${err}`);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Inscrição Estadual — SEFAZ estadual (por UF)
  // BA: scraping automático no portal SEFAZ-BA (ignoreHTTPSErrors — SSL antigo)
  // Demais estados: retorna INDISPONIVEL com link direto para consulta manual
  // ---------------------------------------------------------------------------

  private readonly sefazLinks: Record<string, string> = {
    AC: 'https://www.sefaz.ac.gov.br/',
    AL: 'https://www.sefaz.al.gov.br/',
    AM: 'https://www.sefaz.am.gov.br/',
    AP: 'https://www.sefaz.ap.gov.br/',
    CE: 'https://cagece.sefaz.ce.gov.br/',
    DF: 'https://www.sefaz.df.gov.br/',
    ES: 'https://internet.sefaz.es.gov.br/',
    GO: 'https://www.sefaz.go.gov.br/',
    MA: 'https://sistemas1.sefaz.ma.gov.br/portalsefaz/',
    MG: 'https://www.fazenda.mg.gov.br/contribuintes/portaldfe/cadastro-de-contribuintes.html',
    MS: 'https://www.sefaz.ms.gov.br/',
    MT: 'https://www.sefaz.mt.gov.br/',
    PA: 'https://app.sefa.pa.gov.br/',
    PB: 'https://www.receita.pb.gov.br/',
    PE: 'https://www.sefaz.pe.gov.br/',
    PI: 'https://www.sefaz.pi.gov.br/',
    PR: 'https://celepar7cpe.pr.gov.br/cfc-internet/',
    RJ: 'https://www.fazenda.rj.gov.br/',
    RN: 'https://www.set.rn.gov.br/',
    RO: 'https://www.sefin.ro.gov.br/',
    RR: 'https://www.sefaz.rr.gov.br/',
    RS: 'https://www.sefaz.rs.gov.br/',
    SC: 'https://sat.sef.sc.gov.br/',
    SE: 'https://www.sefaz.se.gov.br/',
    SP: 'https://www.fazenda.sp.gov.br/cadweb/',
    TO: 'https://sefaz.to.gov.br/',
  };

  async consultarInscricaoEstadual(cnpj: string, uf?: string | null): Promise<ResultadoScraper> {
    const cnpjLimpo = cnpj.replace(/\D/g, '');
    const ufUpper = (uf ?? '').toUpperCase().trim();

    if (ufUpper === 'BA') {
      return this.consultarIeSefazBa(cnpjLimpo);
    }

    const link = this.sefazLinks[ufUpper];
    if (link) {
      return {
        status: 'INDISPONIVEL',
        validade: null,
        mensagem: `Consulta automática de IE disponível apenas para BA. Acesse a SEFAZ ${ufUpper}: ${link}`,
      };
    }

    const ufDesc = ufUpper || 'desconhecida';
    return {
      status: 'INDISPONIVEL',
      validade: null,
      mensagem: `UF ${ufDesc}: consulta manual de IE necessária. Acesse a SEFAZ do estado para verificar a Inscrição Estadual.`,
    };
  }

  private async consultarIeSefazBa(cnpjLimpo: string): Promise<ResultadoScraper> {
    // Portal legado ASP — sem SSL moderno, ignoreHTTPSErrors necessário
    const urlFormulario = 'https://portal.sefaz.ba.gov.br/scripts/cadastro/cadastroBa/consultaBa.asp';

    return this.comBrowser(async (browser) => {
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
        locale: 'pt-BR',
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: { 'Accept-Language': 'pt-BR,pt;q=0.9' },
      });
      const page = await context.newPage();

      try {
        await page.goto(urlFormulario, { waitUntil: 'networkidle', timeout: 30_000 });

        // Campo CGC é o nome histórico do CNPJ no sistema legado SEFAZ-BA
        await page.locator('input[name="CGC"]').fill(cnpjLimpo);

        await Promise.all([
          page.waitForNavigation({ timeout: 20_000 }),
          page.locator('input[name="B1"]').click(),
        ]);

        const paginaUrl = page.url();
        const texto = (await page.textContent('body') ?? '').replace(/\s+/g, ' ');

        // Redirecionado para consulta_vazia = CNPJ não cadastrado no ICMS-BA
        if (paginaUrl.includes('consulta_vazia')) {
          return {
            status: 'INDISPONIVEL',
            validade: null,
            mensagem: 'Empresa não localizada no cadastro ICMS-BA (SEFAZ-BA). Prestadores de serviços não são obrigados a ter IE.',
          };
        }

        const resultado = this.parseIeSefazBa(texto);

        if (resultado.status === 'REGULAR' || resultado.status === 'IRREGULAR') {
          resultado.urlArquivo = await this.gerarPdfIe(page, cnpjLimpo);
        }

        return resultado;
      } catch (err) {
        this.logger.error(`IE SEFAZ-BA erro para ${cnpjLimpo}: ${err}`);
        return {
          status: 'INDISPONIVEL',
          validade: null,
          mensagem: `Erro ao acessar SEFAZ-BA: ${err}. Consulte manualmente: ${urlFormulario}`,
        };
      }
    });
  }

  private parseIeSefazBa(texto: string): ResultadoScraper {
    const t = texto.toLowerCase();

    // Extrai número da IE no formato BA (ex: "219.204.453" ou "219204453")
    const matchIe = texto.match(/Inscri[çc]ão Estadual:\s*([\d.]+)/i);
    const numeroIe = matchIe ? matchIe[1].replace(/\./g, '') : null;

    // Indicadores de situação irregular
    if (t.includes('cancelad') || t.includes('inativ') || t.includes('suspend') || t.includes('encerrad') || t.includes('baixad')) {
      return {
        status: 'IRREGULAR',
        validade: null,
        mensagem: numeroIe
          ? `IE ${numeroIe} com situação irregular ou cancelada na SEFAZ-BA.`
          : 'Inscrição Estadual na Bahia com situação irregular ou cancelada.',
      };
    }

    // Empresa encontrada no resultado = IE ativa (o portal só exibe ativos por padrão)
    if (t.includes('inscrição estadual') || t.includes('inscricao estadual') || t.includes('dados da empresa')) {
      return {
        status: 'REGULAR',
        validade: null,
        mensagem: numeroIe
          ? `IE ativa na Bahia. Número: ${numeroIe}.`
          : 'Empresa com Inscrição Estadual ativa na Bahia.',
      };
    }

    return {
      status: 'INDISPONIVEL',
      validade: null,
      mensagem: 'SEFAZ-BA: resposta não reconhecida. Consulte manualmente: https://www.sefaz.ba.gov.br/',
    };
  }

  private async gerarPdfIe(page: Page, cnpjLimpo: string): Promise<string | null> {
    try {
      await page.addStyleTag({
        content: `
          input[type=submit], input[type=button], input[type=reset],
          button, .botao, [id*="btn"], [id*="Btn"],
          nav, header, footer, .menu, .navbar
          { display: none !important; }
        `,
      });

      const uploadDir = join(process.cwd(), 'uploads', 'certidoes');
      if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });
      const filename = `ie-${cnpjLimpo}-${Date.now()}.pdf`;
      const filepath = join(uploadDir, filename);

      await page.pdf({
        path: filepath,
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      });

      this.logger.log(`IE SEFAZ-BA: PDF gerado em ${filename}`);
      return `/uploads/certidoes/${filename}`;
    } catch (err) {
      this.logger.warn(`IE SEFAZ-BA: não foi possível gerar PDF: ${err}`);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // CND Estadual — SEFAZ-BA (Certidão Negativa de Débitos Tributários Estaduais)
  // Portal: https://servicos.sefaz.ba.gov.br/sistemas/DSCRE/Modulos/Publico/EmissaoCertidao.aspx
  // Sem login. Preenche CNPJ, clica "Imprimir" (link AJAX), intercepta window.open,
  // navega para Relatorio.aspx e baixa o PDF como download direto.
  // ---------------------------------------------------------------------------
  async consultarCndEstadual(cnpj: string, uf?: string | null): Promise<ResultadoScraper> {
    const cnpjLimpo = cnpj.replace(/\D/g, '');
    const ufUpper = (uf ?? '').toUpperCase().trim();

    if (ufUpper !== 'BA') {
      const link = this.sefazLinks[ufUpper];
      const ufDesc = ufUpper || 'desconhecida';
      return {
        status: 'INDISPONIVEL',
        validade: null,
        mensagem: link
          ? `Certidão Estadual automática disponível apenas para BA. Acesse a SEFAZ ${ufUpper}: ${link}`
          : `UF ${ufDesc}: consulte a certidão estadual diretamente na SEFAZ do estado.`,
      };
    }

    const URL_FORM = 'https://servicos.sefaz.ba.gov.br/sistemas/DSCRE/Modulos/Publico/EmissaoCertidao.aspx';
    const URL_BASE = 'https://servicos.sefaz.ba.gov.br/sistemas/DSCRE/Modulos/Publico/EmissaoCertidao.aspx';

    const browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
        locale: 'pt-BR',
        ignoreHTTPSErrors: true,
        acceptDownloads: true,
        extraHTTPHeaders: { 'Accept-Language': 'pt-BR,pt;q=0.9' },
      });

      const page = await context.newPage();

      // Intercepta window.open para capturar a URL do relatório sem abrir popup
      await page.addInitScript(() => {
        (window as unknown as Record<string, unknown>)['__capturedPopupUrl'] = null;
        window.open = function(url?: string | URL) {
          (window as unknown as Record<string, unknown>)['__capturedPopupUrl'] = url?.toString() ?? null;
          return null;
        };
      });

      await page.goto(URL_FORM, { waitUntil: 'networkidle', timeout: 30_000 });

      await page.locator('#PHConteudo_TxtNumCNPJ').fill(cnpjLimpo);
      await page.locator('#PHConteudo_TxtNumCNPJ').dispatchEvent('change');
      await page.waitForTimeout(300);

      // Dispara o partial postback AJAX e aguarda resposta
      await Promise.all([
        page.waitForResponse(r => r.url().includes('sefaz.ba.gov.br'), { timeout: 20_000 }),
        page.locator('#PHConteudo_btnImprimir').click(),
      ]);
      await page.waitForTimeout(2000);

      // Verifica se window.open foi chamado (indica que o servidor gerou o relatório)
      const relUrl: string | null = await page.evaluate(
        () => (window as unknown as Record<string, unknown>)['__capturedPopupUrl'] as string | null,
      );

      if (!relUrl) {
        // Sem window.open = erro modal (CNPJ não encontrado no ICMS-BA ou há débitos)
        const corpo = (await page.textContent('body') ?? '').replace(/\s+/g, ' ');
        const temErro = /erro|não encontrado|nao encontrado|débito|debito|irregular/i.test(corpo);
        this.logger.warn(`CND Estadual BA: sem window.open para ${cnpjLimpo}. temErro=${temErro}`);
        return {
          status: 'INDISPONIVEL',
          validade: null,
          mensagem: 'Empresa não localizada no cadastro ICMS-BA ou com débitos que impedem emissão da certidão negativa. Consulte: https://servicos.sefaz.ba.gov.br/sistemas/DSCRE/Modulos/Publico/EmissaoCertidao.aspx',
        };
      }

      // Resolve URL relativa
      const urlRelatorio = new URL(relUrl, URL_BASE).href;
      this.logger.log(`CND Estadual BA: baixando relatório de ${urlRelatorio}`);

      // Abre nova aba, faz download do PDF
      const paginaRelatorio = await context.newPage();
      const [download] = await Promise.all([
        paginaRelatorio.waitForEvent('download', { timeout: 20_000 }),
        paginaRelatorio.goto(urlRelatorio, { waitUntil: 'commit', timeout: 20_000 }).catch(() => {}),
      ]);

      const uploadDir = join(process.cwd(), 'uploads', 'certidoes');
      if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });
      const filename = `cnd-estadual-${cnpjLimpo}-${Date.now()}.pdf`;
      const filepath = join(uploadDir, filename);
      await download.saveAs(filepath);

      this.logger.log(`CND Estadual BA: PDF salvo em ${filename}`);
      return {
        status: 'REGULAR',
        validade: null,
        mensagem: 'Certidão Negativa de Débitos Tributários Estaduais (BA) emitida com sucesso.',
        urlArquivo: `/uploads/certidoes/${filename}`,
      };
    } catch (err) {
      this.logger.error(`CND Estadual BA erro para ${cnpjLimpo}: ${err}`);
      return {
        status: 'INDISPONIVEL',
        validade: null,
        mensagem: `Erro ao consultar CND Estadual SEFAZ-BA: ${err}. Consulte manualmente: ${URL_FORM}`,
      };
    } finally {
      await browser.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Certidão Municipal — por município
  // Salvador: NFSe exige login — retorna INDISPONIVEL com link direto
  // Outros municípios: INDISPONIVEL com instrução para prefeitura
  // ---------------------------------------------------------------------------
  async consultarCertidaoMunicipal(cnpj: string, uf?: string | null, municipio?: string | null): Promise<ResultadoScraper> {
    const munUpper = (municipio ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const ufUpper  = (uf ?? '').toUpperCase().trim();

    if (munUpper.includes('SALVADOR') || (ufUpper === 'BA' && !municipio)) {
      return {
        status: 'INDISPONIVEL',
        validade: null,
        mensagem: 'Certidão Municipal de Salvador exige login no portal NFSe da Prefeitura. Acesse: https://nfse.salvador.ba.gov.br — faça login e emita a Certidão Negativa de Débitos Tributários Municipais.',
      };
    }

    // Mapa de portais municipais conhecidos por UF (prefeituras com CND online pública)
    const portaisMunicipais: Record<string, string> = {
      SP: 'https://www.prefeitura.sp.gov.br/cidade/secretarias/financas/servicos/',
      RJ: 'https://www.fazenda.rio.br/web/sefaz-rio/certidao-negativa',
      BH: 'https://bhissdigital.pbh.gov.br/',
      RS: 'https://www.fazenda.rs.gov.br/',
      PR: 'https://www.curitiba.pr.gov.br/',
    };

    const cidadeCapital: Record<string, string> = {
      SP: 'São Paulo', RJ: 'Rio de Janeiro', MG: 'Belo Horizonte',
      RS: 'Porto Alegre', PR: 'Curitiba', SC: 'Florianópolis',
      GO: 'Goiânia', PE: 'Recife', CE: 'Fortaleza', AM: 'Manaus',
    };

    const portal = portaisMunicipais[ufUpper];
    const nomeMun = municipio ?? cidadeCapital[ufUpper] ?? `município (${ufUpper})`;

    return {
      status: 'INDISPONIVEL',
      validade: null,
      mensagem: portal
        ? `Certidão Municipal de ${nomeMun}: acesse o portal da prefeitura: ${portal}`
        : `Certidão Municipal de ${nomeMun}: consulte diretamente no portal da prefeitura municipal ou Secretaria de Finanças.`,
    };
  }

  // ---------------------------------------------------------------------------
  // Inscrição Municipal (IM / CCM) — por município
  // Salvador: NFSe exige login — retorna INDISPONIVEL com link direto
  // Outros: INDISPONIVEL com instrução
  // ---------------------------------------------------------------------------
  async consultarInscricaoMunicipal(cnpj: string, uf?: string | null, municipio?: string | null): Promise<ResultadoScraper> {
    const munUpper = (municipio ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const ufUpper  = (uf ?? '').toUpperCase().trim();

    if (munUpper.includes('SALVADOR') || (ufUpper === 'BA' && !municipio)) {
      return {
        status: 'INDISPONIVEL',
        validade: null,
        mensagem: 'Inscrição Municipal (CCM) de Salvador: consulta exige login no portal NFSe da Prefeitura. Acesse: https://nfse.salvador.ba.gov.br',
      };
    }

    const nomeMun = municipio ?? `município (${ufUpper || 'desconhecido'})`;
    return {
      status: 'INDISPONIVEL',
      validade: null,
      mensagem: `Inscrição Municipal (IM/CCM) de ${nomeMun}: consulte diretamente na Secretaria de Finanças ou portal de ISS do município.`,
    };
  }

  // ---------------------------------------------------------------------------
  // CND Federal — Receita Federal / PGFN
  // Portal: https://servicos.receitafederal.gov.br/servico/certidoes/
  // Proteção: hCaptcha invisible (sitekey f214a120-a07a-4b28-907a-bfa6b96257ae)
  // Fluxo: 2captcha resolve hCaptcha → validar-contribuinte (set-cookie) → Emissao (PDF base64)
  // ---------------------------------------------------------------------------
  async consultarCndFederal(cnpj: string): Promise<ResultadoScraper> {
    const cnpjLimpo = cnpj.replace(/\D/g, '');
    const chave2captcha = await this.credenciais.obterValor(CredencialTipo.API_2CAPTCHA);

    if (!chave2captcha) {
      return {
        status: 'INDISPONIVEL',
        validade: null,
        mensagem:
          'CND Federal: o portal da Receita Federal usa hCaptcha. Cadastre uma chave 2captcha em Configurações → Credenciais para habilitar a automação.',
      };
    }

    return this.consultarCndFederalCom2captcha(cnpjLimpo, chave2captcha);
  }

  private async consultarCndFederalCom2captcha(
    cnpjLimpo: string,
    apiKey: string,
  ): Promise<ResultadoScraper> {
    const BASE = 'https://servicos.receitafederal.gov.br/servico/certidoes/api';
    const PAGE_URL = 'https://servicos.receitafederal.gov.br/servico/certidoes/';
    const SITEKEY = 'f214a120-a07a-4b28-907a-bfa6b96257ae';

    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      try {
        // 1. Resolve hCaptcha via 2captcha
        this.logger.log(`CND Federal tentativa ${tentativa}: resolvendo hCaptcha...`);
        const captchaToken = await this.resolver2captchaHcaptcha(apiKey, SITEKEY, PAGE_URL);
        if (!captchaToken) {
          this.logger.warn(`CND Federal tentativa ${tentativa}: hCaptcha não resolvido.`);
          continue;
        }

        // 2. Valida CNPJ com o token (seta cookie de sessão)
        const validarRes = await fetch(`${BASE}/consulta/validar-contribuinte`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Captcha-Token': captchaToken,
            'Origin': PAGE_URL,
            'Referer': PAGE_URL,
          },
          body: JSON.stringify({ ni: cnpjLimpo, tipoContribuinte: 'PJ' }),
        });

        const setCookieRaw = validarRes.headers.get('set-cookie') ?? '';
        const validarJson = (await validarRes.json()) as {
          statusValidacao: string;
          codigo?: string;
          mensagem?: string;
        };

        this.logger.log(`CND Federal validar-contribuinte: ${JSON.stringify(validarJson)}`);

        switch (validarJson.statusValidacao) {
          case 'CaptchaFalhaValidacao':
            this.logger.warn(`CND Federal tentativa ${tentativa}: hCaptcha rejeitado pelo servidor.`);
            continue;

          case 'NaoCadastrado':
            return { status: 'INDISPONIVEL', validade: null, mensagem: 'CND Federal: CNPJ não cadastrado na Receita Federal.' };

          case 'CnpjFilial':
            return { status: 'INDISPONIVEL', validade: null, mensagem: 'CND Federal: CNPJ é de filial. A certidão deve ser consultada pelo CNPJ da matriz.' };

          case 'CertidaoNaoPermitida':
            return { status: 'INDISPONIVEL', validade: null, mensagem: 'CND Federal: certidão não permitida para este CNPJ.' };

          case 'SistemaIndisponivel':
            return { status: 'INDISPONIVEL', validade: null, mensagem: 'CND Federal: sistema da Receita Federal indisponível. Tente mais tarde.' };

          case 'NaoEmitida':
            return {
              status: 'IRREGULAR',
              validade: null,
              mensagem: 'CND Federal: certidão negativa não pode ser emitida — empresa possui débitos com a Receita Federal / PGFN.',
            };
        }

        // statusValidacao === 'Emitida' (ou outro válido) — prossegue para emissão
        const cookieHeader = this.extrairCookiesRelevantes(setCookieRaw);

        // 3. Emite a certidão (usa o cookie de sessão)
        const emissaoRes = await fetch(`${BASE}/Emissao`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': cookieHeader,
            'Origin': PAGE_URL,
            'Referer': PAGE_URL,
          },
          body: JSON.stringify({ ni: cnpjLimpo, tipoContribuinte: 'PJ', tipoContribuinteEnum: 'Cnpj' }),
        });

        const emissaoJson = (await emissaoRes.json()) as {
          statusEmissao?: string;
          pdf?: string;
          mensagem?: string;
          dataValidade?: string;
          numeroCertidao?: string;
        };

        this.logger.log(`CND Federal Emissao statusEmissao=${emissaoJson.statusEmissao}`);

        if (emissaoJson.statusEmissao === 'SemDireitoCertidao') {
          return {
            status: 'IRREGULAR',
            validade: null,
            mensagem: 'CND Federal: empresa não tem direito à certidão negativa.',
          };
        }

        if (emissaoJson.statusEmissao !== 'Sucesso' || !emissaoJson.pdf) {
          return {
            status: 'INDISPONIVEL',
            validade: null,
            mensagem: `CND Federal: resposta inesperada da emissão (status=${emissaoJson.statusEmissao ?? 'desconhecido'}).`,
          };
        }

        // 4. Salva o PDF retornado como base64
        const urlArquivo = await this.salvarPdfBase64(emissaoJson.pdf, `cnd-federal-${cnpjLimpo}`);
        const validade = emissaoJson.dataValidade
          ? this.extrairData(emissaoJson.dataValidade)
          : null;

        return {
          status: 'REGULAR',
          validade,
          mensagem: 'Certidão de Débitos Relativos a Créditos Tributários Federais e à Dívida Ativa da União emitida.',
          urlArquivo,
        };
      } catch (err) {
        this.logger.warn(`CND Federal tentativa ${tentativa} erro: ${err}`);
        if (tentativa === 3) {
          return {
            status: 'INDISPONIVEL',
            validade: null,
            mensagem: `CND Federal: erro após 3 tentativas: ${err}`,
          };
        }
      }
    }

    return {
      status: 'INDISPONIVEL',
      validade: null,
      mensagem: 'CND Federal: hCaptcha não resolvido após 3 tentativas.',
    };
  }

  // Resolve hCaptcha via 2captcha (method=hcaptcha)
  private async resolver2captchaHcaptcha(
    apiKey: string,
    sitekey: string,
    pageUrl: string,
  ): Promise<string | null> {
    try {
      const submitRes = await fetch('https://2captcha.com/in.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: apiKey,
          method: 'hcaptcha',
          sitekey,
          pageurl: pageUrl,
          json: 1,
        }),
      });
      const submitJson = (await submitRes.json()) as { status: number; request: string };
      if (submitJson.status !== 1) {
        this.logger.warn(`2captcha hCaptcha submit erro: ${JSON.stringify(submitJson)}`);
        return null;
      }

      const captchaId = submitJson.request;
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 5_000));
        const resRes = await fetch(
          `https://2captcha.com/res.php?key=${apiKey}&action=get&id=${captchaId}&json=1`,
        );
        const resJson = (await resRes.json()) as { status: number; request: string };
        if (resJson.status === 1) return resJson.request;
        if (resJson.request !== 'CAPCHA_NOT_READY') {
          this.logger.warn(`2captcha hCaptcha result erro: ${JSON.stringify(resJson)}`);
          return null;
        }
      }

      this.logger.warn('2captcha hCaptcha: timeout — sem resposta em 120s.');
      return null;
    } catch (err) {
      this.logger.warn(`2captcha hCaptcha erro de rede: ${err}`);
      return null;
    }
  }

  // Salva um PDF em base64 em disco e retorna a URL relativa
  private async salvarPdfBase64(pdfBase64: string, prefixo: string): Promise<string> {
    const uploadsDir = join(process.cwd(), 'uploads', 'certidoes');
    if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

    const timestamp = Date.now();
    const filename = `${prefixo}-${timestamp}.pdf`;
    const filepath = join(uploadsDir, filename);

    const { writeFileSync } = await import('fs');
    writeFileSync(filepath, Buffer.from(pdfBase64, 'base64'));
    this.logger.log(`CND Federal: PDF salvo em ${filename}`);

    return `/uploads/certidoes/${filename}`;
  }

  // Extrai os cookies relevantes do header Set-Cookie para reenvio
  private extrairCookiesRelevantes(setCookieRaw: string): string {
    // Set-Cookie pode ter múltiplos cookies separados por ", " — extrai apenas name=value
    return setCookieRaw
      .split(/,(?=[^;]*=)/)
      .map((c) => c.trim().split(';')[0].trim())
      .filter(Boolean)
      .join('; ');
  }

  // ---------------------------------------------------------------------------
  // Utilitário: extrai data no formato DD/MM/AAAA ou AAAA-MM-DD da página
  // ---------------------------------------------------------------------------
  private extrairData(texto: string): string | null {
    // Tenta DD/MM/AAAA
    const matchBR = texto.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (matchBR) {
      const [, d, m, y] = matchBR;
      return `${y}-${m}-${d}`;
    }
    // Tenta AAAA-MM-DD
    const matchISO = texto.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (matchISO) return matchISO[0];
    return null;
  }
}
