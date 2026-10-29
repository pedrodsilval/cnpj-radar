import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from './auth'
import { CertidoesTab } from './CertidoesTab'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Empresa {
  id: string
  cnpj: string
  razaoSocial: string
  situacaoCadastral: string
  porte: string | null
  inscricaoMobiliaria: string | null
  cga: string | null
  inscricaoEstadual: string | null
  pastaDriveId: string | null
}

interface CertificadoPublico {
  id: string
  tipo: string
  titular: string | null
  validade: string | null
  nomeArquivo: string
  criadoEm: string
}

interface PgdasDeclaracao {
  id: string
  periodoApuracao: string
  rbt12: number
  receitaBrutaMes: number | null
  nomeArquivo: string
  criadoEm: string
}

interface RelatorioGerado {
  id: string
  urlArquivo: string
  nomeArquivo: string
  criadoEm: string
}

type PendenciaSeveridade = 'alerta' | 'pendente'

interface PendenciaTag {
  tipo: string
  label: string
  status: string
  severidade: PendenciaSeveridade
}

interface ResumoClienteCertidoes {
  empresaId: string
  cnpj: string
  pendencias: PendenciaTag[]
  elegivelLote: boolean
}

// Sigla curta pra cada tipo de certidão — um atalho por pendência, em vez de
// agrupar em blocos F/M/E (pedido da Itauana, 28/10/2026: cada tipo pendente
// ganha sua própria tag, acumulando quantas forem necessárias).
const TIPO_SIGLA: Record<string, string> = {
  CND_FEDERAL: 'CND-F',
  FGTS_CRF: 'FGTS',
  CNDT_TRABALHISTA: 'CNDT',
  DIVIDA_ATIVA: 'DAU',
  ESTADUAL: 'EST',
  MUNICIPAL: 'MUN',
  INSCRICAO_ESTADUAL: 'IE',
  INSCRICAO_MUNICIPAL: 'IM',
}

const LIMITE_ME = 360_000

// Baixa um arquivo autenticado — um <a href download> comum não envia o
// header Authorization, então o backend respondia 401 antes desse fetch+blob.
async function baixarArquivo(url: string, nomeArquivo: string): Promise<void> {
  const res = await apiFetch(url)
  if (!res.ok) return
  const blob = await res.blob()
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = nomeArquivo
  a.click()
  URL.revokeObjectURL(blobUrl)
}

function formatarMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatarPeriodo(periodo: string): string {
  const [ano, mes] = periodo.split('-')
  return `${mes}/${ano}`
}

function formatarCnpj(cnpj: string): string {
  if (/^\d{14}$/.test(cnpj)) {
    return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  }
  return cnpj
}

