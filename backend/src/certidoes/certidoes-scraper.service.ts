import { Injectable, Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { chromium, Browser, Page } from 'playwright';
import { CredenciaisService } from '../credenciais/credenciais.service';
import { CredencialTipo } from '../credenciais/credencial.entity';
import { CaptchaClientService } from './captcha-client.service';
import { SupabaseStorageService } from '../common/supabase-storage.service';
import { PDFParse } from 'pdf-parse';

export interface ResultadoScraper {
  status: 'REGULAR' | 'IRREGULAR' | 'INDISPONIVEL' | 'ERRO';
  validade: string | null;
  mensagem: string;
  urlArquivo?: string | null;
  // true só quando o portal respondeu de verdade com um resultado negativo
  // (ex.: impedimento real) — diferencia de um INDISPONIVEL por falha da
  // automação (timeout, captcha, site fora do ar), que não prova nada sobre
  // o status real. upsertCertidao usa isso pra decidir se pode sobrescrever
  // um REGULAR anterior ainda válido.
  pendenciaReal?: boolean;
}

const FORM_URL_SAO_PAULO = 'https://duc.prefeitura.sp.gov.br/certidoes/forms_anonimo/frmconsultaemissaocertificado.aspx';

@Injectable()
export class CertidoesScraperService {
  private readonly logger = new Logger(CertidoesScraperService.name);

  constructor(
    private readonly credenciais: CredenciaisService,
    private readonly captchaClient: CaptchaClientService,
    private readonly storage: SupabaseStorageService,
  ) {}

  // Usado pela extensão de Chrome: ela roda no navegador real do usuário
  // (IP residencial, sem o bloqueio de automação que o servidor leva), mas
  // não tem a chave do 2captcha nem o modelo ONNX local — manda a imagem
  // pra cá e a gente resolve com a mesma infra que os scrapers já usam.
  async resolverCaptchaImagemPublico(imageSrc: string): Promise<string | null> {
    const apiKey = await this.credenciais.obterValor(CredencialTipo.API_2CAPTCHA);
    if (!apiKey) return null;
    const { token } = await this.resolver2captchaImagem(imageSrc, apiKey);
    return token;
  }

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
      viewport: { width: 1920, height: 1080 },
      acceptDownloads,
      extraHTTPHeaders: { 'Accept-Language': 'pt-BR,pt;q=0.9' },
    });
    // Evasões de detecção de automação — headless Chrome tem várias
    // pegadas que sites de bot-detection (incluindo hCaptcha) checam antes
    // de decidir se mostra um desafio ou libera direto: navigator.webdriver
    // presente, navigator.plugins vazio, window.chrome ausente, WebGL
    // reportando o renderizador de software (SwiftShader) em vez de uma
    // GPU real. Nenhuma dessas sozinha "engana" um sistema sofisticado,
    // mas juntas reduzem os sinais mais óbvios e baratos de checar.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

      Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });

      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          const fakePlugin = { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' };
          return Object.assign([fakePlugin], { length: 1, item: () => fakePlugin, namedItem: () => fakePlugin });
        },
      });

      const win = window as unknown as { chrome?: unknown };
      if (!win.chrome) {
        win.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}), app: {} };
      }

      const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
      window.navigator.permissions.query = (parameters: PermissionDescriptor) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
          : originalQuery(parameters);

      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (this: WebGLRenderingContext, parameter: number) {
        if (parameter === 37445) return 'Intel Inc.'; // UNMASKED_VENDOR_WEBGL
        if (parameter === 37446) return 'Intel Iris OpenGL Engine'; // UNMASKED_RENDERER_WEBGL
        return getParameter.call(this, parameter);
      };
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

        // Seletor case-insensitive (o portal já usou "inscricao" e "Inscricao" em versões
        // diferentes) e timeout maior — o servidor roda fora do Brasil, então a latência
        // até o portal da Caixa pode ultrapassar o timeout padrão de 30s do Playwright.
        const campoInscricao = page.locator('input[id*="inscricao" i], input[name*="inscricao" i]').first();
        try {
          await campoInscricao.waitFor({ state: 'visible', timeout: 60_000 });
        } catch {
          // Diagnóstico: se o campo não aparece, precisamos ver o que o portal
          // realmente serviu (página de bloqueio/geo-restrição vs. carregamento lento).
          // O snippet vai direto na mensagem retornada — é o único jeito de inspecionar
          // isso sem acesso aos logs do Render.
          const titulo = await page.title().catch(() => '(sem título)');
          const corpo = ((await page.innerText('body').catch(() => '')) ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 400);
          this.logger.error(`FGTS: campo de inscrição não apareceu. url=${page.url()} title="${titulo}" corpo="${corpo}"`);
          return {
            status: 'INDISPONIVEL',
            validade: null,
            mensagem: `FGTS: campo de inscrição não apareceu no portal. title="${titulo}" corpo="${corpo}"`,
          };
        }
        await campoInscricao.fill(cnpjLimpo, { timeout: 60_000 });

        await Promise.all([
          page.waitForResponse((r) => r.url().includes('caixa.gov.br'), { timeout: 20_000 }),
          page.locator('[id="mainForm:btnConsultar"]').dispatchEvent('click'),
        ]);

        const conteudo = (await page.innerText('body')) ?? '';
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
        const texto = await page.innerText('body') ?? '';
        return { validade: this.extrairValidadeCrf(texto), urlArquivo: null };
      }

      await Promise.all([
        page.waitForResponse((r) => r.url().includes('caixa.gov.br'), { timeout: 20_000 }),
        linkCrf.dispatchEvent('click'),
      ]);

      // Extrai validade do texto renderizado pelo AJAX
      const texto = (await page.innerText('body') ?? '').replace(/\s+/g, ' ').trim();
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
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      });
      const urlArquivo = await this.storage.uploadPdf(pdfBuffer, `crf-${cnpjLimpo}`);

      this.logger.log(`CRF: PDF gerado, validade=${validade}`);
      return { validade, urlArquivo };
    } catch (err) {
      this.logger.warn(`CRF: não foi possível gerar o certificado: ${err}`);
      try {
        const texto = (await page.innerText('body') ?? '').replace(/\s+/g, ' ');
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

    // Checa ANTES do "está regular" solto: a mensagem de impedimento também
    // contém essa frase, só que falando da regularidade na PGFN, não no FGTS
    // — confirmado em produção 02/10/2026 contra um CNPJ real com pendência:
    // "está REGULAR na Procuradoria-Geral da Fazenda Nacional - PGFN. Constam
    // impedimentos na CAIXA para a comprovação da regularidade do empregador
    // no FGTS." Sem essa checagem vir primeiro, isso classificava como
    // REGULAR uma empresa com pendência de verdade.
    if (texto.includes('impedimento') && texto.includes('fgts')) {
      return {
        status: 'INDISPONIVEL',
        validade: null,
        mensagem: 'Há impedimentos na Caixa para confirmar a regularidade no FGTS — requer verificação manual via Conectividade Social (conectividadesocialv2.caixa.gov.br).',
        pendenciaReal: true,
      };
    }

    // Frase usada quando a empresa está REALMENTE regular no FGTS (confirmado
    // contra CNPJ limpo, com o link "Obtenha o Certificado de Regularidade do
    // FGTS - CRF" presente na página) — mais específica que o "está regular"
    // solto de antes, que dava falso positivo no caso de impedimento acima.
    if (texto.includes('regular no fgts') || texto.includes('regular perante o fgts')) {
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
  // Portal: https://cndt-certidao.tst.jus.br/gerarCertidao (site reformulado
  // em 09/2026 — a URL antiga .faces redireciona pra home, e todos os IDs de
  // formulário mudaram, ver achados em [[projeto-cnd-federal-local-pendente]])
  // CAPTCHA: imagem base64 embutida no src da <img id="captcha-imagem">
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
    let ultimoErroCaptcha: string | null = null;

    return this.comBrowser(async (browser) => {
      const page = await this.novaPage(browser, true);

      // O botão de emissão tem o rótulo "Emitir Certidão, o PDF da certidão
      // será baixado" -- a certidão real vem como download nativo do
      // navegador, não como conteúdo renderizado na página. Achado real
      // (03/09/2026): o PDF que gerávamos antes com page.pdf() capturava só
      // a mensagem de confirmação transitória ("Certidão EMITIDA com
      // sucesso"), sem CNPJ/validade/código de verificação -- não era a
      // certidão oficial. Captura o download de verdade aqui.
      let downloadBuffer: Buffer | null = null;
      page.on('download', (download) => {
        download.createReadStream().then((stream) => {
          if (!stream) return;
          const chunks: Buffer[] = [];
          stream.on('data', (c) => chunks.push(c));
          stream.on('end', () => { downloadBuffer = Buffer.concat(chunks); });
        }).catch(() => {});
      });

      for (let tentativa = 1; tentativa <= 3; tentativa++) {
        try {
          await page.goto('https://cndt-certidao.tst.jus.br/gerarCertidao', {
            waitUntil: 'networkidle',
            timeout: 30_000,
          });

          // Diagnostico: IP de saida no momento da carga da pagina (quando o
          // tokenDesafio e emitido via loadCaptcha()). Comparado com o IP
          // logo antes do submit -- se forem diferentes (comum em pools de
          // NAT de provedores de nuvem), o servidor pode rejeitar a resposta
          // por inconsistencia de sessao, independente do texto estar certo.
          const ipInicial = await page.evaluate(() =>
            fetch('https://api.ipify.org?format=json').then((r) => r.json()).then((d) => d.ip).catch((e) => `erro:${e}`),
          );

          await page.locator('#cpfCnpj').fill(cnpjLimpo);

          const imageSrc = await page.locator('#captcha-imagem').getAttribute('src') ?? '';
          if (!imageSrc) {
            this.logger.warn(`CNDT 2captcha tentativa ${tentativa}: imagem CAPTCHA não encontrada.`);
            continue;
          }
          const capturaMs = Date.now();

          const { token: respostaCaptcha, erro: erroCaptcha } = await this.resolver2captchaImagem(imageSrc, apiKey);
          if (!respostaCaptcha) {
            ultimoErroCaptcha = erroCaptcha;
            this.logger.warn(`CNDT 2captcha tentativa ${tentativa}: sem resposta do serviço (${erroCaptcha}).`);
            continue;
          }

          this.logger.log(`CNDT 2captcha tentativa ${tentativa}: resposta "${respostaCaptcha}"`);
          await page.locator('#captcha-resposta').fill(respostaCaptcha.toLowerCase());
          // Instrumentacao: medir a demora entre capturar a imagem e
          // submeter a resposta, E checar se a imagem do captcha na tela
          // ainda e a MESMA que foi capturada e resolvida -- se o site
          // trocar o captcha em segundo plano (renovacao automatica) antes
          // do submit, estariamos respondendo certo pra uma imagem que ja
          // nao e mais a valida, o que pareceria "resposta errada" sem ser
          // erro do modelo. Comparacao feita por tamanho + fim da string
          // (suficiente pra detectar troca, sem logar a imagem inteira).
          const imageSrcNoSubmit = await page.locator('#captcha-imagem').getAttribute('src').catch(() => null);
          const imagemTrocou = imageSrcNoSubmit !== null && imageSrcNoSubmit !== imageSrc;
          const ipFinal = await page.evaluate(() =>
            fetch('https://api.ipify.org?format=json').then((r) => r.json()).then((d) => d.ip).catch((e) => `erro:${e}`),
          );
          this.logger.log(
            `CNDT tentativa ${tentativa}: ${Date.now() - capturaMs}ms entre captura da imagem e submissao da resposta. ` +
            `imagem_trocou_antes_do_submit=${imagemTrocou} ip_inicial=${ipInicial} ip_final=${ipFinal} ip_mudou=${ipInicial !== ipFinal} ` +
            `(len_capturada=${imageSrc.length} fim_capturada="${imageSrc.slice(-15)}" | ` +
            `len_no_submit=${imageSrcNoSubmit?.length ?? 'null'} fim_no_submit="${imageSrcNoSubmit?.slice(-15) ?? 'null'}")`,
          );
          await Promise.all([
            page.waitForResponse((r) => r.url().includes('tst.jus.br'), { timeout: 20_000 }),
            page.locator('#botao-emitir').click(),
          ]);

          // BUG REAL encontrado nesta sessao: textContent('body') inclui o
          // texto de dentro de <script> tags, e o JS da propria pagina do
          // TST tem "idUrlServletSoundCaptcha" (nome de elemento) -- ou seja
          // t.includes('captcha') em parseCndt() batia SEMPRE, em qualquer
          // carga de pagina, classificando toda resposta como "CAPTCHA
          // rejeitado" independente do resultado real. innerText respeita
          // renderizacao e exclui <script>/<style>, como os scripts de
          // teste desta sessao ja usavam corretamente.
          //
          // Site novo (09/2026) emite de forma assíncrona: o texto logo
          // após o submit é "Aguarde a emissão da certidão..." — sem esse
          // polling (mesmo padrão do CND Federal), a leitura única caía
          // sempre no fallback "resposta não reconhecida" mesmo quando a
          // emissão só ainda não tinha terminado de processar no servidor.
          let texto = (await page.innerText('body') ?? '').replace(/\s+/g, ' ');
          for (let espera = 0; espera < 8 && /aguarde/i.test(texto); espera++) {
            await page.waitForTimeout(1_500);
            texto = (await page.innerText('body') ?? '').replace(/\s+/g, ' ');
          }
          const resultado = this.parseCndt(texto);
          this.logger.log(`CNDT tentativa ${tentativa}: status=${resultado.status} mensagem="${resultado.mensagem}" texto="${texto.slice(0, 300)}"`);

          if (resultado.status === 'INDISPONIVEL' && resultado.mensagem.includes('CAPTCHA')) {
            ultimoErroCaptcha = `site rejeitou a resposta "${respostaCaptcha}" (resolvida pelo 2captcha)`;
            // Diagnostico: texto exato devolvido pelo site (nao so a
            // mensagem generica que a gente gera) + URL apos o submit
            // (revela redirect por sessao expirada) + se o campo de CNPJ
            // ainda tem o valor preenchido (revela reset de formulario).
            const urlAtual = page.url();
            const cnpjAindaPreenchido = await page.locator('#cpfCnpj').inputValue().catch(() => '(erro ao ler)');
            this.logger.warn(
              `CNDT 2captcha tentativa ${tentativa}: CAPTCHA rejeitado pelo site (resposta "${respostaCaptcha}"). ` +
              `url_apos_submit="${urlAtual}" cnpj_ainda_preenchido="${cnpjAindaPreenchido}" ` +
              `texto_completo_resposta="${texto.slice(0, 500)}"`,
            );
            continue;
          }

          // CAPTCHA aceito pelo site — contribui para o dataset de treino
          this.contribuirDataset(imageSrc, respostaCaptcha).catch(() => {});

          if (resultado.status === 'REGULAR' || resultado.status === 'IRREGULAR') {
            await page.waitForTimeout(1_500); // dá tempo do stream do download terminar
            resultado.urlArquivo = await this.gerarPdfCndt(downloadBuffer, cnpjLimpo);
            if (!resultado.validade && downloadBuffer) resultado.validade = await this.extrairValidadeDoPdf(downloadBuffer);
          }

          return resultado;
        } catch (err) {
          this.logger.warn(`CNDT 2captcha tentativa ${tentativa} erro: ${err}`);
          if (tentativa === 3) {
            return { status: 'INDISPONIVEL', validade: null, mensagem: `Erro ao consultar CNDT (2captcha) após 3 tentativas: ${err}` };
          }
        }
      }

      return {
        status: 'INDISPONIVEL',
        validade: null,
        mensagem: `CNDT: CAPTCHA não resolvido pelo 2captcha após 3 tentativas. Último erro: ${ultimoErroCaptcha ?? 'desconhecido'}.`,
      };
    });
  }

  // CNDT via Whisper — fallback offline usando transcrição de áudio
  private async consultarCndtComWhisper(cnpjLimpo: string): Promise<ResultadoScraper> {
    return this.comBrowser(async (browser) => {
      const page = await this.novaPage(browser, true);

      // Ver comentário em consultarCndtCom2captcha: a certidão real vem
      // como download nativo do navegador, não como conteúdo renderizado.
      let downloadBuffer: Buffer | null = null;
      page.on('download', (download) => {
        download.createReadStream().then((stream) => {
          if (!stream) return;
          const chunks: Buffer[] = [];
          stream.on('data', (c) => chunks.push(c));
          stream.on('end', () => { downloadBuffer = Buffer.concat(chunks); });
        }).catch(() => {});
      });

      for (let tentativa = 1; tentativa <= 3; tentativa++) {
        try {
          await page.goto('https://cndt-certidao.tst.jus.br/gerarCertidao', {
            waitUntil: 'networkidle',
            timeout: 30_000,
          });

          await page.locator('#cpfCnpj').fill(cnpjLimpo);

          await page.locator('#botao-ouvir-captcha').click();
          await page.waitForTimeout(500);
          const audioSrc = await page.locator('#captcha-audio').getAttribute('src') ?? '';

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

          await page.locator('#captcha-resposta').fill(respostaCaptcha.toLowerCase());
          await Promise.all([
            page.waitForResponse((r) => r.url().includes('tst.jus.br'), { timeout: 20_000 }),
            page.locator('#botao-emitir').click(),
          ]);

          // Ver comentário equivalente em consultarCndtCom2captcha: emissão
          // assíncrona no site novo, precisa de polling do "Aguarde...".
          let texto = (await page.innerText('body') ?? '').replace(/\s+/g, ' ');
          for (let espera = 0; espera < 8 && /aguarde/i.test(texto); espera++) {
            await page.waitForTimeout(1_500);
            texto = (await page.innerText('body') ?? '').replace(/\s+/g, ' ');
          }
          const resultado = this.parseCndt(texto);
          this.logger.log(`CNDT tentativa ${tentativa}: status=${resultado.status} mensagem="${resultado.mensagem}" texto="${texto.slice(0, 300)}"`);

          if (resultado.status === 'INDISPONIVEL' && resultado.mensagem.includes('CAPTCHA')) {
            this.logger.warn(`CNDT Whisper tentativa ${tentativa}: CAPTCHA rejeitado ("${respostaCaptcha}").`);
            continue;
          }

          if (resultado.status === 'REGULAR' || resultado.status === 'IRREGULAR') {
            await page.waitForTimeout(1_500); // dá tempo do stream do download terminar
            resultado.urlArquivo = await this.gerarPdfCndt(downloadBuffer, cnpjLimpo);
            if (!resultado.validade && downloadBuffer) resultado.validade = await this.extrairValidadeDoPdf(downloadBuffer);
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

  // Envia imagem + label correto para o dataset de treino da api_captcha.
  // Sem CAPTCHA_API_URL configurada (nunca configurada em produção até
  // 21/08/2026), não há pra onde mandar — não silenciosamente tentar
  // localhost:8000, que é o próprio container em produção.
  private async contribuirDataset(imageSrc: string, label: string): Promise<void> {
    const apiUrl = process.env.CAPTCHA_API_URL;
    if (!apiUrl) return;
    const apiKey = process.env.CAPTCHA_API_KEY ?? 'dev-key';
    const base64 = imageSrc.replace(/^data:image\/\w+;base64,/, '');
    try {
      const res = await fetch(`${apiUrl}/dataset/contribute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ image_b64: base64, label: label.toUpperCase(), source: 'cndt_2captcha' }),
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) {
        this.logger.log(`Dataset: imagem CNDT contribuida com label "${label}"`);
      }
    } catch {
      // Falha silenciosa — nao impacta o fluxo principal
    }
  }

  // Resolve CAPTCHA de imagem: tenta api_captcha local primeiro, cai no 2captcha se falhar.
  // Retorna { token, erro } — sem o motivo exato, toda falha vira "não resolvido"
  // genérico e não dá pra saber se foi chave/saldo, timeout ou o próprio 2captcha
  // dizendo que a imagem é ilegível.
  private async resolver2captchaImagem(imageSrc: string, apiKey: string): Promise<{ token: string | null; erro: string | null }> {
    const localToken = await this.captchaClient.resolverImagem(imageSrc);
    if (localToken) {
      this.logger.log('CNDT: CAPTCHA resolvido localmente (api_captcha).');
      return { token: localToken, erro: null };
    }

    this.logger.log('CNDT: api_captcha não resolveu — acionando 2captcha (pago).');
    const base64 = imageSrc.replace(/^data:image\/\w+;base64,/, '');

    try {
      const submitRes = await fetch('https://2captcha.com/in.php', {
        method: 'POST',
        body: new URLSearchParams({ key: apiKey, method: 'base64', body: base64, json: '1' }),
      });
      const submitJson = (await submitRes.json()) as { status: number; request: string };
      if (submitJson.status !== 1) {
        this.logger.warn(`2captcha submit erro: ${JSON.stringify(submitJson)}`);
        return { token: null, erro: `submit: ${submitJson.request}` };
      }

      const captchaId = submitJson.request;
      // Aguarda resolução (máx 60s, polling a cada 5s)
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 5_000));
        const resRes = await fetch(
          `https://2captcha.com/res.php?key=${apiKey}&action=get&id=${captchaId}&json=1`,
        );
        const resJson = (await resRes.json()) as { status: number; request: string };
        if (resJson.status === 1) return { token: resJson.request, erro: null };
        if (resJson.request !== 'CAPCHA_NOT_READY') {
          this.logger.warn(`2captcha result erro: ${JSON.stringify(resJson)}`);
          return { token: null, erro: `resultado: ${resJson.request}` };
        }
      }

      this.logger.warn('2captcha: timeout — sem resposta em 60s.');
      return { token: null, erro: 'timeout: sem resposta em 60s' };
    } catch (err) {
      this.logger.warn(`2captcha erro de rede: ${err}`);
      return { token: null, erro: `erro de rede: ${err}` };
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

    // "certidão emitida com sucesso" e a mensagem real de sucesso vista ao
    // vivo (innerText) apos o captcha ser aceito -- nao necessariamente vem
    // junto com "negativa de débitos trabalhistas" no texto renderizado
    // nesse momento. Confirmado nesta sessao: resposta do modelo aceita
    // (confianca 0.94) gerou exatamente esse texto, que caia no fallback
    // "resposta não reconhecida" antes desta correcao.
    if (
      t.includes('negativa de débitos trabalhistas') ||
      t.includes('não constam') ||
      t.includes('certidão emitida com sucesso')
    ) {
      const validade = this.extrairData(texto);
      return { status: 'REGULAR', validade, mensagem: 'Certidão Negativa de Débitos Trabalhistas (CNDT) emitida.' };
    }

    if (t.includes('positiva') || t.includes('débitos') || t.includes('pendências')) {
      return { status: 'IRREGULAR', validade: null, mensagem: 'Empresa com débitos trabalhistas registrados no TST.' };
    }

    if (t.includes('não encontrado') || t.includes('nao encontrado') || t.includes('cnpj inválido')) {
      return { status: 'INDISPONIVEL', validade: null, mensagem: 'CNPJ não encontrado no sistema CNDT.' };
    }

    // "código de validação inválido" e a mensagem real e visivel do site
    // pra captcha errado -- nao contem a palavra "captcha" nem "incorret".
    // Confirmado ao vivo nesta sessao (medicao real: 27 de 29 aceitas usando
    // esse criterio, contra falso-negativo constante antes da correcao do
    // textContent->innerText, que sempre batia em "captcha" via texto de
    // <script> presente em toda carga de pagina).
    if (t.includes('captcha') || t.includes('código de validação inválido') || (t.includes('caracteres') && t.includes('incorret'))) {
      return { status: 'INDISPONIVEL', validade: null, mensagem: 'CNDT: CAPTCHA inválido.' };
    }

    return { status: 'INDISPONIVEL', validade: null, mensagem: 'CNDT TST: resposta não reconhecida.' };
  }

  // O texto da página após a emissão não traz mais a validade (site novo,
  // 09/2026) — só o PDF baixado tem "Validade: DD/MM/AAAA". Sem rede, sem
  // custo: só reaproveita o buffer que já baixamos pra fazer upload.
  // Público — reaproveitado pelo CertidoesService pra resolver jobs da fila
  // (certidão emitida pela extensão de Chrome, PDF chega pronto pela API,
  // sem passar pelo browser headed local).
  async extrairValidadeDoPdf(downloadBuffer: Buffer): Promise<string | null> {
    try {
      const parser = new PDFParse({ data: downloadBuffer });
      const { text } = await parser.getText();
      return this.extrairData(text);
    } catch (err) {
      this.logger.warn(`CNDT: não foi possível ler validade do PDF: ${err}`);
      return null;
    }
  }

  private async gerarPdfCndt(downloadBuffer: Buffer | null, cnpjLimpo: string): Promise<string | null> {
    try {
      if (!downloadBuffer) {
        this.logger.warn('CNDT: nenhum download capturado — não é a certidão oficial pra arriscar gerar um PDF substituto.');
        return null;
      }
      const urlArquivo = await this.storage.uploadPdf(downloadBuffer, `cndt-${cnpjLimpo}`);

      this.logger.log(`CNDT: PDF (download real) salvo`);
      return urlArquivo;
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
        const texto = (await page.innerText('body') ?? '').replace(/\s+/g, ' ');

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

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      });
      const urlArquivo = await this.storage.uploadPdf(pdfBuffer, `ie-${cnpjLimpo}`);

      this.logger.log(`IE SEFAZ-BA: PDF gerado`);
      return urlArquivo;
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
        const corpo = (await page.innerText('body') ?? '').replace(/\s+/g, ' ');
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

      const caminhoTemporario = await download.path();
      if (!caminhoTemporario) throw new Error('download.path() retornou vazio.');
      const urlArquivo = await this.storage.uploadPdf(readFileSync(caminhoTemporario), `cnd-estadual-${cnpjLimpo}`);

      this.logger.log(`CND Estadual BA: PDF salvo`);
      return {
        status: 'REGULAR',
        validade: null,
        mensagem: 'Certidão Negativa de Débitos Tributários Estaduais (BA) emitida com sucesso.',
        urlArquivo,
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
  // Salvador: automatizado (ver consultarCertidaoMunicipalSalvador) — a
  // Certidão de Regularidade Fiscal PJ da SEFAZ/PGMS não exige login nem
  // certificado, ao contrário do que se pensava (o NFSe exige login, mas é
  // um sistema diferente do de certidão de regularidade fiscal).
  // Outros municípios: INDISPONIVEL com instrução para prefeitura
  // ---------------------------------------------------------------------------
  async consultarCertidaoMunicipal(cnpj: string, uf?: string | null, municipio?: string | null, cga?: string | null): Promise<ResultadoScraper> {
    const cnpjLimpo = cnpj.replace(/\D/g, '');
    const munUpper = (municipio ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const ufUpper  = (uf ?? '').toUpperCase().trim();

    if (munUpper.includes('SALVADOR') || (ufUpper === 'BA' && !municipio)) {
      return this.consultarCertidaoMunicipalSalvador(cnpjLimpo);
    }

    if (munUpper.includes('LAURO DE FREITAS')) {
      return this.consultarCertidaoMunicipalLauroDeFreitas(cnpjLimpo, cga);
    }

    if (munUpper.includes('SAO PAULO') && ufUpper === 'SP') {
      return this.consultarCertidaoMunicipalSaoPaulo(cnpjLimpo);
    }

    if (munUpper.includes('ENTRE RIOS') && ufUpper === 'BA') {
      return this.consultarCertidaoMunicipalSaatri(cnpjLimpo, 'https://entrerios.saatri.com.br', 'Entre Rios-BA');
    }

    if (munUpper.includes('DIAS') && munUpper.includes('AVILA') && ufUpper === 'BA') {
      return this.consultarCertidaoMunicipalSaatri(cnpjLimpo, 'https://diasdavila.saatri.com.br', "Dias d'Ávila-BA");
    }

    if (munUpper.includes('ARATUIPE') && ufUpper === 'BA') {
      return this.consultarCertidaoMunicipalAratuipe(cnpjLimpo);
    }

    if (munUpper.includes('SANTO AMARO') && ufUpper === 'BA') {
      return this.consultarCertidaoMunicipalSantoAmaro(cnpjLimpo);
    }

    if (munUpper.includes('JUAZEIRO') && ufUpper === 'BA') {
      return this.consultarCertidaoMunicipalJuazeiro(cnpjLimpo);
    }

    // Brasília-DF: não é certidão "municipal" de verdade (o DF não tem
    // municípios, é unificado) -- mas entra aqui porque é tratada como item
    // da lista de "municípios pendentes" desta leva de automação, e o
    // formato de retorno (ResultadoScraper) é o mesmo.
    if (ufUpper === 'DF') {
      return this.consultarCertidaoDistritalBrasilia(cnpjLimpo);
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
  // Certidão Municipal — Salvador (Regularidade Fiscal PJ, SEFAZ + PGMS)
  // Portal: https://servicosweb.sefaz.salvador.ba.gov.br/sistema/certidao_negativa/
  // Sem login. O "código de verificação" exibido na tela é decorativo: o valor
  // certo já vem exposto num campo hidden (id textfield22) e a validação é
  // inteiramente client-side em JS — o endpoint real (ProxyValidaCNPJCertidao.asp)
  // nem recebe esse valor como parâmetro. A checagem de status é feita via HTTP
  // direto (mesmo endpoint que o JS da página chama); só a emissão do PDF final
  // (quando regular) usa Playwright, replicando o clique real do usuário.
  // ---------------------------------------------------------------------------
  private async consultarCertidaoMunicipalSalvador(cnpjLimpo: string): Promise<ResultadoScraper> {
    const BASE = 'https://servicosweb.sefaz.salvador.ba.gov.br/sistema/certidao_negativa';

    try {
      const proxyRes = await fetch(
        `${BASE}/ProxyValidaCNPJCertidao.asp?CdInscricao=${cnpjLimpo}&Tpcadastro=3`,
        { method: 'POST' },
      );
      // A página é servida em ISO-8859-1 (Latin-1) — decodificar como UTF-8 corrompe acentos.
      const buf = await proxyRes.arrayBuffer();
      const texto = new TextDecoder('iso-8859-1').decode(buf).trim().replace(/\|$/, '');
      const colunas = texto.split(';');
      const codigo = colunas[0];

      if (codigo === 'VAZIO') {
        return { status: 'INDISPONIVEL', validade: null, mensagem: 'Certidão Municipal Salvador: CNPJ não encontrado na base da SEFAZ.' };
      }
      if (codigo === '1') {
        const naoInscrito = colunas[7] === 'N';
        return {
          status: 'INDISPONIVEL',
          validade: null,
          mensagem: naoInscrito
            ? `Certidão Municipal Salvador: CNPJ ${cnpjLimpo} não está inscrito no Cadastro Mobiliário da SEFAZ Salvador. Empresas sem estabelecimento em Salvador costumam não ter inscrição — confirme se é o caso antes de tratar como pendência.`
            : `Certidão Municipal Salvador: informações insuficientes para emissão automática pela internet. Consulte no Posto Central da SEFAZ ou pelo FAS (https://fas.sefaz.salvador.ba.gov.br/).`,
        };
      }
      if (codigo === '2' || codigo === '3') {
        return {
          status: 'INDISPONIVEL',
          validade: null,
          mensagem: colunas[1]?.trim() || 'Certidão Municipal Salvador: informações insuficientes para emissão pela internet.',
        };
      }
      if (codigo !== '0') {
        return { status: 'INDISPONIVEL', validade: null, mensagem: `Certidão Municipal Salvador: resposta inesperada do portal (código "${codigo}").` };
      }

      // Código "0" = regular perante SEFAZ/PGMS. Falta só emitir o documento —
      // isso é uma segunda etapa (POST de formulário que abre o PDF em nova aba).
      return this.emitirCertidaoMunicipalSalvador(cnpjLimpo);
    } catch (err) {
      this.logger.error(`Certidão Municipal Salvador erro para ${cnpjLimpo}: ${err}`);
      return { status: 'INDISPONIVEL', validade: null, mensagem: `Erro ao consultar Certidão Municipal Salvador: ${err}` };
    }
  }

  private async emitirCertidaoMunicipalSalvador(cnpjLimpo: string): Promise<ResultadoScraper> {
    const FORM_URL = 'https://servicosweb.sefaz.salvador.ba.gov.br/sistema/certidao_negativa/servicos_certidao_negativa_CNPJ.asp';

    return this.comBrowser(async (browser) => {
      const page = await this.novaPage(browser, true);
      const context = page.context();

      try {
        await page.goto(FORM_URL, { waitUntil: 'networkidle', timeout: 30_000 });
        await page.locator('#txtCNPJ').fill(cnpjLimpo);

        // O campo visível de "código de verificação" NÃO é #txtCGA — esse id
        // existe no HTML mas fica dentro de #divCGA (display:none, rotulado
        // "CPF", provavelmente resquício de uma variante da página pra CPF) e
        // nunca é exibido no fluxo de CNPJ. Confirmado inspecionando o DOM ao
        // vivo: o campo que aparece de verdade na tela é um <input> sem id,
        // name="form". Usar #txtCGA travava esperando visibilidade que nunca
        // vinha. O valor certo já vem exposto no campo hidden #textfield22
        // (decorativo — não é um captcha de verdade pra resolver).
        const codigoReal = await page.locator('#textfield22').inputValue();
        await page.locator('input[name="form"]').fill(codigoReal);

        const [novaPage] = await Promise.all([
          context.waitForEvent('page', { timeout: 20_000 }),
          page.locator('input[name="Submit"]').click(),
        ]);

        await novaPage.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

        const pdfBuffer = await novaPage.pdf({ format: 'A4', printBackground: true });
        const urlArquivo = await this.storage.uploadPdf(pdfBuffer, `municipal-salvador-${cnpjLimpo}`);

        const texto = (await novaPage.innerText('body') ?? '').replace(/\s+/g, ' ');
        const validade = this.extrairData(texto);

        return {
          status: 'REGULAR',
          validade,
          mensagem: 'Certidão de Regularidade Fiscal de Pessoa Jurídica (SEFAZ/PGMS Salvador) emitida com sucesso.',
          urlArquivo,
        };
      } catch (err) {
        this.logger.warn(`Certidão Municipal Salvador: falha ao emitir PDF final: ${err}`);
        return {
          status: 'REGULAR',
          validade: null,
          mensagem: `Certidão Municipal Salvador: contribuinte regular perante SEFAZ/PGMS, mas não foi possível gerar o PDF automaticamente. Emita manualmente em ${FORM_URL}.`,
        };
      } finally {
        await context.close();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Certidão Municipal — Lauro de Freitas (SEFAZ/PMLF, sistema WebRun)
  // Portal: https://sistemas.sefaz.pmlf.ba.gov.br/webrun/form.jsp?sys=TR2&action=openform&formID=464568210
  // O formulário fica dentro de um iframe (name="mainform"). "Tipo de
  // Certidão" é um combo "lookup" (não é <select> nativo) — precisa clicar
  // pra abrir o popup e clicar na linha certa. Usamos "46 - Certidão
  // Negativa - Mobiliário" (Cadastro Mobiliário = cadastro econômico de
  // empresas, o equivalente ao que Salvador chama de SEFAZ/PGMS). Protegido
  // por reCAPTCHA v2 (sitekey 6LdPAGgUAAAAAG8EOv4wan86cAqC37rbEEHmxLDY) — só
  // dá pra resolver via 2captcha (não existe solver local pra reCAPTCHA).
  // Incerteza não verificável sem submeter o formulário de verdade (validar
  // isso à mão exigiria resolver o captcha manualmente, o que não fazemos):
  // não confirmamos se o campo "Inscrição" aceita o CNPJ diretamente ou
  // exige o número da Inscrição Mobiliária (que não temos armazenado pra
  // empresas arbitrárias). Se não aceitar, a resposta esperada é uma
  // mensagem de "não encontrado" do próprio site — tratada como
  // INDISPONIVEL abaixo. Ajustar conforme o que os logs de produção
  // mostrarem na primeira consulta real.
  // ---------------------------------------------------------------------------
  private async consultarCertidaoMunicipalLauroDeFreitas(cnpjLimpo: string, cga?: string | null): Promise<ResultadoScraper> {
    const chave2captcha = await this.credenciais.obterValor(CredencialTipo.API_2CAPTCHA);
    if (!chave2captcha) {
      return {
        status: 'INDISPONIVEL',
        validade: null,
        mensagem:
          'Certidão Municipal Lauro de Freitas: o portal usa reCAPTCHA. Cadastre uma chave 2captcha em Configurações → Credenciais para habilitar a automação.',
      };
    }

    const FORM_URL = 'https://sistemas.sefaz.pmlf.ba.gov.br/webrun/form.jsp?sys=TR2&action=openform&formID=464568210';
    const SITEKEY = '6LdPAGgUAAAAAG8EOv4wan86cAqC37rbEEHmxLDY';

    // Prazo total travado em 180s: uma primeira tentativa real travou
    // indefinidamente sem nunca retornar (nem sucesso, nem erro logado),
    // deixando a consulta automática inteira pendurada. Corre a tentativa
    // de verdade contra esse limite — se estourar, devolve INDISPONIVEL
    // mesmo que o trabalho em segundo plano ainda esteja rodando (o
    // browser é fechado normalmente quando ele terminar, via comBrowser).
    // 180s (não mais 100s) porque só o resolver2captchaRecaptcha já pode
    // levar até 120s no pior caso (24 tentativas x 5s de polling) — com
    // 100s a corrida quase sempre vencia pelo timeout antes do captcha
    // ter chance de resolver de verdade (confirmado em teste real: bateu
    // o timeout aos ~100s sem nenhum log de erro/sucesso do 2captcha).
    // Cada tipo de certidão agora é uma requisição HTTP isolada (ver
    // consultarUmTipo em certidoes.service.ts), então sobra bastante
    // margem sob os limites do Render free pra esse tempo maior.
    // Promise.race propaga rejeição tanto quanto resolução — sem o .catch
    // abaixo, uma exceção não tratada dentro da tentativa real (ex.: erro
    // ao abrir a página, fora do try/catch interno) vence a corrida na
    // hora e derruba a consulta automática inteira (o loop em
    // certidoes.service.ts não tem try/catch por tipo). Garantir que essa
    // promise NUNCA rejeita é o que faz o limite de 180s valer de verdade.
    const tentativaReal = this.tentarCertidaoMunicipalLauroDeFreitas(cnpjLimpo, chave2captcha, FORM_URL, SITEKEY, cga)
      .catch((err): ResultadoScraper => {
        this.logger.warn(`Certidão Municipal Lauro de Freitas: erro não tratado: ${err}`);
        return {
          status: 'INDISPONIVEL',
          validade: null,
          mensagem: `Certidão Municipal Lauro de Freitas: erro inesperado: ${err}`,
        };
      });
    const limiteDeTempo = new Promise<ResultadoScraper>((resolve) => {
      setTimeout(() => resolve({
        status: 'INDISPONIVEL',
        validade: null,
        mensagem: 'Certidão Municipal Lauro de Freitas: tempo limite (180s) excedido sem resposta do portal ou do 2captcha.',
      }), 180_000);
    });

    return Promise.race([tentativaReal, limiteDeTempo]);
  }

  private async tentarCertidaoMunicipalLauroDeFreitas(
    cnpjLimpo: string,
    chave2captcha: string,
    FORM_URL: string,
    SITEKEY: string,
    cga?: string | null,
  ): Promise<ResultadoScraper> {
    return this.comBrowser(async (browser) => {
      try {
        const page = await this.novaPage(browser, true);
        await page.goto(FORM_URL, { waitUntil: 'networkidle', timeout: 30_000 });
        const frame = page.frame({ name: 'mainform' });
        if (!frame) {
          this.logger.warn('Certidão Municipal Lauro de Freitas: iframe "mainform" ausente — formulário não carregou.');
          return {
            status: 'INDISPONIVEL',
            validade: null,
            mensagem: 'Certidão Municipal Lauro de Freitas: formulário não carregou (iframe "mainform" ausente).',
          };
        }

        if (!cga) {
          return {
            status: 'INDISPONIVEL',
            validade: null,
            mensagem: 'Certidão Municipal Lauro de Freitas: o portal exige o CGA (Cadastro Geral de Atividades), não o CNPJ. Cadastre o CGA da empresa na aba Clientes para habilitar a emissão automática.',
          };
        }

        // Inscrição: CONFIRMADO em 01/09/2026 — o campo exige o CGA (Cadastro
        // Geral de Atividades), não o CNPJ nem a Inscrição Imobiliária. Testado
        // ao vivo com CGA real (empresa MULTILOC, CNPJ 41.530.027/0001-73):
        // reCAPTCHA resolvido, site encontrou o cadastro e respondeu com uma
        // mensagem específica de negócio ("Existe(m) lançamento(s) em aberto:
        // TFF - 2026"), não mais a mensagem genérica de "atualizar cadastro"
        // que aparecia com CNPJ/Inscrição Imobiliária. O CGA agora vem do
        // cadastro manual da empresa (aba Clientes) — sem ele, nem tentamos
        // submeter o formulário (ver checagem acima).

        // Tipo de Certidão: combo "lookup" — clicar no campo em si não abre o
        // popup, é preciso clicar no botão-gatilho (ícone) ao lado dele.
        const tipoCertidaoCombo = frame.locator('#WFRInput772767');
        await tipoCertidaoCombo.locator('xpath=../button[contains(@class, "input-group-append")]').click();
        await frame.getByText('46 - Certidão Negativa - Mobiliário', { exact: true }).click({ timeout: 10_000 });

        await frame.locator('#WFRInput772762').fill(cga);

        // Resolve reCAPTCHA v2 via 2captcha e injeta o token no textarea padrão.
        const { token, erro } = await this.resolver2captchaRecaptcha(chave2captcha, SITEKEY, FORM_URL);
        if (!token) {
          this.logger.warn(`Certidão Municipal Lauro de Freitas: reCAPTCHA não resolvido (${erro}).`);
          return {
            status: 'INDISPONIVEL',
            validade: null,
            mensagem: `Certidão Municipal Lauro de Freitas: reCAPTCHA não resolvido (${erro}).`,
          };
        }
        this.logger.log('Certidão Municipal Lauro de Freitas: reCAPTCHA resolvido, enviando formulário...');
        await frame.evaluate((tok) => {
          const ta = document.getElementById('g-recaptcha-response') as HTMLTextAreaElement | null;
          if (ta) {
            ta.value = tok;
            ta.dispatchEvent(new Event('change'));
          }
        }, token);

        // Captura tanto um download real de arquivo quanto uma navegação
        // direta pro PDF (content-type application/pdf) — escuta a nível de
        // contexto, antes do clique, pra não perder a primeira resposta de
        // uma página nova criada pelo clique. Pega os bytes originais da
        // resposta (não um "print" da página, que corromperia um PDF nativo).
        let capturedPdf: Buffer | null = null;
        let downloadBuffer: Buffer | null = null;
        const context = page.context();
        const onResponse = (response: import('playwright').Response) => {
          if (capturedPdf) return;
          const ct = response.headers()['content-type'] ?? '';
          if (ct.includes('application/pdf')) {
            response.body().then((b) => { capturedPdf = b; }).catch(() => {});
          }
        };
        context.on('response', onResponse);
        context.on('page', (p) => p.on('response', onResponse));
        page.once('download', (download) => {
          download.createReadStream().then((stream) => {
            if (!stream) return;
            const chunks: Buffer[] = [];
            stream.on('data', (c) => chunks.push(c));
            stream.on('end', () => { downloadBuffer = Buffer.concat(chunks); });
          }).catch(() => {});
        });

        const [novaPagina] = await Promise.all([
          context.waitForEvent('page', { timeout: 15_000 }).catch(() => null),
          frame.getByRole('button', { name: 'Pesquisar' }).click(),
        ]);

        const paginaResultado = novaPagina ?? page;
        await paginaResultado.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(1_500); // dá tempo do response.body() assíncrono resolver
        context.off('response', onResponse);

        const pdfBuffer = capturedPdf ?? downloadBuffer;
        if (pdfBuffer) {
          const urlArquivo = await this.salvarPdfBuffer(pdfBuffer, `municipal-laurodefreitas-${cnpjLimpo}`);
          this.logger.log('Certidão Municipal Lauro de Freitas: PDF capturado, emitida com sucesso.');
          return {
            status: 'REGULAR',
            validade: null,
            mensagem: 'Certidão Negativa de Débitos Mobiliários (SEFAZ Lauro de Freitas) emitida com sucesso.',
            urlArquivo,
          };
        }

        const texto = (await paginaResultado.innerText('body').catch(() => '')) ?? '';
        const textoLimpo = texto.replace(/\s+/g, ' ').trim();
        this.logger.warn(`Certidão Municipal Lauro de Freitas: nenhum PDF capturado. Texto da página de resultado: ${textoLimpo.slice(0, 500)}`);

        if (/n(ã|a)o (foi )?encontrad|n(ã|a)o localizad|inscri(ç|c)(ã|a)o inv(á|a)lida|n(ã|a)o cadastrad/i.test(textoLimpo)) {
          return {
            status: 'INDISPONIVEL',
            validade: null,
            mensagem: `Certidão Municipal Lauro de Freitas: CGA "${cga}" não localizado no Cadastro Mobiliário. Confirme se o CGA cadastrado na aba Clientes está correto. Resposta do site: ${textoLimpo.slice(0, 300)}`,
          };
        }

        // "Existe(m) lançamento(s) em aberto" — CGA encontrado, mas com débito
        // pendente (confirmado em teste real em 01/09/2026). Isso é uma
        // resposta de negócio, não uma falha nossa — reporta IRREGULAR.
        if (/lan(ç|c)amento\(?s?\)?\s+em\s+aberto/i.test(textoLimpo)) {
          return {
            status: 'IRREGULAR',
            validade: null,
            mensagem: `Certidão Municipal Lauro de Freitas: existem débitos/lançamentos em aberto no Cadastro Mobiliário. Resposta do site: ${textoLimpo.slice(0, 300)}`,
          };
        }

        // Não conseguimos identificar um PDF de verdade — não arriscamos
        // declarar REGULAR só com base em texto de página pra um documento
        // fiscal. Devolve o texto capturado pra diagnóstico.
        return {
          status: 'INDISPONIVEL',
          validade: null,
          mensagem: `Certidão Municipal Lauro de Freitas: não foi possível confirmar a emissão automaticamente. Resposta do site: ${textoLimpo.slice(0, 300)}`,
        };
      } catch (err) {
        this.logger.warn(`Certidão Municipal Lauro de Freitas erro: ${err}`);
        return {
          status: 'INDISPONIVEL',
          validade: null,
          mensagem: `Erro ao consultar Certidão Municipal Lauro de Freitas: ${err}`,
        };
      }
    });
  }

  // Resolve reCAPTCHA v2 via 2captcha (não existe solver local pra reCAPTCHA
  // na api_captcha — sempre paga). Espelha resolver2captchaHcaptcha.
  private async resolver2captchaRecaptcha(
    apiKey: string,
    sitekey: string,
    pageUrl: string,
  ): Promise<{ token: string | null; erro: string | null }> {
    try {
      const submitRes = await fetch('https://2captcha.com/in.php', {
        method: 'POST',
        body: new URLSearchParams({
          key: apiKey,
          method: 'userrecaptcha',
          googlekey: sitekey,
          pageurl: pageUrl,
          json: '1',
        }),
      });
      const submitJson = (await submitRes.json()) as { status: number; request: string };
      if (submitJson.status !== 1) {
        const erro = `submit: ${submitJson.request}`;
        this.logger.warn(`2captcha reCAPTCHA submit erro: ${JSON.stringify(submitJson)}`);
        return { token: null, erro };
      }

      const captchaId = submitJson.request;
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 5_000));
        const resRes = await fetch(
          `https://2captcha.com/res.php?key=${apiKey}&action=get&id=${captchaId}&json=1`,
        );
        const resJson = (await resRes.json()) as { status: number; request: string };
        if (resJson.status === 1) return { token: resJson.request, erro: null };
        if (resJson.request !== 'CAPCHA_NOT_READY') {
          const erro = `resultado: ${resJson.request}`;
          this.logger.warn(`2captcha reCAPTCHA result erro: ${JSON.stringify(resJson)}`);
          return { token: null, erro };
        }
      }

      this.logger.warn('2captcha reCAPTCHA: timeout — sem resposta em 120s.');
      return { token: null, erro: 'timeout: sem resposta do 2captcha em 120s' };
    } catch (err) {
      this.logger.warn(`2captcha reCAPTCHA erro de rede: ${err}`);
      return { token: null, erro: `erro de rede: ${err}` };
    }
  }

  // Cloudflare Turnstile — usado pelo Portal da Receita-DF (achado
  // 04/10/2026). Diferente de reCAPTCHA/hCaptcha, não existe solver local
  // (api_captcha não cobre Turnstile) nem fallback grátis -- sempre paga.
  // Mesma estrutura de submit/poll do 2captcha que os outros métodos, só
  // troca "method" e o parâmetro de sitekey.
  private async resolver2captchaTurnstile(
    apiKey: string,
    sitekey: string,
    pageUrl: string,
  ): Promise<{ token: string | null; erro: string | null }> {
    try {
      const submitRes = await fetch('https://2captcha.com/in.php', {
        method: 'POST',
        body: new URLSearchParams({
          key: apiKey,
          method: 'turnstile',
          sitekey,
          pageurl: pageUrl,
          json: '1',
        }),
      });
      const submitJson = (await submitRes.json()) as { status: number; request: string };
      if (submitJson.status !== 1) {
        const erro = `submit: ${submitJson.request}`;
        this.logger.warn(`2captcha Turnstile submit erro: ${JSON.stringify(submitJson)}`);
        return { token: null, erro };
      }

      const captchaId = submitJson.request;
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 5_000));
        const resRes = await fetch(
          `https://2captcha.com/res.php?key=${apiKey}&action=get&id=${captchaId}&json=1`,
        );
        const resJson = (await resRes.json()) as { status: number; request: string };
        if (resJson.status === 1) return { token: resJson.request, erro: null };
        if (resJson.request !== 'CAPCHA_NOT_READY') {
          const erro = `resultado: ${resJson.request}`;
          this.logger.warn(`2captcha Turnstile result erro: ${JSON.stringify(resJson)}`);
          return { token: null, erro };
        }
      }

      this.logger.warn('2captcha Turnstile: timeout — sem resposta em 120s.');
      return { token: null, erro: 'timeout: sem resposta do 2captcha em 120s' };
    } catch (err) {
      this.logger.warn(`2captcha Turnstile erro de rede: ${err}`);
      return { token: null, erro: `erro de rede: ${err}` };
    }
  }

  // reCAPTCHA v3 (invisível, sem desafio, baseado em score) — usado pela
  // Ficha Cadastral Resumida da SEFAZ Salvador. Confirmado inspecionando o
  // JS da página: chamada real é `grecaptcha.execute(sitekey, {action: ''})`
  // — action vazio, então não precisa adivinhar/validar esse parâmetro.
  private async resolver2captchaRecaptchaV3(
    apiKey: string,
    sitekey: string,
    pageUrl: string,
    action: string,
  ): Promise<{ token: string | null; erro: string | null }> {
    try {
      const submitRes = await fetch('https://2captcha.com/in.php', {
        method: 'POST',
        body: new URLSearchParams({
          key: apiKey,
          method: 'userrecaptcha',
          version: 'v3',
          action,
          min_score: '0.3',
          googlekey: sitekey,
          pageurl: pageUrl,
          json: '1',
        }),
      });
      const submitJson = (await submitRes.json()) as { status: number; request: string };
      if (submitJson.status !== 1) {
        const erro = `submit: ${submitJson.request}`;
        this.logger.warn(`2captcha reCAPTCHA v3 submit erro: ${JSON.stringify(submitJson)}`);
        return { token: null, erro };
      }

      const captchaId = submitJson.request;
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 5_000));
        const resRes = await fetch(
          `https://2captcha.com/res.php?key=${apiKey}&action=get&id=${captchaId}&json=1`,
        );
        const resJson = (await resRes.json()) as { status: number; request: string };
        if (resJson.status === 1) return { token: resJson.request, erro: null };
        if (resJson.request !== 'CAPCHA_NOT_READY') {
          const erro = `resultado: ${resJson.request}`;
          this.logger.warn(`2captcha reCAPTCHA v3 result erro: ${JSON.stringify(resJson)}`);
          return { token: null, erro };
        }
      }

      this.logger.warn('2captcha reCAPTCHA v3: timeout — sem resposta em 120s.');
      return { token: null, erro: 'timeout: sem resposta do 2captcha em 120s' };
    } catch (err) {
      this.logger.warn(`2captcha reCAPTCHA v3 erro de rede: ${err}`);
      return { token: null, erro: `erro de rede: ${err}` };
    }
  }

  // Salva um Buffer de PDF no Supabase Storage e retorna a URL pública
  private async salvarPdfBuffer(buffer: Buffer, prefixo: string): Promise<string> {
    return this.storage.uploadPdf(buffer, prefixo);
  }

  // ---------------------------------------------------------------------------
  // Certidão Municipal — São Paulo (capital)
  // Portal: https://duc.prefeitura.sp.gov.br/certidoes/forms_anonimo/frmconsultaemissaocertificado.aspx
  // "Certidão Tributária Mobiliária", por CNPJ, sem login. CAPTCHA de imagem
  // simples de 4 caracteres (campo #txtValorCaptcha) — resolvido via
  // resolver2captchaImagem (o modelo ONNX local foi treinado só no estilo do
  // captcha do CNDT/TST, não reconhece este; cai sempre pro 2captcha pago).
  //
  // Achado real (02/10/2026): em pelo menos uma execução apareceu, logo após
  // o primeiro submit, um desafio anti-bot adicional de Prodam-SP ("Este
  // desafio é para testar se você é um visitante legítimo...") — outro
  // captcha de imagem de 6 caracteres, só que vindo de um sistema diferente
  // do formulário em si. Resolvê-lo uma vez não evitou que ele reaparecesse
  // numa navegação fresca logo depois — ou seja, ao contrário do que parecia
  // a princípio, NÃO é algo "resolve uma vez por sessão": pode aparecer de
  // novo a qualquer momento, inclusive antes mesmo do formulário carregar.
  // Trata esse desafio dentro do mesmo loop de tentativas; se aparecer,
  // resolve e tenta a consulta de novo do zero (ele devolve o formulário
  // em branco, não dá pra só continuar de onde parou).
  // ---------------------------------------------------------------------------
  private async consultarCertidaoMunicipalSaoPaulo(cnpjLimpo: string): Promise<ResultadoScraper> {
    const apiKey = await this.credenciais.obterValor(CredencialTipo.API_2CAPTCHA);
    if (!apiKey) {
      return {
        status: 'INDISPONIVEL',
        validade: null,
        mensagem: 'Certidão Municipal São Paulo: cadastre uma chave 2captcha em Configurações → Credenciais para habilitar a automação (o portal usa CAPTCHA de imagem).',
      };
    }

    return this.comBrowser(async (browser) => {
      const page = await this.novaPage(browser, true);
      let ultimoErro: string | null = null;

      for (let tentativa = 1; tentativa <= 4; tentativa++) {
        try {
          await page.goto(FORM_URL_SAO_PAULO, { waitUntil: 'networkidle', timeout: 30_000 });

          // Desafio anti-bot da Prodam-SP — pode aparecer antes mesmo do
          // formulário real carregar (ver comentário acima). Resolve e
          // recarrega a página do zero nesta mesma tentativa.
          let texto = (await page.innerText('body').catch(() => '')) ?? '';
          if (/visitante leg[ií]timo/i.test(texto)) {
            const resolvido = await this.resolverDesafioAntiBotSaoPaulo(page, apiKey);
            if (!resolvido) {
              ultimoErro = 'desafio anti-bot da Prodam-SP não resolvido';
              continue;
            }
            await page.goto(FORM_URL_SAO_PAULO, { waitUntil: 'networkidle', timeout: 30_000 });
          }

          await page.locator('#ctl00_ConteudoPrincipal_ddlTipoCertidao').selectOption('1'); // Certidão Tributária Mobiliária
          await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
          await page.locator('#ctl00_ConteudoPrincipal_ddlTipoDocumento').selectOption('CNPJ').catch(() => {});
          await page.locator('#ctl00_ConteudoPrincipal_txtCNPJ').fill(cnpjLimpo);

          const captchaBuffer = await page.locator('#ctl00_ConteudoPrincipal_imgCaptcha').screenshot();
          const { token: resposta, erro: erroCaptcha } = await this.resolver2captchaImagem(
            `data:image/png;base64,${captchaBuffer.toString('base64')}`,
            apiKey,
          );
          if (!resposta) {
            ultimoErro = `captcha não resolvido (${erroCaptcha})`;
            this.logger.warn(`Certidão Municipal São Paulo tentativa ${tentativa}: ${ultimoErro}.`);
            continue;
          }
          // Normaliza pra minúsculo (mesmo padrão do CNDT) -- 2captcha não
          // recebe "regsense", pode devolver maiúsculo pra imagem minúscula
          // (confirmado visualmente, achado 02/10/2026); extensão de Chrome
          // tem o mesmo fix em content-sp-municipal.js.
          await page.locator('#ctl00_ConteudoPrincipal_txtValorCaptcha').fill(resposta.toLowerCase());

          await Promise.all([
            page.waitForLoadState('networkidle', { timeout: 20_000 }),
            page.locator('#ctl00_ConteudoPrincipal_btnEmitir').click(),
          ]);

          // "networkidle" às vezes resolve antes do postback ASP.NET
          // terminar de renderizar o body (corpo vem vazio por um instante)
          // — tentado ao vivo em 02/10/2026, deu INDISPONIVEL com texto=""
          // na primeira leitura. Repolla por até ~4s antes de desistir.
          for (let espera = 0; espera < 8; espera++) {
            texto = ((await page.innerText('body').catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
            if (texto) break;
            await page.waitForTimeout(500);
          }

          if (/visitante leg[ií]timo/i.test(texto)) {
            this.logger.log(`Certidão Municipal São Paulo tentativa ${tentativa}: desafio anti-bot apareceu após o submit.`);
            const resolvido = await this.resolverDesafioAntiBotSaoPaulo(page, apiKey);
            if (!resolvido) { ultimoErro = 'desafio anti-bot da Prodam-SP não resolvido após o submit'; continue; }
            continue; // volta pro formulário em branco — tenta a consulta de novo
          }

          if (!texto) {
            ultimoErro = 'página de resultado veio vazia após o submit (possível falha de automação, não resposta real do portal)';
            this.logger.warn(`Certidão Municipal São Paulo tentativa ${tentativa}: ${ultimoErro}.`);
            continue;
          }

          const resultado = this.parseCertidaoMunicipalSaoPaulo(texto);
          this.logger.log(`Certidão Municipal São Paulo tentativa ${tentativa}: status=${resultado.status} texto="${texto.slice(0, 300)}"`);
          return resultado;
        } catch (err) {
          ultimoErro = String(err);
          this.logger.warn(`Certidão Municipal São Paulo tentativa ${tentativa} erro: ${err}`);
        }
      }

      return {
        status: 'INDISPONIVEL',
        validade: null,
        mensagem: `Certidão Municipal São Paulo: não foi possível concluir a consulta após 4 tentativas. Último erro: ${ultimoErro ?? 'desconhecido'}.`,
      };
    });
  }

  // Resolve o desafio anti-bot genérico da Prodam-SP (captcha de imagem de
  // 6 caracteres, sem relação com o formulário de certidão em si) e envia a
  // resposta. Retorna true se o desafio foi submetido (não garante que foi
  // aceito — quem chama confere o resultado seguinte).
  private async resolverDesafioAntiBotSaoPaulo(page: Page, apiKey: string): Promise<boolean> {
    try {
      const imagem = page.locator('img').first();
      const buffer = await imagem.screenshot({ timeout: 10_000 });
      const { token: resposta, erro } = await this.resolver2captchaImagem(
        `data:image/png;base64,${buffer.toString('base64')}`,
        apiKey,
      );
      if (!resposta) {
        this.logger.warn(`Desafio anti-bot São Paulo: captcha não resolvido (${erro}).`);
        return false;
      }
      await page.locator('input[type="text"]').first().fill(resposta.toLowerCase());
      await Promise.all([
        page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {}),
        page.getByRole('button', { name: /submit/i }).click(),
      ]);
      return true;
    } catch (err) {
      this.logger.warn(`Desafio anti-bot São Paulo: erro ao resolver: ${err}`);
      return false;
    }
  }

  private parseCertidaoMunicipalSaoPaulo(texto: string): ResultadoScraper {
    const lower = texto.toLowerCase();

    // Confirmado contra empresa real com pendência (02/10/2026): o portal
    // devolve essa frase + uma tabela de "Débitos Pendentes" por CCM.
    if (lower.includes('não foi possivel emitir a certidão') || lower.includes('não foi possível emitir a certidão')) {
      return {
        status: 'IRREGULAR',
        validade: null,
        mensagem: `Certidão Municipal São Paulo: há pendências impeditivas para emissão da certidão. Resposta do site: ${texto.slice(0, 500)}`,
        pendenciaReal: true,
      };
    }

    // Não encontramos, em teste real, uma empresa sem pendências pra
    // confirmar o texto exato (e se vem como PDF/download) da página de
    // sucesso. Em vez de arriscar classificar como REGULAR por suposição —
    // o mesmo tipo de erro corrigido no FGTS nesta sessão —, fica
    // INDISPONIVEL até validarmos contra um caso real limpo.
    return {
      status: 'INDISPONIVEL',
      validade: null,
      mensagem: `Certidão Municipal São Paulo: resposta do portal ainda não validada pra empresa regular — verifique manualmente em ${FORM_URL_SAO_PAULO}. Texto: ${texto.slice(0, 500)}`,
    };
  }

  // ---------------------------------------------------------------------------
  // Certidão Municipal — Entre Rios-BA e Dias d'Ávila-BA (sistema SAATRI/ADM
  // Sistemas, mesmo software nas duas cidades — portal em
  // https://<cidade>.saatri.com.br). Sem login, sem captcha (confirmado
  // visualmente em 03/10/2026). Fluxo na tela "Início": seleciona "Empresa"
  // no combo "Certidão de:" (#Pint_TipoCertidao, value "3"), preenche
  // CPF/CNPJ (#txt_CpfCnpjCertidao) e clica "Emitir CND"
  // (#btn_ConsultarContribuinteCnd).
  //
  // Três respostas observadas ao vivo pra esse clique:
  // 1. Empresa com pendência fiscal: mostra um modal jQuery UI "Aviso:
  //    Impedimento na emissão" com o motivo — inclui o nome da empresa e a
  //    Inscrição Municipal, úteis mesmo sem emitir (confirmado com CNPJ real,
  //    03/10/2026: "SELARIA DO VAQUEIRO...LTDA (000.003.016/116-40)... são
  //    insuficientes para a emissão de certidão por meio da Internet").
  // 2. CNPJ não encontrado: navega pra /Certidao/Emitir com o combo
  //    "Inscrição Municipal" (#cbb_IdContribuinteCertidao) vazio.
  // 3. Empresa regular: ainda não confirmado com um caso real (o CNPJ de
  //    teste disponível caiu no caso 1) — a suposição é que o combo vem
  //    populado e falta só selecionar e clicar "Emitir"
  //    (#btn_EmitirCertidao). Não arrisca declarar REGULAR sem validar contra
  //    um caso limpo de verdade (mesma cautela do Município de São Paulo).
  // ---------------------------------------------------------------------------
  private async consultarCertidaoMunicipalSaatri(cnpjLimpo: string, baseUrl: string, nomeCidade: string): Promise<ResultadoScraper> {
    return this.comBrowser(async (browser) => {
      const page = await this.novaPage(browser);
      try {
        await page.goto(`${baseUrl}/Inicio`, { waitUntil: 'networkidle', timeout: 30_000 });

        // Popup de "Novidades/Atualização" pode abrir sozinho ao carregar
        // (confirmado em Dias d'Ávila, 03/10/2026) -- bloqueia clique no
        // formulário se não fechar antes.
        const popupAberto = page.locator('.ui-dialog:visible .ui-dialog-titlebar-close').first();
        if (await popupAberto.isVisible().catch(() => false)) {
          await popupAberto.click();
        }

        // force:true -- o <select> nativo fica escondido atrás de um widget
        // visual estilizado (confirmado via teste real, Playwright recusa
        // selectOption sem isso porque considera o elemento "not visible").
        await page.selectOption('#Pint_TipoCertidao', '3', { force: true }); // Empresa
        await page.locator('#txt_CpfCnpjCertidao').fill(cnpjLimpo);
        await page.locator('#btn_ConsultarContribuinteCnd').click();

        const resultado = await Promise.race([
          page.waitForSelector('.ui-dialog:visible', { timeout: 15_000 }).then(() => 'modal' as const),
          page.waitForURL('**/Certidao/Emitir**', { timeout: 15_000 }).then(() => 'navegacao' as const),
        ]).catch(() => null);

        if (resultado === 'modal') {
          const textoModal = (await page.locator('.ui-dialog:visible').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
          return {
            status: 'INDISPONIVEL',
            validade: null,
            mensagem: `Certidão Municipal ${nomeCidade}: ${textoModal || 'impedimento na emissão, motivo não capturado no modal de aviso'}.`,
          };
        }

        if (resultado !== 'navegacao') {
          return { status: 'INDISPONIVEL', validade: null, mensagem: `Certidão Municipal ${nomeCidade}: sem resposta do portal após consultar o CNPJ (timeout).` };
        }

        const combo = page.locator('#cbb_IdContribuinteCertidao');
        const opcoes = (await combo.locator('option').allTextContents().catch(() => [])).map((o) => o.trim()).filter(Boolean);

        if (opcoes.length === 0) {
          return { status: 'INDISPONIVEL', validade: null, mensagem: `Certidão Municipal ${nomeCidade}: CNPJ não encontrado no cadastro do município.` };
        }

        await combo.selectOption({ index: 0 });
        await page.locator('#btn_EmitirCertidao').click();
        await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

        const texto = (await page.innerText('body').catch(() => '')).replace(/\s+/g, ' ').trim();
        return {
          status: 'INDISPONIVEL',
          validade: null,
          mensagem: `Certidão Municipal ${nomeCidade}: resposta do portal ainda não validada pra empresa regular — verifique manualmente em ${baseUrl}/Inicio. Texto: ${texto.slice(0, 500)}`,
        };
      } catch (err) {
        this.logger.warn(`Certidão Municipal ${nomeCidade} erro: ${err}`);
        return { status: 'INDISPONIVEL', validade: null, mensagem: `Erro ao consultar Certidão Municipal ${nomeCidade}: ${err}` };
      } finally {
        await page.context().close();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Certidão Municipal — Aratuípe-BA (sistema Smart4Sistemas, app ZK/Java)
  // Portal: https://server10.smart4sistemas.com:8448/NFSe/ValidacaoExterna/certidaoNegativa.zul
  // Sem login. Tem captcha de imagem numérico simples (4 dígitos, confirmado
  // visualmente em 03/10/2026 -- resolvido pelo mesmo pipeline ONNX/2captcha
  // já usado pros outros tipos, via resolver2captchaImagem()).
  //
  // Achado real (03/10/2026): os IDs dos elementos são gerados por sessão
  // (framework ZK) -- mudam a cada carga de página, diferente do ASP.NET do
  // SAATRI/São Paulo. Localiza tudo por role/texto acessível, nunca por id.
  //
  // Confirmado ao vivo com um CNPJ real não cadastrado no município: duas
  // mensagens distintas, testadas com um captcha de propósito errado pra
  // isolar uma da outra --
  // - "Código de verficação inválido." (sic, erro de digitação do próprio
  //   site) -- captcha errado, dá pra tentar de novo com uma imagem nova.
  // - "Contribuinte não encontrado." -- captcha aceito, CNPJ sem cadastro.
  // Caminho de sucesso (empresa regular) ainda não confirmado contra um
  // caso real -- mesma cautela já usada nos outros municípios desta sessão.
  //
  // RISCO REAL NÃO RESOLVIDO (03/10/2026): o código de verificação parece
  // expirar rápido -- numa tentativa manual levando ~10-15s entre capturar a
  // imagem e submeter a resposta, deu "código inválido"; outra, em ~3-4s,
  // funcionou (captcha aceito, resposta "Contribuinte não encontrado"). O
  // ONNX local nunca resolve esse captcha (4 dígitos, modelo treinado pra 6
  // caracteres -- confiança sempre 0, cai pro 2captcha pago), e o 2captcha
  // tipicamente demora bem mais que essa janela pra responder (polling de
  // 5 em 5s). Risco real: o loop de retentativa abaixo pode nunca ter
  // sucesso na prática, mesmo pegando uma imagem nova a cada tentativa. Não
  // testado ao vivo contra o 2captcha de verdade (só captcha lido à mão) --
  // se confirmar esse padrão em produção, a solução provável é um solver
  // local dedicado só pra esse formato (4 dígitos numéricos é bem mais
  // simples que o CNDT/TST) em vez de depender do 2captcha.
  // ---------------------------------------------------------------------------
  private async consultarCertidaoMunicipalAratuipe(cnpjLimpo: string): Promise<ResultadoScraper> {
    const BASE_URL = 'https://server10.smart4sistemas.com:8448/NFSe/ValidacaoExterna/certidaoNegativa.zul';
    const apiKey = await this.credenciais.obterValor(CredencialTipo.API_2CAPTCHA);
    if (!apiKey) {
      return { status: 'INDISPONIVEL', validade: null, mensagem: `Certidão Municipal Aratuípe-BA: chave do 2captcha não cadastrada. Emita manualmente em ${BASE_URL}.` };
    }

    return this.comBrowser(async (browser) => {
      const page = await this.novaPage(browser);
      try {
        await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30_000 });
        await page.getByRole('radio', { name: 'Empresa' }).click();
        await page.getByRole('textbox').first().fill(cnpjLimpo);

        const MAX_TENTATIVAS_CAPTCHA = 3;
        for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_CAPTCHA; tentativa++) {
          const imgCaptcha = page.locator('img[src*="captcha" i]').first();
          const buffer = await imgCaptcha.screenshot({ timeout: 10_000 });
          const { token: resposta, erro } = await this.resolver2captchaImagem(`data:image/png;base64,${buffer.toString('base64')}`, apiKey);
          if (!resposta) {
            this.logger.warn(`Certidão Municipal Aratuípe-BA tentativa ${tentativa}: captcha não resolvido (${erro}).`);
            continue;
          }

          const campoCodigo = page.getByRole('textbox', { name: /código de verificação/i });
          await campoCodigo.fill('');
          await campoCodigo.fill(resposta);
          await page.getByRole('link', { name: 'Emitir Certidão' }).click();
          await page.waitForTimeout(2_000);

          const texto = (await page.innerText('body').catch(() => '')).replace(/\s+/g, ' ').trim();

          if (/código de verfica[cç][aã]o inv[aá]lido/i.test(texto)) {
            continue; // captcha errado -- o site já troca a imagem sozinho, tenta de novo
          }

          if (/contribuinte n[aã]o encontrado/i.test(texto)) {
            return { status: 'INDISPONIVEL', validade: null, mensagem: `Certidão Municipal Aratuípe-BA: CNPJ não encontrado no cadastro do município.` };
          }

          // Resposta diferente das duas conhecidas -- provavelmente o
          // caminho de sucesso (ou uma pendência), nunca confirmado contra
          // um caso real. Não arrisca classificar como REGULAR/IRREGULAR
          // por suposição.
          return {
            status: 'INDISPONIVEL',
            validade: null,
            mensagem: `Certidão Municipal Aratuípe-BA: resposta do portal ainda não validada — verifique manualmente em ${BASE_URL}. Texto: ${texto.slice(0, 500)}`,
          };
        }

        return { status: 'INDISPONIVEL', validade: null, mensagem: `Certidão Municipal Aratuípe-BA: não resolveu o código de verificação após ${MAX_TENTATIVAS_CAPTCHA} tentativas.` };
      } catch (err) {
        this.logger.warn(`Certidão Municipal Aratuípe-BA erro: ${err}`);
        return { status: 'INDISPONIVEL', validade: null, mensagem: `Erro ao consultar Certidão Municipal Aratuípe-BA: ${err}` };
      } finally {
        await page.context().close();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Certidão Municipal — Santo Amaro-BA (sistema "Município Online", 3Tecnos
  // Tecnologia — ASP.NET WebForms por baixo de uma camada AngularJS, IDs
  // estáveis tipo ctl00$body$... — diferente do ZK de Aratuípe, não muda por
  // sessão). Sem login, sem captcha. Portal:
  // https://www.municipioonline.com.br/ba/prefeitura/santoamaro/contribuinte/certidao/emissao
  //
  // Achado real (03/10/2026): a tela tem 3 opções de "Tipo Certidão" --
  // Contribuinte / Imóvel / Econômico. O relatório de outro agente desta
  // sessão testou só "Econômico" (exige Inscrição Municipal previamente
  // cadastrada) e concluiu que não dava pra emitir só com CNPJ -- errado:
  // "Contribuinte" (radio value "1") aceita CPF/CNPJ direto, sem exigir
  // nenhum cadastro prévio.
  //
  // PRIMEIRO caso de sucesso real confirmado nesta sessão inteira (as outras
  // cidades só deram "não encontrado"/"impedimento"): CNPJ real de empresa
  // cadastrada em Santo Amaro devolveu "Foi criada uma nova certidão.",
  // Tipo Certidão "1- Negativa" (= REGULAR), Validade extraída do campo
  // correspondente. O backend é devagar -- a consulta real levou ~20s pra
  // responder (e ~50s no caso "não encontrado", testado em separado) --
  // timeouts generosos abaixo de propósito, não é sinal de travamento.
  //
  // PDF: o botão "Imprimir" (#btnVisualizar) abre um relatório em
  // .../relatorio/view?a=<ano>&i=<id>&r=relCertidao&sgUF=ba -- "ano" e "id"
  // vêm do campo "Código/Exercício" exibido na tela de sucesso (formato
  // "<id>/<ano>", ex. "772/2026"). Constrói a URL direto em vez de clicar no
  // botão, abre numa página Playwright separada e usa .pdf() (mesmo padrão
  // já usado em emitirCertidaoMunicipalSalvador).
  // ---------------------------------------------------------------------------
  private async consultarCertidaoMunicipalSantoAmaro(cnpjLimpo: string): Promise<ResultadoScraper> {
    const BASE_URL = 'https://www.municipioonline.com.br/ba/prefeitura/santoamaro/contribuinte/certidao/emissao';

    return this.comBrowser(async (browser) => {
      const page = await this.novaPage(browser);
      try {
        await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30_000 });
        await page.locator('input[name="optradioCertidao"][value="1"]').click(); // Contribuinte
        await page.locator('#body_txtCpfCnpj').fill(cnpjLimpo);
        await page.locator('#btnConsCertidao').click();

        // Backend lento (confirmado ~20-50s ao vivo) -- espera a mensagem de
        // "não encontrado" ou o campo de Código/Exercício da certidão criada,
        // o que vier primeiro, com timeout generoso.
        const seletorSucesso = '#body_txtCodigo, [id*="txtCodigo" i]';
        const resultado = await Promise.race([
          page.getByText(/não pertence a nenhum contribuinte/i).waitFor({ timeout: 90_000 }).then(() => 'nao_encontrado' as const),
          page.locator(seletorSucesso).first().waitFor({ state: 'visible', timeout: 90_000 }).then(() => 'sucesso' as const),
        ]).catch(() => null);

        if (resultado === 'nao_encontrado') {
          return { status: 'INDISPONIVEL', validade: null, mensagem: 'Certidão Municipal Santo Amaro-BA: CNPJ não encontrado no cadastro do município.' };
        }

        if (resultado !== 'sucesso') {
          const texto = (await page.innerText('body').catch(() => '')).replace(/\s+/g, ' ').trim();
          return { status: 'INDISPONIVEL', validade: null, mensagem: `Certidão Municipal Santo Amaro-BA: sem resposta clara do portal (timeout). Texto: ${texto.slice(0, 500)}` };
        }

        const tipoCertidao = (await page.locator('#body_txtTipoCertidao').inputValue().catch(() => '')).trim();
        const codigoExercicio = (await page.locator('#body_txtCodigo').inputValue().catch(() => '')).trim();
        const validadeTexto = (await page.locator('#body_txtValidade').inputValue().catch(() => '')).trim();
        const validade = this.extrairData(validadeTexto);

        // "1- Negativa" = sem débitos. Qualquer outro valor (ex. "Positiva")
        // é tratado com cautela -- não vimos um caso real de pendência pra
        // confirmar o texto exato, então não assume IRREGULAR por suposição.
        if (!/negativa/i.test(tipoCertidao)) {
          return {
            status: 'INDISPONIVEL',
            validade,
            mensagem: `Certidão Municipal Santo Amaro-BA: tipo de certidão retornado ("${tipoCertidao}") não confirmado como regular — verifique manualmente. Código/Exercício: ${codigoExercicio}.`,
          };
        }

        // Achado real (03/10/2026): navegar direto pra URL do relatório numa
        // aba nova (goto cru) trava em about:blank, mesmo dentro do mesmo
        // contexto/cookies -- o botão #btnVisualizar provavelmente depende
        // de algum estado da página (hidden field, postback) que um GET
        // isolado não reproduz. Clica no botão de verdade e tenta capturar a
        // aba que ele abrir (mesmo padrão do Salvador); se não abrir nenhuma
        // (não confirmado se abre mesmo), cai no catch e segue sem anexo --
        // o status REGULAR já está confirmado pelo campo Tipo Certidão
        // acima, então a falta de PDF não derruba o resultado.
        let urlArquivo: string | null = null;
        try {
          const [pdfPage] = await Promise.all([
            page.context().waitForEvent('page', { timeout: 15_000 }),
            page.locator('#btnVisualizar').click(),
          ]);
          await pdfPage.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
          const pdfBuffer = await pdfPage.pdf({ format: 'A4', printBackground: true });
          urlArquivo = await this.storage.uploadPdf(pdfBuffer, `municipal-santoamaro-${cnpjLimpo}`);
          await pdfPage.close();
        } catch (err) {
          this.logger.warn(`Certidão Municipal Santo Amaro-BA: falha ao gerar PDF (${err}) -- resultado REGULAR mantido sem anexo. Código/Exercício: ${codigoExercicio}.`);
        }

        return {
          status: 'REGULAR',
          validade,
          mensagem: `Certidão Negativa de Débitos (Santo Amaro-BA) emitida com sucesso. Código/Exercício: ${codigoExercicio}.`,
          urlArquivo,
        };
      } catch (err) {
        this.logger.warn(`Certidão Municipal Santo Amaro-BA erro: ${err}`);
        return { status: 'INDISPONIVEL', validade: null, mensagem: `Erro ao consultar Certidão Municipal Santo Amaro-BA: ${err}` };
      } finally {
        await page.context().close();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Certidão Municipal — Juazeiro-BA (sistema WebRun/Sudoeste Informática —
  // mesma plataforma do Lauro de Freitas, ver consultarCertidaoMunicipalLauroDeFreitas
  // acima). Sem login, mas com reCAPTCHA v2 (resolvido via
  // resolver2captchaRecaptcha(), já usado e comprovado em produção pro
  // Lauro de Freitas).
  //
  // Link do formulário NÃO é alcançável navegando o menu do sistema (que
  // pede login) -- achado navegando o site institucional da prefeitura
  // (juazeiro.ba.gov.br → Tributário → Empresa → "Certidões"), que linka
  // direto pro formulário anônimo:
  // https://trbpmjuazeiro.sudoesteinformatica.com.br/webrun/form.jsp?sys=TPC&dataConnection=PM_Juazeiro&action=openform&formID={513A6F39-5238-4910-9E9B-FBB1DB9A95F5}&align=0&mode=-1&goto=-1&filter=&scrolling=no
  //
  // Achado real (04/10/2026) que CORRIGE um relatório de pesquisa anterior
  // desta sessão: o form tem um combo "Tipo de Pesquisa" com 4 opções --
  // Inscrição / Inscrição Anterior / CPF / **CNPJ** -- ou seja, aceita CNPJ
  // direto, não exige Inscrição Municipal previamente cadastrada (ao
  // contrário do que foi concluído antes sem inspecionar o combo de perto).
  //
  // Estrutura confirmada via Playwright real (não só inspeção visual): o
  // formulário vive num <iframe> (openform.do); radio[0] (a ~x=438) é
  // "Débitos" (Tipo de Certidão/Serviço); select com as 4 opções acima é o
  // "Tipo de Pesquisa"; um único <input type=text> fica visível por vez
  // (muda de significado conforme o Tipo de Pesquisa); sitekey do reCAPTCHA
  // confirmado via atributo data-sitekey:
  // 6Lf2jAgTAAAAAEXgPiCOT-bLwP9GndAvxfLRJVEu.
  //
  // NÃO VALIDADO AO VIVO: a resolução do reCAPTCHA e o resultado da busca
  // (decisão consciente -- testar isso exigiria ler a chave do 2captcha de
  // produção a partir de um script solto, e preferi não fazer isso sem
  // confirmar com o usuário; ele optou por não autorizar). O mecanismo de
  // resolver2captchaRecaptcha() já é comprovado em produção (Lauro de
  // Freitas), então o risco está mais em como o RESULTADO da pesquisa se
  // comporta (teor do "Emitir Certidão" / mensagens de erro) do que no
  // captcha em si -- trata com a mesma cautela já usada nas outras cidades.
  // ---------------------------------------------------------------------------
  private async consultarCertidaoMunicipalJuazeiro(cnpjLimpo: string): Promise<ResultadoScraper> {
    const FORM_URL = 'https://trbpmjuazeiro.sudoesteinformatica.com.br/webrun/form.jsp?sys=TPC&dataConnection=PM_Juazeiro&action=openform&formID=%7B513A6F39-5238-4910-9E9B-FBB1DB9A95F5%7D&align=0&mode=-1&goto=-1&filter=&scrolling=no';
    const SITEKEY = '6Lf2jAgTAAAAAEXgPiCOT-bLwP9GndAvxfLRJVEu';

    const apiKey = await this.credenciais.obterValor(CredencialTipo.API_2CAPTCHA);
    if (!apiKey) {
      return { status: 'INDISPONIVEL', validade: null, mensagem: `Certidão Municipal Juazeiro-BA: chave do 2captcha não cadastrada. Emita manualmente em ${FORM_URL}.` };
    }

    return this.comBrowser(async (browser) => {
      const page = await this.novaPage(browser);
      try {
        await page.goto(FORM_URL, { waitUntil: 'networkidle', timeout: 30_000 });
        await page.waitForTimeout(2_000); // formulário carrega dentro do iframe de forma assíncrona

        const frame = page.frames().find((f) => f.url().includes('openform.do'));
        if (!frame) {
          return { status: 'INDISPONIVEL', validade: null, mensagem: `Certidão Municipal Juazeiro-BA: iframe do formulário não carregou.` };
        }

        const radios = frame.locator('input[type=radio]');
        await radios.first().click(); // "Débitos" (confirmado real: radio mais à esquerda)

        const comboTipoPesquisa = frame.locator('select').filter({ has: frame.locator('option', { hasText: '04 - CNPJ' }) });
        await comboTipoPesquisa.selectOption({ label: '04 - CNPJ' });
        await page.waitForTimeout(500);

        const campoDocumento = frame.locator('input[type=text]:visible').first();
        await campoDocumento.fill(cnpjLimpo);

        const { token, erro } = await this.resolver2captchaRecaptcha(apiKey, SITEKEY, FORM_URL);
        if (!token) {
          return { status: 'INDISPONIVEL', validade: null, mensagem: `Certidão Municipal Juazeiro-BA: reCAPTCHA não resolvido (${erro}).` };
        }
        await frame.evaluate((tok) => {
          const ta = document.getElementById('g-recaptcha-response') as HTMLTextAreaElement | null;
          if (ta) { ta.value = tok; ta.dispatchEvent(new Event('change')); }
        }, token);

        await frame.getByRole('button', { name: 'Pesquisar Inscrição' }).click();
        await page.waitForTimeout(3_000);

        const textoResultado = (await frame.innerText('body').catch(() => '')).replace(/\s+/g, ' ').trim();

        if (/n(ã|a)o (foi )?encontrad|n(ã|a)o localizad|inv[aá]lid[oa]|n(ã|a)o cadastrad/i.test(textoResultado)) {
          return { status: 'INDISPONIVEL', validade: null, mensagem: `Certidão Municipal Juazeiro-BA: CNPJ não encontrado no cadastro do município. Resposta: ${textoResultado.slice(0, 300)}` };
        }

        const btnEmitir = frame.getByRole('button', { name: 'Emitir Certidão' });
        if (await btnEmitir.count() === 0) {
          return { status: 'INDISPONIVEL', validade: null, mensagem: `Certidão Municipal Juazeiro-BA: resposta do portal não reconhecida (sem botão "Emitir Certidão" nem mensagem de erro conhecida). Texto: ${textoResultado.slice(0, 500)}` };
        }

        // Contribuinte encontrado -- clica em Emitir e tenta capturar o PDF,
        // mesmo padrão de captura (resposta application/pdf ou download) já
        // usado no Lauro de Freitas. Não confirmado ao vivo (ver nota acima).
        let capturedPdf: Buffer | null = null;
        const context = page.context();
        const onResponse = (response: import('playwright').Response) => {
          if (capturedPdf) return;
          if ((response.headers()['content-type'] ?? '').includes('application/pdf')) {
            response.body().then((b) => { capturedPdf = b; }).catch(() => {});
          }
        };
        context.on('response', onResponse);
        context.on('page', (p) => p.on('response', onResponse));

        const [novaPagina] = await Promise.all([
          context.waitForEvent('page', { timeout: 15_000 }).catch(() => null),
          btnEmitir.first().click(),
        ]);
        const paginaResultado = novaPagina ?? page;
        await paginaResultado.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(1_500);
        context.off('response', onResponse);

        if (capturedPdf) {
          const urlArquivo = await this.storage.uploadPdf(capturedPdf, `municipal-juazeiro-${cnpjLimpo}`);
          return {
            status: 'REGULAR',
            validade: null,
            mensagem: 'Certidão Negativa de Débitos (Juazeiro-BA) emitida com sucesso.',
            urlArquivo,
          };
        }

        const textoFinal = (await paginaResultado.innerText('body').catch(() => '')).replace(/\s+/g, ' ').trim();
        return {
          status: 'INDISPONIVEL',
          validade: null,
          mensagem: `Certidão Municipal Juazeiro-BA: contribuinte encontrado, mas não foi possível confirmar a emissão automaticamente (fluxo não validado ao vivo) — verifique manualmente em ${FORM_URL}. Texto: ${textoFinal.slice(0, 500)}`,
        };
      } catch (err) {
        this.logger.warn(`Certidão Municipal Juazeiro-BA erro: ${err}`);
        return { status: 'INDISPONIVEL', validade: null, mensagem: `Erro ao consultar Certidão Municipal Juazeiro-BA: ${err}` };
      } finally {
        await page.context().close();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Certidão Distrital — Brasília-DF (Portal da Receita do DF)
  // https://ww1.receita.fazenda.df.gov.br/cidadao/certidoes/Certidao
  // Sem login, CNPJ direto ("Pessoa Jurídica"). Achado real (04/10/2026):
  // protegido por Cloudflare Turnstile de verdade (sitekey
  // 0x4AAAAAAAaOvnbOLak1uio1, extraído do bundle JS da página --
  // retornaChaveConformeAmbiente() no componente Angular app-psv-turnstile)
  // -- diferente de todo outro captcha deste projeto, não é um puzzle
  // visual, é fingerprinting/detecção de automação do Cloudflare.
  //
  // Por que não basta preencher um campo escondido: o componente Angular
  // chama window.turnstile.render(elemento, opcoes) em modo "explicit" e só
  // atualiza seu estado interno (e o payload que a API realmente recebe)
  // quando opcoes.callback(token) é invocado de dentro do widget de
  // verdade -- setar um input hidden "cf-turnstile-response" direto não
  // aciona esse callback. Solução: como o sitekey é ESTÁTICO (hardcoded no
  // bundle, não depende de sessão/nonce), resolve o Turnstile via 2captcha
  // ANTES de navegar, e substitui window.turnstile inteiro via
  // page.addInitScript() -- quando o Angular chamar .render(), o shim
  // injeta o token já resolvido direto no callback de sucesso, sem depender
  // do widget real do Cloudflare carregar.
  //
  // RISCO REAL NÃO RESOLVIDO: mesmo com token Turnstile válido, o Cloudflare
  // pode ter uma camada de bot-management adicional no nível do WAF (TLS
  // fingerprint, comportamento, IP de datacenter) que rejeite a
  // requisição de qualquer forma -- mesmo padrão já visto bloqueando o FGTS
  // na Caixa (ver Decisão #5 do CLAUDE.md). NÃO VALIDADO AO VIVO por
  // decisão consciente (usuário optou por não gastar uma resolução paga de
  // Turnstile só pra testar, dado que o sucesso nem está garantido) -- nem
  // o Turnstile nem o fluxo de preenchimento/emissão foram confirmados
  // contra uma resposta real do portal.
  // ---------------------------------------------------------------------------
  private async consultarCertidaoDistritalBrasilia(cnpjLimpo: string): Promise<ResultadoScraper> {
    const FORM_URL = 'https://ww1.receita.fazenda.df.gov.br/cidadao/certidoes/Certidao';
    const TURNSTILE_SITEKEY = '0x4AAAAAAAaOvnbOLak1uio1';

    const apiKey = await this.credenciais.obterValor(CredencialTipo.API_2CAPTCHA);
    if (!apiKey) {
      return { status: 'INDISPONIVEL', validade: null, mensagem: `Certidão Distrital Brasília-DF: chave do 2captcha não cadastrada. Emita manualmente em ${FORM_URL}.` };
    }

    const { token, erro } = await this.resolver2captchaTurnstile(apiKey, TURNSTILE_SITEKEY, FORM_URL);
    if (!token) {
      return { status: 'INDISPONIVEL', validade: null, mensagem: `Certidão Distrital Brasília-DF: Cloudflare Turnstile não resolvido (${erro}).` };
    }

    return this.comBrowser(async (browser) => {
      const page = await this.novaPage(browser, true);
      try {
        await page.addInitScript((tok: string) => {
          (window as unknown as { turnstile: unknown }).turnstile = {
            render: (_el: unknown, opts: { callback?: (t: string) => void }) => {
              if (opts && typeof opts.callback === 'function') {
                setTimeout(() => opts.callback!(tok), 50);
              }
              return 'fake-widget-id';
            },
            reset: () => {},
            remove: () => {},
            execute: () => {},
          };
        }, token);

        await page.goto(FORM_URL, { waitUntil: 'networkidle', timeout: 30_000 });

        await page.getByText('Emissão de Certidão', { exact: true }).click();
        await page.getByText('Pessoa Jurídica', { exact: true }).click();
        await page.waitForTimeout(500);

        const campoCnpj = page.locator('input[type=text]:visible, input:not([type]):visible').first();
        await campoCnpj.fill(cnpjLimpo);

        let capturedPdf: Buffer | null = null;
        let downloadBuffer: Buffer | null = null;
        const context = page.context();
        const onResponse = (response: import('playwright').Response) => {
          if (capturedPdf) return;
          if ((response.headers()['content-type'] ?? '').includes('application/pdf')) {
            response.body().then((b) => { capturedPdf = b; }).catch(() => {});
          }
        };
        context.on('response', onResponse);
        context.on('page', (p) => p.on('response', onResponse));
        page.once('download', (download) => {
          download.createReadStream().then((stream) => {
            if (!stream) return;
            const chunks: Buffer[] = [];
            stream.on('data', (c) => chunks.push(c));
            stream.on('end', () => { downloadBuffer = Buffer.concat(chunks); });
          }).catch(() => {});
        });

        const [novaPagina] = await Promise.all([
          context.waitForEvent('page', { timeout: 15_000 }).catch(() => null),
          page.getByText('Gerar PDF', { exact: true }).click(),
        ]);
        const paginaResultado = novaPagina ?? page;
        await paginaResultado.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(1_500);
        context.off('response', onResponse);

        const pdfBuffer = capturedPdf ?? downloadBuffer;
        if (pdfBuffer) {
          const urlArquivo = await this.storage.uploadPdf(pdfBuffer, `distrital-brasilia-${cnpjLimpo}`);
          return {
            status: 'REGULAR',
            validade: null,
            mensagem: 'Certidão de Débitos Distrital (Receita-DF) emitida com sucesso.',
            urlArquivo,
          };
        }

        const textoFinal = (await paginaResultado.innerText('body').catch(() => '')).replace(/\s+/g, ' ').trim();
        return {
          status: 'INDISPONIVEL',
          validade: null,
          mensagem: `Certidão Distrital Brasília-DF: não foi possível confirmar a emissão automaticamente (fluxo não validado ao vivo) — verifique manualmente em ${FORM_URL}. Texto: ${textoFinal.slice(0, 500)}`,
        };
      } catch (err) {
        this.logger.warn(`Certidão Distrital Brasília-DF erro: ${err}`);
        return { status: 'INDISPONIVEL', validade: null, mensagem: `Erro ao consultar Certidão Distrital Brasília-DF: ${err}` };
      } finally {
        await page.context().close();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Inscrição Municipal (IM / CCM) — por município
  // Salvador: NFSe exige login — retorna INDISPONIVEL com link direto
  // Outros: INDISPONIVEL com instrução
  // ---------------------------------------------------------------------------
  async consultarInscricaoMunicipal(cnpj: string, uf?: string | null, municipio?: string | null, cga?: string | null): Promise<ResultadoScraper> {
    const cnpjLimpo = cnpj.replace(/\D/g, '');
    const munUpper = (municipio ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const ufUpper  = (uf ?? '').toUpperCase().trim();

    if (munUpper.includes('SALVADOR') || (ufUpper === 'BA' && !municipio)) {
      return this.consultarInscricaoMunicipalSalvador(cnpjLimpo);
    }

    // Lauro de Freitas: não existe consulta pública de CNPJ->CGA no portal da
    // SEFAZ-PMLF (confirmado em 02/09/2026 — o "Portal do Contribuinte" exige
    // login, e o site oficial da Secretaria só fala em ter o CGA em mãos, sem
    // nenhuma busca por CNPJ). Sem esse número armazenado manualmente, não tem
    // como automatizar. Com ele, o próprio cadastro já É a resposta — sem
    // custo de reCAPTCHA/2captcha pra só confirmar um número que já temos.
    if (munUpper.includes('LAURO DE FREITAS')) {
      if (!cga) {
        return {
          status: 'INDISPONIVEL',
          validade: null,
          mensagem: 'Inscrição Municipal (CGA) de Lauro de Freitas: não existe consulta pública por CNPJ nesse portal. Cadastre o CGA da empresa na aba Clientes.',
        };
      }
      return {
        status: 'REGULAR',
        validade: null,
        mensagem: `Inscrição Municipal (CGA) de Lauro de Freitas: ${cga}.`,
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
  // Inscrição Municipal (CGA) — Salvador, "Ficha Cadastral Resumida"
  // Portal: AlvaraCgaEmissaoFichaResumidaFrm.aspx (achado em 31/08/2026 — o
  // link "utilize a ferramenta de consulta com seu CNPJ" mencionado em fontes
  // externas se refere a essa página). Aceita consulta por CNPJ OU CGA
  // (CGA = nome que Salvador usa pro que a gente chama de Inscrição
  // Municipal). Protegida por reCAPTCHA v3 invisível (sitekey
  // 6LezQsYUAAAAADGi0SuYM_oefBW6Roqnm04-Phmp, action vazio — confirmado lendo
  // o `grecaptcha.execute()` real da página).
  // ---------------------------------------------------------------------------
  private async consultarInscricaoMunicipalSalvador(cnpjLimpo: string): Promise<ResultadoScraper> {
    const chave2captcha = await this.credenciais.obterValor(CredencialTipo.API_2CAPTCHA);
    if (!chave2captcha) {
      return {
        status: 'INDISPONIVEL',
        validade: null,
        mensagem: 'Inscrição Municipal Salvador: o portal usa reCAPTCHA. Cadastre uma chave 2captcha em Configurações → Credenciais para habilitar a automação.',
      };
    }

    const FORM_URL = 'https://servicosweb.sefaz.salvador.ba.gov.br/WebsiteV2/Sistemas/AlvaraCgaInternet/Modulos/Principal/AlvaraCgaEmissaoFichaResumidaFrm.aspx';
    const SITEKEY = '6LezQsYUAAAAADGi0SuYM_oefBW6Roqnm04-Phmp';

    return this.comBrowser(async (browser) => {
      try {
        const page = await this.novaPage(browser, true);

        // A resposta pode vir como alert() nativo do navegador (comum em
        // ASP.NET WebForms pra mensagens tipo "CNPJ não encontrado") — sem
        // handler, o Playwright descarta o diálogo sozinho e a mensagem se
        // perde (confirmado em teste real: URL igual + token presente após
        // o submit, mas o texto da página voltou idêntico ao estado inicial
        // — sinal de que algo interceptou a resposta antes de eu ler).
        let mensagemAlerta: string | null = null;
        page.on('dialog', (dialog) => {
          mensagemAlerta = dialog.message();
          dialog.dismiss().catch(() => {});
        });

        // A ficha cadastral de verdade sai como download nativo (confirmado
        // visualmente em 03/09/2026: uma caixa "Salvar como" pedindo pra
        // salvar "Relatorio.pdf" apareceu no Chrome real durante o teste
        // manual) — igual ao bug do CNDT. O texto que sobra na página depois
        // do postback é só o formulário resetado ("CGA: [vazio] ... clique
        // em Cancelar"), sem o número do CGA nele.
        let downloadBuffer: Buffer | null = null;
        page.on('download', (download) => {
          download.createReadStream().then((stream) => {
            if (!stream) return;
            const chunks: Buffer[] = [];
            stream.on('data', (c) => chunks.push(c));
            stream.on('end', () => { downloadBuffer = Buffer.concat(chunks); });
          }).catch(() => {});
        });

        await page.goto(FORM_URL, { waitUntil: 'networkidle', timeout: 30_000 });

        await page.locator('#ctl00_ContentPlaceHolderPrincipal_RdBNuCnpj').click();
        await page.waitForTimeout(300); // dá tempo do handler de troca de rádio habilitar o campo
        const campoCnpj = page.locator('#ctl00_ContentPlaceHolderPrincipal_txtNuCnpj');
        // Limpar antes de digitar é necessário — confirmado manualmente: sem
        // isso o MaskedEditExtender (ASP.NET AJAX Toolkit) mantém posição de
        // cursor interna inconsistente e a digitação cai no meio/fim da
        // máscara em vez de do início (reproduzido em teste real: campo saiu
        // como "__.___.__./_303-27" em vez do CNPJ completo).
        await campoCnpj.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Delete');
        await page.keyboard.press('Home');
        await campoCnpj.pressSequentially(cnpjLimpo, { delay: 30 });

        // O campo tem MaskedEditExtender (ASP.NET AJAX Toolkit) — confirma que
        // o valor ficou no formato mascarado esperado (com pontuação) antes de
        // seguir. Teste real mostrou "Dígito do CNPJ inválido!" quando o campo
        // não ficava formatado corretamente no fluxo automatizado.
        const valorCampo = await campoCnpj.inputValue();
        this.logger.log(`Inscrição Municipal Salvador: campo CNPJ preenchido como "${valorCampo}"`);

        const { token, erro } = await this.resolver2captchaRecaptchaV3(chave2captcha, SITEKEY, FORM_URL, '');
        if (!token) {
          return {
            status: 'INDISPONIVEL',
            validade: null,
            mensagem: `Inscrição Municipal Salvador: reCAPTCHA não resolvido (${erro}).`,
          };
        }
        await page.evaluate((tok) => {
          const el = document.getElementById('ctl00_ContentPlaceHolderPrincipal_grecaptcharesponse') as HTMLInputElement | null;
          if (el) {
            el.value = tok;
            el.dispatchEvent(new Event('change'));
          }
        }, token);

        await Promise.all([
          page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {}),
          page.locator('#ctl00_ContentPlaceHolderPrincipal_BtnConsultar0').click(),
        ]);
        await page.waitForTimeout(2_000); // dá tempo do postback (UpdatePanel) e do stream de download terminarem

        // innerText (não textContent) — textContent inclui o conteúdo bruto de
        // <script>, que nesse ASP.NET WebForms aparece antes do texto real
        // renderizado e poluía a extração (confirmado em teste real: primeiro
        // log só trouxe o boilerplate JS do __doPostBack/ScriptManager).
        const texto = (await page.evaluate(() => document.body.innerText) ?? '').replace(/\s+/g, ' ');
        // Diagnóstico extra — resposta anterior veio idêntica ao formulário
        // vazio inicial (sem erro, sem dado), então não dá pra saber se o
        // postback rodou de verdade ou o token nunca foi enviado. Loga a URL
        // atual (mudou de página? recarregou?) e o valor do próprio campo do
        // token depois do clique, pra distinguir as duas hipóteses.
        const tokenNoCampo = await page.evaluate(() => {
          const el = document.getElementById('ctl00_ContentPlaceHolderPrincipal_grecaptcharesponse') as HTMLInputElement | null;
          return el ? el.value.length : -1;
        });
        this.logger.log(`Inscrição Municipal Salvador: URL após submit: ${page.url()} | tamanho do token no campo: ${tokenNoCampo} | alerta JS: ${mensagemAlerta ?? '(nenhum)'}`);
        this.logger.log(`Inscrição Municipal Salvador: resposta do portal: ${texto.slice(0, 800)}`);

        if (mensagemAlerta) {
          return {
            status: 'INDISPONIVEL',
            validade: null,
            mensagem: `Inscrição Municipal Salvador: ${mensagemAlerta}`,
          };
        }

        if (/n(ã|a)o (foi )?encontrad|n(ã|a)o localizad|n(ã|a)o cadastrad|cnpj inv(á|a)lido/i.test(texto)) {
          return {
            status: 'INDISPONIVEL',
            validade: null,
            mensagem: 'Inscrição Municipal Salvador: CNPJ não encontrado no Cadastro Geral de Atividades (CGA).',
          };
        }

        const matchCga = texto.match(/CGA\s*[:\-]?\s*(\d[\d.]{3,})/i);
        const numeroCga = matchCga ? matchCga[1].replace(/\./g, '') : null;

        // Sem download nativo capturado E sem número de CGA no texto: não dá
        // pra confirmar nada, aí sim é indisponível de verdade.
        if (!downloadBuffer && !numeroCga) {
          return {
            status: 'INDISPONIVEL',
            validade: null,
            mensagem: `Inscrição Municipal Salvador: não foi possível localizar o número do CGA na resposta. Resposta do site: ${texto.slice(0, 300)}`,
          };
        }

        const urlArquivo = await this.gerarPdfFichaCadastral(downloadBuffer, cnpjLimpo);

        return {
          status: 'REGULAR',
          validade: null,
          mensagem: numeroCga
            ? `Inscrição Municipal (CGA) ativa em Salvador. Número: ${numeroCga}.`
            : 'Inscrição Municipal (CGA) ativa em Salvador (ficha cadastral emitida).',
          urlArquivo,
        };
      } catch (err) {
        this.logger.warn(`Inscrição Municipal Salvador erro: ${err}`);
        return {
          status: 'INDISPONIVEL',
          validade: null,
          mensagem: `Erro ao consultar Inscrição Municipal Salvador: ${err}`,
        };
      }
    });
  }

  private async gerarPdfFichaCadastral(downloadBuffer: Buffer | null, cnpjLimpo: string): Promise<string | null> {
    try {
      if (!downloadBuffer) {
        this.logger.warn('Inscrição Municipal Salvador: nenhum download capturado — não é a ficha oficial pra arriscar gerar um PDF substituto.');
        return null;
      }
      const urlArquivo = await this.storage.uploadPdf(downloadBuffer, `im-salvador-${cnpjLimpo}`);
      this.logger.log('Inscrição Municipal Salvador: PDF (download real) salvo');
      return urlArquivo;
    } catch (err) {
      this.logger.warn(`Inscrição Municipal Salvador: não foi possível gerar PDF: ${err}`);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // CND Federal — Receita Federal / PGFN
  // Portal: https://servicos.receitafederal.gov.br/servico/certidoes/
  // Proteção: hCaptcha invisible (sitekey f214a120-a07a-4b28-907a-bfa6b96257ae)
  // Fluxo (confirmado em 21/08/2026 inspecionando o site real — o antigo endpoint
  // consulta/validar-contribuinte não é mais o que o front-end usa):
  //   2captcha resolve hCaptcha → POST Emissao/verificar (com X-Captcha-Token,
  //   seta cookie de sessão; "status":"Emitida" quando já existe certidão válida,
  //   mas isso não impede seguir) → POST Emissao (usa o cookie, não o token; PDF
  //   em base64 quando statusEmissao="Sucesso").
  // ---------------------------------------------------------------------------
  async consultarCndFederal(cnpj: string): Promise<ResultadoScraper> {
    const cnpjLimpo = cnpj.replace(/\D/g, '');

    // Ver comentário grande abaixo: em produção (Render) isso SEMPRE falha
    // (PAT do hCaptcha exige atestação de hardware que Chrome headless não
    // produz), então só vale a pena tentar via browser local quando essa
    // env var está setada manualmente (nunca em produção — headed exige
    // ~700MB de RAM, muito acima do free tier do Render).
    if (process.env.USAR_CND_FEDERAL_LOCAL === 'true') {
      return this.consultarCndFederalHeadedLocal(cnpjLimpo);
    }

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

  // ---------------------------------------------------------------------------
  // hCaptcha da Receita Federal — por que produção usa 2captcha e não um
  // solver local (investigado em 02-03/09/2026, ver
  // api_captcha/diagnostico_hcaptcha_receita.py e scripts irmãos no mesmo
  // diretório):
  //
  // Esse hCaptcha usa Private Access Tokens (PAT — padrão Privacy Pass,
  // Apple/Cloudflare), não um desafio de imagem. O header X-Captcha-Token
  // SEMPRE chega populado com um JWT real (prefixo "P1_...") — o hCaptcha
  // gera o token normalmente — mas em Chrome automatizado ele é rejeitado
  // com "023 - CaptchaFalhaValidacao", porque falta a atestação de
  // hardware que o PAT exige.
  //
  // Isolado por eliminação (8 combinações testadas): NÃO é sobre qual
  // binário (Chromium do Playwright e Chrome real se comportam igual) nem
  // sobre stealth/UA/mouse humano (tudo isso testado, sem efeito). As DUAS
  // condições que precisam estar presentes JUNTAS pra passar:
  //   1. headless: false (headless real tem pipeline de GPU/mídia
  //      reduzido — confirmado: --disable-gpu sozinho já quebra o PAT
  //      mesmo com headless:false, então é a aceleração de GPU real que
  //      importa, não "ter uma janela")
  //   2. launchPersistentContext (perfil de verdade em disco) em vez do
  //      newContext() efêmero em memória — não precisa de "aquecimento",
  //      funciona de primeira com perfil recém-criado
  // Confirmado 4/4 vezes com essas duas condições juntas; qualquer uma
  // faltando = sempre falha.
  //
  // Por que produção não usa isso: exige ~700MB de RAM só pro Chrome
  // (medido com medir_memoria_cnd_federal.py) — o free tier do Render tem
  // 512MB no total. Tentativas de cortar memória sem quebrar o PAT
  // (extensões/background/cache desligados) só chegam a ~690MB — as
  // alavancas que realmente cortariam memória (desligar GPU, bloquear
  // requisições de rede) são exatamente as que quebram a atestação. Não
  // dá pra caber no free tier sem um upgrade de plano ou um VPS.
  //
  // Solução atual: consultarCndFederalHeadedLocal() abaixo implementa o
  // fluxo real (headed + perfil persistente), só habilitado via env var
  // USAR_CND_FEDERAL_LOCAL=true — pra rodar manualmente do computador
  // local (RAM não é o gargalo lá) sempre que precisar processar CND
  // Federal/Dívida Ativa, enquanto produção continua no 2captcha.
  // ---------------------------------------------------------------------------
  private async consultarCndFederalCom2captcha(
    cnpjLimpo: string,
    apiKey: string,
  ): Promise<ResultadoScraper> {
    const BASE = 'https://servicos.receitafederal.gov.br/servico/certidoes/api';
    const PAGE_URL = 'https://servicos.receitafederal.gov.br/servico/certidoes/';
    const SITEKEY = 'f214a120-a07a-4b28-907a-bfa6b96257ae';
    let ultimoErroCaptcha: string | null = null;

    // 5 tentativas (não mais 3) — agora que cada uma não perde mais 120s com a
    // api_captcha local (ver resolver2captchaHcaptcha), o orçamento total fica
    // parecido com o de antes, mas dá mais chances de pegar uma resolução do
    // 2captcha rápida o bastante pra vencer a corrida contra a expiração do
    // token do hCaptcha da Receita.
    for (let tentativa = 1; tentativa <= 5; tentativa++) {
      try {
        // 1. Resolve hCaptcha via 2captcha
        this.logger.log(`CND Federal tentativa ${tentativa}: resolvendo hCaptcha...`);
        const { token: captchaToken, erro: erroCaptcha } = await this.resolver2captchaHcaptcha(apiKey, SITEKEY, PAGE_URL);
        if (!captchaToken) {
          ultimoErroCaptcha = erroCaptcha;
          this.logger.warn(`CND Federal tentativa ${tentativa}: hCaptcha não resolvido (${erroCaptcha}).`);
          continue;
        }

        // 2. Verifica com o token (seta cookie de sessão). "status":"Emitida" só
        // indica que já existe uma certidão válida — não impede seguir pra
        // emissão, é o /Emissao que decide se consegue emitir uma negativa nova
        // (o próprio site sempre segue pra /Emissao independente desse status).
        const verificarRes = await fetch(`${BASE}/Emissao/verificar`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Captcha-Token': captchaToken,
            'Origin': PAGE_URL,
            'Referer': PAGE_URL,
          },
          body: JSON.stringify({ ni: cnpjLimpo, tipoContribuinte: 'PJ', tipoContribuinteEnum: 'CNPJ' }),
          signal: AbortSignal.timeout(30_000),
        });

        if (!verificarRes.ok) {
          // Corpo da resposta ajuda a distinguir token de captcha expirado
          // (2captcha às vezes demora perto dos 120s, e o token do hCaptcha
          // tem validade curta) de outros motivos de rejeição.
          const corpoErro = await verificarRes.text().catch(() => '');
          this.logger.warn(`CND Federal tentativa ${tentativa}: Emissao/verificar HTTP ${verificarRes.status} — corpo: ${corpoErro.slice(0, 300)}`);
          ultimoErroCaptcha = `Emissao/verificar HTTP ${verificarRes.status}: ${corpoErro.slice(0, 200)}`;
          continue;
        }

        const setCookieRaw = verificarRes.headers.get('set-cookie') ?? '';
        const verificarJson = (await verificarRes.json().catch(() => ({}))) as { status?: string };
        this.logger.log(`CND Federal Emissao/verificar: ${JSON.stringify(verificarJson)}`);

        const cookieHeader = this.extrairCookiesRelevantes(setCookieRaw);

        // 3. Emite a certidão (usa o cookie de sessão do passo anterior — este
        // endpoint não recebe o token de captcha diretamente).
        const emissaoRes = await fetch(`${BASE}/Emissao`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Cookie': cookieHeader,
            'Origin': PAGE_URL,
            'Referer': PAGE_URL,
          },
          body: JSON.stringify({ ni: cnpjLimpo, tipoContribuinte: 'PJ', tipoContribuinteEnum: 'CNPJ' }),
          signal: AbortSignal.timeout(30_000),
        });

        const emissaoJson = (await emissaoRes.json()) as {
          statusEmissao?: string;
          pdf?: string;
          mensagem?: { texto?: string; data?: string } | string;
          dataValidade?: string;
          numeroCertidao?: string;
        };

        this.logger.log(`CND Federal Emissao statusEmissao=${emissaoJson.statusEmissao}`);

        const mensagemTexto = typeof emissaoJson.mensagem === 'string'
          ? emissaoJson.mensagem
          : emissaoJson.mensagem?.texto;

        if (emissaoJson.statusEmissao === 'SemDireitoCertidao') {
          return {
            status: 'IRREGULAR',
            validade: null,
            mensagem: mensagemTexto ?? 'CND Federal: empresa não tem direito à certidão negativa.',
          };
        }

        if (emissaoJson.statusEmissao !== 'Sucesso' || !emissaoJson.pdf) {
          return {
            status: 'INDISPONIVEL',
            validade: null,
            mensagem: mensagemTexto ?? `CND Federal: resposta inesperada da emissão (status=${emissaoJson.statusEmissao ?? 'desconhecido'}).`,
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
        if (tentativa === 5) {
          return {
            status: 'INDISPONIVEL',
            validade: null,
            mensagem: `CND Federal: erro após 5 tentativas: ${err}`,
          };
        }
      }
    }

    return {
      status: 'INDISPONIVEL',
      validade: null,
      mensagem: `CND Federal: hCaptcha não resolvido após 5 tentativas. Último erro: ${ultimoErroCaptcha ?? 'desconhecido'}.`,
    };
  }

  // ---------------------------------------------------------------------------
  // CND Federal — fluxo real via browser headed + perfil persistente. Só
  // habilitado com USAR_CND_FEDERAL_LOCAL=true (ver comentário grande logo
  // acima de consultarCndFederalCom2captcha pra entender por quê). Dirige
  // o formulário de verdade (não a API REST direto) porque é a página real
  // que decide se emite PAT — chamar a API isolada como
  // consultarCndFederalCom2captcha faz não helps aqui.
  // ---------------------------------------------------------------------------
  private async consultarCndFederalHeadedLocal(cnpjLimpo: string): Promise<ResultadoScraper> {
    const PAGE_URL = 'https://servicos.receitafederal.gov.br/servico/certidoes/';
    const perfilDir = join(process.cwd(), '.chrome-profile-cnd-federal');

    const context = await chromium.launchPersistentContext(perfilDir, {
      headless: false,
      viewport: { width: 1280, height: 800 },
      locale: 'pt-BR',
      acceptDownloads: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-sync',
        '--disable-translate',
        '--disable-default-apps',
        '--no-first-run',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=Translate,OptimizationHints,MediaRouter',
        '--renderer-process-limit=2',
        '--js-flags=--max-old-space-size=256',
        '--disk-cache-size=1',
        '--mute-audio',
      ],
    });

    try {
      const page = context.pages()[0] ?? (await context.newPage());

      let capturedPdf: Buffer | null = null;
      const onResponse = (response: import('playwright').Response) => {
        if (capturedPdf) return;
        const ct = response.headers()['content-type'] ?? '';
        if (ct.includes('application/pdf')) {
          response.body().then((b) => { capturedPdf = b; }).catch(() => {});
        }
      };
      context.on('response', onResponse);
      context.on('page', (p) => p.on('response', onResponse));
      page.on('download', (download) => {
        download.createReadStream().then((stream) => {
          if (!stream) return;
          const chunks: Buffer[] = [];
          stream.on('data', (c) => chunks.push(c));
          stream.on('end', () => { capturedPdf = Buffer.concat(chunks); });
        }).catch(() => {});
      });

      // "Aquecimento" do perfil — navega por sites reais antes de ir na
      // Receita. Reproduz o único teste controlado que já diferenciou
      // sucesso de erro 023 nesse hCaptcha: em 03/09/2026 (madrugada,
      // api_captcha/diagnostico_hcaptcha_perfil_persistente.py), o mesmo
      // perfil persistente SEM esse passo deu 023 duas vezes (02:50 e
      // 02:58, testes antes/depois) e COM esse passo passou de primeira
      // (02:54) — únicas 3 variáveis controladas, resultado limpo. Nunca
      // tinha sido replicado desde então; o fluxo integrado sempre foi
      // direto pra Receita sem aquecer.
      for (const url of ['https://www.google.com', 'https://www.uol.com.br', 'https://www.gov.br']) {
        try {
          await page.goto(url, { waitUntil: 'load', timeout: 15_000 });
          await page.waitForTimeout(1_500);
        } catch { /* aquecimento é best-effort — um site fora do ar não deve travar a consulta */ }
      }

      await page.goto(PAGE_URL, { waitUntil: 'load', timeout: 45_000 });
      // Site é uma SPA: clicar antes da hidratação perde o clique em silêncio
      // (confirmado em 21/09/2026 — 2 de 3 rodadas seguidas falhavam com
      // "campo niContribuinte não encontrado" mesmo com a página normal).
      await page.waitForTimeout(3_000);

      try {
        await page.getByRole('button', { name: 'Aceitar' }).click({ timeout: 3_000 });
      } catch { /* banner pode não aparecer se o perfil já aceitou antes */ }

      const campoCnpj = page.locator('input[name="niContribuinte"]');
      for (let clique = 1; clique <= 3; clique++) {
        await page.getByText('Pessoa Jurídica', { exact: true }).click({ timeout: 15_000 });
        const apareceu = await campoCnpj.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false);
        if (apareceu) break;
        if (clique === 3) throw new Error('Formulário de CNPJ não apareceu após 3 cliques em "Pessoa Jurídica".');
        await page.waitForTimeout(2_000);
      }
      await page.waitForTimeout(800);

      await campoCnpj.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
      await campoCnpj.pressSequentially(cnpjLimpo, { delay: 80 });
      await page.keyboard.press('Tab');
      await page.waitForTimeout(600);

      await page.getByRole('button', { name: 'Emitir Certidão' }).click({ timeout: 8_000 });
      await page.waitForTimeout(3_000);

      // Se já existe certidão válida, o site pergunta antes de emitir uma
      // nova — confirma a emissão pra sempre ter o PDF/validade atuais.
      // isVisible() sozinho NÃO espera (é um check imediato) — precisa de
      // um waitFor de verdade, senão a checagem roda antes do modal
      // renderizar e a lógica cai direto no fallback genérico.
      const apareceuModal = await page
        .getByText('Certidão Válida Encontrada')
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      if (apareceuModal) {
        await page.getByRole('button', { name: 'Emitir Nova Certidão' }).click({ timeout: 8_000 });
        await page.waitForTimeout(3_000);
      }

      // "Resultado da Emissão de Certidão... Estamos analisando seu pedido
      // de emissão de certidão. Aguarde." é um estado intermediário (o site
      // processa a emissão de forma assíncrona) — confirmado em teste real
      // (03/09/2026): não é rejeição de captcha/PAT, é só questão de esperar
      // mais. Sem esse polling, a leitura única de texto pegava esse
      // "aguarde" e caía direto no fallback "resposta não reconhecida".
      await page.waitForTimeout(2_000);
      let texto = ((await page.locator('body').innerText().catch(() => '')) ?? '').trim();
      for (let tentativa = 0; tentativa < 10 && /aguarde|analisando/i.test(texto); tentativa++) {
        await page.waitForTimeout(3_000);
        texto = ((await page.locator('body').innerText().catch(() => '')) ?? '').trim();
      }
      const textoLower = texto.toLowerCase();

      if (textoLower.includes('emitida com sucesso')) {
        // A tela só diz "emitida com sucesso" — a validade ("Válida até
        // DD/MM/AAAA") só existe no PDF. Sem isso ficava null e o alerta de
        // vencimento nunca disparava pra CND Federal.
        await page.waitForTimeout(1_500); // dá tempo do stream do download terminar
        const validade = (capturedPdf ? await this.extrairValidadeDoPdf(capturedPdf) : null) ?? this.extrairData(texto);
        return {
          status: 'REGULAR',
          validade,
          mensagem: 'Certidão de Débitos Relativos a Créditos Tributários Federais e à Dívida Ativa da União emitida.',
          urlArquivo: capturedPdf ? await this.salvarPdfBuffer(capturedPdf, `cnd-federal-${cnpjLimpo}`) : undefined,
        };
      }

      if (/n(ã|a)o tem direito|existem pend(ê|e)ncias|d(é|e)bitos? pendentes/i.test(texto)) {
        return {
          status: 'IRREGULAR',
          validade: null,
          mensagem: `CND Federal: empresa não tem direito à certidão negativa. Resposta do site: ${texto.slice(0, 300)}`,
        };
      }

      // Não reconhecemos a resposta como sucesso nem como rejeição clara —
      // não arriscamos declarar REGULAR só com base em texto de página pra
      // um documento fiscal. Devolve o texto pra diagnóstico.
      this.logger.warn(`CND Federal (headed local): resposta não reconhecida. apareceuModal=${apareceuModal} texto="${texto.slice(0, 400)}"`);
      return {
        status: 'INDISPONIVEL',
        validade: null,
        mensagem: `CND Federal: não foi possível confirmar a emissão automaticamente. Resposta do site: ${texto.slice(0, 400)}`,
      };
    } catch (err) {
      this.logger.warn(`CND Federal (headed local) erro: ${err}`);
      return { status: 'INDISPONIVEL', validade: null, mensagem: `Erro ao consultar CND Federal (local): ${err}` };
    } finally {
      await context.close();
    }
  }

  // Resolve hCaptcha via 2captcha direto — NÃO tenta a api_captcha local antes.
  // Motivo (achado documentado em docs/pendencias-tecnicas.md): o solver local
  // (Playwright clicando no checkbox) nunca resolve esse hCaptcha específico da
  // Receita — sempre estoura o timeout de 120s inteiro antes de cair pro
  // fallback pago. Isso dobrava o tempo de cada tentativa (até 240s: 120s de
  // local + até 120s de 2captcha) contra um problema que já é uma corrida
  // contra o relógio (o token do hCaptcha da Receita expira antes do 2captcha
  // terminar de resolver — confirmado em log: token obtido aos 116s, rejeitado
  // no ato seguinte com CaptchaFalhaValidacao). Pular o passo local não resolve
  // a corrida em si, mas libera esse tempo pra tentar mais vezes no mesmo
  // orçamento total, aumentando a chance de pegar uma resolução rápida o
  // suficiente do 2captcha antes do token expirar.
  // Retorna o token quando resolve, ou { erro } com o motivo exato quando falha —
  // sem isso, uma falha de captcha vira sempre "não resolvido" genérico e não dá
  // pra saber se foi chave inválida, saldo zerado, sitekey mudou etc. sem acesso
  // aos logs do Render.
  private async resolver2captchaHcaptcha(
    apiKey: string,
    sitekey: string,
    pageUrl: string,
  ): Promise<{ token: string | null; erro: string | null }> {
    try {
      const submitRes = await fetch('https://2captcha.com/in.php', {
        method: 'POST',
        body: new URLSearchParams({
          key: apiKey,
          method: 'hcaptcha',
          sitekey,
          pageurl: pageUrl,
          json: '1',
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const submitJson = (await submitRes.json()) as { status: number; request: string };
      if (submitJson.status !== 1) {
        const erro = `submit: ${submitJson.request}`;
        this.logger.warn(`2captcha hCaptcha submit erro: ${JSON.stringify(submitJson)}`);
        return { token: null, erro };
      }

      const captchaId = submitJson.request;
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 5_000));
        const resRes = await fetch(
          `https://2captcha.com/res.php?key=${apiKey}&action=get&id=${captchaId}&json=1`,
          { signal: AbortSignal.timeout(15_000) },
        );
        const resJson = (await resRes.json()) as { status: number; request: string };
        if (resJson.status === 1) return { token: resJson.request, erro: null };
        if (resJson.request !== 'CAPCHA_NOT_READY') {
          const erro = `resultado: ${resJson.request}`;
          this.logger.warn(`2captcha hCaptcha result erro: ${JSON.stringify(resJson)}`);
          return { token: null, erro };
        }
      }

      this.logger.warn('2captcha hCaptcha: timeout — sem resposta em 120s.');
      return { token: null, erro: 'timeout: sem resposta do 2captcha em 120s' };
    } catch (err) {
      this.logger.warn(`2captcha hCaptcha erro de rede: ${err}`);
      return { token: null, erro: `erro de rede: ${err}` };
    }
  }

  // Salva um PDF em base64 em disco e retorna a URL relativa
  private async salvarPdfBase64(pdfBase64: string, prefixo: string): Promise<string> {
    return this.storage.uploadPdf(Buffer.from(pdfBase64, 'base64'), prefixo);
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
    // Prioriza a data logo após "válid[oa] até" — várias certidões (ex:
    // Municipal Salvador) têm mais de uma data no texto (emissão + validade),
    // e pegar a primeira ocorrência de DD/MM/AAAA às cegas pega a data errada
    // (a de emissão, que vem antes no texto) na maioria dos casos.
    const matchValidade = texto.match(/v[aá]lid[oa]\s+at[eé]\D{0,20}(\d{2})\/(\d{2})\/(\d{4})/i);
    if (matchValidade) {
      const [, d, m, y] = matchValidade;
      return `${y}-${m}-${d}`;
    }
    // Idem, mas pro rótulo "Validade: DD/MM/AAAA" (ex: CNDT/TST) — sem essa
    // âncora, o fallback genérico abaixo pegava a data de "Expedição" que
    // aparece antes no texto do PDF, não a validade de fato.
    const matchValidadeDoisPontos = texto.match(/validade\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    if (matchValidadeDoisPontos) {
      const [, d, m, y] = matchValidadeDoisPontos;
      return `${y}-${m}-${d}`;
    }
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
