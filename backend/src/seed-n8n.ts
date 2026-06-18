/**
 * Cria o usuário de serviço para integração n8n.
 * Uso: npm run seed:n8n
 * Perfil: consultor (acesso de leitura/escrita sem funções administrativas)
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';

dotenv.config();

const ds = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  entities: [],
  synchronize: false,
});

async function main() {
  await ds.initialize();

  const email = 'n8n@everest.com.br';
  const nome  = 'Integração n8n';
  const senha = process.env.N8N_API_PASSWORD ?? 'N8nRadar@2026';

  const [existe] = await ds.query<{ count: string }[]>(
    `SELECT COUNT(*)::int AS count FROM usuarios WHERE email = $1`,
    [email],
  );

  if (Number(existe.count) > 0) {
    console.log(`Usuário ${email} já existe — nenhuma alteração feita.`);
    await ds.destroy();
    return;
  }

  const senhaHash = await bcrypt.hash(senha, 12);
  await ds.query(
    `INSERT INTO usuarios (id, nome, email, senha_hash, perfil, ativo, criado_em, atualizado_em)
     VALUES (gen_random_uuid(), $1, $2, $3, 'consultor', true, NOW(), NOW())`,
    [nome, email, senhaHash],
  );

  console.log(`Usuário n8n criado: ${email}`);
  console.log(`Senha: ${senha}`);
  console.log(`Configure N8N_API_PASSWORD no docker-compose.yml do n8n.`);
  await ds.destroy();
}

main().catch(e => { console.error(e); process.exit(1); });
