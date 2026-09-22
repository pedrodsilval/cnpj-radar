function formatarRelativo(timestamp) {
  if (!timestamp) return 'nunca';
  const min = Math.round((Date.now() - timestamp) / 60_000);
  if (min < 1) return 'agora mesmo';
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.round(h / 24)}d`;
}

async function atualizarTela() {
  const dados = await chrome.runtime.sendMessage({ type: 'STATUS_POPUP' });

  const pareado = !!dados.token;
  document.getElementById('pontoPareamento').className = `ponto ${pareado ? 'ok' : 'alerta'}`;
  document.getElementById('statusPareamento').textContent = pareado
    ? 'conectado'
    : 'aguardando login no Radar';

  document.getElementById('ultimaExecucao').textContent = formatarRelativo(dados.ultimaExecucao);

  if (dados.ultimoResultado) {
    const r = dados.ultimoResultado;
    document.getElementById('ultimoResultado').textContent = `${r.status} (${formatarRelativo(r.em)})`;
  }
}

document.getElementById('btnVerificar').addEventListener('click', async () => {
  const btn = document.getElementById('btnVerificar');
  const msg = document.getElementById('msg');
  btn.disabled = true;
  msg.textContent = 'Verificando fila... isso pode abrir uma aba e levar alguns minutos.';
  const resp = await chrome.runtime.sendMessage({ type: 'VERIFICAR_AGORA' });
  msg.textContent = resp && resp.ok ? 'Verificação concluída.' : 'Erro ao verificar — veja o console da extensão.';
  btn.disabled = false;
  atualizarTela();
});

atualizarTela();
