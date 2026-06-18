-- Migration: add_token_version_to_usuarios
-- Data: 2026-06-18
-- Origem: implementação de invalidação de JWT ao alterar senha (item #8 da revisão)
--
-- CRÍTICO: executar ANTES de subir o novo build em produção.
-- O JwtStrategy verifica user.tokenVersion — sem esta coluna o backend rejeita
-- todas as requisições autenticadas com erro de coluna inexistente.
--
-- COMO EXECUTAR EM PRODUÇÃO:
--   psql $DATABASE_URL -f migrations/20260618_add_token_version_to_usuarios.sql
--
-- Segurança: DEFAULT 0 garante que todos os usuários existentes tenham
-- tokenVersion = 0, que coincide com payload.tv = undefined ?? 0 nos
-- tokens emitidos antes desta mudança — nenhuma sessão ativa é invalidada.

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
