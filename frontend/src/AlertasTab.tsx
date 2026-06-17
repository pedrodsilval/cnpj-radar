import { useState, useEffect } from 'react'
import { apiFetch } from './auth'

interface Alerta {
  id: string
  cnpj: string
  tipo: string
  status: 'IRREGULAR' | 'REGULAR'
  validade: string | null
  diasParaVencer: number | null
  dataConsulta: string | null
}

const TIPO_LABEL: Record<string, string> = {
  FGTS_CRF:            'FGTS / CRF',
  CND_FEDERAL:         'CND Federal / PGFN',
  CNDT_TRABALHISTA:    'CNDT Trabalhista',
  INSCRICAO_ESTADUAL:  'Inscrição Estadual',
  INSCRICAO_MUNICIPAL: 'Inscrição Municipal',
  CERTIDAO_ESTADUAL:   'Certidão Estadual',
  CERTIDAO_MUNICIPAL:  'Certidão Municipal',
  DIVIDA_ATIVA_UNIAO:  'Dívida Ativa da União',
  DIVIDA_ATIVA:        'Dívida Ativa da União',
  ESTADUAL:            'Certidão Estadual',
  MUNICIPAL:           'Certidão Municipal',
}

function formatarCnpj(cnpj: string): string {
  if (/^\d{14}$/.test(cnpj))
    return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  return cnpj
}

function descricaoValidade(dias: number | null, validade: string | null): string {
  if (!validade) return 'Sem data registrada'
  if (dias === null) return `Válida até ${validade}`
  if (dias < 0) return `Vencida há ${Math.abs(dias)} dia${Math.abs(dias) !== 1 ? 's' : ''}`
  if (dias === 0) return 'Vence hoje'
  return `Vence em ${dias} dia${dias !== 1 ? 's' : ''}`
}

function AlertaCard({ alerta }: { alerta: Alerta }) {
  const irregular = alerta.status === 'IRREGULAR'
  const urgente   = !irregular && alerta.diasParaVencer !== null && alerta.diasParaVencer <= 7

  return (
    <div className={`flex items-center justify-between gap-4 px-4 py-3 rounded-2xl border ${
      irregular ? 'bg-red-50/40 border-red-200'
      : urgente  ? 'bg-amber-50/60 border-amber-300'
                 : 'bg-white border-gray-100'
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-display font-black text-depth text-sm">
            {formatarCnpj(alerta.cnpj)}
          </span>
          <span className={`text-xs font-display font-bold px-2 py-0.5 rounded-full ${
            irregular ? 'bg-red-100 text-red-700'
            : urgente  ? 'bg-amber-100 text-amber-700'
                       : 'bg-gray-100 text-gray-600'
          }`}>
            {TIPO_LABEL[alerta.tipo] ?? alerta.tipo}
          </span>
        </div>
        <p className={`text-xs font-body mt-0.5 ${
          irregular ? 'text-red-600 font-semibold'
          : urgente  ? 'text-amber-700 font-semibold'
                     : 'text-gray-400'
        }`}>
          {irregular ? 'Irregular — requer atenção imediata' : descricaoValidade(alerta.diasParaVencer, alerta.validade)}
        </p>
      </div>
      {alerta.dataConsulta && (
        <p className="text-[11px] text-gray-400 font-body flex-shrink-0">
          Consultada {new Date(alerta.dataConsulta).toLocaleDateString('pt-BR')}
        </p>
      )}
    </div>
  )
}

export function AlertasTab() {
  const [alertas, setAlertas]       = useState<Alerta[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro]             = useState<string | null>(null)
  const [dias, setDias]             = useState(30)

  async function carregar(d: number) {
    setCarregando(true)
    setErro(null)
    try {
      const res  = await apiFetch(`/certidoes/alertas?dias=${d}`)
      const json = await res.json()
      if (!res.ok) {
        setErro((json as { message?: string }).message ?? 'Não foi possível carregar os alertas.')
        return
      }
      setAlertas(json as Alerta[])
    } catch {
      setErro('Erro de rede ao carregar alertas.')
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => { carregar(dias) }, [dias])

  const irregulares = alertas.filter(a => a.status === 'IRREGULAR')
  const vencendo    = alertas.filter(a => a.status !== 'IRREGULAR')

  if (carregando) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400 font-body text-sm">
        Carregando alertas…
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
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-display font-black text-depth text-lg">Alertas de Certidões</h2>
          <p className="text-gray-400 font-body text-sm mt-0.5">
            Certidões com problema em todos os leads cadastrados
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs font-display font-bold text-gray-500 uppercase tracking-wide">
              Janela:
            </label>
            <select
              value={dias}
              onChange={e => setDias(Number(e.target.value))}
              className="border border-gray-200 rounded-xl px-3 py-1.5 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"
            >
              <option value={15}>15 dias</option>
              <option value={30}>30 dias</option>
              <option value={60}>60 dias</option>
              <option value={90}>90 dias</option>
            </select>
          </div>
          <a
            href="/certidoes/relatorio-pendencias"
            download
            className="text-sm font-display font-bold px-4 py-2 rounded-xl border border-gray-200 text-gray-500 hover:text-depth hover:border-gray-300 transition-colors whitespace-nowrap"
          >
            Baixar relatório PDF
          </a>
        </div>
      </div>

      {alertas.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
          <p className="font-display font-bold text-gray-300 text-3xl mb-2">✓</p>
          <p className="font-display font-bold text-gray-400 text-sm">
            Nenhum alerta nos próximos {dias} dias.
          </p>
        </div>
      ) : (
        <>
          {irregulares.length > 0 && (
            <section>
              <h3 className="font-display font-bold text-red-600 text-xs uppercase tracking-widest mb-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" aria-hidden="true" />
                Irregulares ({irregulares.length})
              </h3>
              <div className="space-y-2">
                {irregulares.map(a => <AlertaCard key={a.id} alerta={a} />)}
              </div>
            </section>
          )}

          {vencendo.length > 0 && (
            <section className={irregulares.length > 0 ? 'pt-2' : ''}>
              <h3 className="font-display font-bold text-amber-600 text-xs uppercase tracking-widest mb-2 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" aria-hidden="true" />
                Vencendo em até {dias} dias ({vencendo.length})
              </h3>
              <div className="space-y-2">
                {vencendo.map(a => <AlertaCard key={a.id} alerta={a} />)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

export function useContagemAlertas() {
  const [count, setCount] = useState<number>(0)

  useEffect(() => {
    apiFetch('/certidoes/alertas?dias=30')
      .then(r => r.json())
      .then((data: unknown) => { if (Array.isArray(data)) setCount(data.length) })
      .catch(() => {})
  }, [])

  return count
}
