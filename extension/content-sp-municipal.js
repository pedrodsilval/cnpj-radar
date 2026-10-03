// Roda em duc.prefeitura.sp.gov.br — fila de job "MUNICIPAL_SAO_PAULO".
// Diferente do fluxo da Receita (Angular SPA, sem reload de página), esse
// portal é ASP.NET WebForms clássico: clicar "Emitir" navega de verdade pra
// outra URL, derrubando qualquer contexto de script injetado antes do
// clique. Por isso esse script é um content_script DECLARADO no manifest
// (reinjeta sozinho a cada navegação dentro do site), não injetado uma vez
// via chrome.scripting.executeScript como o da Receita — e guarda o estado
// entre navegações em chrome.storage.local (chave ESTADO_KEY), não em
// variável de módulo (que morreria no reload).
//
// Achado real em produção (02/10/2026): um teste ao vivo disparou mais de
// 130 chamadas de resolução de captcha em ~2min, mesmo com um limite de 4
// tentativas por ramo do fluxo -- a causa era ter um contador LOCAL por
// ramo (desafio/preenchendo/reenviando/pagina_vazia), que não acumulava
// entre ramos diferentes. Corrigido centralizando toda tentativa (de
// qualquer ramo) em reservarTentativa(), com um único contador global
// (`tentativas`) e um prazo total de parede (`PRAZO_TOTAL_MS`) -- sozinhos,
// esses dois já limitam o job a no máximo MAX_TENTATIVAS tentativas reais
// em até 90s, não importa quão rápido cada uma dispare.
//
// Uma tentativa de freio adicional (intervalo mínimo entre tentativas, pra
// pegar "chamadas impossivelmente rápidas") foi testada e removida depois:
// o portal de SP navega pra ele mesmo DUAS vezes seguidas logo na primeira
// carga (confirmado com log de timestamp em 02/10/2026 -- três "navigate"
// reais no Performance Navigation Timing, a 692ms e 531ms de distância,
// bem abaixo de qualquer intervalo mínimo razoável). É comportamento normal
// do site (provável fechamento de sessão/cookie), não loop -- um freio por
// intervalo sempre vai ter falso positivo contra isso. O contador global +
// prazo total já bastam.

const ESTADO_KEY = 'spMunicipalJob';
// 2 tentativas já são "gastas" pelo bounce duplo do portal antes do
// preenchimento de verdade começar (achado 02/10/2026) -- 5 deixa margem
// real pra reentradas de bounce + pelo menos uma tentativa de preenchimento
// e um retry em caso de captcha rejeitado.
const MAX_TENTATIVAS = 5;
const PRAZO_TOTAL_MS = 90_000;

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function textoVisivel() {
  return (document.body.innerText || document.body.textContent || '').replace(/\s+/g, ' ').trim();
}

async function esperarSeletor(seletor, timeoutMs = 10_000) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    const el = document.querySelector(seletor);
    if (el) return el;
    await esperar(200);
  }
  return null;
}

// Achado real (02/10/2026): capturar a imagem do captcha logo que o
// elemento aparece no DOM, sem esperar ela terminar de CARREGAR, gerava um
// canvas 0x0 -- o 2captcha rejeitava com "ERROR_UPLOAD ... base64 data is
// not a valid base64 image" (confirmado no log do servidor). img.complete
// não é suficiente sozinho (fica true cedo demais em alguns casos) --
// confere naturalWidth > 0 junto.
async function esperarImagemCarregar(img, timeoutMs = 5_000) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    if (img.complete && img.naturalWidth > 0) return true;
    await esperar(100);
  }
  return false;
}

// Imagens já inline (data:) vêm prontas; a do form vem como <img src="URL">
// same-origin -- desenha num canvas pra extrair sem CORS taint.
function imagemParaBase64(img) {
  if (img.src.startsWith('data:')) return img.src;
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);
  return canvas.toDataURL('image/png');
}

