// Orquestra tudo: pareamento (token vindo do content-pareamento.js), fila
// de jobs (poll periódico) e a navegação entre sites reais (aquecimento)
// antes de abrir a Receita — reproduz o único teste controlado que já
// diferenciou sucesso de erro 023 nesse hCaptcha (03/09/2026, ver memória
// do projeto cnpj-radar). Espaça as tentativas de verdade: uma rajada
// automatizada em pouco tempo parece "gastar" a confiança acumulada
// (achado de 22/09/2026).

const API_BASE = 'https://radar.everestcontabilidade.com';
const POLL_ALARM = 'cnpj-radar-poll';
const MIN_MS_ENTRE_TENTATIVAS = 2 * 60 * 60 * 1000; // 2h — espaçamento de segurança
const SITES_AQUECIMENTO = ['https://www.google.com', 'https://www.uol.com.br', 'https://www.gov.br'];
const URL_RECEITA = 'https://servicos.receitafederal.gov.br/servico/certidoes/';

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 15 });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 15 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) tentarProcessarJob().catch((err) => console.error('[cnpj-radar]', err));
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'PAREAR') {
    chrome.storage.local.set({ token: msg.token }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'STATUS_POPUP') {
    chrome.storage.local.get(['token', 'ultimaExecucao', 'ultimoResultado']).then(sendResponse);
    return true;
  }
  if (msg.type === 'VERIFICAR_AGORA') {
    // Clique manual do usuário — não é rajada automatizada, ignora o espaçamento mínimo.
    tentarProcessarJob({ ignorarEspacamento: true }).then(() => sendResponse({ ok: true })).catch((err) => sendResponse({ ok: false, erro: String(err) }));
    return true;
  }
  // RESULTADO_CND é tratado dentro de processarViaTab (listener local, não aqui).
});

function aguardarNavegacaoCompleta(tabId, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    let resolvido = false;
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        resolvido = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(true);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      if (!resolvido) { chrome.tabs.onUpdated.removeListener(listener); resolve(false); }
    }, timeoutMs);
  });
}

async function navegarEEsperar(tabId, url) {
  await chrome.tabs.update(tabId, { url });
  await aguardarNavegacaoCompleta(tabId);
}

async function tentarProcessarJob({ ignorarEspacamento = false } = {}) {
  const { token, ultimaExecucao } = await chrome.storage.local.get(['token', 'ultimaExecucao']);
  if (!token) return; // extensão instalada mas ainda não pareada (usuário não abriu o Radar logado)

  if (!ignorarEspacamento && ultimaExecucao && Date.now() - ultimaExecucao < MIN_MS_ENTRE_TENTATIVAS) return;

  const job = await fetch(`${API_BASE}/certidoes/jobs/proximo`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  if (!job) return; // fila vazia

  await chrome.storage.local.set({ ultimaExecucao: Date.now() });

  let tab;
  try {
    tab = await chrome.tabs.create({ url: 'about:blank', active: false });

    // Aquecimento — mesma sequência do teste que funcionou em 03/09/2026.
    for (const url of SITES_AQUECIMENTO) {
      await navegarEEsperar(tab.id, url);
      await new Promise((r) => setTimeout(r, 1_500));
    }

    await navegarEEsperar(tab.id, URL_RECEITA);

    // Injeta o interceptador de blob no mundo principal ANTES do script de
    // automação — precisa estar ativo antes do clique em "Emitir Certidão".
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-receita-main.js'], world: 'MAIN' });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-receita.js'] });

    const resultado = await new Promise((resolve) => {
      const listener = (msg, sender) => {
        if (sender.tab && sender.tab.id === tab.id && msg.type === 'RESULTADO_CND') {
          chrome.runtime.onMessage.removeListener(listener);
          resolve(msg);
        }
      };
      chrome.runtime.onMessage.addListener(listener);
      chrome.tabs.sendMessage(tab.id, { type: 'INICIAR', cnpj: job.cnpj }).catch(() => {});
      setTimeout(() => {
        chrome.runtime.onMessage.removeListener(listener);
        resolve({ status: 'INDISPONIVEL', mensagem: 'Timeout (3min) esperando o content script responder.' });
      }, 180_000);
    });

    const fd = new FormData();
    fd.append('status', resultado.status);
    fd.append('mensagem', resultado.mensagem || '');
    if (resultado.pdfBase64) {
      const bytes = Uint8Array.from(atob(resultado.pdfBase64), (c) => c.charCodeAt(0));
      fd.append('pdf', new Blob([bytes], { type: 'application/pdf' }), `cnd-federal-${job.cnpj}.pdf`);
    }

    await fetch(`${API_BASE}/certidoes/jobs/${job.jobId}/resultado`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });

    await chrome.storage.local.set({ ultimoResultado: { status: resultado.status, mensagem: resultado.mensagem, em: Date.now() } });
  } catch (err) {
    console.error('[cnpj-radar] erro processando job:', err);
  } finally {
    if (tab) chrome.tabs.remove(tab.id).catch(() => {});
  }
}
