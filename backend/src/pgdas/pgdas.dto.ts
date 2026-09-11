export interface PgdasDeclaracaoPublica {
  id: string;
  periodoApuracao: string;
  rbt12: number;
  receitaBrutaMes: number | null;
  nomeArquivo: string;
  criadoEm: Date;
}

export interface AlertaEnquadramentoPublico {
  empresaId: string;
  cnpj: string;
  razaoSocial: string;
  porte: string | null;
  tipo: 'IMEDIATO' | 'PROXIMO_ANO';
  rbt12: number;
  excedente: number;
  periodoApuracao: string;
}
