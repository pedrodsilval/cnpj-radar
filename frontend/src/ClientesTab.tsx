import { useState, useEffect, useCallback, useRef } from 'react'
import { apiFetch } from './auth'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Empresa {
  id: string
  cnpj: string
  razaoSocial: string
  situacaoCadastral: string
  inscricaoMobiliaria: string | null
  cga: string | null
  inscricaoEstadual: string | null
}

interface CertificadoPublico {
  id: string
  tipo: string
  titular: string | null
  validade: string | null
  nomeArquivo: string
  criadoEm: string
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

// ─── Modal de cadastro/edição ───────────────────────────────────────────────────

interface ModalProps {
  empresa?: Empresa
  certificadoInicial?: CertificadoPublico | null
  onSalvo: () => void
  onFechar: () => void
}

function ModalEmpresa({ empresa, certificadoInicial, onSalvo, onFechar }: ModalProps) {
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

  const dias = diasParaVencer(certificado?.validade ?? null)

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
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2 flex-shrink-0">
          <button onClick={onFechar} className="text-sm font-display font-bold text-gray-500 px-4 py-2 rounded-lg border border-gray-200 hover:border-gray-300 transition-colors">Cancelar</button>
          <button onClick={salvar} disabled={salvando} className="text-sm font-display font-bold bg-primary text-white px-5 py-2 rounded-lg hover:bg-depth transition-colors disabled:opacity-50">
            {salvando ? 'Salvando…' : editando ? 'Salvar' : 'Criar empresa'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── ClientesTab ──────────────────────────────────────────────────────────────

export function ClientesTab() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [modal, setModal] = useState<{ aberto: boolean; empresa?: Empresa; certificado?: CertificadoPublico | null }>({ aberto: false })

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

  // AbortController evita que uma resposta antiga (ex: busca="l") sobrescreva
  // o resultado de uma busca mais recente (ex: busca="lyras") que chegou
  // primeiro — sem isso, digitar rápido podia deixar a lista com resultados
  // desatualizados até a próxima mudança na busca.
  useEffect(() => {
    const controller = new AbortController()
    void carregar(controller.signal)
    return () => controller.abort()
  }, [carregar])

  async function abrirEdicao(empresa: Empresa) {
    const res = await apiFetch(`/empresas/${empresa.id}`)
    if (!res.ok) { setModal({ aberto: true, empresa }); return }
    const { certificado } = await res.json() as { certificado: CertificadoPublico | null }
    setModal({ aberto: true, empresa, certificado })
  }

  return (
    <>
      {modal.aberto && (
        <ModalEmpresa
          empresa={modal.empresa}
          certificadoInicial={modal.certificado}
          onFechar={() => setModal({ aberto: false })}
          onSalvo={() => { setModal({ aberto: false }); void carregar() }}
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
        ) : (
          <div className="space-y-2">
            {empresas.map(e => (
              <button key={e.id} onClick={() => abrirEdicao(e)}
                className="w-full text-left bg-white rounded-2xl border border-gray-100 p-4 hover:border-primary/30 transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-display font-bold text-depth text-sm leading-tight">{e.razaoSocial}</p>
                    <p className="text-xs text-gray-400 font-body mt-0.5">{formatarCnpj(e.cnpj)}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 justify-end">
                    {e.inscricaoMobiliaria && <span className="text-[11px] font-display font-bold text-gray-500 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded-full">Insc. Mobiliária</span>}
                    {e.cga && <span className="text-[11px] font-display font-bold text-gray-500 bg-gray-50 border border-gray-200 px-1.5 py-0.5 rounded-full">CGA</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
