export type CnpjErrorCode =
  | 'CNPJ_INVALIDO'
  | 'CNPJ_NAO_ENCONTRADO'
  | 'RATE_LIMIT'
  | 'SERVICO_INDISPONIVEL'
  | 'TIMEOUT'
  | 'ERRO_DE_REDE'
  | 'RESPOSTA_INCOMPLETA';

export interface CnpjErro {
  error: CnpjErrorCode;
}

export interface LinksOficiais {
  receitaFederal: string;
  consultaCnpj: string;
  cndFederal: string;
  pgfn: string;
  fgts: string;
  diarioOficial: string;
}

export interface CnpjMetadados {
  fonte: string;
  consultadoEm: string;
  observacaoDefasagem: string;
  linksOficiais: LinksOficiais;
  // Presente somente em respostas mock (ambiente demo). Ausente em dados reais.
  simulado?: true;
}

export interface CnpjDadosNormalizados {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  situacaoCadastral: string;
  situacaoCadastralCodigo: number | null;
  situacaoCadastralData: string | null;
  naturezaJuridica: string | null;
  tipo: string | null;
  porte: string | null;
  cnaePrincipal: { codigo: string; descricao: string } | null;
  cnaesSecundarios: Array<{ codigo: string; descricao: string }>;
  endereco: {
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    municipio: string | null;
    uf: string | null;
    cep: string | null;
  };
  email: string | null;
  telefone: string | null;
  capitalSocial: number | null;
  optanteSimples: boolean | null;
  dataOpcaoSimples: string | null;
  dataExclusaoSimples: string | null;
  optanteMei: boolean | null;
  motivoSituacaoCadastral: string | null;
  situacaoEspecial: string | null;
  situacaoEspecialData: string | null;
  dataInicioAtividade: string | null;
  socios: Array<{
    nome: string;
    qualificacao: string | null;
    faixaEtaria: string | null;
  }>;
}

export interface CnpjSucesso {
  dados: CnpjDadosNormalizados;
  metadados: CnpjMetadados;
}

export type ResultadoConsulta = CnpjSucesso | CnpjErro;
