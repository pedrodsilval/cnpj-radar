// Roda em radar.everestcontabilidade.com — lê o token de sessão já usado
// pelo próprio app (localStorage, mesma chave que auth.ts usa) e manda pro
// background da extensão. Não pede login separado nem pede o token pro
// usuário: se ele já está logado no Radar, a extensão pareia sozinha.

const CHAVE_TOKEN = 'cnpj_radar_token';
let ultimoTokenEnviado = null;

function verificarToken() {
  let token = null;
  try {
    token = localStorage.getItem(CHAVE_TOKEN);
  } catch {
    return;
  }
  if (token === ultimoTokenEnviado) return;
  ultimoTokenEnviado = token;
  chrome.runtime.sendMessage({ type: 'PAREAR', token }).catch(() => {
    // Extensão pode ainda não estar pronta pra receber — tenta de novo no próximo ciclo.
  });
}

verificarToken();
setInterval(verificarToken, 5_000);
