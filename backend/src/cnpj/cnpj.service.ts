import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { sanitizeCnpj, isValidCnpj } from '../common/utils/cnpj.util';
import { getAppEnv, isMockEnabled } from '../common/config/app-env';
import { getMockCnpj, CNPJ_MOCK_MAGICO } from './cnpj.mock';
import { normalizarCnpj } from './cnpj.normalizer';
import type { CnpjErrorCode, ResultadoConsulta } from './cnpj.types';
import { Empresa } from './entities/empresa.entity';
import { Consulta } from './entities/consulta.entity';
import { Socio } from './entities/socio.entity';
import { Cnae } from './entities/cnae.entity';

const TIMEOUT_MS = 10_000;
const CAMPOS_OBRIGATORIOS = ['cnpj', 'razao_social', 'situacao_cadastral'] as const;
const OBSERVACAO_DEFASAGEM =
  'Dados cadastrais de origem Receita Federal podem ter defasagem de até ' +
  'aproximadamente um mês, pois a base oficial é atualizada mensalmente.';

const LINKS_OFICIAIS = {
  receitaFederal: 'https://www.gov.br/receitafederal',
  consultaCnpj: 'https://cnpj.receita.fazenda.gov.br/Cnpjindex.asp',
  cndFederal: 'https://solucoes.receita.fazenda.gov.br/Servicos/certidaointernet/PJ/Emitir',
  pgfn: 'https://www.regularize.pgfn.gov.br',
  fgts: 'https://consulta-crf.caixa.gov.br',
  diarioOficial: 'https://www.in.gov.br',
};

const ERROS_COM_FALLBACK = new Set<CnpjErrorCode>([
  'SERVICO_INDISPONIVEL',
  'TIMEOUT',
  'ERRO_DE_REDE',
  'RATE_LIMIT',
]);

interface FonteExterna {
  nome: string;
  buildUrl: (cnpj: string) => string;
  // Algumas fontes (ex. ReceitaWS) devolvem erro com HTTP 200 — checado antes
  // de tentar normalizar o corpo como sucesso.
  checarErroNoCorpo?: (dados: Record<string, unknown>) => CnpjErrorCode | null;
  // Converte o formato bruto da fonte pro "dialeto" de campos que
  // normalizarCnpj() já entende (convenção da BrasilAPI/RFB) — evita
  // duplicar toda a lógica de normalização por fonte nova. A própria
  // BrasilAPI não precisa disso (já fala esse dialeto).
  adaptar?: (bruto: Record<string, unknown>, cnpjSanitizado: string) => Record<string, unknown>;
}

// RFB codifica a situação cadastral como número; a ReceitaWS só devolve o
// texto. Mapeia os códigos oficiais mais comuns — o que não bater fica null
// (CAMPOS_OBRIGATORIOS só exige a CHAVE presente, não o valor, então isso
// não derruba a consulta, só deixa o código numérico vazio).
const CODIGOS_SITUACAO_CADASTRAL: Record<string, number> = {
  NULA: 1, ATIVA: 2, SUSPENSA: 3, INAPTA: 4, BAIXADA: 8,
};

