import { test, expect, type Page, type Route } from '@playwright/test'

// ── fixtures ────────────────────────────────────────────────────────────────

const TOKEN   = 'fake-jwt-for-e2e'
const USUARIO = { id: 'u1', nome: 'Admin E2E', email: 'admin@e2e.com', perfil: 'administrador' }

const RESULTADO_CNPJ = {
  dados: {
    cnpj: '30327128000125',
    razaoSocial: 'EVEREST GESTAO CONTABIL E EMPRESARIAL LTDA',
    nomeFantasia: 'EVEREST - ASSESSORIA CONTABIL E EMPRESARIAL',
    situacaoCadastral: 'ATIVA',
    naturezaJuridica: 'Sociedade Empresária Limitada',
    porte: 'MICRO EMPRESA',
    cnaePrincipal: { codigo: '6920601', descricao: 'Atividades de contabilidade' },
    endereco: {
      logradouro: 'AVENIDA TANCREDO NEVES', numero: '2227', complemento: 'SUB UNIDADE 603',
      bairro: 'CAMINHO DAS ARVORES', municipio: 'SALVADOR', uf: 'BA', cep: '41820021',
    },
    email: null, telefone: '7141411675', capitalSocial: 10000,
    optanteSimples: true, optanteMei: false, dataInicioAtividade: '2018-04-28',
    socios: [{ nome: 'FLAVIA DE SOUZA PEREIRA', qualificacao: 'Sócio-Administrador', faixaEtaria: 'Entre 31 a 40 anos' }],
  },
  metadados: {
    fonte: 'BrasilAPI (origem: Receita Federal)',
    consultadoEm: '2026-06-18T12:00:00.000Z',
    observacaoDefasagem: 'Dados cadastrais de origem Receita Federal podem ter defasagem de até aproximadamente um mês.',
  },
}

const LEAD_RESPONSE = {
  id: 'lead-abc123',
  scoreCadastral: 85,
  scoreComercial: 72,
  scoreAtencao: 15,
  recomendacao: 'Empresa com bom perfil cadastral. Indicada para abordagem comercial.',
  status: 'novo',
}

const PROPOSTA_RESPONSE = {
  tipo: 'proposta',
  titulo: 'Proposta Comercial — Everest',
  cnpj: '30327128000125',
  razaoSocial: 'EVEREST GESTAO CONTABIL E EMPRESARIAL LTDA',
  scores: { cadastral: 85, comercial: 72, atencao: 15 },
  recomendacao: 'Empresa indicada para abordagem comercial.',
  resumo: 'Empresa ativa com bom histórico cadastral e perfil compatível com os serviços da Everest/FK\'s.',
  fatoresConsiderados: [
    { categoria: 'Situação Cadastral', valor: 'ATIVA', impacto: 'positivo', detalhe: 'Empresa regularmente inscrita.' },
  ],
  servicosSugeridos: ['Contabilidade completa', 'Declaração de IR'],
  proximosPassos: ['Enviar apresentação', 'Agendar reunião'],
  geradoEm: '2026-06-18T12:00:00.000Z',
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function setupAuth(page: Page) {
  await page.addInitScript(
    ({ token, usuario }) => {
      localStorage.setItem('cnpj_radar_token', token)
      localStorage.setItem('cnpj_radar_user', JSON.stringify(usuario))
    },
    { token: TOKEN, usuario: USUARIO },
  )
}

async function mockRotas(page: Page) {
  await page.route('/cnpj/30327128000125', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RESULTADO_CNPJ) }),
  )
  await page.route('/cnpj/**', (r: Route) =>
    r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'CNPJ_NAO_ENCONTRADO' }) }),
  )
  await page.route('/leads/30327128000125', (r: Route) => {
    if (r.request().method() === 'POST')
      return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(LEAD_RESPONSE) })
    return r.continue()
  })
  await page.route('/leads/lead-abc123/status', (r: Route) => {
    if (r.request().method() === 'PATCH') {
      const updated = { ...LEAD_RESPONSE, status: 'em_contato' }
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(updated) })
    }
    return r.continue()
  })
  await page.route('/leads/lead-abc123/proposta', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROPOSTA_RESPONSE) }),
  )
  // dashboard e outros endpoints que o app carrega ao iniciar
  await page.route('/dashboard', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      totalConsultasMes: 0, totalLeads: 0, totalClientes: 0, taxaConversao: 0,
      oportunidadesParadas: 0, certidoesCriticas: 0, tarefasPendentes: 0,
      historicoMensal: [], topCnaes: [], topConsultores: [],
    })
    }),
  )
  await page.route('/certidoes/alertas', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ irregulares: [], vencendo: [] }) }),
  )
}

// ── testes ───────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await setupAuth(page)
  await mockRotas(page)
})

test('renderiza a tela de consulta após login simulado', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('CNPJ da empresa')).toBeVisible()
  await expect(page.getByRole('button', { name: /Consultar CNPJ/i })).toBeVisible()
})

