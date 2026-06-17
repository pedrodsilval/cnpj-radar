import { useState } from 'react'
import { CertidoesTab } from './CertidoesTab'
import { CredenciaisTab } from './CredenciaisTab'
import { AlertasTab, useContagemAlertas } from './AlertasTab'
import { PainelTab } from './PainelTab'
import { LoginPage } from './LoginPage'
import { UsuariosTab } from './UsuariosTab'
import { DashboardTab } from './DashboardTab'
import { TarefasTab } from './TarefasTab'
import { estaLogado, getUsuario, limparSessao, apiFetch, type UsuarioLogado } from './auth'

// --- Types ---

interface DadosCnpj {
  cnpj: string
  razaoSocial: string
  nomeFantasia: string | null
  situacaoCadastral: string | null
  naturezaJuridica: string | null
  porte: string | null
  cnaePrincipal: { codigo: string; descricao: string } | null
  endereco: {
    logradouro: string | null
    numero: string | null
    complemento: string | null
    bairro: string | null
    municipio: string | null
    uf: string | null
    cep: string | null
  }
  email: string | null
  telefone: string | null
  capitalSocial: number | null
  optanteSimples: boolean | null
  optanteMei: boolean | null
  dataInicioAtividade: string | null
  socios: Array<{ nome: string; qualificacao: string | null; faixaEtaria: string | null }>
}

interface Metadados {
  fonte: string
  consultadoEm: string
  observacaoDefasagem: string
  simulado?: boolean
}

interface ResultadoSucesso {
  dados: DadosCnpj
  metadados: Metadados
}

interface LeadData {
  id: string
  scoreCadastral: number | null
  scoreComercial: number | null
  scoreAtencao: number | null
  recomendacao: string | null
  status: string
}

interface PropostaData {
  tipo: 'proposta' | 'diagnostico'
  titulo: string
  cnpj: string
  razaoSocial: string
  scores: { cadastral: number | null; comercial: number | null; atencao: number | null }
  recomendacao: string | null
  resumo: string
  proximosPassos: string[]
  geradoEm: string
}

type Tab = 'cadastro' | 'scores' | 'socios' | 'certidoes'
type Vista = 'cnpj' | 'alertas' | 'painel' | 'config' | 'usuarios' | 'dashboard' | 'tarefas'
type StatusLead = 'idle' | 'salvando' | 'salvo' | 'erro'
type StatusAtualizacao = 'idle' | 'salvando' | 'erro'

const LEAD_STATUS_LABELS: Record<string, string> = {
  novo:              'Novo',
  em_contato:        'Em contato',
  proposta_enviada:  'Proposta enviada',
  convertido:        'Convertido',
  descartado:        'Descartado',
}

// --- Constants ---

const MENSAGENS_ERRO: Record<string, string> = {
  CNPJ_INVALIDO:        'CNPJ inválido — verifique os dígitos.',
  CNPJ_NAO_ENCONTRADO:  'CNPJ não encontrado na base consultada.',
  SERVICO_INDISPONIVEL: 'Serviço externo indisponível. Tente novamente.',
  TIMEOUT:              'Consulta excedeu o tempo limite. Tente novamente.',
  RESPOSTA_INCOMPLETA:  'Dados retornados incompletos. Tente novamente.',
  RATE_LIMIT:           'Limite de consultas atingido. Aguarde um momento.',
  ERRO_DE_REDE:         'Não foi possível consultar. Verifique sua conexão.',
}

// --- Helpers ---

function sanitizar(cnpj: string): string {
  return cnpj.replace(/[.\-/\s]/g, '').toUpperCase()
}

function formatarCnpj(cnpj: string): string {
  if (/^\d{14}$/.test(cnpj)) {
    return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  }
  return cnpj
}

function formatarCapital(valor: number | null): string {
  if (valor === null) return 'Não informado'
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// --- Sub-components ---

function StatusBadge({ status, onDark = false }: { status: string | null; onDark?: boolean }) {
  if (!status) return null
  const ativa = status === 'ATIVA'
  if (onDark) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-display font-bold uppercase tracking-wide bg-white/15 border border-white/25 text-white"
        aria-label={`Situação cadastral: ${status}`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${ativa ? 'bg-emerald-300' : 'bg-red-300'}`} aria-hidden="true" />
        {status}
      </span>
    )
  }
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-display font-bold uppercase tracking-wide ${
        ativa ? 'bg-accent/10 text-accent' : 'bg-danger/10 text-danger'
      }`}
      aria-label={`Situação cadastral: ${status}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${ativa ? 'bg-accent' : 'bg-danger'}`} aria-hidden="true" />
      {status}
    </span>
  )
}

