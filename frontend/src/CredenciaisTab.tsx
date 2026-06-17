import { useState, useEffect, useRef } from 'react'
import { apiFetch } from './auth'

// ─── Types ────────────────────────────────────────────────────────────────────

type CredencialTipo =
  | 'API_2CAPTCHA'
  | 'CERTIFICADO_A1'
  | 'API_INFOSIMPLES'
  | 'PORTAL_ECAC'
  | 'OUTRO'

interface Credencial {
  id: string
  tipo: CredencialTipo
  descricao: string
  valorMascarado: string
  ativo: boolean
  ultimaVerificacao: string | null
  criadoEm: string
  atualizadoEm: string
}

// ─── Config ───────────────────────────────────────────────────────────────────

const TIPO_LABELS: Record<CredencialTipo, string> = {
  API_2CAPTCHA:    '2captcha',
  CERTIFICADO_A1:  'Certificado A1',
  API_INFOSIMPLES: 'Infosimples',
  PORTAL_ECAC:     'Portal e-CAC',
  OUTRO:           'Outro',
}

const TIPO_DESCRICAO: Record<CredencialTipo, string> = {
  API_2CAPTCHA:    'API key para resolução automática de CAPTCHAs (CNDT/TST)',
  CERTIFICADO_A1:  'Certificado digital .pfx + senha para portais que exigem ICP-Brasil',
  API_INFOSIMPLES: 'API key para consultas em lote via Infosimples (Fase 2)',
  PORTAL_ECAC:     'Login e senha do Portal e-CAC (Receita Federal)',
  OUTRO:           'Credencial avulsa',
}

const TIPO_COR: Record<CredencialTipo, { badge: string; dot: string }> = {
  API_2CAPTCHA:    { badge: 'bg-violet-50 text-violet-700 border-violet-200', dot: 'bg-violet-500' },
  CERTIFICADO_A1:  { badge: 'bg-blue-50 text-blue-700 border-blue-200',       dot: 'bg-blue-500'   },
  API_INFOSIMPLES: { badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  PORTAL_ECAC:     { badge: 'bg-amber-50 text-amber-700 border-amber-200',     dot: 'bg-amber-500'  },
  OUTRO:           { badge: 'bg-gray-100 text-gray-600 border-gray-200',       dot: 'bg-gray-400'   },
}

const TIPOS_OPCOES: CredencialTipo[] = [
  'API_2CAPTCHA',
  'CERTIFICADO_A1',
  'API_INFOSIMPLES',
  'PORTAL_ECAC',
  'OUTRO',
]

// ─── TipoBadge ────────────────────────────────────────────────────────────────

function TipoBadge({ tipo }: { tipo: CredencialTipo }) {
  const cfg = TIPO_COR[tipo] ?? TIPO_COR['OUTRO']
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-display font-bold border ${cfg.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} aria-hidden="true" />
      {TIPO_LABELS[tipo] ?? tipo}
    </span>
  )
}

// ─── FormularioCampos — campos dinâmicos por tipo ─────────────────────────────

interface CamposFormulario {
  tipo: CredencialTipo
  descricao: string
  // campos simples
  chaveApi?: string
  // campos login/senha
  login?: string
  senha?: string
  // campos certificado A1
  pfxBase64?: string
  pfxNome?: string
  pfxSenha?: string
}

function camposParaValor(campos: CamposFormulario): string {
  switch (campos.tipo) {
    case 'CERTIFICADO_A1':
      return JSON.stringify({ pfxBase64: campos.pfxBase64 ?? '', senha: campos.pfxSenha ?? '' })
    case 'PORTAL_ECAC':
      return JSON.stringify({ login: campos.login ?? '', senha: campos.senha ?? '' })
    default:
      return campos.chaveApi ?? ''
  }
}

function descricaoPadrao(tipo: CredencialTipo): string {
  const mapa: Record<CredencialTipo, string> = {
    API_2CAPTCHA:    'Chave 2captcha',
    CERTIFICADO_A1:  'Certificado A1',
    API_INFOSIMPLES: 'Chave Infosimples',
    PORTAL_ECAC:     'Login e-CAC',
    OUTRO:           'Credencial',
  }
  return mapa[tipo]
}

// ─── CredenciaisTab ───────────────────────────────────────────────────────────