// ReceitaWS usa datas DD/MM/AAAA — new Date() do JS não é confiável pra esse
// formato (trata como MM/DD em muitos casos), teria que converter na mão.
function dataBrParaIso(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const m = valor.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// cnae_principal_codigo na nossa tabela é varchar(7) -- convenção da
// BrasilAPI de código numérico puro (ex. "5611201"). A ReceitaWS devolve
// pontuado (ex. "56.11-2-01", 10 caracteres) -- estourava a coluna.
function digitosCnae(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const digitos = valor.replace(/\D/g, '');
  return digitos || null;
}

// ReceitaWS às vezes empacota vários telefones numa string só, separados
// por "/" (ex. "(71) 3327-2169 / (71) 8247-5823") -- stripar tudo que não é
// dígito concatenaria os três e estourava a coluna (varchar(11), um único
// telefone). Pega só o primeiro.
function primeiroTelefone(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  return valor.split('/')[0]?.trim() || null;
}

function adaptarReceitaWs(bruto: Record<string, unknown>, cnpjSanitizado: string): Record<string, unknown> {
  const simples = (bruto['simples'] ?? {}) as Record<string, unknown>;
  const simei = (bruto['simei'] ?? {}) as Record<string, unknown>;
  const atividadePrincipal = Array.isArray(bruto['atividade_principal'])
    ? (bruto['atividade_principal'] as Record<string, unknown>[])[0]
    : null;
  const atividadesSecundarias = Array.isArray(bruto['atividades_secundarias'])
    ? (bruto['atividades_secundarias'] as Record<string, unknown>[])
    : [];
  const situacaoTexto = String(bruto['situacao'] ?? '').toUpperCase().trim();

  return {
    cnpj: cnpjSanitizado,
    razao_social: bruto['nome'],
    nome_fantasia: bruto['fantasia'],
    descricao_situacao_cadastral: bruto['situacao'],
    situacao_cadastral: CODIGOS_SITUACAO_CADASTRAL[situacaoTexto] ?? null,
    data_situacao_cadastral: dataBrParaIso(bruto['data_situacao']),
    natureza_juridica: bruto['natureza_juridica'],
    tipo: bruto['tipo'],
    porte: bruto['porte'],
    cnae_fiscal: digitosCnae(atividadePrincipal?.['code']),
    cnae_fiscal_descricao: atividadePrincipal?.['text'] ?? null,
    cnaes_secundarios: atividadesSecundarias.map((a) => ({ codigo: digitosCnae(a['code']), descricao: a['text'] })),
    logradouro: bruto['logradouro'],
    numero: bruto['numero'],
    complemento: bruto['complemento'],
    bairro: bruto['bairro'],
    municipio: bruto['municipio'],
    uf: bruto['uf'],
    cep: bruto['cep'],
    email: bruto['email'],
    telefone: primeiroTelefone(bruto['telefone']),
    capital_social: bruto['capital_social'],
    opcao_pelo_simples: simples['optante'],
    data_opcao_pelo_simples: dataBrParaIso(simples['data_opcao']),
    data_exclusao_do_simples: dataBrParaIso(simples['data_exclusao']),
    opcao_pelo_mei: simei['optante'],
    descricao_motivo_situacao_cadastral: bruto['motivo_situacao'],
    situacao_especial: bruto['situacao_especial'],
    data_situacao_especial: dataBrParaIso(bruto['data_situacao_especial']),
    data_inicio_atividade: dataBrParaIso(bruto['abertura']),
    qsa: bruto['qsa'], // já no formato {nome, qual} que normalizarCnpj aceita via fallback
  };
}

const FONTES: FonteExterna[] = [
  {
    nome: 'BrasilAPI (origem: Receita Federal)',
    buildUrl: (cnpj) => `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
  },
  // Fallback gratuito (sem chave) — usado só quando a BrasilAPI falha.
  // Limite de 3 requisições/minuto por IP no plano grátis; como só entra em
  // ação no fallback (não em toda consulta), isso raramente é um problema.
  // Base própria da ReceitaWS (não bate na Receita Federal ao vivo a cada
  // consulta), então continua respondendo mesmo quando o webservice oficial
  // da RFB está fora do ar — foi exatamente esse o caso real que motivou
  // adicionar esse fallback (03/10/2026).
  {
    nome: 'ReceitaWS',
    buildUrl: (cnpj) => `https://www.receitaws.com.br/v1/cnpj/${cnpj}`,
    checarErroNoCorpo: (dados) => {
      if (dados['status'] !== 'ERROR') return null;
      const msg = String(dados['message'] ?? '').toLowerCase();
      if (msg.includes('minuto') || msg.includes('frequ')) return 'RATE_LIMIT';
      return 'CNPJ_NAO_ENCONTRADO';
    },
    adaptar: adaptarReceitaWs,
  },
];

@Injectable()
export class CnpjService {
  private readonly logger = new Logger(CnpjService.name);

  constructor(
    @InjectRepository(Empresa)
    private readonly empresaRepo: Repository<Empresa>,
    @InjectRepository(Consulta)
    private readonly consultaRepo: Repository<Consulta>,
    @InjectRepository(Socio)
    private readonly socioRepo: Repository<Socio>,
    @InjectRepository(Cnae)
    private readonly cnaeRepo: Repository<Cnae>,
  ) {}

  async consultarCnpj(cnpj: string, usuarioId?: string): Promise<ResultadoConsulta> {
    const sanitized = sanitizeCnpj(cnpj);

    if (!isValidCnpj(sanitized)) {
      this.logger.warn(`[CNPJ] Entrada inválida: "${cnpj}"`);
      return { error: 'CNPJ_INVALIDO' };
    }

    if (isMockEnabled() && sanitized === CNPJ_MOCK_MAGICO) {
      const env = getAppEnv();
      this.logger.warn(`[CNPJ] ${sanitized} | Mock ativado (ambiente: ${env})`);
      return getMockCnpj(env === 'demo');
    }

    let ultimoErroFallback: CnpjErrorCode = 'SERVICO_INDISPONIVEL';

    for (const fonte of FONTES) {
      const resultado = await this.fetchDaFonte(sanitized, fonte);

      this.logger.log(
        `[CNPJ] ${sanitized} | Fonte: ${fonte.nome} | ` +
          ('error' in resultado ? `Erro: ${resultado.error}` : 'Sucesso'),
      );

      if (!('error' in resultado)) {
        await this.persistirResultado(sanitized, resultado, fonte.nome, usuarioId);
        return resultado;
      }

      await this.registrarConsulta(sanitized, null, fonte.nome, resultado.error, usuarioId);

      if (!ERROS_COM_FALLBACK.has(resultado.error)) {
        return resultado;
      }

      ultimoErroFallback = resultado.error;
    }

    this.logger.error(`[CNPJ] ${sanitized} | Todas as fontes indisponíveis`);
    return { error: ultimoErroFallback };
  }

  private async persistirResultado(
    cnpj: string,
    resultado: Extract<ResultadoConsulta, { dados: unknown }>,
    fonteNome: string,
    usuarioId?: string,
  ): Promise<void> {
    try {
      const empresa = await this.upsertEmpresa(resultado.dados as ReturnType<typeof normalizarCnpj>);
      await this.registrarConsulta(cnpj, empresa.id, fonteNome, null, usuarioId);
    } catch (err) {
      this.logger.error(`[CNPJ] ${cnpj} | Falha ao persistir: ${String(err)}`);
    }
  }

  private async upsertEmpresa(dados: ReturnType<typeof normalizarCnpj>): Promise<Empresa> {
    let empresa = await this.empresaRepo.findOne({ where: { cnpj: dados.cnpj } });

    if (!empresa) {
      empresa = this.empresaRepo.create();
    }

    empresa.cnpj = dados.cnpj;
    empresa.razaoSocial = dados.razaoSocial;
    empresa.nomeFantasia = dados.nomeFantasia;
    empresa.situacaoCadastral = dados.situacaoCadastral;
    empresa.situacaoCadastralCodigo = dados.situacaoCadastralCodigo;
    empresa.situacaoCadastralData = dados.situacaoCadastralData;
    empresa.naturezaJuridica = dados.naturezaJuridica;
    empresa.tipo = dados.tipo;
    empresa.porte = dados.porte;
    empresa.cnaePrincipalCodigo = dados.cnaePrincipal?.codigo ?? null;
    empresa.cnaePrincipalDescricao = dados.cnaePrincipal?.descricao ?? null;
    empresa.logradouro = dados.endereco.logradouro;
    empresa.numero = dados.endereco.numero;
    empresa.complemento = dados.endereco.complemento;
    empresa.bairro = dados.endereco.bairro;
    empresa.municipio = dados.endereco.municipio;
    empresa.uf = dados.endereco.uf;
    empresa.cep = dados.endereco.cep;
    empresa.email = dados.email;
    empresa.telefone = dados.telefone;
    empresa.capitalSocial = dados.capitalSocial;
    empresa.optanteSimples = dados.optanteSimples;
    empresa.optanteMei = dados.optanteMei;
    empresa.dataInicioAtividade = dados.dataInicioAtividade;

    await this.empresaRepo.save(empresa);

    // Regrava sócios e CNAEs secundários a cada consulta (dados podem mudar na Receita)
    await this.socioRepo.delete({ empresaId: empresa.id });
    if (dados.socios.length > 0) {
      const socios = dados.socios.map((s) =>
        this.socioRepo.create({ ...s, empresaId: empresa!.id }),
      );
      await this.socioRepo.save(socios);
    }

    await this.cnaeRepo.delete({ empresaId: empresa.id });
    if (dados.cnaesSecundarios.length > 0) {
      const cnaes = dados.cnaesSecundarios.map((c) =>
        this.cnaeRepo.create({ ...c, empresaId: empresa!.id }),
      );
      await this.cnaeRepo.save(cnaes);
    }

    return empresa;
  }

  private async registrarConsulta(
    cnpj: string,
    empresaId: string | null,
    fonte: string,
    erro: string | null,
    usuarioId?: string,
  ): Promise<void> {
    const consulta = this.consultaRepo.create({ cnpj, empresaId, fonte, erro, usuarioId: usuarioId ?? null });
    await this.consultaRepo.save(consulta);
  }

  async consultarLote(cnpjs: string[], usuarioId?: string): Promise<{
    total: number;
    sucesso: number;
    erros: number;
    resultados: Array<{ cnpj: string; ok: boolean; erro?: string }>;
  }> {
    const MAX_LOTE = 10;
    const lista = cnpjs.slice(0, MAX_LOTE);
    const resultados: Array<{ cnpj: string; ok: boolean; erro?: string }> = [];

    for (const cnpj of lista) {
      const resultado = await this.consultarCnpj(cnpj, usuarioId);
      if ('error' in resultado) {
        resultados.push({ cnpj, ok: false, erro: resultado.error });
      } else {
        resultados.push({ cnpj: resultado.dados.cnpj, ok: true });
      }
      // Intervalo entre requisições para respeitar limites da BrasilAPI
      await new Promise((r) => setTimeout(r, 300));
    }

    const sucesso = resultados.filter((r) => r.ok).length;
    return { total: lista.length, sucesso, erros: lista.length - sucesso, resultados };
  }

  private async fetchDaFonte(cnpj: string, fonte: FonteExterna): Promise<ResultadoConsulta> {
    const consultadoEm = new Date().toISOString();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(fonte.buildUrl(cnpj), {
        signal: controller.signal,
        headers: { 'User-Agent': 'cnpj-radar/1.0' },
      });

      this.logger.log(`[CNPJ] ${cnpj} | HTTP ${response.status} de ${fonte.nome}`);

      if (response.status === 404) return { error: 'CNPJ_NAO_ENCONTRADO' };
      if (response.status === 429) return { error: 'RATE_LIMIT' };
      if (response.status >= 500) return { error: 'SERVICO_INDISPONIVEL' };
      if (response.status >= 400) return { error: 'SERVICO_INDISPONIVEL' };

      let dados: Record<string, unknown>;
      try {
        dados = (await response.json()) as Record<string, unknown>;
      } catch {
        return { error: 'RESPOSTA_INCOMPLETA' };
      }

      // Algumas fontes (ex. ReceitaWS) respondem erro com HTTP 200 — checa
      // antes de tratar o corpo como sucesso.
      const erroNoCorpo = fonte.checarErroNoCorpo?.(dados) ?? null;
      if (erroNoCorpo) return { error: erroNoCorpo };

      if (fonte.adaptar) dados = fonte.adaptar(dados, cnpj);

      const camposFaltando = CAMPOS_OBRIGATORIOS.filter((c) => !(c in dados));
      if (camposFaltando.length > 0) return { error: 'RESPOSTA_INCOMPLETA' };

      return {
        dados: normalizarCnpj(dados),
        metadados: {
          fonte: fonte.nome,
          consultadoEm,
          observacaoDefasagem: OBSERVACAO_DEFASAGEM,
          linksOficiais: LINKS_OFICIAIS,
        },
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { error: 'TIMEOUT' };
      }
      return { error: 'ERRO_DE_REDE' };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
