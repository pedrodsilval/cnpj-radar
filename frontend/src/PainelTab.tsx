import { useState, useEffect, useCallback } from 'react'
import { CampanhasTab } from './CampanhasTab'
import { apiFetch } from './auth'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Indicadores {
  totalEmpresas: number
  totalLeads: number
  cnaesUnicos: number
  percentualMei: number
  abertasUltimos12Meses: number
  topUfs: { uf: string; total: number }[]
}

interface CnaeItem {
  codigo: string
  descricao: string
  totalEmpresas: number
  totalLeads: number
  percentualMei: number
  prioritario: boolean
  segmento: string | null
  ofertaSugerida: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function CardResumo({ label, valor, sub }: { label: string; valor: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5">
      <p className="text-xs font-display font-bold text-gray-400 uppercase tracking-widest mb-1">{label}</p>
      <p className="font-display font-black text-depth text-3xl">{valor}</p>
      {sub && <p className="text-xs text-gray-400 font-body mt-1">{sub}</p>}
    </div>
  )
}

// ─── Modal configurar CNAE ────────────────────────────────────────────────────

interface ModalConfigProps {
  item: CnaeItem
  onSalvo: () => void
  onFechar: () => void
}

function ModalConfig({ item, onSalvo, onFechar }: ModalConfigProps) {
  const [segmento, setSegmento]           = useState(item.segmento ?? '')
  const [ofertaSugerida, setOfertaSugerida] = useState(item.ofertaSugerida ?? '')
  const [salvando, setSalvando]           = useState(false)
  const [erro, setErro]                   = useState<string | null>(null)

  async function salvar() {
    setSalvando(true)
    setErro(null)
    try {
      const res = await apiFetch('/painel/cnae-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codigo: item.codigo,
          descricao: item.descricao,
          segmento: segmento || null,
          ofertaSugerida: ofertaSugerida || null,
          prioritario: true,
        }),
      })
      if (!res.ok) {
        setErro('Não foi possível salvar.')
        return
      }
      onSalvo()
    } catch {
      setErro('Erro de rede.')
    } finally {
      setSalvando(false)
    }
  }

  async function remover() {
    setSalvando(true)
    try {
      await apiFetch(`/painel/cnae-config/${encodeURIComponent(item.codigo)}`, { method: 'DELETE' })
      onSalvo()
    } catch {
      setErro('Erro ao remover.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-depth/60 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-[24px] shadow-2xl w-full max-w-md">
        <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-display font-bold text-gray-400 uppercase tracking-widest">Configurar CNAE prioritário</p>
            <h2 className="font-display font-black text-depth text-base mt-0.5">{item.codigo}</h2>
            <p className="text-xs text-gray-500 font-body mt-0.5 leading-tight">{item.descricao}</p>
          </div>
          <button onClick={onFechar} aria-label="Fechar" className="text-gray-400 hover:text-depth transition-colors mt-0.5">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">Segmento</label>
            <input
              type="text"
              value={segmento}
              onChange={e => setSegmento(e.target.value)}
              placeholder="Ex: Saúde, Comércio Varejista, Alimentação…"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"
            />
          </div>
          <div>
            <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">Oferta sugerida</label>
            <textarea
              value={ofertaSugerida}
              onChange={e => setOfertaSugerida(e.target.value)}
              rows={3}
              placeholder="Ex: Contabilidade especializada + planejamento tributário…"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white resize-none"
            />
          </div>
          {erro && <p className="text-xs text-danger font-display font-bold">⚠ {erro}</p>}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
          {item.prioritario && (
            <button
              onClick={remover}
              disabled={salvando}
              className="text-sm font-display font-bold text-danger border border-danger/30 px-4 py-2 rounded-lg hover:bg-danger/5 transition-colors disabled:opacity-50"
            >
              Remover prioridade
            </button>
          )}
          <div className="flex gap-2 ml-auto">
            <button onClick={onFechar} className="text-sm font-display font-bold text-gray-500 px-4 py-2 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors">
              Cancelar
            </button>
            <button
              onClick={salvar}
              disabled={salvando}
              className="text-sm font-display font-bold bg-primary text-white px-5 py-2 rounded-lg hover:bg-depth transition-colors disabled:opacity-50"
            >
              {salvando ? 'Salvando…' : 'Marcar como prioritário'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── PainelTab ────────────────────────────────────────────────────────────────

type SubVista = 'mercado' | 'campanhas'

export function PainelTab() {
  const [subVista, setSubVista]         = useState<SubVista>('mercado')
  const [indicadores, setIndicadores]   = useState<Indicadores | null>(null)
  const [cnaes, setCnaes]               = useState<CnaeItem[]>([])
  const [carregando, setCarregando]     = useState(true)
  const [erro, setErro]                 = useState<string | null>(null)
  const [ufFiltro, setUfFiltro]         = useState('')
  const [busca, setBusca]               = useState('')
  const [apenasP, setApenasP]           = useState(false)
  const [modalItem, setModalItem]       = useState<CnaeItem | null>(null)

  const carregar = useCallback(async (uf: string) => {
    setCarregando(true)
    setErro(null)
    try {
      const q = uf ? `?uf=${uf}` : ''
      const [resInd, resCnae] = await Promise.all([
        apiFetch(`/painel/indicadores${q}`),
        apiFetch(`/painel/cnae${q}`),
      ])
      if (!resInd.ok || !resCnae.ok) { setErro('Não foi possível carregar o painel.'); return }
      const [ind, cnae] = await Promise.all([resInd.json(), resCnae.json()])
      setIndicadores(ind as Indicadores)
      setCnaes(cnae as CnaeItem[])
    } catch {
      setErro('Erro de rede ao carregar o painel.')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => { carregar(ufFiltro) }, [ufFiltro, carregar])

  const UFS = ['', 'BA', 'SP', 'RJ', 'MG', 'RS', 'PR', 'SC', 'GO', 'DF', 'PE', 'CE', 'AM', 'PA', 'MA', 'PI', 'RN', 'PB', 'AL', 'SE', 'ES', 'MT', 'MS', 'RO', 'AC', 'AP', 'RR', 'TO']

  const cnaesFiltrados = cnaes.filter(c => {
    if (apenasP && !c.prioritario) return false
    if (busca) {
      const b = busca.toLowerCase()
      return c.codigo.toLowerCase().includes(b) || c.descricao.toLowerCase().includes(b) || (c.segmento ?? '').toLowerCase().includes(b)
    }
    return true
  })

  const prioritarios = cnaes.filter(c => c.prioritario)

  if (carregando && subVista === 'mercado') {
    return <div className="flex items-center justify-center py-20 text-gray-400 font-body text-sm">Carregando painel…</div>
  }

  if (erro && subVista === 'mercado') {
    return <div className="flex items-center gap-2 py-10 text-danger text-sm font-display font-bold" role="alert"><span>⚠</span>{erro}</div>
  }

  return (
    <>
      {modalItem && (
        <ModalConfig
          item={modalItem}
          onFechar={() => setModalItem(null)}
          onSalvo={() => { setModalItem(null); carregar(ufFiltro) }}
        />
      )}

      <div className="space-y-6">

        {/* Cabeçalho + sub-navegação */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="font-display font-black text-depth text-lg">Painel de Mercado</h2>
            <p className="text-gray-400 font-body text-sm mt-0.5">Empresas consultadas cruzadas com CNAE, porte e região</p>
          </div>
          <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
            {(['mercado', 'campanhas'] as SubVista[]).map(sv => (
              <button
                key={sv}
                onClick={() => setSubVista(sv)}
                className={`px-3 py-1.5 rounded-lg text-sm font-display font-bold transition-colors ${
                  subVista === sv ? 'bg-white text-depth shadow-sm' : 'text-gray-400 hover:text-depth'
                }`}
              >
                {sv === 'mercado' ? 'Mercado' : 'Campanhas'}
              </button>
            ))}
          </div>
        </div>

        {/* Vista Campanhas */}
        {subVista === 'campanhas' && <CampanhasTab />}

        {/* Vista Mercado */}
        {subVista === 'mercado' && <>

        {/* Filtro UF */}
        <div className="flex justify-end">
          <div className="flex items-center gap-2">
            <label className="text-xs font-display font-bold text-gray-500 uppercase tracking-wide">UF:</label>
            <select
              value={ufFiltro}
              onChange={e => setUfFiltro(e.target.value)}
              className="border border-gray-200 rounded-xl px-3 py-1.5 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"
            >
              {UFS.map(uf => <option key={uf} value={uf}>{uf || 'Todos'}</option>)}
            </select>
          </div>
        </div>

        {/* Cards resumo */}
        {indicadores && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <CardResumo label="Empresas" valor={indicadores.totalEmpresas} />
            <CardResumo label="Leads" valor={indicadores.totalLeads} />
            <CardResumo label="CNAEs únicos" valor={indicadores.cnaesUnicos} />
            <CardResumo label="MEI" valor={`${indicadores.percentualMei}%`} sub="do total consultado" />
            <CardResumo label="Abertas (12m)" valor={indicadores.abertasUltimos12Meses} sub="últimos 12 meses" />
          </div>
        )}

        {/* Segmentos prioritários */}
        {prioritarios.length > 0 && (
          <section>
            <h3 className="text-xs font-display font-bold text-gray-500 uppercase tracking-widest mb-2">
              Segmentos prioritários ({prioritarios.length})
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {prioritarios.map(c => (
                <div key={c.codigo} className="bg-primary/5 border border-primary/20 rounded-2xl px-4 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-display font-bold text-depth text-sm">{c.codigo}</span>
                      {c.segmento && (
                        <span className="text-[11px] font-display font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full">{c.segmento}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 font-body mt-0.5 leading-tight">{c.descricao}</p>
                    {c.ofertaSugerida && (
                      <p className="text-xs text-gray-400 font-body mt-1 italic">"{c.ofertaSugerida}"</p>
                    )}
                    <p className="text-xs text-primary font-display font-bold mt-1.5">
                      {c.totalEmpresas} empresa{c.totalEmpresas !== 1 ? 's' : ''} · {c.totalLeads} lead{c.totalLeads !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => setModalItem(c)}
                    className="text-xs font-display font-bold text-gray-400 hover:text-primary transition-colors flex-shrink-0 mt-0.5"
                  >
                    Editar
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Tabela CNAEs */}
        <section>
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <h3 className="text-xs font-display font-bold text-gray-500 uppercase tracking-widest">
              Todos os CNAEs ({cnaesFiltrados.length})
            </h3>
            <input
              type="text"
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por código, descrição ou segmento…"
              className="flex-1 min-w-48 border border-gray-200 rounded-xl px-3 py-1.5 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"
            />
            <label className="flex items-center gap-1.5 text-xs font-display font-bold text-gray-500 cursor-pointer">
              <input
                type="checkbox"
                checked={apenasP}
                onChange={e => setApenasP(e.target.checked)}
                className="rounded"
              />
              Só prioritários
            </label>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-xs font-display font-bold text-gray-400 uppercase tracking-wide">CNAE</th>
                  <th className="text-left px-4 py-3 text-xs font-display font-bold text-gray-400 uppercase tracking-wide">Descrição</th>
                  <th className="text-right px-4 py-3 text-xs font-display font-bold text-gray-400 uppercase tracking-wide">Empresas</th>
                  <th className="text-right px-4 py-3 text-xs font-display font-bold text-gray-400 uppercase tracking-wide">Leads</th>
                  <th className="text-right px-4 py-3 text-xs font-display font-bold text-gray-400 uppercase tracking-wide">MEI</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {cnaesFiltrados.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-10 text-gray-400 font-body text-sm">Nenhum CNAE encontrado.</td></tr>
                ) : cnaesFiltrados.map((c, i) => (
                  <tr key={c.codigo} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors ${i % 2 === 0 ? '' : 'bg-gray-50/30'}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-display font-bold text-depth text-xs">{c.codigo}</span>
                        {c.prioritario && (
                          <span className="text-[10px] font-display font-black bg-accent/20 text-amber-700 px-1.5 py-0.5 rounded-full">★</span>
                        )}
                      </div>
                      {c.segmento && <p className="text-[11px] text-primary font-body mt-0.5">{c.segmento}</p>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 font-body text-xs max-w-[220px]">
                      <span className="line-clamp-2">{c.descricao}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-display font-bold text-depth">{c.totalEmpresas}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-display font-bold ${c.totalLeads > 0 ? 'text-accent' : 'text-gray-300'}`}>
                        {c.totalLeads}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-400 font-body text-xs">{c.percentualMei}%</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setModalItem(c)}
                        className={`text-xs font-display font-bold px-2.5 py-1 rounded-lg border transition-colors ${
                          c.prioritario
                            ? 'border-primary/30 text-primary hover:bg-primary/5'
                            : 'border-gray-200 text-gray-400 hover:text-depth hover:border-gray-300'
                        }`}
                      >
                        {c.prioritario ? 'Editar' : 'Priorizar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        </> /* fim subVista mercado */}

      </div>
    </>
  )
}