// Não faz o fetch direto daqui: content scripts herdam o CSP da própria
// página, e um site de governo costuma ter connect-src restritivo que
// bloqueia requisições pra domínios externos (silenciosamente — cai no
// .catch sem erro nenhum útil). O service worker (background.js) não sofre
// esse CSP, então pede a ele pra fazer a chamada.
async function resolverCaptcha(img) {
  const carregou = await esperarImagemCarregar(img);
  if (!carregou) return null; // imagem nunca carregou -- não adianta tentar resolver
  const imagemBase64 = imagemParaBase64(img);
  const resposta = await chrome.runtime.sendMessage({ type: 'RESOLVER_CAPTCHA', imagemBase64 }).catch(() => null);
  return resposta && resposta.token ? resposta.token : null;
}

function selectComEvento(el, valor) {
  el.value = valor;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

async function finalizar(resultado) {
  await chrome.storage.local.remove(ESTADO_KEY);
  chrome.runtime.sendMessage({ type: 'RESULTADO_MUNICIPAL_SP', ...resultado }).catch(() => {});
}

// Único ponto que autoriza (ou não) uma nova tentativa, de qualquer ramo do
// fluxo. Grava a reserva (contador + timestamp) ANTES de fazer qualquer
// trabalho — é a trava que impede uma disparada de chamadas, não só uma
// contagem informativa. Retorna o job atualizado (já persistido) se
// autorizado, ou null se já finalizou (quem chamou deve retornar na hora).
async function reservarTentativa(job, etapa) {
  const agora = Date.now();

  if (agora - (job.criadoEm || agora) > PRAZO_TOTAL_MS) {
    await finalizar({ status: 'INDISPONIVEL', mensagem: `Certidão Municipal São Paulo: prazo total (${PRAZO_TOTAL_MS / 1000}s) esgotado na etapa "${etapa}".` });
    return null;
  }

  const tentativas = (job.tentativas || 0) + 1;
  if (tentativas > MAX_TENTATIVAS) {
    await finalizar({ status: 'INDISPONIVEL', mensagem: `Certidão Municipal São Paulo: desisti após ${MAX_TENTATIVAS} tentativas (etapa: ${etapa}).` });
    return null;
  }

  const novoJob = { ...job, tentativas, etapa };
  await chrome.storage.local.set({ [ESTADO_KEY]: novoJob });
  return novoJob;
}

function parseResultado(texto) {
  const lower = texto.toLowerCase();
  if (lower.includes('não foi possivel emitir a certidão') || lower.includes('não foi possível emitir a certidão')) {
    return { status: 'IRREGULAR', mensagem: `Certidão Municipal São Paulo: há pendências impeditivas para emissão da certidão. Resposta do site: ${texto.slice(0, 500)}` };
  }
  // Mesma cautela do lado servidor (certidoes-scraper.service.ts): sem uma
  // amostra confirmada de empresa regular, não arrisca declarar REGULAR.
  return { status: 'INDISPONIVEL', mensagem: `Certidão Municipal São Paulo: resposta do portal ainda não validada pra empresa regular — verifique manualmente. Texto: ${texto.slice(0, 500)}` };
}

async function processar() {
  const { [ESTADO_KEY]: jobAtual } = await chrome.storage.local.get(ESTADO_KEY);
  if (!jobAtual) return; // nenhum job ativo -- script fica inerte nessa navegação

  const texto = textoVisivel();

  // Desafio anti-bot da Prodam-SP -- pode aparecer em qualquer navegação
  // dentro do site, não só na primeira (achado real 02/10/2026). Em caso de
  // falha ao resolver, finaliza em vez de recarregar (menos um caminho de
  // retry = menos chance de loop, dado o incidente acima).
  if (/visitante leg[ií]timo/i.test(texto)) {
    const job = await reservarTentativa(jobAtual, 'desafio');
    if (!job) return;

    const img = document.querySelector('img');
    const campo = document.querySelector('input[type="text"]');
    const botao = [...document.querySelectorAll('button, a, [role="button"]')].find((el) => /submit/i.test(el.textContent || ''));
    if (!img || !campo || !botao) {
      return finalizar({ status: 'INDISPONIVEL', mensagem: 'Certidão Municipal São Paulo: desafio anti-bot com layout inesperado (campo/botão não encontrado).' });
    }
    const resposta = await resolverCaptcha(img);
    if (!resposta) {
      return finalizar({ status: 'INDISPONIVEL', mensagem: 'Certidão Municipal São Paulo: não consegui resolver o captcha do desafio anti-bot.' });
    }
    // Normaliza pra minúsculo (mesmo padrão já usado no CNDT) -- o 2captcha
    // não recebe instrução de case (sem "regsense"), então pode devolver
    // maiúsculo pra uma imagem que é minúscula (confirmado visualmente,
    // achado 02/10/2026); se o portal validar case-sensitive, isso rejeitava
    // uma resposta com os caracteres certos só por causa da caixa.
    campo.value = resposta.toLowerCase();
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    botao.click();
    return; // próxima navegação continua o fluxo
  }

  // Formulário de emissão -- preenche e submete.
  const ddlTipo = document.getElementById('ctl00_ConteudoPrincipal_ddlTipoCertidao');
  if (ddlTipo) {
    if (jobAtual.etapa !== 'formulario_preenchido') {
      const job = await reservarTentativa(jobAtual, 'preenchendo');
      if (!job) return;

      selectComEvento(ddlTipo, '1'); // Certidão Tributária Mobiliária
      const ddlDoc = await esperarSeletor('#ctl00_ConteudoPrincipal_ddlTipoDocumento', 8_000);
      if (ddlDoc) selectComEvento(ddlDoc, 'CNPJ');

      const campoCnpj = await esperarSeletor('#ctl00_ConteudoPrincipal_txtCNPJ', 8_000);
      const imgCaptcha = await esperarSeletor('#ctl00_ConteudoPrincipal_imgCaptcha', 8_000);
      const campoCaptcha = document.getElementById('ctl00_ConteudoPrincipal_txtValorCaptcha');
      const btnEmitir = document.getElementById('ctl00_ConteudoPrincipal_btnEmitir');
      if (!campoCnpj || !imgCaptcha || !campoCaptcha || !btnEmitir) {
        return finalizar({ status: 'INDISPONIVEL', mensagem: 'Certidão Municipal São Paulo: campos do formulário não apareceram (layout pode ter mudado).' });
      }

      campoCnpj.value = job.cnpj;
      campoCnpj.dispatchEvent(new Event('input', { bubbles: true }));

      const resposta = await resolverCaptcha(imgCaptcha);
      if (!resposta) {
        // reservarTentativa() já gravou o contador acima — o próximo
        // processar() (pós-reload) já nasce respeitando o limite de
        // tentativas automaticamente.
        location.reload();
        return;
      }

      campoCaptcha.value = resposta.toLowerCase();
      campoCaptcha.dispatchEvent(new Event('input', { bubbles: true }));
      await chrome.storage.local.set({ [ESTADO_KEY]: { ...job, etapa: 'formulario_preenchido' } });
      btnEmitir.click();
      return; // próxima navegação é o resultado
    }

    // ddlTipo existe mas etapa já era "formulario_preenchido": o submit deu
    // em algum erro de validação e voltou pro mesmo form sem navegar pra
    // uma página de resultado de verdade (ex. captcha rejeitado).
    const job = await reservarTentativa(jobAtual, 'reenviando');
    if (!job) return;
    await chrome.storage.local.set({ [ESTADO_KEY]: { ...job, etapa: null } });
    location.reload();
    return;
  }

  // Sem o formulário na tela e sem o desafio anti-bot -- deve ser a página
  // de resultado.
  if (!texto) {
    const job = await reservarTentativa(jobAtual, 'pagina_vazia');
    if (!job) return;
    await esperar(1_000);
    return processar(); // tenta ler de novo antes de desistir dessa navegação
  }

  return finalizar(parseResultado(texto));
}

// background.js grava o job em chrome.storage.local ANTES de navegar pra
// essa página — toda carga (inclusive a primeira) encontra o job pronto e
// continua o fluxo sozinha, sem precisar de mensagem explícita de início.
processar().catch((err) => finalizar({ status: 'INDISPONIVEL', mensagem: `Erro no content script: ${err.message}` }));
