-- Migration: add_pgdas_declaracoes
-- Data: 2026-09-11
-- Origem: alerta de enquadramento ME -> EPP no Simples Nacional, calculado a
-- partir do RBT12 extraído do upload do PGDAS-D mensal (LC 123/2006, art. 3º
-- §9º-A: excesso de até 20% do limite de ME reenquadra a partir de janeiro
-- do ano seguinte; excesso acima de 20% reenquadra de imediato).
--
-- COMO EXECUTAR EM PRODUÇÃO:
--   psql $DATABASE_URL -f migrations/20260911_add_pgdas_declaracoes.sql

CREATE TABLE IF NOT EXISTS pgdas_declaracoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  periodo_apuracao VARCHAR(7) NOT NULL, -- 'YYYY-MM'
  rbt12 NUMERIC(15,2) NOT NULL,
  receita_bruta_mes NUMERIC(15,2),
  cnpj_declarado VARCHAR(14) NOT NULL,
  nome_arquivo VARCHAR NOT NULL,
  url_arquivo VARCHAR NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, periodo_apuracao)
);

CREATE INDEX IF NOT EXISTS idx_pgdas_declaracoes_empresa_id ON pgdas_declaracoes (empresa_id);
