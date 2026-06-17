import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CnpjService } from './cnpj.service';
import { CNPJ_MOCK_MAGICO } from './cnpj.mock';
import { Empresa } from './entities/empresa.entity';
import { Consulta } from './entities/consulta.entity';
import { Socio } from './entities/socio.entity';
import { Cnae } from './entities/cnae.entity';

const RESPOSTA_BRASILIA_API_VALIDA = {
  cnpj: CNPJ_MOCK_MAGICO,
  razao_social: 'EMPRESA TESTE LTDA',
  situacao_cadastral: 2,
  descricao_situacao_cadastral: 'ATIVA',
};

function mockFetchOnce(status: number, body?: object): void {
  const response = {
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
  jest.spyOn(global, 'fetch').mockResolvedValueOnce(response);
}

const makeRepoMock = () => ({
  findOne: jest.fn().mockResolvedValue(null),
  create: jest.fn().mockImplementation((dto) => ({ ...dto, id: 'uuid-mock' })),
  save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
  delete: jest.fn().mockResolvedValue(undefined),
});

describe('CnpjService', () => {
  let service: CnpjService;
  let savedAppEnv: string | undefined;

  beforeEach(async () => {
    savedAppEnv = process.env.APP_ENV;
    process.env.APP_ENV = 'production';

    const module = await Test.createTestingModule({
      providers: [
        CnpjService,
        { provide: getRepositoryToken(Empresa), useValue: makeRepoMock() },
        { provide: getRepositoryToken(Consulta), useValue: makeRepoMock() },
        { provide: getRepositoryToken(Socio), useValue: makeRepoMock() },
        { provide: getRepositoryToken(Cnae), useValue: makeRepoMock() },
      ],
    }).compile();

    service = module.get(CnpjService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (savedAppEnv === undefined) {
      delete process.env.APP_ENV;
    } else {
      process.env.APP_ENV = savedAppEnv;
    }
  });

  it('CNPJ inválido → retorna CNPJ_INVALIDO sem chamar a API', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const resultado = await service.consultarCnpj('00000000000000');
    expect(resultado).toEqual({ error: 'CNPJ_INVALIDO' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('BrasilAPI retorna 404 → retorna CNPJ_NAO_ENCONTRADO', async () => {
    mockFetchOnce(404);
    const resultado = await service.consultarCnpj(CNPJ_MOCK_MAGICO);
    expect(resultado).toEqual({ error: 'CNPJ_NAO_ENCONTRADO' });
  });

  it('BrasilAPI retorna 429 → retorna RATE_LIMIT', async () => {
    mockFetchOnce(429);
    const resultado = await service.consultarCnpj(CNPJ_MOCK_MAGICO);
    expect(resultado).toEqual({ error: 'RATE_LIMIT' });
  });

  it('BrasilAPI retorna 500 → retorna SERVICO_INDISPONIVEL', async () => {
    mockFetchOnce(500);
    const resultado = await service.consultarCnpj(CNPJ_MOCK_MAGICO);
    expect(resultado).toEqual({ error: 'SERVICO_INDISPONIVEL' });
  });

  it('BrasilAPI retorna 400 (serviço interno offline) → retorna SERVICO_INDISPONIVEL', async () => {
    mockFetchOnce(400, { message: 'Serviço Interno de Consulta de CNPJ Offline', type: 'SERVICE_ERROR' });
    const resultado = await service.consultarCnpj(CNPJ_MOCK_MAGICO);
    expect(resultado).toEqual({ error: 'SERVICO_INDISPONIVEL' });
  });

  it('BrasilAPI retorna resposta sem campos obrigatórios → retorna RESPOSTA_INCOMPLETA', async () => {
    mockFetchOnce(200, { nome_fantasia: 'SEM CAMPOS OBRIGATORIOS' });
    const resultado = await service.consultarCnpj(CNPJ_MOCK_MAGICO);
    expect(resultado).toEqual({ error: 'RESPOSTA_INCOMPLETA' });
  });

  it('BrasilAPI retorna dados completos → retorna sucesso com dados e metadados', async () => {
    mockFetchOnce(200, RESPOSTA_BRASILIA_API_VALIDA);
    const resultado = await service.consultarCnpj(CNPJ_MOCK_MAGICO);
    expect('error' in resultado).toBe(false);
    if (!('error' in resultado)) {
      expect(resultado.dados.cnpj).toBe(CNPJ_MOCK_MAGICO);
      expect(resultado.metadados.fonte).toContain('BrasilAPI');
      expect(resultado.metadados.consultadoEm).toBeTruthy();
      expect(resultado.metadados.observacaoDefasagem).toBeTruthy();
      expect(resultado.metadados.linksOficiais.receitaFederal).toBe('https://www.gov.br/receitafederal');
    }
  });

  it('CNPJ mágico com APP_ENV=development → retorna mock sem campo simulado', async () => {
    process.env.APP_ENV = 'development';
    const resultado = await service.consultarCnpj(CNPJ_MOCK_MAGICO);
    expect('error' in resultado).toBe(false);
    if (!('error' in resultado)) {
      expect(resultado.metadados.simulado).toBeUndefined();
      expect(resultado.dados.cnpj).toBe(CNPJ_MOCK_MAGICO);
    }
  });

  it('CNPJ mágico com APP_ENV=demo → retorna mock com simulado: true', async () => {
    process.env.APP_ENV = 'demo';
    const resultado = await service.consultarCnpj(CNPJ_MOCK_MAGICO);
    expect('error' in resultado).toBe(false);
    if (!('error' in resultado)) {
      expect(resultado.metadados.simulado).toBe(true);
    }
  });

  it('CNPJ mágico com APP_ENV=production → consulta BrasilAPI normalmente (não retorna mock)', async () => {
    process.env.APP_ENV = 'production';
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      status: 200,
      json: jest.fn().mockResolvedValue(RESPOSTA_BRASILIA_API_VALIDA),
    } as unknown as Response);
    const resultado = await service.consultarCnpj(CNPJ_MOCK_MAGICO);
    expect(fetchSpy).toHaveBeenCalled();
    if (!('error' in resultado)) {
      expect(resultado.metadados.simulado).toBeUndefined();
    }
  });
});