function diasParaVencer(validade: string | null): number | null {
  if (!validade) return null
  const ms = new Date(validade).getTime() - Date.now()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

// ─── PastaDriveCliente ────────────────────────────────────────────────────────

interface PastaCandidata {
  id: string
  nome: string
  pontuacao: number
}

function PastaDriveCliente({ empresaId, cnpj, razaoSocial, pastaDriveIdInicial, pendencias }: {
  empresaId: string
  cnpj: string
  razaoSocial: string
  pastaDriveIdInicial: string | null
  pendencias: PendenciaTag[]
}) {
  const [pastaAtual, setPastaAtual] = useState(pastaDriveIdInicial)
  const [buscando, setBuscando] = useState(false)
  const [candidatos, setCandidatos] = useState<PastaCandidata[] | null>(null)
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [editandoManual, setEditandoManual] = useState(false)
  const [valorManual, setValorManual] = useState('')
  const [salvandoManual, setSalvandoManual] = useState(false)

  const [confirmandoEnvioComPendencia, setConfirmandoEnvioComPendencia] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [resultadoEnvio, setResultadoEnvio] = useState<string | null>(null)

  async function enviarAgora() {
    setEnviando(true); setResultadoEnvio(null); setErro(null)
    try {
      const res = await apiFetch(`/relatorios/pre-analise/${cnpj}/drive`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) { setErro((json as { message?: string }).message ?? 'Não foi possível enviar.'); return }
      setResultadoEnvio(`✓ Enviado: ${(json as { nomeArquivo: string }).nomeArquivo}`)
      setConfirmandoEnvioComPendencia(false)
    } catch { setErro('Erro de rede ao enviar.') }
    finally { setEnviando(false) }
  }

  function clicarEnviar() {
    setResultadoEnvio(null)
    if (pendencias.length > 0) { setConfirmandoEnvioComPendencia(true); return }
    void enviarAgora()
  }

  async function buscarCandidatos() {
    setBuscando(true); setErro(null); setCandidatos(null)
    try {
      const res = await apiFetch(`/empresas/${empresaId}/drive/candidatos`)
      const json = await res.json()
      if (!res.ok) { setErro((json as { message?: string }).message ?? 'Não foi possível buscar sugestões.'); return }
      const lista = json as PastaCandidata[]
      if (lista.length === 0) setErro('Nenhuma pasta parecida encontrada na pasta raiz. Use "Colar link manualmente".')
      else setCandidatos(lista)
    } catch { setErro('Erro de rede ao buscar sugestões.') }
    finally { setBuscando(false) }
  }

  async function confirmar(pastaClienteId: string) {
    setConfirmando(pastaClienteId); setErro(null)
    try {
      const res = await apiFetch(`/empresas/${empresaId}/drive/confirmar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pastaClienteId }),
      })
      const json = await res.json()
      if (!res.ok) { setErro((json as { message?: string }).message ?? 'Não foi possível confirmar a pasta.'); return }
      setPastaAtual((json as { pastaDriveId: string }).pastaDriveId)
      setCandidatos(null)
    } catch { setErro('Erro de rede ao confirmar a pasta.') }
    finally { setConfirmando(null) }
  }

  async function salvarManual() {
    setSalvandoManual(true); setErro(null)
    try {
      const res = await apiFetch(`/empresas/${empresaId}/drive`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pastaDriveId: valorManual || null }),
      })
      if (!res.ok) { setErro('Não foi possível salvar a pasta.'); return }
      setPastaAtual(valorManual || null)
      setEditandoManual(false)
    } catch { setErro('Erro de rede ao salvar.') }
    finally { setSalvandoManual(false) }
  }

  return (
    <div className="pt-3 border-t border-gray-100">
      <p className="text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-2">Pasta no Drive</p>

      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-xs font-body text-gray-600">
          {pastaAtual ? <span className="text-emerald-600 font-display font-bold">✓ Configurada</span> : 'Não configurada'}
        </span>
        <button onClick={buscarCandidatos} disabled={buscando}
          className="text-xs font-display font-bold text-primary hover:underline disabled:opacity-50">
          {buscando ? 'Buscando…' : `Buscar automaticamente (${razaoSocial.split(' ')[0]})`}
        </button>
        <button onClick={() => { setEditandoManual(v => !v); setValorManual(pastaAtual ?? '') }}
          className="text-xs font-display font-bold text-gray-500 hover:underline">
          Colar link manualmente
        </button>
      </div>

      {editandoManual && (
        <div className="flex items-center gap-2 mb-2">
          <input type="text" value={valorManual} onChange={e => setValorManual(e.target.value)}
            placeholder="ID ou link da pasta no Drive" autoComplete="off"
            className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"/>
          <button onClick={salvarManual} disabled={salvandoManual}
            className="text-xs font-display font-bold text-primary hover:underline disabled:opacity-50">
            {salvandoManual ? '…' : 'Salvar'}
          </button>
        </div>
      )}

      {candidatos && (
        <div className="space-y-1.5 mb-2">
          {candidatos.map(c => (
            <div key={c.id} className="bg-gray-50 rounded-xl px-3 py-2 flex items-center justify-between gap-2 text-xs font-body">
              <span className="text-depth">{c.nome}</span>
              <button onClick={() => confirmar(c.id)} disabled={confirmando === c.id}
                className="text-xs font-display font-bold bg-primary text-white px-3 py-1 rounded-lg hover:bg-depth transition-colors disabled:opacity-50 whitespace-nowrap">
                {confirmando === c.id ? 'Confirmando…' : 'É essa'}
              </button>
            </div>
          ))}
        </div>
      )}

      {erro && <p className="text-xs text-danger font-display font-bold mb-2">⚠ {erro}</p>}

      {pastaAtual && (
        <div className="pt-2 border-t border-gray-100">
          <button onClick={clicarEnviar} disabled={enviando}
            className="text-xs font-display font-bold bg-depth text-white px-3 py-1.5 rounded-lg hover:bg-primary transition-colors disabled:opacity-50">
            {enviando ? 'Enviando…' : 'Enviar relatório pro Drive agora'}
          </button>
          {resultadoEnvio && <p className="text-xs text-emerald-600 font-body mt-1.5">{resultadoEnvio}</p>}

          {confirmandoEnvioComPendencia && (
            <div className="mt-2 bg-amber-50 border border-amber-300 rounded-xl px-3 py-2.5">
              <p className="text-xs font-display font-bold text-amber-800 mb-1">
                ⚠ Esse cliente NÃO está 100% regular — tem {pendencias.length} pendência{pendencias.length > 1 ? 's' : ''}:
              </p>
              <div className="flex flex-wrap gap-1 mb-2">
                {pendencias.map(p => (
                  <span key={p.tipo} className={`text-[11px] font-display font-bold px-1.5 py-0.5 rounded-full border ${
                    p.severidade === 'alerta' ? 'text-red-700 bg-red-50 border-red-200' : 'text-amber-700 bg-amber-100 border-amber-300'
                  }`}>
                    {p.label}
                  </span>
                ))}
              </div>
              <p className="text-xs text-amber-700 font-body mb-2">
                O relatório enviado vai refletir esse(s) problema(s) — confirma que quer enviar mesmo assim?
              </p>
              <div className="flex gap-2">
                <button onClick={enviarAgora} disabled={enviando}
                  className="text-xs font-display font-bold bg-amber-600 text-white px-3 py-1.5 rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50">
                  {enviando ? 'Enviando…' : 'Enviar mesmo assim'}
                </button>
                <button onClick={() => setConfirmandoEnvioComPendencia(false)}
                  className="text-xs font-display font-medium text-gray-500 hover:text-depth">
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Modal de cadastro/edição ───────────────────────────────────────────────────

interface ModalProps {
  empresa?: Empresa
  certificadoInicial?: CertificadoPublico | null
  pendencias?: PendenciaTag[]
  onSalvo: () => void
  onFechar: () => void
}

function ModalEmpresa({ empresa, certificadoInicial, pendencias, onSalvo, onFechar }: ModalProps) {
  const editando = !!empresa
  const [cnpj, setCnpj] = useState(empresa?.cnpj ?? '')
  const [razaoSocial, setRazaoSocial] = useState(empresa?.razaoSocial ?? '')
  const [inscricaoMobiliaria, setInscricaoMobiliaria] = useState(empresa?.inscricaoMobiliaria ?? '')
  const [cga, setCga] = useState(empresa?.cga ?? '')
  const [inscricaoEstadual, setInscricaoEstadual] = useState(empresa?.inscricaoEstadual ?? '')
  const [buscando, setBuscando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const [certificado, setCertificado] = useState(certificadoInicial ?? null)
  const [tipo, setTipo] = useState<'A1' | 'A3'>('A1')
  const [titular, setTitular] = useState('')
  const [validade, setValidade] = useState('')
  const [senha, setSenha] = useState('')
  const [enviandoCert, setEnviandoCert] = useState(false)
  const [erroCert, setErroCert] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [arquivoSelecionado, setArquivoSelecionado] = useState<File | null>(null)
  const [removendo, setRemovendo] = useState(false)

  const [pgdasDeclaracoes, setPgdasDeclaracoes] = useState<PgdasDeclaracao[]>([])
  const [carregandoPgdas, setCarregandoPgdas] = useState(false)
  const [enviandoPgdas, setEnviandoPgdas] = useState(false)
  const [erroPgdas, setErroPgdas] = useState<string | null>(null)
  const pgdasFileRef = useRef<HTMLInputElement>(null)
  const [arquivoPgdasSelecionado, setArquivoPgdasSelecionado] = useState<File | null>(null)

  const [relatoriosGerados, setRelatoriosGerados] = useState<RelatorioGerado[]>([])
  const [carregandoRelatorios, setCarregandoRelatorios] = useState(false)

  const carregarRelatorios = useCallback(async () => {
    if (!empresa) return
    setCarregandoRelatorios(true)
    try {
      const res = await apiFetch(`/relatorios/gerados/${empresa.cnpj}`)
      if (res.ok) setRelatoriosGerados(await res.json() as RelatorioGerado[])
    } catch { /* silencioso — histórico não é crítico pro resto do modal */ }
    finally { setCarregandoRelatorios(false) }
  }, [empresa])

  useEffect(() => { void carregarRelatorios() }, [carregarRelatorios])

  async function buscarDadosReceita() {
    const limpo = cnpj.replace(/\D/g, '')
    if (limpo.length < 11) { setErro('Informe um CNPJ válido antes de buscar.'); return }
    setBuscando(true); setErro(null)
    try {
      const res = await apiFetch(`/cnpj/${limpo}`)
      const json = await res.json()
      if (!res.ok || 'error' in json) { setErro('Não foi possível buscar esse CNPJ na Receita — preencha manualmente.'); return }
      setRazaoSocial(json.dados?.razaoSocial ?? razaoSocial)
    } catch { setErro('Erro de rede ao buscar CNPJ.') }
    finally { setBuscando(false) }
  }

  async function salvar() {
    if (!cnpj.replace(/\D/g, '') || !razaoSocial.trim()) { setErro('CNPJ e razão social são obrigatórios.'); return }
    setSalvando(true); setErro(null)
    try {
      const url = editando ? `/empresas/${empresa!.id}` : '/empresas'
      const method = editando ? 'PATCH' : 'POST'
      const body = editando
        ? { razaoSocial, inscricaoMobiliaria: inscricaoMobiliaria || null, cga: cga || null, inscricaoEstadual: inscricaoEstadual || null }
        : { cnpj, razaoSocial, inscricaoMobiliaria: inscricaoMobiliaria || null, cga: cga || null, inscricaoEstadual: inscricaoEstadual || null }
      const res = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setErro((json as { message?: string }).message ?? 'Não foi possível salvar.')
        return
      }
      onSalvo()
    } catch { setErro('Erro de rede.') }
    finally { setSalvando(false) }
  }

  async function enviarCertificado() {
    if (!empresa) return
    if (!arquivoSelecionado) { setErroCert('Selecione o arquivo .pfx/.p12.'); return }
    if (!senha) { setErroCert('Informe a senha do certificado.'); return }
    setEnviandoCert(true); setErroCert(null)
    try {
      const fd = new FormData()
      fd.append('arquivo', arquivoSelecionado)
      fd.append('tipo', tipo)
      fd.append('senha', senha)
      if (titular) fd.append('titular', titular)
      if (validade) fd.append('validade', validade)
      const res = await apiFetch(`/empresas/${empresa.id}/certificado`, { method: 'POST', body: fd })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setErroCert((json as { message?: string }).message ?? 'Não foi possível enviar o certificado.')
        return
      }
      const novo = await res.json() as CertificadoPublico
      setCertificado(novo)
      setSenha(''); setArquivoSelecionado(null); setTitular(''); setValidade('')
      if (fileRef.current) fileRef.current.value = ''
    } catch { setErroCert('Erro de rede no upload.') }
    finally { setEnviandoCert(false) }
  }

  async function removerCertificado() {
    if (!empresa || !confirm('Remover o certificado digital desta empresa?')) return
    await apiFetch(`/empresas/${empresa.id}/certificado`, { method: 'DELETE' })
    setCertificado(null)
  }

  async function removerEmpresa() {
    if (!empresa) return
    if (!confirm(`Excluir "${empresa.razaoSocial}"? Isso remove também certidões, anexos e certificado digital vinculados. Não pode ser desfeito.`)) return
    setRemovendo(true); setErro(null)
    try {
      const res = await apiFetch(`/empresas/${empresa.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setErro((json as { message?: string }).message ?? 'Não foi possível excluir a empresa.')
        return
      }
      onSalvo()
    } catch { setErro('Erro de rede.') }
    finally { setRemovendo(false) }
  }

  const carregarPgdas = useCallback(async () => {
    if (!empresa) return
    setCarregandoPgdas(true)
    try {
      const res = await apiFetch(`/pgdas/${empresa.id}`)
      if (res.ok) setPgdasDeclaracoes(await res.json() as PgdasDeclaracao[])
    } catch { /* silencioso — não é crítico pro resto do modal funcionar */ }
    finally { setCarregandoPgdas(false) }
  }, [empresa])

  useEffect(() => { void carregarPgdas() }, [carregarPgdas])

  async function enviarPgdas() {
    if (!empresa) return
    if (!arquivoPgdasSelecionado) { setErroPgdas('Selecione o PDF do recibo do PGDAS-D.'); return }
    setEnviandoPgdas(true); setErroPgdas(null)
    try {
      const fd = new FormData()
      fd.append('arquivo', arquivoPgdasSelecionado)
      const res = await apiFetch(`/pgdas/${empresa.id}`, { method: 'POST', body: fd })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setErroPgdas((json as { message?: string }).message ?? 'Não foi possível processar o PGDAS-D.')
        return
      }
      setArquivoPgdasSelecionado(null)
      if (pgdasFileRef.current) pgdasFileRef.current.value = ''
      await carregarPgdas()
    } catch { setErroPgdas('Erro de rede no upload.') }
    finally { setEnviandoPgdas(false) }
  }

  const dias = diasParaVencer(certificado?.validade ?? null)

  const ultimoPgdas = pgdasDeclaracoes[0] ?? null
  const alertaEnquadramento = ultimoPgdas && /^\s*me\s*$|micro\s*empresa/i.test(empresa?.porte ?? '') && ultimoPgdas.rbt12 > LIMITE_ME
    ? ultimoPgdas
    : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-depth/60 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-[24px] shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <h2 className="font-display font-black text-depth text-base">{editando ? 'Editar empresa' : 'Nova empresa'}</h2>
          <button onClick={onFechar} aria-label="Fechar" className="text-gray-400 hover:text-depth transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">CNPJ *</label>
            <div className="flex gap-2">
              <input type="text" value={cnpj} onChange={e => setCnpj(e.target.value)} disabled={editando} placeholder="00.000.000/0000-00" autoComplete="off"
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white disabled:bg-gray-50 disabled:text-gray-400"/>
              {!editando && (
                <button onClick={buscarDadosReceita} disabled={buscando}
                  className="text-xs font-display font-bold px-3 py-2 rounded-xl border border-gray-200 text-gray-500 hover:text-depth hover:border-gray-300 transition-colors disabled:opacity-40 whitespace-nowrap">
                  {buscando ? 'Buscando…' : 'Buscar dados'}
                </button>
              )}
            </div>
          </div>
          <div>
            <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">Razão social *</label>
            <input type="text" value={razaoSocial} onChange={e => setRazaoSocial(e.target.value)} autoComplete="off"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">Inscrição Mobiliária</label>
              <input type="text" value={inscricaoMobiliaria} onChange={e => setInscricaoMobiliaria(e.target.value)} placeholder="Lauro de Freitas" autoComplete="off"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"/>
            </div>
            <div>
              <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">CGA</label>
              <input type="text" value={cga} onChange={e => setCga(e.target.value)} placeholder="Salvador" autoComplete="off"
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"/>
            </div>
          </div>
          <div>
            <label className="block text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-1">Inscrição Estadual</label>
            <input type="text" value={inscricaoEstadual} onChange={e => setInscricaoEstadual(e.target.value)} autoComplete="off"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"/>
          </div>
          {erro && <p className="text-xs text-danger font-display font-bold">⚠ {erro}</p>}

          {editando && (
            <div className="pt-3 border-t border-gray-100">
              <p className="text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-2">Certificado digital</p>

              {certificado ? (
                <div className="bg-gray-50 rounded-xl px-3 py-2.5 flex items-start justify-between gap-2 mb-3">
                  <div className="text-xs font-body text-depth">
                    <p className="font-display font-bold">{certificado.tipo} · {certificado.nomeArquivo}</p>
                    {certificado.titular && <p className="text-gray-500 mt-0.5">{certificado.titular}</p>}
                    {certificado.validade && (
                      <p className={`mt-0.5 ${dias !== null && dias <= 30 ? 'text-danger font-bold' : 'text-gray-500'}`}>
                        Validade: {certificado.validade.split('-').reverse().join('/')}
                        {dias !== null && (dias < 0 ? ' — vencido' : dias <= 30 ? ` — vence em ${dias}d` : '')}
                      </p>
                    )}
                  </div>
                  <button onClick={removerCertificado} className="text-xs font-display font-bold text-danger hover:underline whitespace-nowrap">Remover</button>
                </div>
              ) : (
                <p className="text-xs text-gray-400 font-body mb-3">Nenhum certificado cadastrado.</p>
              )}

              <div className="space-y-2.5">
                <div className="flex gap-2">
                  <button onClick={() => fileRef.current?.click()}
                    className="text-xs font-display font-bold px-3 py-2 rounded-xl border border-gray-200 text-gray-500 hover:text-depth hover:border-gray-300 transition-colors whitespace-nowrap">
                    {arquivoSelecionado ? arquivoSelecionado.name : 'Escolher arquivo (.pfx/.p12)'}
                  </button>
                  <input ref={fileRef} type="file" accept=".pfx,.p12" className="hidden"
                    onChange={e => setArquivoSelecionado(e.target.files?.[0] ?? null)} />
                  <select value={tipo} onChange={e => setTipo(e.target.value as 'A1' | 'A3')}
                    className="border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white">
                    <option value="A1">A1</option>
                    <option value="A3">A3</option>
                  </select>
                </div>
                <input type="password" value={senha} onChange={e => setSenha(e.target.value)} placeholder="Senha do certificado" autoComplete="new-password"
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"/>
                <div className="grid grid-cols-2 gap-2">
                  <input type="text" value={titular} onChange={e => setTitular(e.target.value)} placeholder="Titular" autoComplete="off"
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"/>
                  <input type="date" value={validade} onChange={e => setValidade(e.target.value)}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"/>
                </div>
                {erroCert && <p className="text-xs text-danger font-display font-bold">⚠ {erroCert}</p>}
                <button onClick={enviarCertificado} disabled={enviandoCert}
                  className="text-xs font-display font-bold bg-depth text-white px-4 py-2 rounded-xl hover:bg-primary transition-colors disabled:opacity-50">
                  {enviandoCert ? 'Enviando…' : certificado ? 'Substituir certificado' : 'Salvar certificado'}
                </button>
              </div>
            </div>
          )}

          {editando && (
            <div className="pt-3 border-t border-gray-100">
              <p className="text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-2">PGDAS-D / Enquadramento Simples Nacional</p>

              {alertaEnquadramento && (
                <div className={`rounded-xl px-3 py-2.5 mb-3 text-xs font-body ${
                  alertaEnquadramento.rbt12 > LIMITE_ME * 1.2 ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-amber-50 border border-amber-300 text-amber-700'
                }`}>
                  <p className="font-display font-bold">
                    {alertaEnquadramento.rbt12 > LIMITE_ME * 1.2 ? '⚠ Reenquadramento EPP imediato' : '⚠ Excedeu o limite de ME'}
                  </p>
                  <p className="mt-0.5">
                    RBT12 de {formatarPeriodo(alertaEnquadramento.periodoApuracao)} é {formatarMoeda(alertaEnquadramento.rbt12)},
                    acima do limite de {formatarMoeda(LIMITE_ME)} pra Microempresa.
                    {alertaEnquadramento.rbt12 > LIMITE_ME * 1.2
                      ? ' Excesso maior que 20% — reenquadra pra EPP já a partir do mês seguinte.'
                      : ' Excesso até 20% — reenquadra pra EPP a partir de janeiro do ano seguinte.'}
                  </p>
                </div>
              )}

              {carregandoPgdas ? (
                <p className="text-xs text-gray-400 font-body mb-3">Carregando declarações…</p>
              ) : pgdasDeclaracoes.length > 0 ? (
                <div className="space-y-1.5 mb-3">
                  {pgdasDeclaracoes.map(d => (
                    <div key={d.id} className="bg-gray-50 rounded-xl px-3 py-2 flex items-center justify-between gap-2 text-xs font-body">
                      <span className="font-display font-bold text-depth">{formatarPeriodo(d.periodoApuracao)}</span>
                      <span className="text-gray-500">RBT12: {formatarMoeda(d.rbt12)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 font-body mb-3">Nenhum PGDAS-D enviado ainda.</p>
              )}

              <div className="flex gap-2">
                <button onClick={() => pgdasFileRef.current?.click()}
                  className="text-xs font-display font-bold px-3 py-2 rounded-xl border border-gray-200 text-gray-500 hover:text-depth hover:border-gray-300 transition-colors whitespace-nowrap">
                  {arquivoPgdasSelecionado ? arquivoPgdasSelecionado.name : 'Escolher recibo do PGDAS-D (.pdf)'}
                </button>
                <input ref={pgdasFileRef} type="file" accept=".pdf" className="hidden"
                  onChange={e => setArquivoPgdasSelecionado(e.target.files?.[0] ?? null)} />
                <button onClick={enviarPgdas} disabled={enviandoPgdas}
                  className="text-xs font-display font-bold bg-depth text-white px-4 py-2 rounded-xl hover:bg-primary transition-colors disabled:opacity-50 whitespace-nowrap">
                  {enviandoPgdas ? 'Enviando…' : 'Enviar'}
                </button>
              </div>
              {erroPgdas && <p className="text-xs text-danger font-display font-bold mt-2">⚠ {erroPgdas}</p>}
            </div>
          )}

          {editando && (
            <div className="pt-3 border-t border-gray-100">
              <p className="text-xs font-display font-bold text-gray-500 uppercase tracking-wide mb-2">Certidões</p>
              <CertidoesTab cnpj={empresa!.cnpj} onRelatorioGerado={carregarRelatorios} />

              <p className="text-xs font-display font-bold text-gray-500 uppercase tracking-wide mt-4 mb-2">Relatórios de pré-análise gerados</p>
              {carregandoRelatorios ? (
                <p className="text-xs text-gray-400 font-body">Carregando…</p>
              ) : relatoriosGerados.length > 0 ? (
                <div className="space-y-1.5">
                  {relatoriosGerados.map(r => (
                    <div key={r.id} className="bg-gray-50 rounded-xl px-3 py-2 flex items-center justify-between gap-2 text-xs font-body">
                      <span className="text-gray-500">{new Date(r.criadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                      <a href={r.urlArquivo} target="_blank" rel="noopener noreferrer" className="font-display font-bold text-primary hover:underline">Baixar</a>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 font-body">Nenhum relatório gerado ainda.</p>
              )}

              <PastaDriveCliente empresaId={empresa!.id} cnpj={empresa!.cnpj} razaoSocial={empresa!.razaoSocial} pastaDriveIdInicial={empresa!.pastaDriveId} pendencias={pendencias ?? []} />
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-2 flex-shrink-0">
          {editando ? (
            <button onClick={removerEmpresa} disabled={removendo}
              className="text-sm font-display font-bold text-danger px-4 py-2 rounded-lg hover:bg-danger/10 transition-colors disabled:opacity-50">
              {removendo ? 'Excluindo…' : 'Excluir empresa'}
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onFechar} className="text-sm font-display font-bold text-gray-500 px-4 py-2 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors">Cancelar</button>
            <button onClick={salvar} disabled={salvando} className="text-sm font-display font-bold bg-primary text-white px-5 py-2 rounded-lg hover:bg-depth transition-colors disabled:opacity-50">
              {salvando ? 'Salvando…' : editando ? 'Salvar' : 'Criar empresa'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── ClientesTab ──────────────────────────────────────────────────────────────

type FiltroPendencia = 'todos' | 'pendentes' | 'regulares'

export function ClientesTab() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [modal, setModal] = useState<{ aberto: boolean; empresa?: Empresa; certificado?: CertificadoPublico | null }>({ aberto: false })
  const [resumo, setResumo] = useState<Record<string, ResumoClienteCertidoes>>({})
  const [filtro, setFiltro] = useState<FiltroPendencia>('todos')
  const [baixandoLote, setBaixandoLote] = useState(false)
  const [enviandoDrive, setEnviandoDrive] = useState(false)
  const [resultadoDrive, setResultadoDrive] = useState<string | null>(null)

  const carregar = useCallback(async (signal?: AbortSignal) => {
    setCarregando(true); setErro(null)
    try {
      const q = busca ? `?busca=${encodeURIComponent(busca)}` : ''
      const res = await apiFetch(`/empresas${q}`, { signal })
      if (!res.ok) { setErro('Não foi possível carregar as empresas.'); return }
      setEmpresas(await res.json() as Empresa[])
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setErro('Erro de rede.')
      return
    }
    finally { if (!signal?.aborted) setCarregando(false) }
  }, [busca])

  const carregarResumo = useCallback(async () => {
    try {
      const res = await apiFetch('/certidoes/resumo-clientes')
      if (!res.ok) return
      const lista = await res.json() as ResumoClienteCertidoes[]
      setResumo(Object.fromEntries(lista.map(r => [r.empresaId, r])))
    } catch { /* badges de pendência não são críticas pro resto da tela funcionar */ }
  }, [])

  // AbortController evita que uma resposta antiga (ex: busca="l") sobrescreva
  // o resultado de uma busca mais recente (ex: busca="lyras") que chegou
  // primeiro — sem isso, digitar rápido podia deixar a lista com resultados
  // desatualizados até a próxima mudança na busca.
  useEffect(() => {
    const controller = new AbortController()
    void carregar(controller.signal)
    return () => controller.abort()
  }, [carregar])

  useEffect(() => { void carregarResumo() }, [carregarResumo])

  async function abrirEdicao(empresa: Empresa) {
    const res = await apiFetch(`/empresas/${empresa.id}`)
    if (!res.ok) { setModal({ aberto: true, empresa }); return }
    const { certificado } = await res.json() as { certificado: CertificadoPublico | null }
    setModal({ aberto: true, empresa, certificado })
  }

  function fecharModal() {
    setModal({ aberto: false })
    void carregarResumo()
  }

  async function baixarLote() {
    setBaixandoLote(true)
    try {
      const nome = `pre-analise-lote-${new Date().toISOString().slice(0, 10)}.zip`
      await baixarArquivo('/relatorios/pre-analise-lote', nome)
    } finally { setBaixandoLote(false) }
  }

  async function enviarParaDrive() {
    setEnviandoDrive(true)
    setResultadoDrive(null)
    try {
      const res = await apiFetch('/relatorios/pre-analise-lote/drive', { method: 'POST' })
      const json = await res.json() as { enviados?: number; total?: number; semPasta?: string[]; message?: string }
      if (!res.ok) { setResultadoDrive(json.message ?? 'Não foi possível enviar pro Drive.'); return }
      const semPasta = json.semPasta?.length
        ? ` — sem pasta configurada: ${json.semPasta.join(', ')}`
        : ''
      setResultadoDrive(`${json.enviados} de ${json.total} relatórios enviados pro Drive.${semPasta}`)
    } catch { setResultadoDrive('Erro de rede ao enviar pro Drive.') }
    finally { setEnviandoDrive(false) }
  }

  const elegiveisLote = Object.values(resumo).filter(r => r.elegivelLote).length

  const empresasFiltradas = empresas.filter(e => {
    if (filtro === 'todos') return true
    const r = resumo[e.id]
    const temPendencia = r ? r.pendencias.length > 0 : true // sem resumo carregado ainda = trata como pendente, não esconde
    return filtro === 'pendentes' ? temPendencia : !temPendencia
  })

  return (
    <>
      {modal.aberto && (
        <ModalEmpresa
          empresa={modal.empresa}
          certificadoInicial={modal.certificado}
          pendencias={modal.empresa ? resumo[modal.empresa.id]?.pendencias : undefined}
          onFechar={fecharModal}
          onSalvo={() => { setModal({ aberto: false }); void carregar(); void carregarResumo() }}
        />
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-display font-black text-depth text-lg">Clientes</h2>
            <p className="text-gray-400 font-body text-sm mt-0.5">Cadastro de empresas — inscrições municipais/estaduais e certificado digital.</p>
          </div>
          <div className="flex items-center gap-2">
            <input type="text" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por CNPJ ou razão social" autoComplete="off"
              className="border border-gray-200 rounded-xl px-3 py-1.5 text-sm font-body text-depth focus:outline-none focus:ring-2 focus:ring-primary bg-white"/>
            <button onClick={() => setModal({ aberto: true })}
              className="bg-primary text-white font-display font-bold text-sm px-4 py-1.5 rounded-xl hover:bg-depth transition-colors whitespace-nowrap">
              + Nova empresa
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-1 bg-gray-50 border border-gray-200 rounded-xl p-1">
            {([
              ['todos', 'Todos'],
              ['pendentes', 'Com pendência'],
              ['regulares', 'Regulares'],
            ] as [FiltroPendencia, string][]).map(([valor, label]) => (
              <button key={valor} onClick={() => setFiltro(valor)}
                className={`text-xs font-display font-bold px-3 py-1.5 rounded-lg transition-colors ${
                  filtro === valor ? 'bg-white text-depth shadow-sm' : 'text-gray-500 hover:text-depth'
                }`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {resultadoDrive && <span className="text-xs text-gray-500 font-body">{resultadoDrive}</span>}
            <button onClick={enviarParaDrive} disabled={enviandoDrive || elegiveisLote === 0}
              className="text-xs font-display font-bold px-3 py-2 rounded-xl border border-gray-200 text-gray-600 hover:text-depth hover:border-gray-300 transition-colors disabled:opacity-40 whitespace-nowrap">
              {enviandoDrive ? 'Enviando…' : 'Enviar pro Drive'}
            </button>
            <button onClick={baixarLote} disabled={baixandoLote || elegiveisLote === 0}
              className="text-xs font-display font-bold px-3 py-2 rounded-xl border border-gray-200 text-gray-600 hover:text-depth hover:border-gray-300 transition-colors disabled:opacity-40 whitespace-nowrap">
              {baixandoLote ? 'Gerando zip…' : `Baixar em lote (${elegiveisLote} regulares)`}
            </button>
          </div>
        </div>

        {carregando ? (
          <div className="py-8 text-center text-gray-400 text-sm font-body">Carregando empresas…</div>
        ) : erro ? (
          <div className="py-8 text-center text-danger text-sm font-display font-bold" role="alert">⚠ {erro}</div>
        ) : empresas.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 py-12 text-center">
            <p className="text-gray-400 text-sm font-body mb-3">Nenhuma empresa cadastrada.</p>
            <button onClick={() => setModal({ aberto: true })} className="text-primary font-display font-bold text-sm border border-primary/30 px-4 py-2 rounded-lg hover:bg-primary/5 transition-colors">
              Cadastrar primeira empresa
            </button>
          </div>
        ) : empresasFiltradas.length === 0 ? (
          <div className="py-8 text-center text-gray-400 text-sm font-body">Nenhuma empresa nesse filtro.</div>
        ) : (
          <div className="space-y-2">
            {empresasFiltradas.map(e => {
              const r = resumo[e.id]
              return (
                <button key={e.id} onClick={() => abrirEdicao(e)}
                  className="w-full text-left bg-white rounded-2xl border border-gray-100 p-4 hover:border-primary/30 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-display font-bold text-depth text-sm leading-tight">{e.razaoSocial}</p>
                      <p className="text-xs text-gray-400 font-body mt-0.5">{formatarCnpj(e.cnpj)}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5 justify-end items-center">
                      {e.inscricaoMobiliaria && <span className="text-[11px] font-display font-bold text-gray-500 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded-full">Insc. Mobiliária</span>}
                      {e.cga && <span className="text-[11px] font-display font-bold text-gray-500 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded-full">CGA</span>}
                      {r && r.pendencias.length === 0 && (
                        <span className="text-[11px] font-display font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">✓ Regular</span>
                      )}
                      {r?.pendencias.map(p => (
                        <span key={p.tipo} title={`${p.label}: ${p.status}`}
                          className={`text-[11px] font-display font-bold px-1.5 py-0.5 rounded-full border ${
                            p.severidade === 'alerta'
                              ? 'text-red-700 bg-red-50 border-red-200'
                              : 'text-amber-700 bg-amber-50 border-amber-200'
                          }`}>
                          {TIPO_SIGLA[p.tipo] ?? p.tipo}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
