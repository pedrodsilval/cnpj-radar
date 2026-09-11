// Extrai os campos do PGDAS-D que interessam pro alerta de enquadramento
// ME -> EPP a partir do texto puro do PDF (pdf-parse). Layout calibrado com
// um recibo real do PGDAS-D (Simples Nacional) — os rótulos abaixo ("RBT12",
// "CNPJ Matriz", "Período de Apuração") são fixos no gerador oficial do
// programa, então servem de âncora estável mesmo com pequenas variações de
// espaçamento entre versões/anos.

export interface PgdasExtraido {
  cnpjDeclarado: string;
  periodoApuracao: string; // 'YYYY-MM'
  rbt12: number;
  receitaBrutaMes: number | null;
}

// "1.810.171,94" -> 1810171.94
function parseValorBr(valor: string): number {
  return Number(valor.replace(/\./g, '').replace(',', '.'));
}

export function parsePgdasTexto(texto: string): PgdasExtraido {
  const cnpjMatch = texto.match(/CNPJ Matriz:\s*([\d.\/-]+)/);
  if (!cnpjMatch) {
    throw new Error('Não encontrei o "CNPJ Matriz" no PDF — não parece ser um recibo de PGDAS-D válido.');
  }
  const cnpjDeclarado = cnpjMatch[1].replace(/\D/g, '');

  const periodoMatch = texto.match(/Período de Apuração:\s*\d{2}\/(\d{2})\/(\d{4})/);
  if (!periodoMatch) {
    throw new Error('Não encontrei o "Período de Apuração" no PDF.');
  }
  const periodoApuracao = `${periodoMatch[2]}-${periodoMatch[1]}`;

  // "Receita bruta acumulada nos doze meses anteriores\nao PA (RBT12) 1.810.171,94 0,00 1.810.171,94"
  // — três números na ordem Mercado Interno / Mercado Externo / Total; o
  // valor que interessa pro limite legal (LC 123/2006) é o Total.
  const rbt12Match = texto.match(/RBT12\)\s*([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/);
  if (!rbt12Match) {
    throw new Error('Não encontrei o RBT12 no PDF — verifique se é a página 1 do recibo (Discriminativo de Receitas).');
  }
  const rbt12 = parseValorBr(rbt12Match[3]);

  const rpaMatch = texto.match(/Receita Bruta do PA \(RPA\) - Competência\s*([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/);
  const receitaBrutaMes = rpaMatch ? parseValorBr(rpaMatch[3]) : null;

  return { cnpjDeclarado, periodoApuracao, rbt12, receitaBrutaMes };
}

// Limites do Simples Nacional (LC 123/2006, art. 3º) — ME até R$360k/ano,
// excesso de até 20% só reenquadra pra EPP a partir de janeiro do ano
// seguinte (art. 3º §9º); excesso acima de 20% reenquadra de imediato,
// a partir do mês seguinte ao que ultrapassou (art. 3º §9º-A).
export const LIMITE_ME = 360_000;
export const LIMITE_ME_COM_EXCESSO_20 = LIMITE_ME * 1.2;

export type TipoAlertaEnquadramento = 'IMEDIATO' | 'PROXIMO_ANO';

export interface AlertaEnquadramento {
  tipo: TipoAlertaEnquadramento;
  rbt12: number;
  excedente: number;
  periodoApuracao: string;
}

export function calcularAlertaEnquadramento(porte: string | null, rbt12: number, periodoApuracao: string): AlertaEnquadramento | null {
  if (!porte || !/micro\s*empresa|^\s*me\s*$/i.test(porte)) return null;
  if (rbt12 <= LIMITE_ME) return null;

  return {
    tipo: rbt12 > LIMITE_ME_COM_EXCESSO_20 ? 'IMEDIATO' : 'PROXIMO_ANO',
    rbt12,
    excedente: rbt12 - LIMITE_ME,
    periodoApuracao,
  };
}
