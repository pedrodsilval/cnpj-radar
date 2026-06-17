import { useState, useEffect } from 'react'
import { apiFetch } from './auth'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DashboardData {
  totalConsultasMes: number
  totalLeads: number
  totalClientes: number
  taxaConversaoLeads: number
  oportunidadesParadas: number
  alertasCertidoesCriticos: number
  tarefasPendentes: number
  consultasPorMes: { mes: string; total: number }[]
  topCnaes: { codigo: string; descricao: string; total: number }[]
  topConsultores: { nome: string; total: number }[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatarMes(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-')
  const nomes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  return `${nomes[Number(m) - 1]}/${y.slice(2)}`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricCard({
  label, valor, sub, destaque = false, alerta = false,
}: {
  label: string; valor: string | number; sub?: string; destaque?: boolean; alerta?: boolean
}) {
  return (
    <div className={`rounded-2xl border p-5 ${
      alerta   ? 'bg-danger/5 border-danger/20'   :
      destaque ? 'bg-primary/5 border-primary/20' :
                 'bg-white border-gray-100'
    }`}>
      <p className="text-xs font-display font-bold text-gray-400 uppercase tracking-widest mb-1">{label}</p>
      <p className={`font-display font-black text-3xl leading-none ${
        alerta ? 'text-danger' : destaque ? 'text-primary' : 'text-depth'
      }`}>{valor}</p>
      {sub && <p className="text-xs text-gray-400 font-body mt-1">{sub}</p>}
    </div>
  )
}

function MiniBarChart({ data }: { data: { mes: string; total: number }[] }) {
  if (data.length === 0) return <p className="text-gray-300 text-sm font-body text-center py-4">Sem dados.</p>
  const max = Math.max(...data.map(d => d.total), 1)
  return (
    <div className="flex items-end gap-1.5 h-24 w-full">
      {data.map(d => (
        <div key={d.mes} className="flex-1 flex flex-col items-center gap-1">
          <div
            className="w-full bg-primary/70 rounded-t transition-all"
            style={{ height: `${Math.round((d.total / max) * 80)}px`, minHeight: d.total > 0 ? '4px' : '0' }}
            title={`${d.total} consultas`}
          />
          <span className="text-[10px] font-body text-gray-400 whitespace-nowrap">{formatarMes(d.mes)}</span>
        </div>
      ))}
    </div>
  )
}

// ─── DashboardTab ─────────────────────────────────────────────────────────────

export function DashboardTab() {
  const [dados, setDados]       = useState<DashboardData | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro]         = useState<string | null>(null)

  useEffect(() => {
    async function carregar() {
      setCarregando(true)
      setErro(null)
      try {
        const res = await apiFetch('/dashboard')
        if (!res.ok) { setErro('Não foi possível carregar o dashboard.'); return }
        setDados(await res.json() as DashboardData)
      } catch { setErro('Erro de rede.') }
      finally { setCarregando(false) }
    }
    void carregar()
  }, [])

  if (carregando) return <div className="py-20 text-center text-gray-400 text-sm font-body">Carregando dashboard…</div>
  if (erro) return <div className="py-10 text-center text-danger text-sm font-display font-bold" role="alert">⚠ {erro}</div>
  if (!dados) return null

  return (
    <div className="space-y-6">

      {/* Título */}
      <div>
        <h2 className="font-display font-black text-depth text-lg">Dashboard Executivo</h2>
        <p className="text-gray-400 font-body text-sm mt-0.5">Visão consolidada do mês atual.</p>
      </div>

      {/* Métricas principais */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard label="Consultas (mês)" valor={dados.totalConsultasMes} />
        <MetricCard label="Leads ativos"    valor={dados.totalLeads} />
        <MetricCard
          label="Conversão"
          valor={`${dados.taxaConversaoLeads}%`}
          sub={`${dados.totalClientes} cliente${dados.totalClientes !== 1 ? 's' : ''}`}
          destaque={dados.taxaConversaoLeads >= 20}
        />
        <MetricCard
          label="Oport. paradas"
          valor={dados.oportunidadesParadas}
          sub="+30 dias sem ação"
          alerta={dados.oportunidadesParadas > 0}
        />
      </div>

      {/* Alertas rápidos */}
      {(dados.alertasCertidoesCriticos > 0 || dados.tarefasPendentes > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {dados.alertasCertidoesCriticos > 0 && (
            <MetricCard
              label="Certidões críticas"
              valor={dados.alertasCertidoesCriticos}
              sub="irregular ou vence em 7 dias"
              alerta
            />
          )}
          {dados.tarefasPendentes > 0 && (
            <MetricCard
              label="Tarefas pendentes"
              valor={dados.tarefasPendentes}
              sub="pendente ou em andamento"
            />
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Consultas por mês */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h3 className="text-xs font-display font-bold text-gray-400 uppercase tracking-widest mb-4">
            Consultas — últimos 6 meses
          </h3>
          <MiniBarChart data={dados.consultasPorMes} />
        </div>

        {/* Top CNAEs */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <h3 className="text-xs font-display font-bold text-gray-400 uppercase tracking-widest mb-3">
            CNAEs mais consultados (30 dias)
          </h3>
          {dados.topCnaes.length === 0 ? (
            <p className="text-gray-300 text-sm font-body">Sem consultas no período.</p>
          ) : (
            <ol className="space-y-2">
              {dados.topCnaes.map((c, i) => {
                const pct = Math.round((c.total / (dados.topCnaes[0]?.total || 1)) * 100)
                return (
                  <li key={c.codigo} className="flex items-center gap-3">
                    <span className="w-5 text-xs font-display font-black text-gray-300 text-right flex-shrink-0">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs font-display font-bold text-depth truncate">{c.codigo}</span>
                        <span className="text-xs font-display font-bold text-primary flex-shrink-0 ml-2">{c.total}</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div className="bg-primary h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-[10px] text-gray-400 font-body truncate mt-0.5">{c.descricao}</p>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>

        {/* Top consultores */}
        {dados.topConsultores.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <h3 className="text-xs font-display font-bold text-gray-400 uppercase tracking-widest mb-3">
              Consultores mais ativos (30 dias)
            </h3>
            <ol className="space-y-2">
              {dados.topConsultores.map((c, i) => (
                <li key={c.nome} className="flex items-center gap-3">
                  <span className="w-5 text-xs font-display font-black text-gray-300 text-right flex-shrink-0">{i + 1}</span>
                  <span className="flex-1 text-sm font-display font-bold text-depth">{c.nome}</span>
                  <span className="text-sm font-display font-bold text-primary">{c.total}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

      </div>
    </div>
  )
}
