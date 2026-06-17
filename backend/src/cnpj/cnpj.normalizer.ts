import type { CnpjDadosNormalizados } from './cnpj.types';

// Retorna string não-vazia ou null. Espaços em branco viram null.
function getString(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') return val.trim() || null;
  return null;
}

// Aceita YYYY-MM-DD (passthrough) ou qualquer formato que Date() interprete.
// Se não for possível interpretar: null.
function getDate(val: unknown): string | null {
  const s = getString(val);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

// Remove tudo que não for dígito. String vazia resultante → null.
function getDigitsOnly(val: unknown): string | null {
  const s = getString(val);
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  return digits || null;
}

// Aceita number diretamente ou string numérica. Qualquer outro valor → null.
function getNumber(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  if (typeof val === 'string') {
    const n = Number(val);
    return isNaN(n) ? null : n;
  }
  return null;
}

// Aceita boolean; qualquer outro valor → null (não tenta converter string "true").
function getBoolean(val: unknown): boolean | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'boolean') return val;
  return null;
}

export function normalizarCnpj(bruto: Record<string, unknown>): CnpjDadosNormalizados {
  // CNAE principal: presente se cnae_fiscal existir (código pode ser 0, então testamos != null/undefined)
  const codigoCnae = bruto['cnae_fiscal'];
  const cnaePrincipal =
    codigoCnae !== null && codigoCnae !== undefined
      ? {
          codigo: String(codigoCnae),
          descricao: getString(bruto['cnae_fiscal_descricao']) ?? '',
        }
      : null;

  // CNAEs secundários: cada item tem { codigo, descricao }
  const cnaesRaw = bruto['cnaes_secundarios'];
  const cnaesSecundarios = Array.isArray(cnaesRaw)
    ? cnaesRaw
        .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
        .map((c) => ({
          codigo: String(c['codigo'] ?? ''),
          descricao: getString(c['descricao']) ?? '',
        }))
    : [];

  // QSA (Quadro de Sócios e Administradores) — campos confirmados contra schema BrasilAPI
  const qsaRaw = bruto['qsa'];
  const socios = Array.isArray(qsaRaw)
    ? qsaRaw
        .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
        .map((s) => ({
          nome: getString(s['nome_socio']) ?? getString(s['nome']) ?? '',
          qualificacao: getString(s['qualificacao_socio']) ?? getString(s['qual']) ?? null,
          faixaEtaria: getString(s['faixa_etaria']) ?? null,
        }))
    : [];

  // ddd_telefone_1 confirmado; fallback para 'telefone' por segurança
  const telefoneRaw = bruto['ddd_telefone_1'] ?? bruto['telefone'];

  // data_situacao_cadastral confirmado; fallback para grafia alternativa
  const dataSituacaoRaw = bruto['data_situacao_cadastral'] ?? bruto['situacao_cadastral_data'];

  // situacao_cadastral é numérico na BrasilAPI (ex.: 2 = ATIVA).
  // O texto legível vem em descricao_situacao_cadastral.
  return {
    cnpj: getString(bruto['cnpj']) ?? '',
    razaoSocial: getString(bruto['razao_social']) ?? '',
    nomeFantasia: getString(bruto['nome_fantasia']),
    situacaoCadastral: getString(bruto['descricao_situacao_cadastral']) ?? '',
    situacaoCadastralCodigo: getNumber(bruto['situacao_cadastral']),
    situacaoCadastralData: getDate(dataSituacaoRaw),
    naturezaJuridica: getString(bruto['natureza_juridica']),
    tipo: getString(bruto['descricao_identificador_matriz_filial']) ?? getString(bruto['tipo']),
    porte: getString(bruto['porte']),
    cnaePrincipal,
    cnaesSecundarios,
    endereco: {
      logradouro: (() => {
        const tipo = getString(bruto['descricao_tipo_de_logradouro']);
        const nome = getString(bruto['logradouro']);
        if (!nome) return null;
        return tipo ? `${tipo} ${nome}` : nome;
      })(),
      numero: getString(bruto['numero']),
      complemento: getString(bruto['complemento']),
      bairro: getString(bruto['bairro']),
      municipio: getString(bruto['municipio']),
      uf: getString(bruto['uf']),
      cep: getDigitsOnly(bruto['cep']),
    },
    email: getString(bruto['email']),
    telefone: getDigitsOnly(telefoneRaw),
    capitalSocial: getNumber(bruto['capital_social']),
    optanteSimples: getBoolean(bruto['opcao_pelo_simples']),
    dataOpcaoSimples: getDate(bruto['data_opcao_pelo_simples']),
    dataExclusaoSimples: getDate(bruto['data_exclusao_do_simples']),
    optanteMei: getBoolean(bruto['opcao_pelo_mei']),
    motivoSituacaoCadastral: (() => {
      const m = getString(bruto['descricao_motivo_situacao_cadastral']);
      return m && m.toUpperCase() !== 'SEM MOTIVO' ? m : null;
    })(),
    situacaoEspecial: getString(bruto['situacao_especial']),
    situacaoEspecialData: getDate(bruto['data_situacao_especial']),
    dataInicioAtividade: getDate(bruto['data_inicio_atividade']),
    socios,
  };
}
