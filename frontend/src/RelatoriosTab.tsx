import { useState, useEffect } from 'react'
import { apiFetch } from './auth'

// ─── Types ────────────────────────────────────────────────────────────────────

interface FunilItem {
  status: string
  label: string
  total: number
}

interface Consultor {
  nome: string
  consultas: number
  leads: number
  convertidos: number
  taxaConversao: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hojeISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function inicioMesISO(): string {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}

function ptDate(iso: string): string {
  const [y, m, day] = iso.split('-')
  return `${day}/${m}/${y}`
}

// ─── Funil ────────────────────────────────────────────────────────────────────

const COR_FUNIL: Record<string, string> = {
  novo:             'bg-primary',
  em_contato:       'bg-blue-400',
  proposta_enviada: 'bg-accent',
  convertido:       'bg-emerald-500',
  descartado:       'bg-gray-300',
}

function FunilConversao({ funil }: { funil: FunilItem[] }) {
  const total = funil.reduce((s, f) => s + f.total, 0)
  const max   = Math.max(...funil.map(f => f.total), 1)

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <h3 className="font-display font-black text-depth text-sm mb-4">Funil de Conversão</h3>

      {total === 0 ? (
        <p className="text-gray-400 font-body text-sm text-center py-6">Nenhum lead cadastrado.</p>
      ) : (
        <div className="space-y-3">
          {funil.map(f => {
            const pct = Math.round((f.total / max) * 100)
            const cor = COR_FUNIL[f.status] ?? 'bg-gray-300'
            return (
              <div key={f.status}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-display font-bold text-gray-500">{f.label}</span>
                  <span className="text-xs font-display font-black text-depth">{f.total}</span>
                </div>
                <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${cor}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
          <p className="text-xs text-gray-400 font-body pt-1">Total de leads: {total}</p>
        </div>
      )}
    </div>
  )
}

// ─── Tabela consultores ───────────────────────────────────────────────────────

function TabelaConsultores({ consultores }: { consultores: Consultor[] }) {
  if (consultores.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
        <p className="text-gray-400 font-body text-sm">Nenhuma consulta no período.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[#EFF6FF]">
            <th className="text-left px-4 py-3 font-display font-bold text-gray-500 text-xs uppercase tracking-wide">Consultor</th>
            <th className="text-right px-4 py-3 font-display font-bold text-gray-500 text-xs uppercase tracking-wide">Consultas</th>
            <th className="text-right px-4 py-3 font-display font-bold text-gray-500 text-xs uppercase tracking-wide">Leads</th>
            <th className="text-right px-4 py-3 font-display font-bold text-gray-500 text-xs uppercase tracking-wide">Convertidos</th>
            <th className="text-right px-4 py-3 font-display font-bold text-gray-500 text-xs uppercase tracking-wide">Taxa</th>
          </tr>
        </thead>
        <tbody>
          {consultores.map((c, i) => (
            <tr key={c.nome} className={i % 2 === 0 ? 'bg-white' : 'bg-[#F9FAFB]'}>
              <td className="px-4 py-3 font-body text-depth">{c.nome}</td>
              <td className="px-4 py-3 text-right font-display font-bold text-depth">{c.consultas}</td>
              <td className="px-4 py-3 text-right font-body text-gray-600">{c.leads}</td>
              <td className="px-4 py-3 text-right font-display font-bold text-emerald-600">{c.convertidos}</td>
              <td className="px-4 py-3 text-right">
                <span className={`font-display font-black text-xs px-2 py-0.5 rounded-full ${
                  c.taxaConversao >= 30 ? 'bg-emerald-100 text-emerald-700'
                  : c.taxaConversao >= 10 ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-100 text-gray-500'
                }`}>
                  {c.taxaConversao}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Tab principal ────────────────────────────────────────────────────────────

export function RelatoriosTab() {
  const [de,  setDe]  = useState(inicioMesISO)
  const [ate, setAte] = useState(hojeISO)

  const [funil,        setFunil]        = useState<FunilItem[]>([])
  const [consultores,  setConsultores]  = useState<Consultor[]>([])
  const [carregando,   setCarregando]   = useState(true)
  const [erro,         setErro]         = useState<string | null>(null)

  async function carregar() {
    setCarregando(true)
    setErro(null)
    try {
      const [rFunil, rConsultores] = await Promise.all([
        apiFetch('/dashboard/funil-conversao'),
        apiFetch(`/dashboard/relatorio-consultores?de=${de}&ate=${ate}`),
      ])
      if (!rFunil.ok || !rConsultores.ok) {
        setErro('Não foi possível carregar os relatórios.')
        return
      }
      setFunil(await rFunil.json() as FunilItem[])
      setConsultores(await rConsultores.json() as Consultor[])
    } catch {
      setErro('Erro de rede ao carregar relatórios.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => { void carregar() }, [de, ate])

  if (carregando) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400 font-body text-sm">
        Carregando relatórios…
      </div>
    )
  }

  if (erro) {
    return (
      <div className="flex items-center gap-2 py-10 text-danger text-sm font-display font-bold" role="alert">
        <span aria-hidden="true">⚠</span> {erro}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho + filtro de período */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display font-black text-depth text-lg">Relatórios</h2>
          <p className="text-gray-400 font-body text-sm mt-0.5">
            Funil de conversão e desempenho por consultor
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs font-display font-bold text-gray-500 uppercase tracking-wide">De</label>
          <input
            type="date"
            value={de}
            max={ate}
            onChange={e => setDe(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-1.5 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"
          />
          <label className="text-xs font-display font-bold text-gray-500 uppercase tracking-wide">Até</label>
          <input
            type="date"
            value={ate}
            min={de}
            max={hojeISO()}
            onChange={e => setAte(e.target.value)}
            className="border border-gray-200 rounded-xl px-3 py-1.5 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"
          />
        </div>
      </div>

      {/* Período selecionado */}
      <p className="text-xs text-gray-400 font-body -mt-2">
        Período: {ptDate(de)} a {ptDate(ate)}
      </p>

      {/* Funil */}
      <FunilConversao funil={funil} />

      {/* Tabela de consultores */}
      <div>
        <h3 className="font-display font-black text-depth text-sm mb-3">Desempenho por Consultor</h3>
        <TabelaConsultores consultores={consultores} />
      </div>
    </div>
  )
}
