// Injetado no "mundo principal" da página (world: "MAIN") — precisa rodar
// no mesmo contexto JS que o script da própria Receita, porque
// URL.createObjectURL é chamado por ELES, não por nós. Um content script
// isolado (o padrão) não veria essa chamada.
//
// Guarda o Blob de cada URL criada (não só a URL) — assim não precisa
// re-buscar a blob: URL depois, que só é válida dentro dessa mesma aba/
// documento. Manda o Blob pro script isolado via CustomEvent, que o DOM
// compartilha entre os dois mundos mesmo com JS isolado.
(function () {
  if (window.__cnpjRadarPatched) return;
  window.__cnpjRadarPatched = true;

  const original = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (obj) {
    const url = original(obj);
    try {
      window.dispatchEvent(new CustomEvent('cnpjRadarBlobCriado', { detail: { url, blob: obj } }));
    } catch {
      // Blob não clonável por algum motivo — ignora, o fallback de download continua tentando.
    }
    return url;
  };
})();
