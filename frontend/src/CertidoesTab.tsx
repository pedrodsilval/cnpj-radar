import { useState, useEffect, useRef } from 'react'
import { apiFetch } from './auth'

// ─── Types ────────────────────────────────────────────────────────────────────

type CertidaoStatus =
  | 'NAO_CONSULTADA'
  | 'CONSULTA_MANUAL'
  | 'REGULAR'
  | 'IRREGULAR'
  | 'INDISPONIVEL'
  | 'EXIGE_CERTIFICADO'

interface ChecklistItem {
  tipo: string
  label: string
  status: CertidaoStatus
  validade: string | null
  diasParaVencer: number | null
  automatizavel: boolean
  certidaoId: string | null
  dataConsulta: string | null
  urlArquivo: string | null
}

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<CertidaoStatus, { label: string; pill: string; dot: string }> = {
  REGULAR:           { label: 'Regular',            pill: 'bg-emerald-50 text-emerald-700 border border-emerald-200', dot: 'bg-emerald-500' },
  IRREGULAR:         { label: 'Irregular',          pill: 'bg-red-50 text-red-700 border border-red-200',             dot: 'bg-red-500'     },
  NAO_CONSULTADA:    { label: 'Não consultada',     pill: 'bg-gray-100 text-gray-500 border border-gray-200',         dot: 'bg-gray-400'    },
  CONSULTA_MANUAL:   { label: 'Manual necessária',  pill: 'bg-amber-50 text-amber-700 border border-amber-200',       dot: 'bg-amber-500'   },
  INDISPONIVEL:      { label: 'Indisponível',       pill: 'bg-orange-50 text-orange-700 border border-orange-200',    dot: 'bg-orange-500'  },
  EXIGE_CERTIFICADO: { label: 'Exige certificado',  pill: 'bg-violet-50 text-violet-700 border border-violet-200',    dot: 'bg-violet-500'  },
}

const STATUS_OPTIONS: CertidaoStatus[] = [
  'NAO_CONSULTADA',
  'REGULAR',
  'IRREGULAR',
  'CONSULTA_MANUAL',
  'INDISPONIVEL',
  'EXIGE_CERTIFICADO',
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatarDataBR(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function descricaoValidade(item: ChecklistItem): string | null {
  if (!item.validade) return null
  const dias = item.diasParaVencer
  if (dias === null) return `Válida até ${formatarDataBR(item.validade)}`
  if (dias < 0)     return `Vencida há ${Math.abs(dias)} dia${Math.abs(dias) !== 1 ? 's' : ''}`
  if (dias === 0)   return 'Vence hoje'
  if (dias <= 30)   return `Vence em ${dias} dia${dias !== 1 ? 's' : ''}`
  return `Válida até ${formatarDataBR(item.validade)}`
}

function classesValidade(dias: number | null): string {
  if (dias === null || dias > 30) return 'text-gray-400'
  if (dias < 0) return 'text-red-500 font-semibold'
  return 'text-amber-600 font-semibold'
}

// ─── StatusPill ───────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: CertidaoStatus }) {
  const cfg = STATUS_CFG[status]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-display font-bold ${cfg.pill}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} aria-hidden="true" />
      {cfg.label}
    </span>
  )
}

// ─── CertidaoCard ─────────────────────────────────────────────────────────────

interface CardProps {
  item: ChecklistItem
  cnpj: string
  expandido: boolean
  onToggle: () => void
  onSalvo: () => void
}

