import { ScoresService } from './scores.service';
import { Empresa } from '../cnpj/entities/empresa.entity';

function makeEmpresa(overrides: Partial<Empresa> = {}): Empresa {
  return {
    id: 'uuid',
    cnpj: '30327128000125',
    razaoSocial: 'EMPRESA TESTE LTDA',
    nomeFantasia: null,
    situacaoCadastral: 'ATIVA',
    situacaoCadastralCodigo: 2,
    situacaoCadastralData: '2018-01-01',
    naturezaJuridica: 'Sociedade Empresária Limitada',
    tipo: 'MATRIZ',
    porte: 'MICRO EMPRESA',
    cnaePrincipalCodigo: '6920601',
    cnaePrincipalDescricao: 'Atividades de contabilidade',
    logradouro: 'AVENIDA TANCREDO NEVES',
    numero: '2227',
    complemento: 'SALA 1',
    bairro: 'CENTRO',
    municipio: 'SALVADOR',
    uf: 'BA',
    cep: '41820021',
    email: null,
    telefone: '7141411675',
    capitalSocial: 10000,
    optanteSimples: true,
    optanteMei: false,
    dataInicioAtividade: '2018-04-28',
    criadoEm: new Date(),
    atualizadoEm: new Date(),
    consultas: [],
    socios: [],
    cnaesSecundarios: [],
    ...overrides,
  } as Empresa;
}

describe('ScoresService', () => {
  let service: ScoresService;

  beforeEach(() => {
    service = new ScoresService();
  });

  describe('score cadastral', () => {
    it('empresa com todos os campos preenchidos e 2 sócios → score alto', () => {
      const empresa = makeEmpresa({ email: 'contato@empresa.com' });
      const { scoreCadastral } = service.calcular(empresa, 2);
      expect(scoreCadastral).toBeGreaterThanOrEqual(90);
    });

    it('empresa sem email nem telefone → score menor que com contato', () => {
      const semContato = makeEmpresa({ email: null, telefone: null });
      const comContato = makeEmpresa({ email: 'a@b.com', telefone: '71999999999' });
      const { scoreCadastral: semPts } = service.calcular(semContato, 1);
      const { scoreCadastral: comPts } = service.calcular(comContato, 1);
      expect(semPts).toBeLessThan(comPts);
    });

    it('empresa sem QSA → score reduzido', () => {
      const empresa = makeEmpresa();
      const semQsa = service.calcular(empresa, 0);
      const comQsa = service.calcular(empresa, 2);
      expect(comQsa.scoreCadastral).toBeGreaterThan(semQsa.scoreCadastral);
    });

    it('nunca ultrapassa 100', () => {
      const empresa = makeEmpresa({ email: 'a@b.com' });
      const { scoreCadastral } = service.calcular(empresa, 5);
      expect(scoreCadastral).toBeLessThanOrEqual(100);
    });
  });

  describe('score de atenção', () => {
    it('empresa inativa → score de atenção alto', () => {
      const empresa = makeEmpresa({ situacaoCadastral: 'BAIXADA' });
      const { scoreAtencao } = service.calcular(empresa, 1);
      expect(scoreAtencao).toBeGreaterThanOrEqual(40);
    });

    it('empresa sem QSA e sem contato → score de atenção elevado', () => {
      const empresa = makeEmpresa({ email: null, telefone: null });
      const { scoreAtencao } = service.calcular(empresa, 0);
      expect(scoreAtencao).toBeGreaterThanOrEqual(40);
    });

    it('empresa ativa com dados completos → score de atenção baixo', () => {
      const empresa = makeEmpresa({ email: 'a@b.com', dataInicioAtividade: '2015-01-01' });
      const { scoreAtencao } = service.calcular(empresa, 2);
      expect(scoreAtencao).toBeLessThan(40);
    });

    it('nunca ultrapassa 100', () => {
      const empresa = makeEmpresa({ situacaoCadastral: 'BAIXADA', email: null, telefone: null, capitalSocial: null });
      const { scoreAtencao } = service.calcular(empresa, 0);
      expect(scoreAtencao).toBeLessThanOrEqual(100);
    });
  });

  describe('score comercial', () => {
    it('empresa ativa, porte ME, CNAE produtivo, BA, antiga → score alto', () => {
      const empresa = makeEmpresa({ dataInicioAtividade: '2018-04-28' });
      const { scoreComercial } = service.calcular(empresa, 1);
      expect(scoreComercial).toBeGreaterThanOrEqual(70);
    });

    it('empresa MEI → score limitado a 30 (prospect de migração, não cliente pleno)', () => {
      const empresa = makeEmpresa({ optanteMei: true });
      const { scoreComercial } = service.calcular(empresa, 1);
      expect(scoreComercial).toBeLessThanOrEqual(30);
    });

    it('eClienteAtivo → score comercial 0', () => {
      const empresa = makeEmpresa();
      const { scoreComercial } = service.calcular(empresa, 1, true);
      expect(scoreComercial).toBe(0);
    });

    it('empresa fora de BA → score menor que empresa em BA', () => {
      const ba = makeEmpresa({ uf: 'BA' });
      const sp = makeEmpresa({ uf: 'SP' });
      expect(service.calcular(ba, 1).scoreComercial).toBeGreaterThan(service.calcular(sp, 1).scoreComercial);
    });

    it('empresa recente (< 1 ano) → pontos de tempo menores', () => {
      const antiga = makeEmpresa({ dataInicioAtividade: '2018-01-01' });
      const recente = makeEmpresa({ dataInicioAtividade: new Date().toISOString().split('T')[0] });
      expect(service.calcular(antiga, 1).scoreComercial).toBeGreaterThan(service.calcular(recente, 1).scoreComercial);
    });

    it('nunca ultrapassa 100', () => {
      const empresa = makeEmpresa({ email: 'a@b.com', capitalSocial: 999999 });
      const { scoreComercial } = service.calcular(empresa, 5);
      expect(scoreComercial).toBeLessThanOrEqual(100);
    });
  });

  describe('recomendação', () => {
    it('empresa inativa → recomendação de não priorizar', () => {
      const empresa = makeEmpresa({ situacaoCadastral: 'BAIXADA' });
      const { recomendacao } = service.calcular(empresa, 0);
      expect(recomendacao).toMatch(/inativa/i);
    });

    it('empresa MEI → recomendação educacional', () => {
      const empresa = makeEmpresa({ optanteMei: true });
      const { recomendacao } = service.calcular(empresa, 1);
      expect(recomendacao).toMatch(/MEI/i);
    });

    it('empresa ativa com atenção baixa → abordagem comercial', () => {
      const empresa = makeEmpresa({ email: 'a@b.com', dataInicioAtividade: '2015-01-01' });
      const { recomendacao } = service.calcular(empresa, 2);
      expect(recomendacao).toMatch(/comercial/i);
    });

    it('eClienteAtivo → encaminhar para responsável interno', () => {
      const empresa = makeEmpresa();
      const { recomendacao } = service.calcular(empresa, 1, true);
      expect(recomendacao).toMatch(/responsável interno/i);
    });
  });
});
