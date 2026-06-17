import type { CnpjDadosNormalizados, CnpjMetadados, CnpjSucesso } from './cnpj.types';

// CNPJ numérico válido fixo. Somente este CNPJ aciona o mock em dev/demo.
export const CNPJ_MOCK_MAGICO = '11222333000181';

const DADOS_MOCK: CnpjDadosNormalizados = {
  cnpj: CNPJ_MOCK_MAGICO,
  razaoSocial: 'EMPRESA SIMULADA LTDA',
  nomeFantasia: null,
  situacaoCadastral: 'ATIVA',
  situacaoCadastralCodigo: 2,
  situacaoCadastralData: '2020-01-01',
  naturezaJuridica: '206-2 - Sociedade Empresária Limitada',
  tipo: 'MATRIZ',
  porte: 'ME',
  cnaePrincipal: { codigo: '6920601', descricao: 'Atividades de contabilidade' },
  cnaesSecundarios: [],
  endereco: {
    logradouro: 'RUA DAS SIMULAÇÕES',
    numero: '100',
    complemento: null,
    bairro: 'CENTRO',
    municipio: 'SALVADOR',
    uf: 'BA',
    cep: '40000000',
  },
  email: 'contato@empresasimulada.com.br',
  telefone: '7199999999',
  capitalSocial: 10000,
  optanteSimples: true,
  dataOpcaoSimples: '2020-01-15',
  dataExclusaoSimples: null,
  optanteMei: false,
  motivoSituacaoCadastral: null,
  situacaoEspecial: null,
  situacaoEspecialData: null,
  dataInicioAtividade: '2020-01-15',
  socios: [
    {
      nome: 'SÓCIO SIMULADO DA SILVA',
      qualificacao: '49-Sócio-Administrador',
      faixaEtaria: 'Entre 31 a 40 anos',
    },
  ],
};

export function getMockCnpj(simulado: boolean): CnpjSucesso {
  const metadados: CnpjMetadados = {
    fonte: 'MOCK — dados simulados (não usar para decisão real)',
    consultadoEm: new Date().toISOString(),
    observacaoDefasagem:
      'Estes dados são fictícios e gerados localmente para fins de desenvolvimento ou demonstração.',
    linksOficiais: {
      receitaFederal: 'https://www.gov.br/receitafederal',
      consultaCnpj: 'https://cnpj.receita.fazenda.gov.br/Cnpjindex.asp',
      cndFederal: 'https://solucoes.receita.fazenda.gov.br/Servicos/certidaointernet/PJ/Emitir',
      pgfn: 'https://www.regularize.pgfn.gov.br',
      fgts: 'https://consulta-crf.caixa.gov.br',
      diarioOficial: 'https://www.in.gov.br',
    },
  };

  // Em demo: inclui simulado: true para o frontend estampar o selo "dados simulados".
  // Em development: campo ausente — uso interno, sem necessidade do selo visual.
  if (simulado) {
    metadados.simulado = true;
  }

  return { dados: DADOS_MOCK, metadados };
}
