CREATE TABLE IF NOT EXISTS relatorios_gerados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id VARCHAR NOT NULL,
  url_arquivo VARCHAR NOT NULL,
  nome_arquivo VARCHAR NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_relatorios_gerados_empresa_id ON relatorios_gerados (empresa_id);
