// Roda em duc.prefeitura.sp.gov.br — fila de job "MUNICIPAL_SAO_PAULO".
// Diferente do fluxo da Receita (Angular SPA, sem reload de página), esse
// portal é ASP.NET WebForms clássico: clicar "Emitir" navega de verdade pra
// outra URL, derrubando qualquer contexto de script injetado antes do
// clique. Por isso esse script é um content_script DECLARADO no manifest
// (reinjeta sozinho a cada navegação dentro do site), não injetado uma vez
// via chrome.scripting.executeScript como o da Receita — e guarda o estado
// entre navegações em chrome.storage.local (chave ESTADO_KEY), não em
// variável de módulo (que morreria no reload).

const ESTADO_KEY = 'spMunicipalJob';
const API_BASE = 'https://radar.everestcontabilidade.com';
const MAX_TENTATIVAS = 4;

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

// Converte a imagem (captcha do form ou do desafio anti-bot) pra base64.
// Imagens já inline (data:) vêm prontas; a do form vem como <img src="URL">
// same-origin -- desenha num canvas pra extrair sem CORS taint.
function imagemParaBase64(img) {
  if (img.src.startsWith('data:')) return img.src;
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  canvas.getContext('2d').drawImage(img, 0, 0);
  return canvas.toDataURL('image/png');
}

async function resolverCaptcha(img) {
  const { token } = await chrome.storage.local.get('token');
  if (!token) return null;
  const imagemBase64 = imagemParaBase64(img);
  const res = await fetch(`${API_BASE}/certidoes/resolver-captcha`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ imagemBase64 }),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const json = await res.json().catch(() => ({}));
  return json.token || null;
}

function selectComEvento(el, valor) {
  el.value = valor;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

async function avancarEstado(novoEstado) {
  const { [ESTADO_KEY]: atual } = await chrome.storage.local.get(ESTADO_KEY);
  if (!atual) return;
  await chrome.storage.local.set({ [ESTADO_KEY]: { ...atual, ...novoEstado } });
}

async function finalizar(resultado) {
  await chrome.storage.local.remove(ESTADO_KEY);
  chrome.runtime.sendMessage({ type: 'RESULTADO_MUNICIPAL_SP', ...resultado }).catch(() => {});
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
  const { [ESTADO_KEY]: job } = await chrome.storage.local.get(ESTADO_KEY);
  if (!job) return; // nenhum job ativo -- script fica inerte nessa navegação

  const texto = textoVisivel();

  // Desafio anti-bot da Prodam-SP -- pode aparecer em qualquer navegação
  // dentro do site, não só na primeira (achado real 02/10/2026).
  if (/visitante leg[ií]timo/i.test(texto)) {
    const tentativa = (job.tentativa || 0) + 1;
    if (tentativa > MAX_TENTATIVAS) {
      return finalizar({ status: 'INDISPONIVEL', mensagem: 'Certidão Municipal São Paulo: desafio anti-bot da Prodam-SP reapareceu demais vezes, desisti.' });
    }
    const img = document.querySelector('img');
    const campo = document.querySelector('input[type="text"]');
    const botao = [...document.querySelectorAll('button, a, [role="button"]')].find((el) => /submit/i.test(el.textContent || ''));
    if (!img || !campo || !botao) {
      return finalizar({ status: 'INDISPONIVEL', mensagem: 'Certidão Municipal São Paulo: desafio anti-bot com layout inesperado (campo/botão não encontrado).' });
    }
    const resposta = await resolverCaptcha(img);
    if (!resposta) {
      return finalizar({ status: 'INDISPONIVEL', mensagem: 'Certidão Municipal São Paulo: não consegui resolver o captcha do desafio anti-bot (2captcha sem chave ou sem resposta).' });
    }
    await avancarEstado({ tentativa, etapa: 'desafio' });
    campo.value = resposta;
    campo.dispatchEvent(new Event('input', { bubbles: true }));
    botao.click();
    return; // próxima navegação continua o fluxo
  }

  // Formulário de emissão -- preenche e submete.
  const ddlTipo = document.getElementById('ctl00_ConteudoPrincipal_ddlTipoCertidao');
  if (ddlTipo) {
    if (job.etapa !== 'formulario_preenchido') {
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
        const tentativa = (job.tentativa || 0) + 1;
        if (tentativa > MAX_TENTATIVAS) {
          return finalizar({ status: 'INDISPONIVEL', mensagem: 'Certidão Municipal São Paulo: captcha do formulário não resolvido após várias tentativas.' });
        }
        await avancarEstado({ tentativa });
        location.reload(); // pega um captcha novo
        return;
      }

      campoCaptcha.value = resposta;
      campoCaptcha.dispatchEvent(new Event('input', { bubbles: true }));
      await avancarEstado({ etapa: 'formulario_preenchido' });
      btnEmitir.click();
      return; // próxima navegação é o resultado
    }
    // ddlTipo existe mas etapa já era "formulario_preenchido": o submit deu
    // em algum erro de validação e voltou pro mesmo form sem navegar de
    // verdade (ex. captcha rejeitado). Trata como tentativa nova.
    const tentativa = (job.tentativa || 0) + 1;
    if (tentativa > MAX_TENTATIVAS) {
      return finalizar({ status: 'INDISPONIVEL', mensagem: 'Certidão Municipal São Paulo: formulário recusou a submissão repetidamente (captcha rejeitado?).' });
    }
    await avancarEstado({ tentativa, etapa: null });
    location.reload();
    return;
  }

  // Sem o formulário na tela e sem o desafio anti-bot -- deve ser a página
  // de resultado.
  if (!texto) {
    const tentativa = (job.tentativa || 0) + 1;
    if (tentativa > MAX_TENTATIVAS) {
      return finalizar({ status: 'INDISPONIVEL', mensagem: 'Certidão Municipal São Paulo: página de resultado veio vazia repetidas vezes.' });
    }
    await avancarEstado({ tentativa });
    await esperar(1_000);
    return processar(); // tenta ler de novo antes de desistir dessa navegação
  }

  return finalizar(parseResultado(texto));
}

// background.js grava o job em chrome.storage.local ANTES de navegar pra
// essa página — toda carga (inclusive a primeira) encontra o job pronto e
// continua o fluxo sozinha, sem precisar de mensagem explícita de início.
processar().catch((err) => finalizar({ status: 'INDISPONIVEL', mensagem: `Erro no content script: ${err.message}` }));
