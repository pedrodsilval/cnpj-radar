CREATE TABLE IF NOT EXISTS certidoes_historico (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id VARCHAR NOT NULL,
  cnpj VARCHAR(20),
  tipo VARCHAR(50) NOT NULL,
  status VARCHAR(30) NOT NULL,
  validade VARCHAR(10),
  url_arquivo VARCHAR,
  observacoes TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_certidoes_historico_empresa_tipo ON certidoes_historico (empresa_id, tipo);
