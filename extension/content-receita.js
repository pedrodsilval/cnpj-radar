// Roda em servicos.receitafederal.gov.br — automatiza o mesmo fluxo já
// validado em backend/src/certidoes/certidoes-scraper.service.ts
// (consultarCndFederalHeadedLocal): clica "Pessoa Jurídica", preenche o
// CNPJ, clica "Emitir Certidão", espera o processamento assíncrono e lê o
// resultado. A diferença é que aqui quem "é o navegador real" é o próprio
// Chrome do usuário — não precisa simular nada.

let blobCapturado = null;
window.addEventListener('cnpjRadarBlobCriado', (e) => {
  blobCapturado = e.detail.blob;
});

function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function textoVisivel(el) {
  return (el.innerText || el.textContent || '').trim();
}

// Acha o primeiro elemento clicável (button, a, [role=button]) cujo texto
// bate exatamente ou contém o texto procurado.
function buscarClicavelPorTexto(texto, exato = false) {
  const candidatos = document.querySelectorAll('button, a, [role="button"]');
  for (const el of candidatos) {
    const t = textoVisivel(el);
    if (exato ? t === texto : t.includes(texto)) return el;
  }
  return null;
}

async function esperarElementoPorTexto(texto, exato = false, timeoutMs = 15_000) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    const el = buscarClicavelPorTexto(texto, exato);
    if (el) return el;
    await esperar(300);
  }
  return null;
}

async function esperarSeletor(seletor, timeoutMs = 15_000) {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    const el = document.querySelector(seletor);
    if (el && el.offsetParent !== null) return el;
    await esperar(300);
  }
  return null;
}

function blobParaBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const resultado = reader.result;
      // data:application/pdf;base64,XXXX — só interessa a parte depois da vírgula
      resolve(resultado.slice(resultado.indexOf(',') + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function extrairData(texto) {
  const m = texto.match(/v[aá]lid[oa]\s+at[eé]\D{0,20}(\d{2})\/(\d{2})\/(\d{4})/i);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

async function processarCnd(cnpj) {
  // Clica no aviso de cookies se aparecer (perfil já pode ter aceitado antes).
  const aceitar = buscarClicavelPorTexto('Aceitar', true);
  if (aceitar) aceitar.click();
  await esperar(500);

  const pj = await esperarElementoPorTexto('Pessoa Jurídica', true, 15_000);
  if (!pj) return { status: 'INDISPONIVEL', mensagem: 'Não achei o botão "Pessoa Jurídica" — o site pode ter mudado de layout.' };
  pj.click();

  const campoCnpj = await esperarSeletor('input[name="niContribuinte"]', 15_000);
  if (!campoCnpj) return { status: 'INDISPONIVEL', mensagem: 'Formulário de CNPJ não apareceu.' };

  campoCnpj.focus();
  // Simula digitação de verdade (dispara os eventos que frameworks reativos esperam).
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(campoCnpj, '');
  campoCnpj.dispatchEvent(new Event('input', { bubbles: true }));
  for (const char of cnpj) {
    setter.call(campoCnpj, campoCnpj.value + char);
    campoCnpj.dispatchEvent(new Event('input', { bubbles: true }));
    await esperar(60);
  }
  campoCnpj.dispatchEvent(new Event('change', { bubbles: true }));
  campoCnpj.blur();
  await esperar(600);

  const emitir = await esperarElementoPorTexto('Emitir Certidão', true, 8_000);
  if (!emitir) return { status: 'INDISPONIVEL', mensagem: 'Botão "Emitir Certidão" não apareceu.' };
  emitir.click();
  await esperar(3_000);

  // Se já existe certidão válida, o site pergunta antes de emitir uma nova.
  const modalValida = buscarClicavelPorTexto('Certidão Válida Encontrada');
  if (modalValida) {
    const emitirNova = await esperarElementoPorTexto('Emitir Nova Certidão', true, 8_000);
    if (emitirNova) { emitirNova.click(); await esperar(3_000); }
  }

  // Emissão é assíncrona — espera sair do estado "Aguarde"/"analisando".
  let texto = textoVisivel(document.body);
  for (let tentativa = 0; tentativa < 12 && /aguarde|analisando/i.test(texto); tentativa++) {
    await esperar(3_000);
    texto = textoVisivel(document.body);
  }

  const textoLower = texto.toLowerCase();

  if (textoLower.includes('emitida com sucesso')) {
    // Dá um tempinho pro blob (se houver) ser criado antes de ler.
    await esperar(1_500);
    const validade = extrairData(texto);
    const resultado = {
      status: 'REGULAR',
      mensagem: 'Certidão de Débitos Relativos a Créditos Tributários Federais e à Dívida Ativa da União emitida.',
      validade,
    };
    if (blobCapturado) {
      resultado.pdfBase64 = await blobParaBase64(blobCapturado);
    }
    return resultado;
  }

  if (/n(ã|a)o tem direito|existem pend(ê|e)ncias|d(é|e)bitos? pendentes/i.test(texto)) {
    return { status: 'IRREGULAR', mensagem: `Empresa não tem direito à certidão negativa. Resposta do site: ${texto.slice(0, 300)}` };
  }

  return { status: 'INDISPONIVEL', mensagem: `Não foi possível confirmar a emissão. Resposta do site: ${texto.slice(0, 400)}` };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'INICIAR') return;
  processarCnd(msg.cnpj)
    .then((resultado) => chrome.runtime.sendMessage({ type: 'RESULTADO_CND', ...resultado }))
    .catch((err) => chrome.runtime.sendMessage({ type: 'RESULTADO_CND', status: 'INDISPONIVEL', mensagem: `Erro no content script: ${err.message}` }));
  sendResponse({ ok: true });
});
