// Aceita tanto o ID puro quanto uma URL completa de pasta do Drive colada
// pelo usuário (ex: https://drive.google.com/drive/u/1/folders/<id>) e
// devolve só o ID.
export function extrairIdPasta(valor: string): string {
  const match = valor.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return (match ? match[1] : valor).trim();
}
