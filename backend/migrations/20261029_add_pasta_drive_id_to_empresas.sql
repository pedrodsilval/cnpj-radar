-- Migration: add_pasta_drive_id_to_empresas
-- Data: 2026-10-29
-- Origem: envio pro Drive precisa de uma pasta POR CLIENTE, não uma pasta
-- única por usuário que manda tudo pro mesmo lugar (inviável na prática —
-- cada cliente tem sua própria pasta na estrutura real do escritório).
--
-- COMO EXECUTAR EM PRODUÇÃO:
--   psql $DATABASE_URL -f migrations/20261029_add_pasta_drive_id_to_empresas.sql

ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS pasta_drive_id VARCHAR NULL;
