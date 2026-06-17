import { useState, useEffect } from 'react'
import { authHeaders } from './auth'

interface Usuario {
  id: string
  nome: string
  email: string
  perfil: string
  ativo: boolean
  criadoEm: string
}

const PERFIL_LABELS: Record<string, string> = {
  administrador: 'Administrador',
  comercial:     'Comercial',
  financeiro:    'Financeiro',
  consultor:     'Consultor',
  leitura:       'Leitura',
}

interface ModalNovoProps {
  onSalvo: () => void
  onFechar: () => void
}

function ModalNovoUsuario({ onSalvo, onFechar }: ModalNovoProps) {
  const [nome, setNome]     = useState('')
  const [email, setEmail]   = useState('')
  const [senha, setSenha]   = useState('')
  const [perfil, setPerfil] = useState('consultor')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro]     = useState<string | null>(null)

  async function salvar() {
    if (!nome.trim() || !email.trim() || !senha) { setErro('Preencha todos os campos.'); return }
    setSalvando(true)
    setErro(null)
    try {
      const res = await fetch('/auth/usuarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ nome, email, senha, perfil }),
      })
      const json = await res.json() as { message?: string }
      if (!res.ok) { setErro(json.message ?? 'Não foi possível criar o usuário.'); return }
      onSalvo()
    } catch { setErro('Erro de rede.') }
    finally { setSalvando(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-depth/60 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-[24px] shadow-2xl w-full max-w-md">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-display font-black text-depth text-base">Novo usuário</h2>
          <button onClick={onFechar} aria-label="Fechar" className="text-gray-400 hover:text-depth transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {(['Nome', 'E-mail'] as const).map((campo, i) => (
            <div key={campo}>
              <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">{campo}</label>
              <input
                type={i === 1 ? 'email' : 'text'}
                value={i === 0 ? nome : email}
                onChange={e => i === 0 ? setNome(e.target.value) : setEmail(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"
              />
            </div>
          ))}
          <div>
            <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">Senha inicial</label>
            <input
              type="password"
              value={senha}
              onChange={e => setSenha(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"
            />
          </div>
          <div>
            <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">Perfil</label>
            <select
              value={perfil}
              onChange={e => setPerfil(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"
            >
              {Object.entries(PERFIL_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          {erro && <p className="text-xs text-danger font-display font-bold">⚠ {erro}</p>}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onFechar} className="text-sm font-display font-bold text-gray-500 px-4 py-2 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors">Cancelar</button>
          <button
            onClick={salvar}
            disabled={salvando}
            className="text-sm font-display font-bold bg-primary text-white px-5 py-2 rounded-lg hover:bg-depth transition-colors disabled:opacity-50"
          >
            {salvando ? 'Criando…' : 'Criar usuário'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function UsuariosTab() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro]         = useState<string | null>(null)
  const [modalAberto, setModalAberto] = useState(false)

  async function carregar() {
    setCarregando(true)
    setErro(null)
    try {
      const res = await fetch('/auth/usuarios', { headers: authHeaders() })
      if (!res.ok) { setErro('Sem permissão ou falha ao carregar usuários.'); return }
      setUsuarios(await res.json() as Usuario[])
    } catch { setErro('Erro de rede.') }
    finally { setCarregando(false) }
  }

  async function desativar(id: string) {
    if (!confirm('Desativar este usuário?')) return
    await fetch(`/auth/usuarios/${id}`, { method: 'DELETE', headers: authHeaders() })
    await carregar()
  }

  useEffect(() => { void carregar() }, [])

  if (carregando) return <div className="py-10 text-center text-gray-400 text-sm font-body">Carregando…</div>
  if (erro) return <div className="py-10 text-center text-danger text-sm font-display font-bold" role="alert">⚠ {erro}</div>

  return (
    <>
      {modalAberto && (
        <ModalNovoUsuario
          onFechar={() => setModalAberto(false)}
          onSalvo={() => { setModalAberto(false); void carregar() }}
        />
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display font-black text-depth text-lg">Usuários</h2>
            <p className="text-gray-400 font-body text-sm mt-0.5">Gerenciamento de acesso à plataforma.</p>
          </div>
          <button
            onClick={() => setModalAberto(true)}
            className="bg-primary text-white font-display font-bold text-sm px-5 py-2 rounded-lg hover:bg-depth transition-colors"
          >
            Novo usuário
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-display font-bold text-gray-400 uppercase tracking-wide">Nome</th>
                <th className="text-left px-4 py-3 text-xs font-display font-bold text-gray-400 uppercase tracking-wide">E-mail</th>
                <th className="text-left px-4 py-3 text-xs font-display font-bold text-gray-400 uppercase tracking-wide">Perfil</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {usuarios.length === 0 ? (
                <tr><td colSpan={4} className="text-center py-10 text-gray-400 font-body text-sm">Nenhum usuário cadastrado.</td></tr>
              ) : usuarios.map(u => (
                <tr key={u.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-display font-bold text-depth text-sm">{u.nome}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-500 font-body text-sm">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-display font-bold px-2 py-0.5 rounded-full ${
                      u.perfil === 'administrador'
                        ? 'bg-primary/10 text-primary'
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {PERFIL_LABELS[u.perfil] ?? u.perfil}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => desativar(u.id)}
                      className="text-xs font-display font-bold text-danger border border-danger/20 px-2.5 py-1 rounded-lg hover:bg-danger/5 transition-colors"
                    >
                      Desativar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
