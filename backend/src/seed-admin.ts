/**
 * Cria o usuário administrador inicial.
 * Uso: npx ts-node src/seed-admin.ts
 * Variáveis: DATABASE_URL, ADMIN_EMAIL, ADMIN_SENHA, ADMIN_NOME
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

  const email = (process.env.ADMIN_EMAIL ?? 'admin@everestcontabilidade.com.br').toLowerCase();
  const nome  = process.env.ADMIN_NOME  ?? 'Administrador';
  const senha = process.env.ADMIN_SENHA ?? 'MudeEstaSenh@123';

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
     VALUES (gen_random_uuid(), $1, $2, $3, 'administrador', true, NOW(), NOW())`,
    [nome, email, senhaHash],
  );

  console.log(`Usuário administrador criado: ${email}`);
  console.log(`Senha inicial: ${senha}`);
  console.log(`Altere a senha no primeiro acesso.`);
  await ds.destroy();
}

main().catch(e => { console.error(e); process.exit(1); });
