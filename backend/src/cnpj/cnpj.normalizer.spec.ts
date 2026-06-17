import { normalizarCnpj } from './cnpj.normalizer';

// Resposta completa típica da BrasilAPI (campos crus em snake_case)
const respostaCompleta: Record<string, unknown> = {
  cnpj: '11222333000181',
  razao_social: 'EMPRESA TESTE LTDA',
  nome_fantasia: 'TESTE',
  situacao_cadastral: 2,
  descricao_situacao_cadastral: 'ATIVA',
  data_situacao_cadastral: '2023-06-01',
  natureza_juridica: '206-2 - Sociedade Empresária Limitada',
  descricao_identificador_matriz_filial: 'MATRIZ',
  porte: 'ME',
  cnae_fiscal: 6920601,
  cnae_fiscal_descricao: 'Atividades de contabilidade',
  cnaes_secundarios: [{ codigo: 6911701, descricao: 'Serviços advocatícios' }],
  logradouro: 'RUA DAS FLORES',
  numero: '100',
  complemento: 'SALA 1',
  bairro: 'CENTRO',
  municipio: 'SALVADOR',
  uf: 'BA',
  cep: '40.000-000',
  email: 'contato@empresateste.com.br',
  ddd_telefone_1: '(71) 9999-9999',
  capital_social: 10000,
  opcao_pelo_simples: true,
  opcao_pelo_mei: false,
  data_inicio_atividade: '2020-01-15',
  qsa: [
    {
      nome_socio: 'FULANO DA SILVA',
      qualificacao_socio: '49-Sócio-Administrador',
      faixa_etaria: 'Entre 31 a 40 anos',
    },
  ],
};

describe('normalizarCnpj', () => {
  describe('resposta completa típica', () => {
    const resultado = normalizarCnpj(respostaCompleta);

    it('mapeia cnpj e razaoSocial', () => {
      expect(resultado.cnpj).toBe('11222333000181');
      expect(resultado.razaoSocial).toBe('EMPRESA TESTE LTDA');
    });

    it('mapeia nomeFantasia', () => {
      expect(resultado.nomeFantasia).toBe('TESTE');
    });

    it('mapeia situacaoCadastral a partir de descricao_situacao_cadastral', () => {
      expect(resultado.situacaoCadastral).toBe('ATIVA');
    });

    it('mapeia situacaoCadastralCodigo a partir de situacao_cadastral (número)', () => {
      expect(resultado.situacaoCadastralCodigo).toBe(2);
    });

    it('mapeia situacaoCadastralData', () => {
      expect(resultado.situacaoCadastralData).toBe('2023-06-01');
    });

    it('mapeia cnaePrincipal com código como string', () => {
      expect(resultado.cnaePrincipal).toEqual({
        codigo: '6920601',
        descricao: 'Atividades de contabilidade',
      });
    });

    it('mapeia cnaesSecundarios', () => {
      expect(resultado.cnaesSecundarios).toEqual([
        { codigo: '6911701', descricao: 'Serviços advocatícios' },
      ]);
    });

    it('remove máscara do CEP', () => {
      expect(resultado.endereco.cep).toBe('40000000');
    });

    it('remove máscara do telefone', () => {
      expect(resultado.telefone).toBe('7199999999');
    });

    it('mapeia capitalSocial como number', () => {
      expect(resultado.capitalSocial).toBe(10000);
    });

    it('mapeia optanteSimples e optanteMei como boolean', () => {
      expect(resultado.optanteSimples).toBe(true);
      expect(resultado.optanteMei).toBe(false);
    });

    it('mapeia socios corretamente', () => {
      expect(resultado.socios).toEqual([
        {
          nome: 'FULANO DA SILVA',
          qualificacao: '49-Sócio-Administrador',
          faixaEtaria: 'Entre 31 a 40 anos',
        },
      ]);
    });
  });

  describe('QSA ausente', () => {
    it('retorna socios: [] quando qsa não está presente', () => {
      const { qsa: _, ...semQsa } = respostaCompleta;
      expect(normalizarCnpj(semQsa).socios).toEqual([]);
    });

    it('retorna socios: [] quando qsa é null', () => {
      expect(normalizarCnpj({ ...respostaCompleta, qsa: null }).socios).toEqual([]);
    });
  });

  describe('CNAEs secundários ausentes', () => {
    it('retorna cnaesSecundarios: [] quando campo não está presente', () => {
      const { cnaes_secundarios: _, ...semCnaes } = respostaCompleta;
      expect(normalizarCnpj(semCnaes).cnaesSecundarios).toEqual([]);
    });

    it('retorna cnaesSecundarios: [] quando campo é array vazio', () => {
      expect(
        normalizarCnpj({ ...respostaCompleta, cnaes_secundarios: [] }).cnaesSecundarios,
      ).toEqual([]);
    });
  });

  describe('campos opcionais ausentes ou nulos', () => {
    it('nomeFantasia ausente → null', () => {
      const { nome_fantasia: _, ...sem } = respostaCompleta;
      expect(normalizarCnpj(sem).nomeFantasia).toBeNull();
    });

    it('nome_fantasia vazio → null', () => {
      expect(normalizarCnpj({ ...respostaCompleta, nome_fantasia: '' }).nomeFantasia).toBeNull();
    });

    it('email ausente → null', () => {
      const { email: _, ...sem } = respostaCompleta;
      expect(normalizarCnpj(sem).email).toBeNull();
    });

    it('complemento vazio → null no endereco', () => {
      expect(
        normalizarCnpj({ ...respostaCompleta, complemento: '' }).endereco.complemento,
      ).toBeNull();
    });

    it('opcao_pelo_simples ausente → null', () => {
      const { opcao_pelo_simples: _, ...sem } = respostaCompleta;
      expect(normalizarCnpj(sem).optanteSimples).toBeNull();
    });

    it('situacao_cadastral ausente → situacaoCadastralCodigo null', () => {
      const { situacao_cadastral: _, ...sem } = respostaCompleta;
      expect(normalizarCnpj(sem).situacaoCadastralCodigo).toBeNull();
    });

    it('cnaePrincipal ausente quando cnae_fiscal não está presente → null', () => {
      const { cnae_fiscal: _, cnae_fiscal_descricao: __, ...sem } = respostaCompleta;
      expect(normalizarCnpj(sem).cnaePrincipal).toBeNull();
    });

    it('não quebra com resposta completamente vazia', () => {
      expect(() => normalizarCnpj({})).not.toThrow();
    });
  });

  describe('normalização de tipos', () => {
    it('capital_social como string numérica → number', () => {
      expect(
        normalizarCnpj({ ...respostaCompleta, capital_social: '50000' }).capitalSocial,
      ).toBe(50000);
    });

    it('capital_social não numérico → null', () => {
      expect(
        normalizarCnpj({ ...respostaCompleta, capital_social: 'invalido' }).capitalSocial,
      ).toBeNull();
    });

    it('data em formato alternativo válido → ISO YYYY-MM-DD', () => {
      const resultado = normalizarCnpj({
        ...respostaCompleta,
        data_situacao_cadastral: '2023-06-01T00:00:00.000Z',
      });
      expect(resultado.situacaoCadastralData).toBe('2023-06-01');
    });

    it('data ininterpretável → null', () => {
      expect(
        normalizarCnpj({ ...respostaCompleta, data_situacao_cadastral: 'nao-e-data' })
          .situacaoCadastralData,
      ).toBeNull();
    });
  });
});