function ScoreCard({
  label,
  value,
  tipo,
}: {
  label: string
  value: number | null
  tipo: 'cadastral' | 'comercial' | 'atencao'
}) {
  if (value === null) {
    return (
      <div className="p-4 rounded-lg border border-gray-100 bg-gray-50">
        <p className="font-display font-bold text-gray-400 text-xs uppercase tracking-widest mb-2">{label}</p>
        <p className="font-display font-black text-3xl text-gray-300">—</p>
      </div>
    )
  }

  const isAlert = tipo === 'atencao' && value >= 40
  const isHigh  = tipo !== 'atencao' && value >= 70
  const numColor  = isAlert ? 'text-danger' : isHigh ? 'text-accent' : 'text-depth'
  const barColor  = isAlert ? 'bg-danger'   : isHigh ? 'bg-accent'   : 'bg-primary'

  return (
    <div className="p-4 rounded-lg border border-gray-100">
      <p className="font-display font-bold text-gray-500 text-xs uppercase tracking-widest mb-2">{label}</p>
      <p className={`font-display font-black text-3xl mb-3 ${numColor}`}>{value}</p>
      <div
        className="w-full bg-gray-100 rounded-full h-2"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${value} de 100`}
      >
        <div
          className={`${barColor} h-2 rounded-full transition-all duration-500`}
          style={{ width: `${value}%` }}
        />
      </div>
      <p className="text-gray-400 text-xs mt-1.5 font-body">{value}/100</p>
    </div>
  )
}

function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-4 py-3 border-b border-gray-50 last:border-0">
      <dt className="font-display font-medium text-gray-500 text-sm w-44 flex-shrink-0">{label}</dt>
      <dd className="font-body text-depth text-sm flex-1">{value ?? 'Não informado'}</dd>
    </div>
  )
}

function NavItem({
  label,
  active = false,
  disabled = false,
  badge,
  onClick,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  badge?: number
  onClick?: () => void
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-display font-medium transition-colors flex items-center justify-between ${
        active
          ? 'bg-primary text-surface'
          : disabled
          ? 'text-surface/20 cursor-not-allowed'
          : 'text-surface/60 hover:text-surface hover:bg-surface/10'
      }`}
    >
      <span>{label}</span>
      {disabled && (
        <span className="text-xs font-body text-surface/20" aria-hidden="true">
          em breve
        </span>
      )}
      {!disabled && badge != null && badge > 0 && (
        <span className="ml-auto bg-red-500 text-white text-[10px] font-display font-black px-1.5 py-0.5 rounded-full leading-none">
          {badge}
        </span>
      )}
    </button>
  )
}

