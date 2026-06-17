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
}

const FONTES: FonteExterna[] = [
  {
    nome: 'BrasilAPI (origem: Receita Federal)',
    buildUrl: (cnpj) => `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`,
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

  async consultarCnpj(cnpj: string): Promise<ResultadoConsulta> {
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
        await this.persistirResultado(sanitized, resultado, fonte.nome);
        return resultado;
      }

      await this.registrarConsulta(sanitized, null, fonte.nome, resultado.error);

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
  ): Promise<void> {
    try {
      const empresa = await this.upsertEmpresa(resultado.dados as ReturnType<typeof normalizarCnpj>);
      await this.registrarConsulta(cnpj, empresa.id, fonteNome, null);
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
  ): Promise<void> {
    const consulta = this.consultaRepo.create({ cnpj, empresaId, fonte, erro });
    await this.consultaRepo.save(consulta);
  }

  async consultarLote(cnpjs: string[]): Promise<{
    total: number;
    sucesso: number;
    erros: number;
    resultados: Array<{ cnpj: string; ok: boolean; erro?: string }>;
  }> {
    const MAX_LOTE = 10;
    const lista = cnpjs.slice(0, MAX_LOTE);
    const resultados: Array<{ cnpj: string; ok: boolean; erro?: string }> = [];

    for (const cnpj of lista) {
      const resultado = await this.consultarCnpj(cnpj);
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
