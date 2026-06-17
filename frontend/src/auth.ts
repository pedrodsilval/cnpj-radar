// Auth utilities — localStorage is acceptable for an internal tool

export interface UsuarioLogado {
  id: string
  nome: string
  email: string
  perfil: 'administrador' | 'comercial' | 'financeiro' | 'consultor' | 'leitura'
}

const TOKEN_KEY = 'cnpj_radar_token'
const USER_KEY  = 'cnpj_radar_user'

export function salvarSessao(token: string, usuario: UsuarioLogado) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(usuario))
}

export function limparSessao() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function getUsuario(): UsuarioLogado | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try { return JSON.parse(raw) as UsuarioLogado } catch { return null }
}

export function estaLogado(): boolean {
  return !!getToken() && !!getUsuario()
}

// Adds Authorization header when a token exists
export function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// Drop-in replacement for fetch() that always sends the Bearer token
export function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(url, { ...init, headers })
}