export function CredenciaisTab() {
  const [lista, setLista]             = useState<Credencial[]>([])
  const [carregando, setCarregando]   = useState(true)
  const [erro, setErro]               = useState<string | null>(null)
  const [mostraForm, setMostraForm]   = useState(false)
  const [editandoId, setEditandoId]   = useState<string | null>(null)
  const [salvando, setSalvando]       = useState(false)
  const [erroForm, setErroForm]       = useState<string | null>(null)
  const [removendoId, setRemovendoId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [campos, setCampos] = useState<CamposFormulario>({
    tipo: 'API_2CAPTCHA',
    descricao: descricaoPadrao('API_2CAPTCHA'),
  })

  async function carregar() {
    setCarregando(true)
    setErro(null)
    try {
      const res = await apiFetch('/credenciais')
      if (!res.ok) throw new Error('Falha ao carregar credenciais.')
      setLista((await res.json()) as Credencial[])
    } catch {
      setErro('Não foi possível carregar as credenciais. Verifique a conexão.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => { carregar() }, [])

  function abrirFormNovo() {
    setEditandoId(null)
    setCampos({ tipo: 'API_2CAPTCHA', descricao: descricaoPadrao('API_2CAPTCHA') })
    setErroForm(null)
    setMostraForm(true)
  }

  function abrirFormEdicao(c: Credencial) {
    setEditandoId(c.id)
    setCampos({ tipo: c.tipo as CredencialTipo, descricao: c.descricao })
    setErroForm(null)
    setMostraForm(true)
  }

  function fecharForm() {
    setMostraForm(false)
    setEditandoId(null)
    setErroForm(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function onTipoChange(novoTipo: CredencialTipo) {
    setCampos({ tipo: novoTipo, descricao: descricaoPadrao(novoTipo) })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function onArquivoPfx(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1] ?? ''
      setCampos((prev) => ({ ...prev, pfxBase64: base64, pfxNome: file.name }))
    }
    reader.readAsDataURL(file)
  }

  async function handleSalvar(e: React.FormEvent) {
    e.preventDefault()
    setErroForm(null)

    if (!campos.descricao.trim()) {
      setErroForm('Informe uma descrição para identificar esta credencial.')
      return
    }

    const valor = camposParaValor(campos)

    if (!editandoId && !valor) {
      setErroForm('Informe o valor da credencial.')
      return
    }

    setSalvando(true)
    try {
      if (editandoId) {
        const body: Record<string, unknown> = { descricao: campos.descricao }
        if (valor) body.valor = valor
        const res = await apiFetch(`/credenciais/${editandoId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) throw new Error('Falha ao atualizar.')
      } else {
        const res = await apiFetch('/credenciais', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tipo: campos.tipo, descricao: campos.descricao, valor }),
        })
        if (!res.ok) throw new Error('Falha ao criar.')
      }
      fecharForm()
      await carregar()
    } catch {
      setErroForm('Não foi possível salvar. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  async function handleToggleAtivo(c: Credencial) {
    try {
      await apiFetch(`/credenciais/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ativo: !c.ativo }),
      })
      await carregar()
    } catch {
      /* silencioso — status visual reverte no próximo carregar */
    }
  }

  async function handleRemover(id: string) {
    setRemovendoId(id)
    try {
      await apiFetch(`/credenciais/${id}`, { method: 'DELETE' })
      setLista((prev) => prev.filter((c) => c.id !== id))
    } catch {
      setErro('Não foi possível remover a credencial.')
    } finally {
      setRemovendoId(null)
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display font-black text-depth text-lg">Credenciais de Acesso</h2>
          <p className="text-gray-500 text-sm font-body mt-0.5">
            Chaves e certificados usados pelas automações. Valores armazenados criptografados (AES-256-GCM).
          </p>
        </div>
        <button
          onClick={abrirFormNovo}
          className="bg-accent text-depth font-display font-bold text-sm px-5 py-2.5 rounded-xl hover:bg-accent/90 transition-colors whitespace-nowrap"
        >
          + Adicionar
        </button>
      </div>

      {/* Aviso de segurança */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-2.5">
        <span className="text-amber-600 mt-0.5 flex-shrink-0" aria-hidden="true">⚠</span>
        <p className="text-amber-700 text-sm font-body">
          Credenciais são sensíveis. Valores nunca são exibidos após o cadastro.
          Para trocar uma credencial, edite e informe o novo valor.
        </p>
      </div>

      {/* Formulário inline */}
      {mostraForm && (
        <div className="bg-white rounded-[20px] border border-gray-200 shadow-sm p-6">
          <h3 className="font-display font-bold text-depth text-sm mb-4">
            {editandoId ? 'Editar Credencial' : 'Nova Credencial'}
          </h3>

          <form onSubmit={handleSalvar} noValidate className="space-y-4">

            {/* Tipo — só para criação */}
            {!editandoId && (
              <div>
                <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-widest mb-1.5">
                  Tipo
                </label>
                <select
                  value={campos.tipo}
                  onChange={(e) => onTipoChange(e.target.value as CredencialTipo)}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                >
                  {TIPOS_OPCOES.map((t) => (
                    <option key={t} value={t}>{TIPO_LABELS[t]} — {TIPO_DESCRICAO[t]}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Descrição */}
            <div>
              <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-widest mb-1.5">
                Descrição
              </label>
              <input
                type="text"
                value={campos.descricao}
                onChange={(e) => setCampos((p) => ({ ...p, descricao: e.target.value }))}
                placeholder="Ex: Chave 2captcha produção"
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent placeholder:text-gray-400"
              />
            </div>

            {/* Campos dinâmicos por tipo */}
            {!editandoId && campos.tipo === 'API_2CAPTCHA' && (
              <CampoChaveApi
                label="Chave API (2captcha)"
                placeholder="ab12cd34ef56..."
                value={campos.chaveApi ?? ''}
                onChange={(v) => setCampos((p) => ({ ...p, chaveApi: v }))}
              />
            )}

            {!editandoId && campos.tipo === 'API_INFOSIMPLES' && (
              <CampoChaveApi
                label="Chave API (Infosimples)"
                placeholder="inf_..."
                value={campos.chaveApi ?? ''}
                onChange={(v) => setCampos((p) => ({ ...p, chaveApi: v }))}
              />
            )}

            {!editandoId && campos.tipo === 'OUTRO' && (
              <CampoChaveApi
                label="Valor"
                placeholder="Valor da credencial"
                value={campos.chaveApi ?? ''}
                onChange={(v) => setCampos((p) => ({ ...p, chaveApi: v }))}
              />
            )}

            {!editandoId && campos.tipo === 'CERTIFICADO_A1' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-widest mb-1.5">
                    Arquivo .pfx / .p12
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pfx,.p12"
                    onChange={onArquivoPfx}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-display file:font-bold file:bg-primary/10 file:text-primary"
                  />
                  {campos.pfxNome && (
                    <p className="mt-1 text-xs text-emerald-600 font-body">{campos.pfxNome} carregado</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-widest mb-1.5">
                    Senha do certificado
                  </label>
                  <input
                    type="password"
                    value={campos.pfxSenha ?? ''}
                    onChange={(e) => setCampos((p) => ({ ...p, pfxSenha: e.target.value }))}
                    placeholder="••••••••"
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent placeholder:text-gray-400"
                  />
                </div>
              </div>
            )}

            {!editandoId && campos.tipo === 'PORTAL_ECAC' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-widest mb-1.5">
                    Login (CPF/CNPJ)
                  </label>
                  <input
                    type="text"
                    value={campos.login ?? ''}
                    onChange={(e) => setCampos((p) => ({ ...p, login: e.target.value }))}
                    placeholder="000.000.000-00"
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent placeholder:text-gray-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-widest mb-1.5">
                    Senha
                  </label>
                  <input
                    type="password"
                    value={campos.senha ?? ''}
                    onChange={(e) => setCampos((p) => ({ ...p, senha: e.target.value }))}
                    placeholder="••••••••"
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent placeholder:text-gray-400"
                  />
                </div>
              </div>
            )}

            {/* Aviso de edição */}
            {editandoId && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                <p className="text-gray-500 text-sm font-body">
                  O valor atual permanece inalterado. Para substituí-lo, entre em contato com o administrador
                  e recadastre a credencial.
                </p>
              </div>
            )}

            {erroForm && (
              <p role="alert" className="text-sm text-red-600 flex items-center gap-1.5">
                <span aria-hidden="true">⚠</span> {erroForm}
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={salvando}
                className="bg-primary text-surface font-display font-bold text-sm px-5 py-2.5 rounded-xl hover:bg-depth transition-colors disabled:opacity-50"
              >
                {salvando ? 'Salvando…' : editandoId ? 'Salvar alterações' : 'Cadastrar'}
              </button>
              <button
                type="button"
                onClick={fecharForm}
                className="text-gray-500 font-display font-medium text-sm px-4 py-2.5 rounded-xl hover:bg-gray-100 transition-colors"
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Erro global */}
      {erro && (
        <p role="alert" className="text-sm text-red-600 flex items-center gap-1.5">
          <span aria-hidden="true">⚠</span> {erro}
        </p>
      )}

      {/* Lista */}
      {carregando ? (
        <div className="bg-white rounded-[20px] border border-gray-100 p-8 text-center">
          <p className="text-gray-400 text-sm font-body">Carregando credenciais…</p>
        </div>
      ) : lista.length === 0 ? (
        <div className="bg-white rounded-[20px] border border-gray-100 p-10 text-center">
          <p className="font-display font-bold text-gray-400 text-sm mb-1">Nenhuma credencial cadastrada</p>
          <p className="text-gray-400 text-xs font-body">
            Adicione uma chave 2captcha para habilitar a automação da CNDT.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-[20px] border border-gray-100 divide-y divide-gray-50 overflow-hidden">
          {lista.map((c) => (
            <CredencialRow
              key={c.id}
              credencial={c}
              removendo={removendoId === c.id}
              onEditar={() => abrirFormEdicao(c)}
              onToggleAtivo={() => handleToggleAtivo(c)}
              onRemover={() => handleRemover(c.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── CampoChaveApi ────────────────────────────────────────────────────────────

function CampoChaveApi({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
}) {
  const [visivel, setVisivel] = useState(false)
  return (
    <div>
      <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-widest mb-1.5">
        {label}
      </label>
      <div className="relative">
        <input
          type={visivel ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full border border-gray-200 rounded-xl px-4 py-2.5 pr-10 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent placeholder:text-gray-400"
        />
        <button
          type="button"
          onClick={() => setVisivel((v) => !v)}
          aria-label={visivel ? 'Ocultar valor' : 'Mostrar valor'}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-depth transition-colors"
        >
          {visivel ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
          )}
        </button>
      </div>
    </div>
  )
}

// ─── CredencialRow ────────────────────────────────────────────────────────────

function CredencialRow({
  credencial: c,
  removendo,
  onEditar,
  onToggleAtivo,
  onRemover,
}: {
  credencial: Credencial
  removendo: boolean
  onEditar: () => void
  onToggleAtivo: () => void
  onRemover: () => void
}) {
  const [confirmando, setConfirmando] = useState(false)

  function handleRemoverClick() {
    if (!confirmando) {
      setConfirmando(true)
      return
    }
    onRemover()
    setConfirmando(false)
  }

  const tipo = c.tipo as CredencialTipo

  return (
    <div className="px-5 py-4 flex items-center gap-4">
      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <TipoBadge tipo={tipo} />
          <span className="font-display font-bold text-depth text-sm truncate">{c.descricao}</span>
          {!c.ativo && (
            <span className="text-xs font-display font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full border border-gray-200">
              inativa
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1">
          <span className="font-mono text-gray-400 text-xs tracking-widest">{c.valorMascarado}</span>
          <span className="text-gray-300 text-xs">·</span>
          <span className="text-gray-400 text-xs font-body">
            {new Date(c.atualizadoEm).toLocaleDateString('pt-BR')}
          </span>
        </div>
      </div>

      {/* Ações */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Toggle ativo */}
        <button
          onClick={onToggleAtivo}
          aria-label={c.ativo ? 'Desativar credencial' : 'Ativar credencial'}
          title={c.ativo ? 'Desativar' : 'Ativar'}
          className={`w-8 h-5 rounded-full transition-colors relative flex-shrink-0 ${
            c.ativo ? 'bg-emerald-400' : 'bg-gray-200'
          }`}
        >
          <span
            className={`block w-3.5 h-3.5 bg-white rounded-full shadow absolute top-0.5 transition-transform ${
              c.ativo ? 'translate-x-3' : 'translate-x-0.5'
            }`}
          />
        </button>

        <button
          onClick={onEditar}
          className="text-xs font-display font-bold text-gray-500 hover:text-primary px-2.5 py-1.5 rounded-lg hover:bg-primary/5 transition-colors"
        >
          Editar
        </button>

        {confirmando ? (
          <div className="flex items-center gap-1">
            <button
              onClick={handleRemoverClick}
              disabled={removendo}
              className="text-xs font-display font-bold text-red-600 px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              {removendo ? '…' : 'Confirmar'}
            </button>
            <button
              onClick={() => setConfirmando(false)}
              className="text-xs font-display font-medium text-gray-400 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Não
            </button>
          </div>
        ) : (
          <button
            onClick={handleRemoverClick}
            className="text-xs font-display font-bold text-gray-400 hover:text-red-600 px-2.5 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
          >
            Remover
          </button>
        )}
      </div>
    </div>
  )
}
