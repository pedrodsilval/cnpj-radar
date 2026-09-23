import { useState, useEffect, type ReactNode } from 'react'
import { apiFetch } from './auth'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DashboardData {
  periodoDias: number
  consultasPeriodo: number
  consultasDelta: number | null
  totalLeads: number
  leadsAtivos: number
  totalClientes: number
  taxaConversaoLeads: number
  oportunidadesParadas: number
  alertasCertidoesCriticos: number
  tarefasPendentes: number
  consultasPorMes: { mes: string; total: number }[]
  topCnaes: { codigo: string; descricao: string; total: number }[]
  topConsultores: { nome: string; total: number }[]
}

interface AcoesData {
  certidoes: { empresa: string; cnpj: string | null; tipo: string; status: string; validade: string | null; diasRestantes: number | null }[]
  tarefas: { id: string; titulo: string; prioridade: string; responsavel: string | null; dataLimite: string | null; atrasada: boolean }[]
  oportunidades: { empresa: string; cnpj: string; status: string; diasParado: number }[]
}

interface FunilItem { status: string; label: string; total: number }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatarMes(yyyyMM: string): string {
  const [y, m] = yyyyMM.split('-')
  const nomes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  return `${nomes[Number(m) - 1]}/${y.slice(2)}`
}

function formatarData(iso: string | null): string {
  if (!iso) return ''
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

const PRIO_COR: Record<string, string> = { alta: 'bg-danger', media: 'bg-amber-400', baixa: 'bg-gray-300' }

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricCard({
  label, valor, sub, destaque = false, alerta = false, onClick, delta,
}: {
  label: string; valor: string | number; sub?: string
  destaque?: boolean; alerta?: boolean; onClick?: () => void
  delta?: number | null   // variação %: >0 sobe (verde), <0 cai (vermelho)
}) {
  const base = `rounded-2xl border p-5 text-left w-full ${
    alerta   ? 'bg-danger/5 border-danger/20'   :
    destaque ? 'bg-primary/5 border-primary/20' :
               'bg-white border-gray-100'
  }`
  // Card clicável vira botão real: cursor, hover, foco por teclado e uma seta discreta.
  const interativo = onClick
    ? ' cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
    : ''
  const conteudo = (
    <>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-display font-bold text-gray-400 uppercase tracking-widest">{label}</p>
        {onClick && <span aria-hidden className="text-gray-300 text-sm leading-none">›</span>}
      </div>
      <div className="flex items-baseline gap-2">
        <p className={`font-display font-black text-3xl leading-none ${
          alerta ? 'text-danger' : destaque ? 'text-primary' : 'text-depth'
        }`}>{valor}</p>
        {delta !== undefined && delta !== null && (
          <span className={`text-xs font-display font-bold ${
            delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-danger' : 'text-gray-400'
          }`}>
            {delta > 0 ? '▲' : delta < 0 ? '▼' : '→'} {Math.abs(delta)}%
          </span>
        )}
      </div>
      {sub && <p className="text-xs text-gray-400 font-body mt-1">{sub}</p>}
    </>
  )
  if (onClick) {
    return <button type="button" onClick={onClick} className={base + interativo}>{conteudo}</button>
  }
  return <div className={base}>{conteudo}</div>
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

function Funil({ dados }: { dados: FunilItem[] }) {
  const total = dados.reduce((s, d) => s + d.total, 0)
  if (total === 0) return <p className="text-gray-300 text-sm font-body text-center py-4">Sem leads ainda.</p>
  const max = Math.max(...dados.map(d => d.total), 1)
  const COR: Record<string, string> = {
    novo: 'bg-gray-300', em_contato: 'bg-primary/50', proposta_enviada: 'bg-primary/70',
    convertido: 'bg-emerald-500', descartado: 'bg-gray-200',
  }
  return (
    <div className="space-y-2">
      {dados.map(d => (
        <div key={d.status} className="flex items-center gap-2">
          <span className="w-28 text-[11px] font-body text-gray-500 flex-shrink-0">{d.label}</span>
          <div className="flex-1 bg-gray-50 rounded-full h-4 overflow-hidden">
            <div className={`h-4 rounded-full transition-all ${COR[d.status] || 'bg-primary/60'}`}
                 style={{ width: `${Math.round((d.total / max) * 100)}%`, minWidth: d.total > 0 ? '8px' : '0' }} />
          </div>
          <span className="w-6 text-right text-xs font-display font-bold text-depth flex-shrink-0">{d.total}</span>
        </div>
      ))}
    </div>
  )
}

// Coluna genérica do bloco "Precisa de ação hoje".
function ColunaAcao({ titulo, n, onVerTodos, vazio, children }: {
  titulo: string; n: number; onVerTodos?: () => void; vazio: string; children: ReactNode
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-display font-bold text-depth">{titulo} <span className="text-gray-300">({n})</span></span>
        {onVerTodos && n > 0 && (
          <button type="button" onClick={onVerTodos}
                  className="text-[11px] font-display font-bold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded">
            ver todas ›
          </button>
        )}
      </div>
      {n === 0 ? <p className="text-xs text-gray-300 font-body">{vazio}</p> : <ul className="space-y-2">{children}</ul>}
    </div>
  )
}

function AcoesHoje({ acoes, onNavegar }: { acoes: AcoesData; onNavegar?: (vista: string) => void }) {
  const { certidoes, tarefas, oportunidades } = acoes
  if (certidoes.length + tarefas.length + oportunidades.length === 0) return null
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <h3 className="text-xs font-display font-bold text-gray-400 uppercase tracking-widest">Precisa de ação hoje</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-5 mt-4">

        <ColunaAcao titulo="Certidões" n={certidoes.length} vazio="Tudo em dia."
          onVerTodos={onNavegar ? () => onNavegar('alertas') : undefined}>
          {certidoes.slice(0, 5).map((c, i) => {
            const critico = c.status === 'IRREGULAR' || (c.diasRestantes ?? 0) < 0
            return (
              <li key={i} className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-display font-bold text-depth truncate">{c.empresa}</p>
                  <p className="text-[10px] text-gray-400 font-body truncate">{c.tipo}</p>
                </div>
                <span className={`text-[10px] font-display font-bold whitespace-nowrap flex-shrink-0 ${critico ? 'text-danger' : 'text-amber-600'}`}>
                  {c.status === 'IRREGULAR' ? 'Irregular'
                    : c.diasRestantes === null ? '—'
                    : c.diasRestantes < 0 ? `vencida ${Math.abs(c.diasRestantes)}d`
                    : `vence ${c.diasRestantes}d`}
                </span>
              </li>
            )
          })}
        </ColunaAcao>

        <ColunaAcao titulo="Tarefas" n={tarefas.length} vazio="Nada pendente."
          onVerTodos={onNavegar ? () => onNavegar('tarefas') : undefined}>
          {tarefas.slice(0, 5).map(t => (
            <li key={t.id} className="flex items-start gap-2">
              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${PRIO_COR[t.prioridade] || 'bg-gray-300'}`} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-display font-bold text-depth truncate">{t.titulo}</p>
                <p className="text-[10px] text-gray-400 font-body truncate">{t.responsavel ?? 'sem responsável'}</p>
              </div>
              <span className={`text-[10px] font-display font-bold whitespace-nowrap flex-shrink-0 ${t.atrasada ? 'text-danger' : 'text-gray-400'}`}>
                {t.atrasada ? 'atrasada' : t.dataLimite ? formatarData(t.dataLimite) : 'sem prazo'}
              </span>
            </li>
          ))}
        </ColunaAcao>

        <ColunaAcao titulo="Oport. paradas" n={oportunidades.length} vazio="Nenhuma parada.">
          {oportunidades.slice(0, 5).map((o, i) => (
            <li key={i} className="flex items-start justify-between gap-2">
              <p className="text-xs font-display font-bold text-depth truncate min-w-0">{o.empresa}</p>
              <span className="text-[10px] font-display font-bold text-amber-600 whitespace-nowrap flex-shrink-0">{o.diasParado}d parado</span>
            </li>
          ))}
        </ColunaAcao>

      </div>
    </div>
  )
}

// ─── DashboardTab ─────────────────────────────────────────────────────────────

export function DashboardTab({ onNavegar }: { onNavegar?: (vista: string) => void }) {
  const [dias, setDias]         = useState(30)
  const [dados, setDados]       = useState<DashboardData | null>(null)
  const [acoes, setAcoes]       = useState<AcoesData | null>(null)
  const [funil, setFunil]       = useState<FunilItem[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro]         = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    async function carregar() {
      setErro(null)
      try {
        // Resumo segue o período; ações e funil são best-effort (não derrubam o dashboard).
        const [rd, ra, rf] = await Promise.all([
          apiFetch(`/dashboard?dias=${dias}`),
          apiFetch('/dashboard/acoes').catch(() => null),
          apiFetch('/dashboard/funil-conversao').catch(() => null),
        ])
        if (cancelado) return
        if (!rd.ok) { setErro('Não foi possível carregar o dashboard.'); return }
        setDados(await rd.json() as DashboardData)
        if (ra && ra.ok) setAcoes(await ra.json() as AcoesData)
        if (rf && rf.ok) setFunil(await rf.json() as FunilItem[])
      } catch { if (!cancelado) setErro('Erro de rede.') }
      finally { if (!cancelado) setCarregando(false) }
    }
    void carregar()
    return () => { cancelado = true }
  }, [dias])

  if (carregando) return <div className="py-20 text-center text-gray-400 text-sm font-body">Carregando dashboard…</div>
  if (erro) return <div className="py-10 text-center text-danger text-sm font-display font-bold" role="alert">⚠ {erro}</div>
  if (!dados) return null

  return (
    <div className="space-y-6">

      {/* Título + seletor de período (aplica a Consultas, CNAEs e Consultores) */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display font-black text-depth text-lg">Dashboard Executivo</h2>
          <p className="text-gray-400 font-body text-sm mt-0.5">Visão consolidada da carteira.</p>
        </div>
        <div className="flex gap-1 bg-white border border-gray-100 rounded-xl p-1" role="group" aria-label="Período">
          {[7, 30, 90].map(d => (
            <button
              key={d} type="button" onClick={() => setDias(d)}
              className={`px-3 py-1 rounded-lg text-xs font-display font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                dias === d ? 'bg-primary text-white' : 'text-gray-500 hover:text-depth'
              }`}
            >
              {d} dias
            </button>
          ))}
        </div>
      </div>

      {/* Linha 1 — risco e ação: o que precisa de você hoje (destaque no topo) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <MetricCard
          label="Certidões críticas"
          valor={dados.alertasCertidoesCriticos}
          sub={dados.alertasCertidoesCriticos > 0 ? 'irregular ou vence em 7 dias' : 'tudo em dia'}
          alerta={dados.alertasCertidoesCriticos > 0}
          onClick={onNavegar ? () => onNavegar('alertas') : undefined}
        />
        <MetricCard
          label="Tarefas pendentes"
          valor={dados.tarefasPendentes}
          sub={dados.tarefasPendentes > 0 ? 'pendente ou em andamento' : 'nada pendente'}
          alerta={dados.tarefasPendentes > 0}
          onClick={onNavegar ? () => onNavegar('tarefas') : undefined}
        />
        <MetricCard
          label="Oport. paradas"
          valor={dados.oportunidadesParadas}
          sub="+30 dias sem ação"
          alerta={dados.oportunidadesParadas > 0}
        />
      </div>

      {/* Linha 2 — comercial */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <MetricCard
          label="Leads ativos"
          valor={dados.leadsAtivos}
          sub={dados.leadsAtivos !== dados.totalLeads ? `${dados.totalLeads} no total` : undefined}
        />
        <MetricCard
          label="Conversão"
          valor={dados.totalLeads === 0 ? '—' : `${dados.taxaConversaoLeads}%`}
          sub={
            dados.totalLeads === 0
              ? 'sem leads ainda'
              : dados.totalClientes > 0
                ? `${dados.totalClientes} cliente${dados.totalClientes !== 1 ? 's' : ''}`
                : 'nenhum convertido ainda'
          }
          destaque={dados.totalLeads > 0 && dados.taxaConversaoLeads >= 20}
          onClick={onNavegar ? () => onNavegar('clientes') : undefined}
        />
        <MetricCard
          label={`Consultas (${dados.periodoDias}d)`}
          valor={dados.consultasPeriodo}
          delta={dados.consultasDelta}
          sub="vs. período anterior"
          onClick={onNavegar ? () => onNavegar('relatorios') : undefined}
        />
      </div>

      {/* Precisa de ação hoje (I2) — lista de trabalho priorizada */}
      {acoes && <AcoesHoje acoes={acoes} onNavegar={onNavegar} />}

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
            CNAEs mais consultados ({dados.periodoDias} dias)
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

        {/* Funil de conversão (I3) */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-display font-bold text-gray-400 uppercase tracking-widest">
              Funil de conversão
            </h3>
            {onNavegar && (
              <button type="button" onClick={() => onNavegar('clientes')}
                className="text-xs font-display font-bold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded">
                Clientes ›
              </button>
            )}
          </div>
          <Funil dados={funil} />
        </div>

        {/* Top consultores — só faz sentido com 2+ pessoas (S2) */}
        {dados.topConsultores.length > 1 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-display font-bold text-gray-400 uppercase tracking-widest">
                Consultores mais ativos ({dados.periodoDias} dias)
              </h3>
              {onNavegar && (
                <button
                  type="button"
                  onClick={() => onNavegar('relatorios')}
                  className="text-xs font-display font-bold text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded"
                >
                  Relatório ›
                </button>
              )}
            </div>
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
