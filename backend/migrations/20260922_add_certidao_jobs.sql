-- Migration: add_certidao_jobs
-- Data: 2026-09-22
-- Origem: CND Federal/Dívida Ativa só passam no hCaptcha da Receita rodando
-- de navegador real, IP residencial, perfil "aquecido" — impossível a partir
-- do VPS (ver [[projeto-cnd-federal-local-pendente]] na memória do projeto).
-- Fila de jobs consumida pela extensão de Chrome que roda no navegador de
-- cada usuário, em vez de rodar centralizado no servidor.
--
-- COMO EXECUTAR EM PRODUÇÃO:
--   psql $DATABASE_URL -f migrations/20260922_add_certidao_jobs.sql

CREATE TABLE IF NOT EXISTS certidao_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  cnpj VARCHAR(14) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE', -- PENDENTE | EM_ANDAMENTO | CONCLUIDO | ERRO
  solicitado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  assumido_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  assumido_em TIMESTAMPTZ,
  resultado_status VARCHAR(20), -- REGULAR | IRREGULAR | INDISPONIVEL, só quando CONCLUIDO
  resultado_mensagem TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_certidao_jobs_status ON certidao_jobs (status);
CREATE INDEX IF NOT EXISTS idx_certidao_jobs_empresa_id ON certidao_jobs (empresa_id);
