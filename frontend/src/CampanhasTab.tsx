import { useState, useEffect, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type StatusCampanha = 'ativa' | 'pausada' | 'encerrada'

interface Campanha {
  id: string
  titulo: string
  segmento: string | null
  cnaeCodigo: string | null
  descricao: string | null
  ofertaSugerida: string | null
  status: StatusCampanha
  dataInicio: string | null
  dataFim: string | null
  criadoEm: string
}

const STATUS_LABELS: Record<StatusCampanha, string> = {
  ativa:      'Ativa',
  pausada:    'Pausada',
  encerrada:  'Encerrada',
}

const STATUS_CORES: Record<StatusCampanha, string> = {
  ativa:      'bg-accent/15 text-amber-700',
  pausada:    'bg-gray-100 text-gray-500',
  encerrada:  'bg-gray-100 text-gray-400',
}

// ─── Modal criar/editar campanha ──────────────────────────────────────────────

interface ModalProps {
  campanha?: Campanha
  onSalvo: () => void
  onFechar: () => void
}

function ModalCampanha({ campanha, onSalvo, onFechar }: ModalProps) {
  const editando = !!campanha
  const [titulo, setTitulo]               = useState(campanha?.titulo ?? '')
  const [segmento, setSegmento]           = useState(campanha?.segmento ?? '')
  const [cnaeCodigo, setCnaeCodigo]       = useState(campanha?.cnaeCodigo ?? '')
  const [descricao, setDescricao]         = useState(campanha?.descricao ?? '')
  const [ofertaSugerida, setOfertaSugerida] = useState(campanha?.ofertaSugerida ?? '')
  const [dataInicio, setDataInicio]       = useState(campanha?.dataInicio ?? '')
  const [dataFim, setDataFim]             = useState(campanha?.dataFim ?? '')
  const [status, setStatus]               = useState<StatusCampanha>(campanha?.status ?? 'ativa')
  const [salvando, setSalvando]           = useState(false)
  const [erro, setErro]                   = useState<string | null>(null)

  async function salvar() {
    if (!titulo.trim()) { setErro('O título é obrigatório.'); return }
    setSalvando(true)
    setErro(null)
    const body = {
      titulo,
      segmento: segmento || null,
      cnaeCodigo: cnaeCodigo || null,
      descricao: descricao || null,
      ofertaSugerida: ofertaSugerida || null,
      dataInicio: dataInicio || null,
      dataFim: dataFim || null,
      ...(editando ? { status } : {}),
    }
    try {
      const url    = editando ? `/painel/campanhas/${campanha!.id}` : '/painel/campanhas'
      const method = editando ? 'PATCH' : 'POST'
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) { setErro('Não foi possível salvar.'); return }
      onSalvo()
    } catch { setErro('Erro de rede.') }
    finally { setSalvando(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-depth/60 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-[24px] shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">

        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <h2 className="font-display font-black text-depth text-base">
            {editando ? 'Editar campanha' : 'Nova campanha'}
          </h2>
          <button onClick={onFechar} aria-label="Fechar" className="text-gray-400 hover:text-depth transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">Título *</label>
            <input
              type="text"
              value={titulo}
              onChange={e => setTitulo(e.target.value)}
              placeholder="Ex: Clínicas odontológicas em Salvador"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">Segmento</label>
              <input
                type="text"
                value={segmento}
                onChange={e => setSegmento(e.target.value)}
                placeholder="Ex: Saúde, Varejo…"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">CNAE</label>
              <input
                type="text"
                value={cnaeCodigo}
                onChange={e => setCnaeCodigo(e.target.value)}
                placeholder="Ex: 8630-5/04"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">Descrição</label>
            <textarea
              value={descricao}
              onChange={e => setDescricao(e.target.value)}
              rows={2}
              placeholder="Detalhes e contexto da campanha…"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">Oferta sugerida</label>
            <textarea
              value={ofertaSugerida}
              onChange={e => setOfertaSugerida(e.target.value)}
              rows={2}
              placeholder="Ex: Contabilidade especializada + planejamento tributário…"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">Início</label>
              <input
                type="date"
                value={dataInicio}
                onChange={e => setDataInicio(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">Fim</label>
              <input
                type="date"
                value={dataFim}
                onChange={e => setDataFim(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"
              />
            </div>
          </div>

          {editando && (
            <div>
              <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">Status</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as StatusCampanha)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"
              >
                {(Object.keys(STATUS_LABELS) as StatusCampanha[]).map(s => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>
          )}

          {erro && <p className="text-xs text-danger font-display font-bold">⚠ {erro}</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2 flex-shrink-0">
          <button onClick={onFechar} className="text-sm font-display font-bold text-gray-500 px-4 py-2 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors">
            Cancelar
          </button>
          <button
            onClick={salvar}
            disabled={salvando}
            className="text-sm font-display font-bold bg-primary text-white px-5 py-2 rounded-lg hover:bg-depth transition-colors disabled:opacity-50"
          >
            {salvando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Criar campanha'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── CampanhasTab ─────────────────────────────────────────────────────────────

export function CampanhasTab() {
  const [campanhas, setCampanhas]   = useState<Campanha[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro]             = useState<string | null>(null)
  const [filtroStatus, setFiltroStatus] = useState<StatusCampanha | ''>('ativa')
  const [modal, setModal]           = useState<{ aberto: boolean; campanha?: Campanha }>({ aberto: false })

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const q = filtroStatus ? `?status=${filtroStatus}` : ''
      const res = await fetch(`/painel/campanhas${q}`)
      if (!res.ok) { setErro('Não foi possível carregar as campanhas.'); return }
      setCampanhas(await res.json() as Campanha[])
    } catch { setErro('Erro de rede.') }
    finally { setCarregando(false) }
  }, [filtroStatus])

  useEffect(() => { void carregar() }, [carregar])

  async function remover(id: string) {
    if (!confirm('Remover esta campanha permanentemente?')) return
    await fetch(`/painel/campanhas/${id}`, { method: 'DELETE' })
    await carregar()
  }

  function formatarData(d: string | null): string {
    if (!d) return '—'
    const [y, m, dia] = d.split('-')
    return `${dia}/${m}/${y}`
  }

  return (
    <>
      {modal.aberto && (
        <ModalCampanha
          campanha={modal.campanha}
          onFechar={() => setModal({ aberto: false })}
          onSalvo={() => { setModal({ aberto: false }); void carregar() }}
        />
      )}

      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-display font-black text-depth text-base">Campanhas por segmento</h3>
            <p className="text-gray-400 font-body text-xs mt-0.5">Iniciativas comerciais vinculadas a CNAEs prioritários.</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={filtroStatus}
              onChange={e => setFiltroStatus(e.target.value as StatusCampanha | '')}
              className="border border-gray-200 rounded-xl px-3 py-1.5 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"
            >
              <option value="">Todas</option>
              {(Object.keys(STATUS_LABELS) as StatusCampanha[]).map(s => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
            <button
              onClick={() => setModal({ aberto: true })}
              className="bg-primary text-white font-display font-bold text-sm px-4 py-1.5 rounded-xl hover:bg-depth transition-colors whitespace-nowrap"
            >
              + Nova campanha
            </button>
          </div>
        </div>

        {/* Content */}
        {carregando ? (
          <div className="py-8 text-center text-gray-400 text-sm font-body">Carregando campanhas…</div>
        ) : erro ? (
          <div className="py-8 text-center text-danger text-sm font-display font-bold" role="alert">⚠ {erro}</div>
        ) : campanhas.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 py-12 text-center">
            <p className="text-gray-400 text-sm font-body mb-3">Nenhuma campanha {filtroStatus ? STATUS_LABELS[filtroStatus as StatusCampanha].toLowerCase() : ''} cadastrada.</p>
            <button
              onClick={() => setModal({ aberto: true })}
              className="text-primary font-display font-bold text-sm border border-primary/30 px-4 py-2 rounded-lg hover:bg-primary/5 transition-colors"
            >
              Criar primeira campanha
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {campanhas.map(c => (
              <div key={c.id} className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-display font-bold text-depth text-sm leading-tight">{c.titulo}</p>
                      <span className={`text-[10px] font-display font-black px-1.5 py-0.5 rounded-full ${STATUS_CORES[c.status]}`}>
                        {STATUS_LABELS[c.status]}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {c.segmento && (
                        <span className="text-[11px] font-display font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">{c.segmento}</span>
                      )}
                      {c.cnaeCodigo && (
                        <span className="text-[11px] font-body text-gray-400">{c.cnaeCodigo}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => setModal({ aberto: true, campanha: c })}
                      className="text-xs font-display font-bold text-gray-400 hover:text-primary transition-colors"
                    >
                      Editar
                    </button>
                    <span className="text-gray-200">·</span>
                    <button
                      onClick={() => remover(c.id)}
                      className="text-xs font-display font-bold text-gray-400 hover:text-danger transition-colors"
                    >
                      Remover
                    </button>
                  </div>
                </div>

                {c.descricao && (
                  <p className="text-xs text-gray-500 font-body leading-relaxed line-clamp-2">{c.descricao}</p>
                )}
                {c.ofertaSugerida && (
                  <p className="text-xs text-gray-400 font-body italic line-clamp-2">"{c.ofertaSugerida}"</p>
                )}

                {(c.dataInicio || c.dataFim) && (
                  <p className="text-[11px] text-gray-400 font-body mt-auto">
                    {formatarData(c.dataInicio)} → {formatarData(c.dataFim)}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