test('exibe resultado após consulta bem-sucedida', async ({ page }) => {
  await page.goto('/')
  await page.fill('#cnpj-input', '30327128000125')
  await page.click('button[type=submit]')
  await expect(page.getByText('EVEREST GESTAO CONTABIL E EMPRESARIAL LTDA')).toBeVisible()
  await expect(page.getByText('EVEREST - ASSESSORIA CONTABIL E EMPRESARIAL')).toBeVisible()
  await expect(page.getByText('BrasilAPI (origem: Receita Federal)')).toBeVisible()
})

test('exibe erro específico para CNPJ não encontrado', async ({ page }) => {
  await page.goto('/')
  await page.fill('#cnpj-input', '11222333000181')
  await page.click('button[type=submit]')
  await expect(page.getByRole('alert')).toContainText('CNPJ não encontrado na base consultada.')
})

test('exibe erro para campo vazio', async ({ page }) => {
  await page.goto('/')
  await page.click('button[type=submit]')
  await expect(page.getByRole('alert')).toContainText('Informe o CNPJ para consultar.')
})

test('botão Consultar fica desabilitado durante operação em andamento', async ({ page }) => {
  // Atrasa a resposta para verificar estado de loading
  await page.route('/cnpj/30327128000125', async (r: Route) => {
    await new Promise(res => setTimeout(res, 300))
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RESULTADO_CNPJ) })
  })
  await page.goto('/')
  await page.fill('#cnpj-input', '30327128000125')
  await page.click('button[type=submit]')
  await expect(page.getByRole('button', { name: /Consultar CNPJ/i })).toBeDisabled()
  await expect(page.getByText('EVEREST GESTAO CONTABIL E EMPRESARIAL LTDA')).toBeVisible()
  await expect(page.getByRole('button', { name: /Consultar CNPJ/i })).toBeEnabled()
})

test('fluxo completo: consultar → salvar lead → ver scores', async ({ page }) => {
  await page.goto('/')

  // 1. Consultar
  await page.fill('#cnpj-input', '30327128000125')
  await page.click('button[type=submit]')
  await expect(page.getByText('EVEREST GESTAO CONTABIL E EMPRESARIAL LTDA')).toBeVisible()

  // 2. Salvar como lead
  await page.click('button:has-text("Salvar como lead")')
  await expect(page.getByText('Lead salvo')).toBeVisible()

  // 3. Scores visíveis na aba scores (ativa automaticamente após save)
  await expect(page.getByText('Score Cadastral')).toBeVisible()
  await expect(page.getByText('85')).toBeVisible()
  await expect(page.getByText('Score Comercial')).toBeVisible()
  await expect(page.getByText('Empresa com bom perfil cadastral')).toBeVisible()
})

test('fluxo completo: consultar → salvar lead → gerar proposta → ver modal', async ({ page }) => {
  await page.goto('/')

  // 1. Consultar
  await page.fill('#cnpj-input', '30327128000125')
  await page.click('button[type=submit]')
  await expect(page.getByText('EVEREST GESTAO CONTABIL E EMPRESARIAL LTDA')).toBeVisible()

  // 2. Salvar como lead
  await page.click('button:has-text("Salvar como lead")')
  await expect(page.getByText('Lead salvo')).toBeVisible()

  // 3. Gerar proposta
  await expect(page.getByRole('button', { name: /Gerar proposta/i })).toBeVisible()
  await page.click('button:has-text("Gerar proposta")')

  // 4. Modal de proposta aberto
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('EVEREST GESTAO CONTABIL E EMPRESARIAL LTDA')
  await expect(page.getByRole('dialog')).toContainText('Proposta Comercial')
})

test('atualizar status do lead via select', async ({ page }) => {
  await page.goto('/')
  await page.fill('#cnpj-input', '30327128000125')
  await page.click('button[type=submit]')
  await expect(page.getByText('EVEREST GESTAO CONTABIL E EMPRESARIAL LTDA')).toBeVisible()

  await page.click('button:has-text("Salvar como lead")')
  await expect(page.getByText('Lead salvo')).toBeVisible()

  // Muda status via select
  await page.selectOption('#lead-status', 'em_contato')
  await expect(page.locator('#lead-status')).toHaveValue('em_contato')
})

test('nova consulta zera estado do lead anterior', async ({ page }) => {
  await page.goto('/')

  // Primeira consulta + salvar lead
  await page.fill('#cnpj-input', '30327128000125')
  await page.click('button[type=submit]')
  await expect(page.getByText('EVEREST GESTAO CONTABIL E EMPRESARIAL LTDA')).toBeVisible()
  await page.click('button:has-text("Salvar como lead")')
  await expect(page.getByText('Lead salvo')).toBeVisible()

  // Segunda consulta — deve limpar o estado do lead
  await page.fill('#cnpj-input', '11222333000181')
  await page.click('button[type=submit]')

  // Resultado anterior sumiu, erro exibido para CNPJ não encontrado
  await expect(page.getByText('EVEREST GESTAO CONTABIL E EMPRESARIAL LTDA')).not.toBeVisible()
  await expect(page.getByRole('alert')).toContainText('CNPJ não encontrado')
})