function PropostaModal({ dados, leadId, onFechar }: { dados: PropostaData; leadId: string; onFechar: () => void }) {
  const isProposta   = dados.tipo === 'proposta'
  const corTipo      = isProposta ? 'text-accent' : 'text-primary'
  const bgTipo       = isProposta ? 'bg-accent/10 border-accent/20' : 'bg-primary/10 border-primary/20'
  const [baixando, setBaixando] = useState(false)

  async function baixarPdf() {
    setBaixando(true)
    try {
      const res = await apiFetch(`/leads/${leadId}/proposta/pdf`)
      if (!res.ok) return
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `proposta-${dados.cnpj}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setBaixando(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-depth/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={dados.titulo}
    >
      <div className="bg-white rounded-[28px] shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between gap-4">
          <div>
            <span className={`text-xs font-display font-bold uppercase tracking-widest ${corTipo}`}>
              {isProposta ? 'Proposta Comercial' : 'Diagnóstico Inicial'}
            </span>
            <h2 className="font-display font-black text-depth text-lg leading-tight mt-0.5">
              {dados.razaoSocial}
            </h2>
          </div>
          <button
            onClick={onFechar}
            aria-label="Fechar"
            className="text-gray-400 hover:text-depth transition-colors mt-0.5 flex-shrink-0"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Resumo */}
          <div className={`rounded-lg border px-4 py-3 ${bgTipo}`}>
            <p className="font-body text-depth text-sm">{dados.resumo}</p>
          </div>

          {/* Scores resumidos */}
          <div className="grid grid-cols-3 gap-3">
            {(
              [
                { label: 'Cadastral', val: dados.scores.cadastral, tipo: 'cadastral' },
                { label: 'Comercial', val: dados.scores.comercial, tipo: 'comercial' },
                { label: 'Atenção',   val: dados.scores.atencao,   tipo: 'atencao'   },
              ] as const
            ).map(({ label, val, tipo }) => {
              const isAlert = tipo === 'atencao' && (val ?? 0) >= 40
              const isHigh  = tipo !== 'atencao' && (val ?? 0) >= 70
              const color   = isAlert ? 'text-danger' : isHigh ? 'text-accent' : 'text-depth'
              return (
                <div key={label} className="text-center p-3 rounded-lg border border-gray-100">
                  <p className="text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">{label}</p>
                  <p className={`font-display font-black text-2xl ${color}`}>{val ?? '—'}</p>
                </div>
              )
            })}
          </div>

          {/* Recomendação */}
          {dados.recomendacao && (
            <div>
              <p className="text-xs font-display font-bold text-gray-500 uppercase tracking-widest mb-2">Recomendação</p>
              <p className="font-body text-depth text-sm">{dados.recomendacao}</p>
            </div>
          )}

          {/* Próximos passos */}
          <div>
            <p className="text-xs font-display font-bold text-gray-500 uppercase tracking-widest mb-2">Próximos passos</p>
            <ol className="space-y-2">
              {dados.proximosPassos.map((passo, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary font-display font-bold text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <span className="font-body text-depth text-sm">{passo}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
          <p className="text-xs text-gray-400 font-body">
            Gerado em {new Date(dados.geradoEm).toLocaleString('pt-BR')}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={baixarPdf}
              disabled={baixando}
              className="text-sm font-display font-bold px-4 py-2 rounded-lg border border-gray-200 text-gray-500 hover:text-depth hover:border-gray-300 transition-colors disabled:opacity-50"
            >
              {baixando ? 'Gerando…' : 'Baixar PDF'}
            </button>
            <button
              onClick={onFechar}
              className="bg-primary text-surface font-display font-bold text-sm px-5 py-2 rounded-lg hover:bg-depth transition-colors"
            >
              Fechar
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}

// --- Modal alterar senha ---

function ModalAlterarSenha({ usuario, onFechar }: { usuario: UsuarioLogado; onFechar: () => void }) {
  const [senhaAtual, setSenhaAtual]   = useState('')
  const [novaSenha, setNovaSenha]     = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [salvando, setSalvando]       = useState(false)
  const [erro, setErro]               = useState<string | null>(null)
  const [ok, setOk]                   = useState(false)

  async function salvar() {
    if (!senhaAtual) { setErro('Informe a senha atual.'); return }
    if (novaSenha.length < 8) { setErro('A nova senha deve ter pelo menos 8 caracteres.'); return }
    if (novaSenha !== confirmacao) { setErro('As senhas não coincidem.'); return }
    setSalvando(true); setErro(null)
    try {
      // Verifica senha atual fazendo login
      const check = await apiFetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: usuario.email, senha: senhaAtual }),
      })
      if (!check.ok) { setErro('Senha atual incorreta.'); return }

      const res = await apiFetch(`/auth/usuarios/${usuario.id}/senha`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senha: novaSenha }),
      })
      if (!res.ok) { setErro('Não foi possível alterar a senha.'); return }
      setOk(true)
    } catch { setErro('Erro de rede.') }
    finally { setSalvando(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-depth/60 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-[24px] shadow-2xl w-full max-w-sm">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-display font-black text-depth text-base">Alterar senha</h2>
          <button onClick={onFechar} aria-label="Fechar" className="text-gray-400 hover:text-depth transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </button>
        </div>

        {ok ? (
          <div className="px-6 py-8 text-center">
            <p className="font-display font-bold text-accent text-base mb-1">Senha alterada com sucesso!</p>
            <p className="text-gray-400 text-sm font-body mb-5">Use a nova senha no próximo acesso.</p>
            <button onClick={onFechar} className="bg-primary text-white font-display font-bold text-sm px-6 py-2.5 rounded-xl hover:bg-depth transition-colors">
              Fechar
            </button>
          </div>
        ) : (
          <>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">Senha atual</label>
                <input type="password" value={senhaAtual} onChange={e => setSenhaAtual(e.target.value)} autoComplete="current-password"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"/>
              </div>
              <div>
                <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">Nova senha</label>
                <input type="password" value={novaSenha} onChange={e => setNovaSenha(e.target.value)} autoComplete="new-password"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"/>
              </div>
              <div>
                <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">Confirmar nova senha</label>
                <input type="password" value={confirmacao} onChange={e => setConfirmacao(e.target.value)} autoComplete="new-password"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"/>
              </div>
              {erro && <p className="text-xs text-danger font-display font-bold">⚠ {erro}</p>}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={onFechar} className="text-sm font-display font-bold text-gray-500 px-4 py-2 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors">Cancelar</button>
              <button onClick={salvar} disabled={salvando} className="text-sm font-display font-bold bg-primary text-white px-5 py-2 rounded-lg hover:bg-depth transition-colors disabled:opacity-50">
                {salvando ? 'Salvando…' : 'Alterar senha'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// --- App ---

function App() {
  const [logado, setLogado]                         = useState(estaLogado)
  const [modalSenha, setModalSenha]                 = useState(false)
  const [vista, setVista]                           = useState<Vista>('cnpj')
  const [cnpj, setCnpj]                             = useState('')
  const [erro, setErro]                             = useState<string | null>(null)
  const [carregando, setCarregando]                 = useState(false)
  const [resultado, setResultado]                   = useState<ResultadoSucesso | null>(null)
  const [cnpjConsultado, setCnpjConsultado]         = useState('')
  const [activeTab, setActiveTab]                   = useState<Tab>('cadastro')
  const [statusLead, setStatusLead]                 = useState<StatusLead>('idle')
  const [erroLead, setErroLead]                     = useState<string | null>(null)
  const [leadData, setLeadData]                     = useState<LeadData | null>(null)
  const [statusAtualizacao, setStatusAtualizacao]   = useState<StatusAtualizacao>('idle')
  const [erroStatus, setErroStatus]                 = useState<string | null>(null)
  const [propostaCarregando, setPropostaCarregando] = useState(false)
  const [propostaDados, setPropostaDados]           = useState<PropostaData | null>(null)
  const [propostaLeadId, setPropostaLeadId]         = useState<string | null>(null)
  const contagemAlertas                             = useContagemAlertas()

  const usuario = getUsuario()

  if (!logado) {
    return <LoginPage onLogado={() => setLogado(true)} />
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    setResultado(null)
    setStatusLead('idle')
    setErroLead(null)
    setLeadData(null)
    setStatusAtualizacao('idle')
    setErroStatus(null)
    setPropostaDados(null)
    setActiveTab('cadastro')

    const limpo = sanitizar(cnpj)
    if (!limpo) {
      setErro('Informe o CNPJ para consultar.')
      return
    }

    setCarregando(true)
    try {
      const res  = await apiFetch(`/cnpj/${limpo}`)
      const json = await res.json()

      if (!res.ok || 'error' in json) {
        const codigo = (json as { error: string }).error
        setErro(MENSAGENS_ERRO[codigo] ?? 'Não foi possível consultar agora. Tente novamente.')
        return
      }

      setResultado(json as ResultadoSucesso)
      setCnpjConsultado(limpo)
    } catch {
      setErro('Não foi possível consultar agora. Verifique sua conexão.')
    } finally {
      setCarregando(false)
    }
  }

  async function handleGerarProposta() {
    if (!leadData) return
    setPropostaCarregando(true)
    try {
      const res = await apiFetch(`/leads/${leadData.id}/proposta`)
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setErroStatus((json as { message?: string }).message ?? 'Não foi possível gerar a proposta.')
        return
      }
      setPropostaDados((await res.json()) as PropostaData)
      setPropostaLeadId(leadData.id)
    } catch {
      setErroStatus('Não foi possível gerar a proposta. Verifique sua conexão.')
    } finally {
      setPropostaCarregando(false)
    }
  }

  async function handleAtualizarStatus(novoStatus: string) {
    if (!leadData) return
    setStatusAtualizacao('salvando')
    setErroStatus(null)
    try {
      const res = await apiFetch(`/leads/${leadData.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: novoStatus }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setErroStatus((json as { message?: string }).message ?? 'Não foi possível atualizar o status.')
        setStatusAtualizacao('erro')
        return
      }
      const atualizado = (await res.json()) as LeadData
      setLeadData(atualizado)
      setStatusAtualizacao('idle')
    } catch {
      setErroStatus('Não foi possível atualizar o status. Verifique sua conexão.')
      setStatusAtualizacao('erro')
    }
  }

  async function handleSalvarLead() {
    setStatusLead('salvando')
    setErroLead(null)
    try {
      const res = await apiFetch(`/leads/${cnpjConsultado}`, { method: 'POST' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setErroLead((json as { message?: string }).message ?? 'Não foi possível salvar o lead.')
        setStatusLead('erro')
        return
      }
      const lead = (await res.json()) as LeadData
      setLeadData(lead)
      setStatusLead('salvo')
      setActiveTab('scores')
    } catch {
      setErroLead('Não foi possível salvar o lead. Verifique sua conexão.')
      setStatusLead('erro')
    }
  }

  const dados = resultado?.dados
  const meta  = resultado?.metadados

  const enderecoCompleto = dados
    ? [
        dados.endereco.logradouro,
        dados.endereco.numero,
        dados.endereco.bairro,
        dados.endereco.municipio && dados.endereco.uf
          ? `${dados.endereco.municipio}/${dados.endereco.uf}`
          : dados.endereco.municipio ?? dados.endereco.uf,
        dados.endereco.cep ? `CEP ${dados.endereco.cep}` : null,
      ]
        .filter(Boolean)
        .join(', ') || null
    : null

  return (
    <>
    {propostaDados && (
      <PropostaModal dados={propostaDados} leadId={propostaLeadId!} onFechar={() => { setPropostaDados(null); setPropostaLeadId(null) }} />
    )}
    {modalSenha && usuario && (
      <ModalAlterarSenha usuario={usuario} onFechar={() => setModalSenha(false)} />
    )}
    <div className="flex h-screen bg-gradient-to-br from-[#020617] via-[#172554] to-[#0f172a] font-body overflow-hidden">

      {/* ── Sidebar ── */}
      <aside
        className="w-60 bg-depth flex-shrink-0 flex flex-col"
        aria-label="Navegação principal"
      >
        <div className="px-5 py-6 border-b border-surface/10">
          <p className="font-display font-black text-accent text-xl leading-none">Radar</p>
          <p className="font-display font-medium text-surface/60 text-sm mt-0.5">Everest/FK's</p>
        </div>

        <nav className="flex-1 p-3 space-y-0.5">
          <NavItem label="Dashboard"      active={vista === 'dashboard'} onClick={() => setVista('dashboard')} />
          <NavItem label="Consulta CNPJ"  active={vista === 'cnpj'}      onClick={() => setVista('cnpj')} />
          <NavItem
            label="Alertas"
            active={vista === 'alertas'}
            onClick={() => setVista('alertas')}
            badge={contagemAlertas}
          />
          <NavItem label="Tarefas"        active={vista === 'tarefas'}   onClick={() => setVista('tarefas')} />
          <NavItem label="Painel de Mercado" active={vista === 'painel'} onClick={() => setVista('painel')} />
          <NavItem label="Leads"         disabled />
          <NavItem label="Clientes"      disabled />
          <NavItem label="Relatórios"    disabled />
        </nav>

        <div className="p-3 border-t border-surface/10 space-y-0.5">
          <NavItem label="Configurações" active={vista === 'config'} onClick={() => setVista('config')} />
          {usuario?.perfil === 'administrador' && (
            <NavItem label="Usuários" active={vista === 'usuarios'} onClick={() => setVista('usuarios')} />
          )}
          <div className="px-3 pt-2 space-y-1">
            <button
              onClick={() => setModalSenha(true)}
              className="w-full text-left text-surface/40 hover:text-surface/70 text-xs font-body transition-colors truncate"
              title="Alterar senha"
            >
              {usuario?.nome ?? 'Usuário'}
            </button>
            <div className="flex items-center justify-between">
              <span className="text-surface/20 text-[10px] font-body capitalize">{usuario?.perfil ?? ''}</span>
              <button
                onClick={() => { limparSessao(); setLogado(false) }}
                className="text-surface/30 hover:text-surface/60 text-xs font-body transition-colors"
                aria-label="Sair"
              >
                Sair
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Header */}
        <header className="bg-depth h-14 flex-shrink-0 flex items-center px-8 border-b border-surface/10">
          <h1 className="font-display font-bold text-surface text-sm tracking-wide">
            {vista === 'config'    ? 'Configurações'        :
             vista === 'alertas'   ? 'Alertas de Certidões' :
             vista === 'painel'    ? 'Painel de Mercado'    :
             vista === 'usuarios'  ? 'Usuários'             :
             vista === 'dashboard' ? 'Dashboard'            :
             vista === 'tarefas'   ? 'Tarefas'              :
                                     'Consulta de CNPJ'}
          </h1>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-8 space-y-5">

          {/* Vista Dashboard */}
          {vista === 'dashboard' && <DashboardTab />}

          {/* Vista Tarefas */}
          {vista === 'tarefas' && <TarefasTab />}

          {/* Vista Configurações */}
          {vista === 'config' && <CredenciaisTab />}

          {/* Vista Usuários (admin only) */}
          {vista === 'usuarios' && <UsuariosTab />}

          {/* Vista Alertas */}
          {vista === 'alertas' && <AlertasTab />}

          {/* Vista Painel */}
          {vista === 'painel' && <PainelTab />}

          {/* Vista CNPJ */}
          {vista === 'cnpj' && <>

          {/* Search card */}
          <section className="bg-white rounded-[28px] shadow-2xl p-7" aria-label="Consultar CNPJ">
            <h2 className="font-display font-bold text-depth text-xs uppercase tracking-widest mb-4 opacity-50">
              Nova Consulta
            </h2>
            <form onSubmit={handleSubmit} noValidate className="flex gap-3 flex-wrap items-start">
              <div className="flex-1 min-w-48">
                <label htmlFor="cnpj-input" className="sr-only">CNPJ da empresa</label>
                <input
                  id="cnpj-input"
                  type="text"
                  value={cnpj}
                  onChange={(e) => setCnpj(e.target.value)}
                  placeholder="00.000.000/0000-00"
                  aria-describedby={erro ? 'cnpj-erro' : undefined}
                  aria-invalid={erro ? true : undefined}
                  className="w-full border border-gray-200 rounded-2xl px-5 py-3.5 font-body text-depth text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent focus:shadow-[0_0_0_4px_rgba(37,99,235,0.15)] placeholder:text-gray-400"
                />
              </div>
              <button
                type="submit"
                disabled={carregando}
                aria-busy={carregando || undefined}
                className="bg-accent text-depth font-display font-bold text-sm px-7 py-3.5 rounded-2xl hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {carregando ? 'Consultando…' : 'Consultar CNPJ'}
              </button>
            </form>

            {erro && (
              <p
                id="cnpj-erro"
                role="alert"
                aria-live="assertive"
                className="mt-3 text-sm text-danger flex items-center gap-1.5"
              >
                <span aria-hidden="true">⚠</span>
                {erro}
              </p>
            )}
          </section>

          {/* Simulado banner */}
          {meta?.simulado && (
            <div
              role="status"
              className="bg-danger/10 border border-danger/20 rounded-lg px-4 py-3 flex items-center gap-2"
            >
              <span aria-hidden="true" className="text-danger">⚠</span>
              <p className="text-danger text-sm font-display font-bold">
                Dados simulados — não usar para decisão real.
              </p>
            </div>
          )}

          {/* Result card */}
          {resultado && dados && meta && (
            <section
              className="bg-white rounded-[28px] shadow-2xl overflow-hidden"
              aria-label="Resultado da consulta"
            >

              {/* Company header */}
              <div className="px-6 py-6 bg-gradient-to-r from-[#1e40af] to-[#2563eb]">
                <h2 className="font-display font-black text-white text-xl leading-tight">
                  {dados.razaoSocial}
                </h2>
                {dados.nomeFantasia && (
                  <p className="text-blue-200 text-sm mt-0.5">{dados.nomeFantasia}</p>
                )}
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <span className="font-body text-blue-200 text-xs">{formatarCnpj(cnpjConsultado)}</span>
                  <StatusBadge status={dados.situacaoCadastral} onDark />
                  {dados.porte && (
                    <span className="text-xs text-blue-200 font-body">{dados.porte}</span>
                  )}
                  {dados.endereco.municipio && dados.endereco.uf && (
                    <span className="text-xs text-blue-200 font-body">
                      {dados.endereco.municipio}/{dados.endereco.uf}
                    </span>
                  )}
                </div>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-gray-100" role="tablist">
                {(['cadastro', 'scores', 'socios', 'certidoes'] as Tab[]).map((tab) => {
                  const labels: Record<Tab, string> = {
                    cadastro:  'Cadastro',
                    scores:    'Scores',
                    socios:    'Sócios',
                    certidoes: 'Certidões',
                  }
                  return (
                    <button
                      key={tab}
                      role="tab"
                      aria-selected={activeTab === tab}
                      onClick={() => setActiveTab(tab)}
                      className={`px-6 py-3 text-sm font-display font-bold transition-colors border-b-2 ${
                        activeTab === tab
                          ? 'border-accent text-depth'
                          : 'border-transparent text-gray-400 hover:text-depth'
                      }`}
                    >
                      {labels[tab]}
                      {tab === 'scores' && statusLead === 'salvo' && (
                        <span
                          className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-accent"
                          aria-label="scores disponíveis"
                        />
                      )}
                      {tab === 'certidoes' && (
                        <span
                          className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-primary"
                          aria-label="certidões disponíveis"
                        />
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Tab content */}
              <div className="p-6" role="tabpanel">

                {activeTab === 'cadastro' && (
                  <dl>
                    <DataRow label="CNPJ"              value={formatarCnpj(dados.cnpj)} />
                    <DataRow label="Natureza jurídica" value={dados.naturezaJuridica} />
                    <DataRow
                      label="CNAE principal"
                      value={
                        dados.cnaePrincipal
                          ? `${dados.cnaePrincipal.codigo} — ${dados.cnaePrincipal.descricao}`
                          : null
                      }
                    />
                    <DataRow label="Endereço"          value={enderecoCompleto} />
                    <DataRow label="E-mail"            value={dados.email} />
                    <DataRow label="Telefone"          value={dados.telefone} />
                    <DataRow label="Capital social"    value={formatarCapital(dados.capitalSocial)} />
                    <DataRow
                      label="Início de atividade"
                      value={
                        dados.dataInicioAtividade
                          ? new Date(dados.dataInicioAtividade + 'T00:00:00').toLocaleDateString('pt-BR')
                          : null
                      }
                    />
                    <DataRow
                      label="Simples Nacional"
                      value={
                        dados.optanteSimples === null
                          ? null
                          : dados.optanteSimples
                          ? 'Optante'
                          : 'Não optante'
                      }
                    />
                    <DataRow
                      label="MEI"
                      value={
                        dados.optanteMei === null ? null : dados.optanteMei ? 'Sim' : 'Não'
                      }
                    />
                  </dl>
                )}

                {activeTab === 'scores' && (
                  leadData ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <ScoreCard label="Score Cadastral"   value={leadData.scoreCadastral}  tipo="cadastral" />
                        <ScoreCard label="Score Comercial"   value={leadData.scoreComercial}  tipo="comercial" />
                        <ScoreCard label="Score de Atenção"  value={leadData.scoreAtencao}    tipo="atencao"   />
                      </div>
                      {leadData.recomendacao && (
                        <div className="p-4 bg-primary/5 rounded-lg border border-primary/10">
                          <p className="font-display font-bold text-depth text-xs uppercase tracking-widest mb-1">
                            Recomendação
                          </p>
                          <p className="font-body text-depth text-sm">{leadData.recomendacao}</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-10">
                      <p className="text-gray-400 text-sm font-body">
                        Salve como lead para calcular os scores desta empresa.
                      </p>
                    </div>
                  )
                )}

                {activeTab === 'socios' && (
                  dados.socios.length > 0 ? (
                    <ul className="divide-y divide-gray-50">
                      {dados.socios.map((s, i) => (
                        <li key={i} className="py-3 flex items-start gap-3">
                          <div
                            className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5"
                            aria-hidden="true"
                          >
                            <span className="font-display font-bold text-primary text-xs">
                              {s.nome.charAt(0)}
                            </span>
                          </div>
                          <div>
                            <p className="font-display font-bold text-depth text-sm">{s.nome}</p>
                            {s.qualificacao && (
                              <p className="text-gray-500 text-xs mt-0.5">{s.qualificacao}</p>
                            )}
                            {s.faixaEtaria && (
                              <p className="text-gray-400 text-xs">{s.faixaEtaria}</p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-gray-400 text-sm text-center py-10 font-body">
                      Quadro societário não informado.
                    </p>
                  )
                )}

                {activeTab === 'certidoes' && (
                  <CertidoesTab cnpj={cnpjConsultado} />
                )}

              </div>

              {/* Actions + metadata */}
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
                <div className="flex flex-wrap items-center gap-3 mb-3">

                  {statusLead !== 'salvo' ? (
                    <button
                      type="button"
                      onClick={handleSalvarLead}
                      disabled={statusLead === 'salvando'}
                      aria-busy={statusLead === 'salvando' || undefined}
                      className="bg-primary text-surface font-display font-bold text-sm px-5 py-2 rounded-lg hover:bg-depth transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {statusLead === 'salvando' ? 'Salvando…' : 'Salvar como lead'}
                    </button>
                  ) : (
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="flex items-center gap-1.5 text-sm font-display font-bold text-accent">
                        <span aria-hidden="true">✓</span>
                        Lead salvo
                      </span>
                      <div className="flex items-center gap-2">
                        <label htmlFor="lead-status" className="text-xs font-display font-medium text-gray-500">
                          Status:
                        </label>
                        <select
                          id="lead-status"
                          value={leadData?.status ?? 'novo'}
                          disabled={statusAtualizacao === 'salvando'}
                          onChange={(e) => handleAtualizarStatus(e.target.value)}
                          aria-busy={statusAtualizacao === 'salvando' || undefined}
                          className="text-sm font-body text-depth border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50 bg-white"
                        >
                          {Object.entries(LEAD_STATUS_LABELS).map(([val, label]) => (
                            <option key={val} value={val}>{label}</option>
                          ))}
                        </select>
                        {statusAtualizacao === 'salvando' && (
                          <span className="text-xs text-gray-400 font-body" aria-live="polite">Salvando…</span>
                        )}
                      </div>
                    </div>
                  )}

                  {statusLead === 'salvo' && (
                    <button
                      type="button"
                      onClick={handleGerarProposta}
                      disabled={propostaCarregando}
                      aria-busy={propostaCarregando || undefined}
                      className="text-primary font-display font-bold text-sm px-5 py-2 rounded-lg border border-primary/30 hover:border-primary hover:bg-primary/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                      {propostaCarregando
                        ? 'Gerando…'
                        : (leadData?.scoreAtencao ?? 0) >= 40
                        ? 'Gerar diagnóstico'
                        : 'Gerar proposta'}
                    </button>
                  )}

                  <a
                    href={`/cnpj/${cnpjConsultado}/pdf`}
                    download
                    aria-label={`Baixar relatório PDF do CNPJ ${cnpjConsultado}`}
                    className="text-gray-500 font-display font-bold text-sm px-5 py-2 rounded-lg border border-gray-200 hover:border-gray-300 hover:text-depth transition-colors"
                  >
                    Baixar PDF
                  </a>

                  {statusLead === 'erro' && erroLead && (
                    <p
                      role="alert"
                      aria-live="assertive"
                      className="text-danger text-sm flex items-center gap-1"
                    >
                      <span aria-hidden="true">⚠</span>
                      {erroLead}
                    </p>
                  )}

                  {statusAtualizacao === 'erro' && erroStatus && (
                    <p
                      role="alert"
                      aria-live="assertive"
                      className="text-danger text-sm flex items-center gap-1"
                    >
                      <span aria-hidden="true">⚠</span>
                      {erroStatus}
                    </p>
                  )}
                </div>

                <p className="text-xs text-gray-400 font-body">
                  {meta.fonte} · {new Date(meta.consultadoEm).toLocaleString('pt-BR')}
                </p>
                <p className="text-xs text-gray-400 font-body mt-0.5">{meta.observacaoDefasagem}</p>
              </div>

            </section>
          )}

          </> /* fim vista cnpj */}

        </main>
      </div>
    </div>
    </>
  )
}

export default App
