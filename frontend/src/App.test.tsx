import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import App from './App'

const RESULTADO_SUCESSO = {
  dados: {
    cnpj: '30327128000125',
    razaoSocial: 'EVEREST GESTAO CONTABIL E EMPRESARIAL LTDA',
    nomeFantasia: 'EVEREST - ASSESSORIA CONTABIL E EMPRESARIAL',
    situacaoCadastral: 'ATIVA',
    naturezaJuridica: 'Sociedade Empresária Limitada',
    porte: 'MICRO EMPRESA',
    cnaePrincipal: { codigo: '6920601', descricao: 'Atividades de contabilidade' },
    endereco: {
      logradouro: 'AVENIDA TANCREDO NEVES',
      numero: '2227',
      complemento: 'SUB UNIDADE 603',
      bairro: 'CAMINHO DAS ARVORES',
      municipio: 'SALVADOR',
      uf: 'BA',
      cep: '41820021',
    },
    email: null,
    telefone: '7141411675',
    capitalSocial: 10000,
    optanteSimples: true,
    optanteMei: false,
    dataInicioAtividade: '2018-04-28',
    socios: [
      { nome: 'FLAVIA DE SOUZA PEREIRA', qualificacao: 'Sócio-Administrador', faixaEtaria: 'Entre 31 a 40 anos' },
    ],
  },
  metadados: {
    fonte: 'BrasilAPI (origem: Receita Federal)',
    consultadoEm: '2026-06-08T23:00:00.000Z',
    observacaoDefasagem: 'Dados cadastrais de origem Receita Federal podem ter defasagem de até aproximadamente um mês.',
  },
}

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(global, 'fetch').mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response)
}

describe('App', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renderiza o formulário com input e botão', () => {
    render(<App />)
    expect(screen.getByLabelText(/CNPJ da empresa/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Consultar CNPJ/i })).toBeInTheDocument()
  })

  it('exibe erro ao submeter com campo vazio', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /Consultar CNPJ/i }))
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o CNPJ para consultar.')
  })

  it('remove máscara antes de chamar a API', async () => {
    const fetchSpy = mockFetch(200, RESULTADO_SUCESSO)
    render(<App />)
    await userEvent.type(screen.getByLabelText(/CNPJ da empresa/i), '30.327.128/0001-25')
    await userEvent.click(screen.getByRole('button', { name: /Consultar CNPJ/i }))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith('/cnpj/30327128000125'))
  })

  it('exibe razão social e nome fantasia após consulta bem-sucedida', async () => {
    mockFetch(200, RESULTADO_SUCESSO)
    render(<App />)
    await userEvent.type(screen.getByLabelText(/CNPJ da empresa/i), '30327128000125')
    await userEvent.click(screen.getByRole('button', { name: /Consultar CNPJ/i }))
    await waitFor(() => {
      expect(screen.getByText('EVEREST GESTAO CONTABIL E EMPRESARIAL LTDA')).toBeInTheDocument()
      expect(screen.getByText('EVEREST - ASSESSORIA CONTABIL E EMPRESARIAL')).toBeInTheDocument()
    })
  })

  it('exibe link de PDF com CNPJ correto após consulta bem-sucedida', async () => {
    mockFetch(200, RESULTADO_SUCESSO)
    render(<App />)
    await userEvent.type(screen.getByLabelText(/CNPJ da empresa/i), '30327128000125')
    await userEvent.click(screen.getByRole('button', { name: /Consultar CNPJ/i }))
    await waitFor(() => {
      const link = screen.getByRole('link', { name: /Baixar.*PDF/i })
      expect(link).toHaveAttribute('href', '/cnpj/30327128000125/pdf')
    })
  })

  it('exibe procedência nos metadados', async () => {
    mockFetch(200, RESULTADO_SUCESSO)
    render(<App />)
    await userEvent.type(screen.getByLabelText(/CNPJ da empresa/i), '30327128000125')
    await userEvent.click(screen.getByRole('button', { name: /Consultar CNPJ/i }))
    await waitFor(() => {
      expect(screen.getByText(/BrasilAPI \(origem: Receita Federal\)/)).toBeInTheDocument()
    })
  })

  it('exibe aviso de dados simulados quando simulado: true', async () => {
    const mock = { ...RESULTADO_SUCESSO, metadados: { ...RESULTADO_SUCESSO.metadados, simulado: true } }
    mockFetch(200, mock)
    render(<App />)
    await userEvent.type(screen.getByLabelText(/CNPJ da empresa/i), '30327128000125')
    await userEvent.click(screen.getByRole('button', { name: /Consultar CNPJ/i }))
    await waitFor(() => {
      expect(screen.getByText(/DADOS SIMULADOS/i)).toBeInTheDocument()
    })
  })

  const casosDeErro: Array<[string, number, unknown, string]> = [
    ['CNPJ_INVALIDO',          400, { error: 'CNPJ_INVALIDO' },          'CNPJ inválido — verifique os dígitos.'],
    ['CNPJ_NAO_ENCONTRADO',    404, { error: 'CNPJ_NAO_ENCONTRADO' },    'CNPJ não encontrado na base consultada.'],
    ['SERVICO_INDISPONIVEL',   503, { error: 'SERVICO_INDISPONIVEL' },   'Serviço externo indisponível. Tente novamente.'],
    ['TIMEOUT',                504, { error: 'TIMEOUT' },                'Consulta excedeu o tempo limite. Tente novamente.'],
    ['RESPOSTA_INCOMPLETA',    502, { error: 'RESPOSTA_INCOMPLETA' },    'Dados retornados incompletos. Tente novamente.'],
    ['RATE_LIMIT',             429, { error: 'RATE_LIMIT' },             'Limite de consultas atingido. Aguarde um momento.'],
    ['ERRO_DE_REDE',           502, { error: 'ERRO_DE_REDE' },           'Não foi possível consultar. Verifique sua conexão.'],
  ]

  casosDeErro.forEach(([codigo, status, body, mensagemEsperada]) => {
    it(`exibe mensagem específica para ${codigo}`, async () => {
      mockFetch(status, body)
      render(<App />)
      await userEvent.type(screen.getByLabelText(/CNPJ da empresa/i), '11222333000181')
      await userEvent.click(screen.getByRole('button', { name: /Consultar CNPJ/i }))
      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(mensagemEsperada)
      })
    })
  })

  it('exibe mensagem de erro ao falhar a requisição por exceção de rede', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Network error'))
    render(<App />)
    await userEvent.type(screen.getByLabelText(/CNPJ da empresa/i), '11222333000181')
    await userEvent.click(screen.getByRole('button', { name: /Consultar CNPJ/i }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível consultar agora. Verifique sua conexão.')
    })
  })
})