function CertidaoCard({ item, cnpj, expandido, onToggle, onSalvo }: CardProps) {
  const [form, setForm]           = useState({ status: item.status, validade: item.validade ?? '', observacoes: '' })
  const [salvando, setSalvando]   = useState(false)
  const [erroForm, setErroForm]   = useState<string | null>(null)
  const [uploadando, setUploadando] = useState(false)
  const fileRef                   = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setForm({ status: item.status, validade: item.validade ?? '', observacoes: '' })
    setErroForm(null)
  }, [item.status, item.validade])

  async function salvar() {
    setSalvando(true)
    setErroForm(null)
    try {
      const body: Record<string, string> = { tipo: item.tipo, status: form.status }
      if (form.validade)    body.validade    = form.validade
      if (form.observacoes) body.observacoes = form.observacoes

      const res = await apiFetch(`/certidoes/empresa/${cnpj}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setErroForm((json as { message?: string }).message ?? 'Não foi possível salvar.')
        return
      }

      onSalvo()
    } catch {
      setErroForm('Erro de rede. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  async function uploadPdf(file: File) {
    if (!item.certidaoId) return
    setUploadando(true)
    setErroForm(null)
    try {
      const fd = new FormData()
      fd.append('arquivo', file)
      const res = await apiFetch(`/certidoes/${item.certidaoId}/anexo`, {
        method: 'POST',
        body: fd,
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setErroForm((json as { message?: string }).message ?? 'Erro no upload.')
        return
      }
      onSalvo()
    } catch {
      setErroForm('Erro no upload. Tente novamente.')
    } finally {
      setUploadando(false)
    }
  }

  const isAlerta  = item.status === 'IRREGULAR' || (item.diasParaVencer !== null && item.diasParaVencer >= 0 && item.diasParaVencer <= 30)
  const descVal   = descricaoValidade(item)
  const classVal  = classesValidade(item.diasParaVencer)

  return (
    <div
      className={`border rounded-2xl overflow-hidden transition-colors ${
        item.status === 'IRREGULAR'
          ? 'border-red-200 bg-red-50/30'
          : isAlerta
          ? 'border-amber-200 bg-amber-50/20'
          : 'border-gray-100 bg-white'
      }`}
    >
      {/* Cabeçalho do card */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-display font-bold text-depth text-sm leading-tight">{item.label}</p>
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <StatusPill status={item.status} />
              {item.automatizavel && (
                <span className="text-[11px] font-display font-bold text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded-full">
                  Automático
                </span>
              )}
            </div>
            {descVal && (
              <p className={`text-xs mt-1.5 font-body ${classVal}`}>{descVal}</p>
            )}
            {item.dataConsulta && (
              <p className="text-[11px] text-gray-400 font-body mt-0.5">
                Consultada em {new Date(item.dataConsulta).toLocaleDateString('pt-BR')}
              </p>
            )}
          </div>

          {/* Botões */}
          <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
            <button
              onClick={onToggle}
              className={`text-xs font-display font-bold px-3 py-1.5 rounded-xl border transition-colors ${
                expandido
                  ? 'bg-depth text-white border-depth'
                  : 'text-primary border-primary/30 hover:bg-primary/5'
              }`}
            >
              {expandido ? 'Cancelar' : 'Registrar'}
            </button>

            {item.certidaoId && (
              <>
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploadando}
                  className="text-xs font-display font-bold px-3 py-1.5 rounded-xl border border-gray-200 text-gray-500 hover:text-depth hover:border-gray-300 transition-colors disabled:opacity-40"
                >
                  {uploadando ? 'Enviando…' : 'Upload PDF'}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) uploadPdf(file)
                    e.target.value = ''
                  }}
                />
              </>
            )}

            {item.urlArquivo && (
              <a
                href={item.urlArquivo}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-display font-bold px-3 py-1.5 rounded-xl border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition-colors text-center"
              >
                Baixar PDF
              </a>
            )}
          </div>
        </div>

        {erroForm && !expandido && (
          <p className="mt-2 text-xs text-danger font-display font-bold flex items-center gap-1">
            <span aria-hidden="true">⚠</span> {erroForm}
          </p>
        )}
      </div>

      {/* Formulário expandido */}
      {expandido && (
        <div className="border-t border-gray-100 bg-gray-50/80 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">
                Status
              </label>
              <select
                value={form.status}
                onChange={(e) => setForm(f => ({ ...f, status: e.target.value as CertidaoStatus }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"
              >
                {STATUS_OPTIONS.map(s => (
                  <option key={s} value={s}>{STATUS_CFG[s].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">
                Validade
              </label>
              <input
                type="date"
                value={form.validade}
                onChange={(e) => setForm(f => ({ ...f, validade: e.target.value }))}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">
              Observações
            </label>
            <textarea
              value={form.observacoes}
              onChange={(e) => setForm(f => ({ ...f, observacoes: e.target.value }))}
              rows={2}
              placeholder="Opcional"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white resize-none"
            />
          </div>

          {erroForm && (
            <p className="text-xs text-danger font-display font-bold flex items-center gap-1">
              <span aria-hidden="true">⚠</span> {erroForm}
            </p>
          )}

          <button
            onClick={salvar}
            disabled={salvando}
            className="bg-primary text-white font-display font-bold text-sm px-5 py-2 rounded-xl hover:bg-depth transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── CertidoesTab (exportado) ─────────────────────────────────────────────────

export function CertidoesTab({ cnpj }: { cnpj: string }) {
  const [itens, setItens]                       = useState<ChecklistItem[]>([])
  const [carregando, setCarregando]             = useState(true)
  const [erro, setErro]                         = useState<string | null>(null)
  const [expandido, setExpandido]               = useState<string | null>(null)
  const [consultandoAuto, setConsultandoAuto]   = useState(false)
  const [erroAuto, setErroAuto]                 = useState<string | null>(null)

  async function carregar() {
    setCarregando(true)
    setErro(null)
    try {
      const res  = await apiFetch(`/certidoes/checklist/${cnpj}`)
      const json = await res.json()
      if (!res.ok) {
        setErro((json as { message?: string }).message ?? 'Não foi possível carregar as certidões.')
        return
      }
      setItens(json as ChecklistItem[])
    } catch {
      setErro('Erro de rede ao carregar certidões.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    if (cnpj) carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cnpj])

  async function consultarAuto() {
    setConsultandoAuto(true)
    setErroAuto(null)
    try {
      const res = await apiFetch(`/certidoes/consultar/${cnpj}`, { method: 'POST' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setErroAuto((json as { message?: string }).message ?? 'Erro na consulta automática.')
        return
      }
      await carregar()
    } catch {
      setErroAuto('Erro de rede. Tente novamente.')
    } finally {
      setConsultandoAuto(false)
    }
  }

  function onSalvo() {
    setExpandido(null)
    carregar()
  }

  const regulares   = itens.filter(i => i.status === 'REGULAR').length
  const irregulares = itens.filter(i => i.status === 'IRREGULAR').length
  const vencendo    = itens.filter(i =>
    i.status !== 'IRREGULAR' &&
    i.diasParaVencer !== null &&
    i.diasParaVencer >= 0 &&
    i.diasParaVencer <= 30
  ).length

  if (carregando) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400 font-body text-sm">
        Carregando certidões…
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
    <div className="space-y-4">
      {/* Resumo + ação */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-display font-black text-depth text-2xl">{regulares}</span>
          <span className="text-gray-400 font-body text-sm">de {itens.length} regulares</span>
          {irregulares > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-50 text-red-700 border border-red-200 text-xs font-display font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" aria-hidden="true" />
              {irregulares} irregular{irregulares !== 1 ? 'es' : ''}
            </span>
          )}
          {vencendo > 0 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs font-display font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden="true" />
              {vencendo} vencendo em breve
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {erroAuto && (
            <span className="text-xs text-danger font-display font-bold" role="alert">
              ⚠ {erroAuto}
            </span>
          )}
          <button
            onClick={consultarAuto}
            disabled={consultandoAuto}
            className="text-sm font-display font-bold px-4 py-2 rounded-xl border border-primary/30 text-primary hover:bg-primary/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {consultandoAuto ? 'Consultando…' : 'Consultar automaticamente'}
          </button>
        </div>
      </div>

      {/* Grid de certidões */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {itens.map((item) => (
          <CertidaoCard
            key={item.tipo}
            item={item}
            cnpj={cnpj}
            expandido={expandido === item.tipo}
            onToggle={() => setExpandido(prev => prev === item.tipo ? null : item.tipo)}
            onSalvo={onSalvo}
          />
        ))}
      </div>

      <p className="text-xs text-gray-400 font-body">
        Certidões marcadas como "Automático" podem ser atualizadas via scraper. As demais exigem registro manual.
      </p>
    </div>
  )
}
