-- Migration: add_cadastro_empresas
-- Data: 2026-09-01
-- Origem: aba "Clientes" — cadastro manual de empresas com campos que faltam
-- pra automatizar Certidão Municipal de Lauro de Freitas (Inscrição Mobiliária),
-- Certidão Municipal de Salvador (CGA), e guarda de certificado digital A1/A3
-- (.pfx + senha, criptografados) por empresa. Ver docs/pendencias-tecnicas.md
-- (31/08–01/09/2026) e docs/roadmap/fase-3-regularidade.md.
--
-- COMO EXECUTAR EM PRODUÇÃO:
--   psql $DATABASE_URL -f migrations/20260901_add_cadastro_empresas.sql
--
-- Segurança: colunas novas em `empresas` são todas nullable — nenhum dado
-- existente é afetado. `certificados_digitais` é tabela nova, isolada.

ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS inscricao_mobiliaria VARCHAR,
  ADD COLUMN IF NOT EXISTS cga VARCHAR,
  ADD COLUMN IF NOT EXISTS inscricao_estadual VARCHAR;

CREATE TABLE IF NOT EXISTS certificados_digitais (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo VARCHAR(2) NOT NULL,
  titular VARCHAR,
  validade DATE,
  nome_arquivo VARCHAR NOT NULL,
  conteudo_criptografado TEXT NOT NULL,
  iv VARCHAR(32) NOT NULL,
  tag VARCHAR(32) NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_certificados_digitais_empresa_id ON certificados_digitais (empresa_id);
