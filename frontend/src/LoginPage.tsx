import { useState } from 'react'
import { salvarSessao, type UsuarioLogado } from './auth'

interface Props {
  onLogado: () => void
}

export function LoginPage({ onLogado }: Props) {
  const [email, setEmail]         = useState('')
  const [senha, setSenha]         = useState('')
  const [erro, setErro]           = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro(null)
    if (!email.trim() || !senha) {
      setErro('Informe e-mail e senha.')
      return
    }
    setCarregando(true)
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), senha }),
      })
      const json = await res.json() as { access_token?: string; usuario?: UsuarioLogado; message?: string }
      if (!res.ok || !json.access_token || !json.usuario) {
        setErro(json.message ?? 'E-mail ou senha incorretos.')
        return
      }
      salvarSessao(json.access_token, json.usuario)
      onLogado()
    } catch {
      setErro('Não foi possível conectar. Verifique sua conexão.')
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#020617] via-[#172554] to-[#0f172a] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="text-center mb-8">
          <p className="font-display font-black text-accent text-3xl leading-none">Radar</p>
          <p className="font-display font-medium text-surface/60 text-base mt-1">Everest/FK's</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-[28px] shadow-2xl p-8">
          <h1 className="font-display font-black text-depth text-xl mb-1">Entrar</h1>
          <p className="font-body text-gray-400 text-sm mb-6">Acesso restrito à equipe Everest/FK's.</p>

          <form onSubmit={handleSubmit} noValidate className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">
                E-mail
              </label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="username"
                placeholder="voce@everestcontabilidade.com.br"
                className="w-full border border-gray-200 rounded-2xl px-4 py-3 font-body text-depth text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent placeholder:text-gray-300"
              />
            </div>

            <div>
              <label htmlFor="login-senha" className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">
                Senha
              </label>
              <input
                id="login-senha"
                type="password"
                value={senha}
                onChange={e => setSenha(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                className="w-full border border-gray-200 rounded-2xl px-4 py-3 font-body text-depth text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent placeholder:text-gray-300"
              />
            </div>

            {erro && (
              <p role="alert" aria-live="assertive" className="text-danger text-sm font-display font-bold flex items-center gap-1.5">
                <span aria-hidden="true">⚠</span>
                {erro}
              </p>
            )}

            <button
              type="submit"
              disabled={carregando}
              aria-busy={carregando || undefined}
              className="w-full bg-primary text-surface font-display font-bold text-sm py-3.5 rounded-2xl hover:bg-depth transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-2"
            >
              {carregando ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        </div>

        <p className="text-center text-surface/30 text-xs font-body mt-6">
          Acesso não autorizado é proibido.
        </p>
      </div>
    </div>
  )
}
