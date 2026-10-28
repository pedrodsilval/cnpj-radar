-- Migration: add_pasta_drive_id_to_usuarios
-- Data: 2026-10-28
-- Origem: envio em lote do relatório de pré-análise direto pro Google Drive
-- (pedido da Itauana, DP/Societário) — cada usuário configura a pasta de
-- destino dos relatórios que ele mesmo gera em lote.
--
-- COMO EXECUTAR EM PRODUÇÃO:
--   psql $DATABASE_URL -f migrations/20261028_add_pasta_drive_id_to_usuarios.sql

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS pasta_drive_id VARCHAR NULL;
