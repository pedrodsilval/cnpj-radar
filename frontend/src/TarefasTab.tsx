import { useState, useEffect, useCallback } from 'react'
import { apiFetch, getUsuario } from './auth'

// ─── Types ────────────────────────────────────────────────────────────────────

type StatusTarefa   = 'pendente' | 'em_andamento' | 'concluida' | 'cancelada'
type PrioridadeTarefa = 'baixa' | 'media' | 'alta'

interface Tarefa {
  id: string
  titulo: string
  descricao: string | null
  status: StatusTarefa
  prioridade: PrioridadeTarefa
  responsavelId: string | null
  responsavelNome: string | null
  cnpjVinculado: string | null
  dataLimite: string | null
  concluidaEm: string | null
  criadoEm: string
}

const STATUS_LABELS: Record<StatusTarefa, string> = {
  pendente:     'Pendente',
  em_andamento: 'Em andamento',
  concluida:    'Concluída',
  cancelada:    'Cancelada',
}

const STATUS_COR: Record<StatusTarefa, string> = {
  pendente:     'bg-amber-50 text-amber-700 border border-amber-200',
  em_andamento: 'bg-blue-50 text-blue-700 border border-blue-200',
  concluida:    'bg-emerald-50 text-emerald-700 border border-emerald-200',
  cancelada:    'bg-gray-100 text-gray-400 border border-gray-200',
}

const PRIO_COR: Record<PrioridadeTarefa, string> = {
  alta:  'text-danger',
  media: 'text-amber-600',
  baixa: 'text-gray-400',
}

const PRIO_LABEL: Record<PrioridadeTarefa, string> = {
  alta:  '↑ Alta',
  media: '— Média',
  baixa: '↓ Baixa',
}

// ─── Modal ────────────────────────────────────────────────────────────────────

interface ModalProps {
  tarefa?: Tarefa
  onSalvo: () => void
  onFechar: () => void
}

