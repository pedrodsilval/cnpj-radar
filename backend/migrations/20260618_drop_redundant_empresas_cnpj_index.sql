-- Migration: drop_redundant_empresas_cnpj_index
-- Data: 2026-06-18
--
-- O campo empresas.cnpj tem @Column({ unique: true }) que já cria o índice
-- UQ_f5ed71aeb4ef47f95df5f8830b8. O @Index() adicional criou IDX_f5ed71aeb4ef47f95df5f8830b
-- na mesma coluna — redundante. Este script dropa o IDX_ (não-único) e mantém
-- o UQ_ (constraint única, mais adequado).
--
-- Em dev/demo o TypeORM (synchronize:true) dropa o IDX_ automaticamente
-- na próxima inicialização após o @Index() ter sido removido da entidade.
--
-- COMO EXECUTAR EM PRODUÇÃO (antes de subir o novo build):
--   psql $DATABASE_URL -f migrations/20260618_drop_redundant_empresas_cnpj_index.sql

DROP INDEX CONCURRENTLY IF EXISTS "IDX_f5ed71aeb4ef47f95df5f8830b";
