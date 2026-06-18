-- Migration: add_dashboard_indexes
-- Data: 2026-06-17
-- Origem: itens identificados na revisão de performance do dashboard
--
-- COMO EXECUTAR EM PRODUÇÃO:
--   psql $DATABASE_URL -f migrations/20260617_add_dashboard_indexes.sql
--
-- Notas:
-- 1. CREATE INDEX CONCURRENTLY não pode rodar dentro de uma transação —
--    este arquivo não usa BEGIN/COMMIT intencionalmente.
-- 2. IF NOT EXISTS torna o script idempotente (seguro re-executar).
-- 3. CONCURRENTLY permite que o índice seja criado sem bloquear leituras/escritas
--    na tabela durante a criação — essencial em produção com dados.
-- 4. Os nomes aqui (idx_*) são descritivos e diferem dos nomes auto-gerados
--    pelo TypeORM (IDX_<hash>). Isso não afeta o uso pelo Postgres, mas se
--    o projeto migrar para TypeORM migrations runner, verificar duplicatas
--    com: SELECT indexname FROM pg_indexes WHERE tablename IN ('consultas','leads','certidoes');


-- consultas.consultado_em
-- Usado em: COUNT por mês, top CNAEs, top consultores, relatório por período.
-- Todas as queries do dashboard filtram por este campo com range scans.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_consultas_consultado_em
  ON consultas (consultado_em);


-- leads.atualizado_em
-- Usado em: query de "oportunidades paradas" (atualizado_em < NOW() - 30 dias).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_leads_atualizado_em
  ON leads (atualizado_em);


-- certidoes.status
-- Usado em: COUNT de alertas críticos (WHERE status = 'IRREGULAR' OR status = 'REGULAR').
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_certidoes_status
  ON certidoes (status);


-- certidoes.validade
-- Usado em: filtro de vencimento próximo (validade::date <= CURRENT_DATE + 7 days).
-- Nota: o cast ::date impede uso pleno do índice em alguns planos, mas ajuda
--       na eliminação de NULLs (IS NOT NULL) antes do cast.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_certidoes_validade
  ON certidoes (validade);