function ModalTarefa({ tarefa, onSalvo, onFechar }: ModalProps) {
  const usuario   = getUsuario()
  const editando  = !!tarefa
  const [titulo, setTitulo]       = useState(tarefa?.titulo ?? '')
  const [descricao, setDescricao] = useState(tarefa?.descricao ?? '')
  const [prioridade, setPrioridade] = useState<PrioridadeTarefa>(tarefa?.prioridade ?? 'media')
  const [status, setStatus]       = useState<StatusTarefa>(tarefa?.status ?? 'pendente')
  const [dataLimite, setDataLimite] = useState(tarefa?.dataLimite ?? '')
  const [responsavelNome, setResponsavelNome] = useState(tarefa?.responsavelNome ?? usuario?.nome ?? '')
  const [salvando, setSalvando]   = useState(false)
  const [erro, setErro]           = useState<string | null>(null)

  async function salvar() {
    if (!titulo.trim()) { setErro('O título é obrigatório.'); return }
    setSalvando(true); setErro(null)
    const body = {
      titulo,
      descricao: descricao || null,
      prioridade,
      responsavelId: usuario?.id ?? null,
      responsavelNome: responsavelNome || null,
      dataLimite: dataLimite || null,
      ...(editando ? { status } : {}),
    }
    try {
      const url    = editando ? `/tarefas/${tarefa!.id}` : '/tarefas'
      const method = editando ? 'PATCH' : 'POST'
      const res = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) { setErro('Não foi possível salvar.'); return }
      onSalvo()
    } catch { setErro('Erro de rede.') }
    finally { setSalvando(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-depth/60 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-[24px] shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <h2 className="font-display font-black text-depth text-base">{editando ? 'Editar tarefa' : 'Nova tarefa'}</h2>
          <button onClick={onFechar} aria-label="Fechar" className="text-gray-400 hover:text-depth transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </button>
        </div>
        <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">Título *</label>
            <input type="text" value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="O que precisa ser feito?" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"/>
          </div>
          <div>
            <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">Descrição</label>
            <textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={2} placeholder="Detalhes adicionais…" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white resize-none"/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">Prioridade</label>
              <select value={prioridade} onChange={e => setPrioridade(e.target.value as PrioridadeTarefa)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white">
                <option value="alta">Alta</option>
                <option value="media">Média</option>
                <option value="baixa">Baixa</option>
              </select>
            </div>
            {editando && (
              <div>
                <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">Status</label>
                <select value={status} onChange={e => setStatus(e.target.value as StatusTarefa)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white">
                  {(Object.keys(STATUS_LABELS) as StatusTarefa[]).map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">Responsável</label>
              <input type="text" value={responsavelNome} onChange={e => setResponsavelNome(e.target.value)} placeholder="Nome do responsável" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"/>
            </div>
            <div>
              <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">Data limite</label>
              <input type="date" value={dataLimite} onChange={e => setDataLimite(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"/>
            </div>
          </div>
          {erro && <p className="text-xs text-danger font-display font-bold">⚠ {erro}</p>}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2 flex-shrink-0">
          <button onClick={onFechar} className="text-sm font-display font-bold text-gray-500 px-4 py-2 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors">Cancelar</button>
          <button onClick={salvar} disabled={salvando} className="text-sm font-display font-bold bg-primary text-white px-5 py-2 rounded-lg hover:bg-depth transition-colors disabled:opacity-50">
            {salvando ? 'Salvando…' : editando ? 'Salvar' : 'Criar tarefa'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── TarefaCard ───────────────────────────────────────────────────────────────

function TarefaCard({ t, onEditar, onConcluir, onRemover }: {
  t: Tarefa
  onEditar: () => void
  onConcluir: () => void
  onRemover: () => void
}) {
  const vencida = t.dataLimite && t.status !== 'concluida' && new Date(t.dataLimite) < new Date()

  return (
    <div className={`bg-white rounded-2xl border p-4 ${t.status === 'concluida' ? 'opacity-60 border-gray-100' : vencida ? 'border-danger/30' : 'border-gray-100'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          <button
            onClick={onConcluir}
            disabled={t.status === 'concluida' || t.status === 'cancelada'}
            aria-label={t.status === 'concluida' ? 'Concluída' : 'Marcar como concluída'}
            className={`mt-0.5 w-4.5 h-4.5 rounded-full border-2 flex-shrink-0 transition-colors ${
              t.status === 'concluida'
                ? 'bg-emerald-500 border-emerald-500'
                : 'border-gray-300 hover:border-primary'
            }`}
          >
            {t.status === 'concluida' && (
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="-ml-px -mt-px">
                <path d="M4.5 9L7.5 12L13.5 6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
          <div className="min-w-0">
            <p className={`font-display font-bold text-depth text-sm leading-tight ${t.status === 'concluida' ? 'line-through text-gray-400' : ''}`}>{t.titulo}</p>
            {t.descricao && <p className="text-xs text-gray-500 font-body mt-0.5 line-clamp-1">{t.descricao}</p>}
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <span className={`text-xs px-1.5 py-0.5 rounded-full border font-display font-bold ${STATUS_COR[t.status]}`}>{STATUS_LABELS[t.status]}</span>
              <span className={`text-xs font-display font-bold ${PRIO_COR[t.prioridade]}`}>{PRIO_LABEL[t.prioridade]}</span>
              {t.responsavelNome && <span className="text-[11px] text-gray-400 font-body">{t.responsavelNome}</span>}
              {t.dataLimite && (
                <span className={`text-[11px] font-body ${vencida ? 'text-danger font-bold' : 'text-gray-400'}`}>
                  {vencida ? '⚠ ' : ''}até {t.dataLimite.split('-').reverse().join('/')}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          <button onClick={onEditar} className="text-xs font-display font-bold text-gray-400 hover:text-primary transition-colors">Editar</button>
          <span className="text-gray-200">·</span>
          <button onClick={onRemover} className="text-xs font-display font-bold text-gray-400 hover:text-danger transition-colors">Remover</button>
        </div>
      </div>
    </div>
  )
}

// ─── TarefasTab ───────────────────────────────────────────────────────────────

export function TarefasTab() {
  const [tarefas, setTarefas]     = useState<Tarefa[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro]           = useState<string | null>(null)
  const [filtroStatus, setFiltroStatus] = useState<StatusTarefa | ''>('')
  const [modal, setModal]         = useState<{ aberto: boolean; tarefa?: Tarefa }>({ aberto: false })

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null)
    try {
      const q = filtroStatus ? `?status=${filtroStatus}` : ''
      const res = await apiFetch(`/tarefas${q}`)
      if (!res.ok) { setErro('Não foi possível carregar as tarefas.'); return }
      setTarefas(await res.json() as Tarefa[])
    } catch { setErro('Erro de rede.') }
    finally { setCarregando(false) }
  }, [filtroStatus])

  useEffect(() => { void carregar() }, [carregar])

  async function concluir(t: Tarefa) {
    if (t.status === 'concluida') return
    await apiFetch(`/tarefas/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'concluida' }) })
    await carregar()
  }

  async function remover(id: string) {
    if (!confirm('Remover esta tarefa?')) return
    await apiFetch(`/tarefas/${id}`, { method: 'DELETE' })
    await carregar()
  }

  const emAndamento = tarefas.filter(t => t.status === 'em_andamento')
  const soPendentes = tarefas.filter(t => t.status === 'pendente')
  const concluidas  = tarefas.filter(t => t.status === 'concluida' || t.status === 'cancelada')
  const mostrar     = filtroStatus ? tarefas : [...emAndamento, ...soPendentes, ...concluidas]

  return (
    <>
      {modal.aberto && (
        <ModalTarefa
          tarefa={modal.tarefa}
          onFechar={() => setModal({ aberto: false })}
          onSalvo={() => { setModal({ aberto: false }); void carregar() }}
        />
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-display font-black text-depth text-lg">Tarefas</h2>
            <p className="text-gray-400 font-body text-sm mt-0.5">Atribuição de responsabilidades por lead, certidão ou operação interna.</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={filtroStatus}
              onChange={e => setFiltroStatus(e.target.value as StatusTarefa | '')}
              className="border border-gray-200 rounded-xl px-3 py-1.5 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"
            >
              <option value="">Todas</option>
              {(Object.keys(STATUS_LABELS) as StatusTarefa[]).map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
            <button
              onClick={() => setModal({ aberto: true })}
              className="bg-primary text-white font-display font-bold text-sm px-4 py-1.5 rounded-xl hover:bg-depth transition-colors whitespace-nowrap"
            >
              + Nova tarefa
            </button>
          </div>
        </div>

        {carregando ? (
          <div className="py-8 text-center text-gray-400 text-sm font-body">Carregando tarefas…</div>
        ) : erro ? (
          <div className="py-8 text-center text-danger text-sm font-display font-bold" role="alert">⚠ {erro}</div>
        ) : mostrar.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 py-12 text-center">
            <p className="text-gray-400 text-sm font-body mb-3">Nenhuma tarefa encontrada.</p>
            <button onClick={() => setModal({ aberto: true })} className="text-primary font-display font-bold text-sm border border-primary/30 px-4 py-2 rounded-lg hover:bg-primary/5 transition-colors">
              Criar primeira tarefa
            </button>
          </div>
        ) : filtroStatus ? (
          <div className="space-y-2">
            {mostrar.map(t => (
              <TarefaCard key={t.id} t={t}
                onEditar={() => setModal({ aberto: true, tarefa: t })}
                onConcluir={() => concluir(t)}
                onRemover={() => remover(t.id)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {emAndamento.length > 0 && (
              <div>
                <p className="text-xs font-display font-bold text-blue-600 uppercase tracking-widest mb-2">Em andamento</p>
                <div className="space-y-2">
                  {emAndamento.map(t => (
                    <TarefaCard key={t.id} t={t}
                      onEditar={() => setModal({ aberto: true, tarefa: t })}
                      onConcluir={() => concluir(t)}
                      onRemover={() => remover(t.id)}
                    />
                  ))}
                </div>
              </div>
            )}
            {soPendentes.length > 0 && (
              <div>
                <p className="text-xs font-display font-bold text-amber-600 uppercase tracking-widest mb-2">Pendentes</p>
                <div className="space-y-2">
                  {soPendentes.map(t => (
                    <TarefaCard key={t.id} t={t}
                      onEditar={() => setModal({ aberto: true, tarefa: t })}
                      onConcluir={() => concluir(t)}
                      onRemover={() => remover(t.id)}
                    />
                  ))}
                </div>
              </div>
            )}
            {concluidas.length > 0 && (
              <div>
                <p className="text-xs font-display font-bold text-gray-400 uppercase tracking-widest mb-2">Concluídas / Canceladas</p>
                <div className="space-y-2">
                  {concluidas.map(t => (
                    <TarefaCard key={t.id} t={t}
                      onEditar={() => setModal({ aberto: true, tarefa: t })}
                      onConcluir={() => concluir(t)}
                      onRemover={() => remover(t.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
