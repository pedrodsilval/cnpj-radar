export type AppEnv = 'development' | 'demo' | 'production';

// Falha fechada: qualquer valor ausente, vazio ou desconhecido resulta em 'production' —
// o modo mais restritivo. Isso garante que mock nunca vaze por variável mal configurada.
export function getAppEnv(): AppEnv {
  const env = process.env.APP_ENV;
  if (env === 'development' || env === 'demo') return env;
  return 'production';
}

export function isMockEnabled(): boolean {
  const env = getAppEnv();
  return env === 'development' || env === 'demo';
}
