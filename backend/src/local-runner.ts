// Executor local — roda FGTS/CRF e CND Federal a partir desta máquina em vez
// do Render, pra usar o IP residencial (não datacenter, não deve carregar o
// mesmo estigma que bloqueia o Render na Caixa) e o Chrome real local (com
// GPU/hardware de verdade, necessário pra passar a atestação PAT do hCaptcha
// da Receita — ver o comentário grande em certidoes-scraper.service.ts sobre
// consultarCndFederalHeadedLocal).
//
// Uso manual:  cd backend && npx ts-node src/local-runner.ts
// Uso agendado: configurado via Windows Task Scheduler (tarefa
// "cnpj-radar-local-runner"), que chama esse mesmo comando periodicamente.
//
// Escreve direto no mesmo banco de produção que o Render usa (DATABASE_URL
// do .env local já aponta pra lá) — os resultados aparecem no painel normal,
// sem precisar copiar nada manualmente.

// Define ANTES de importar o AppModule: garante synchronize:false no
// TypeORM mesmo rodando fora do Render (evita alterar o schema de produção
// sem querer ao bootar esse script sem supervisão).
process.env.APP_ENV = 'production';

// A Receita usa PAT no hCaptcha — só passa com Chrome headed real, o que só
// faz sentido rodando localmente. Força isso aqui pra não depender de quem
// chamou o script ter lembrado de setar a env var.
process.env.USAR_CND_FEDERAL_LOCAL = 'true';

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from './app.module';
import { CertidoesService } from './certidoes/certidoes.service';
import { Empresa } from './cnpj/entities/empresa.entity';
import { CertidaoTipo } from './database/entities/certidao.entity';

const TIPOS_LOCAIS = [CertidaoTipo.FGTS_CRF, CertidaoTipo.CND_FEDERAL];

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  log('Iniciando executor local (FGTS + CND Federal)...');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  try {
    const certidoesService = app.get(CertidoesService);
    const empresaRepo = app.get<Repository<Empresa>>(getRepositoryToken(Empresa));

    const todas = await empresaRepo.find({ order: { razaoSocial: 'ASC' } });
    // LOCAL_RUNNER_LIMITE / LOCAL_RUNNER_CNPJ: só pra teste manual rápido
    // (1 empresa específica em vez de todas). Não usar em produção — o
    // agendamento roda sem essas env vars.
    const cnpjFiltro = process.env.LOCAL_RUNNER_CNPJ?.replace(/\D/g, '');
    const limite = process.env.LOCAL_RUNNER_LIMITE ? Number(process.env.LOCAL_RUNNER_LIMITE) : undefined;
    let empresas = cnpjFiltro ? todas.filter((e) => e.cnpj === cnpjFiltro) : todas;
    if (limite) empresas = empresas.slice(0, limite);
    log(`${empresas.length} de ${todas.length} empresa(s) selecionada(s).`);

    let ok = 0;
    let falhas = 0;

    for (const empresa of empresas) {
      for (const tipo of TIPOS_LOCAIS) {
        const inicio = Date.now();
        try {
          log(`${empresa.razaoSocial} (${empresa.cnpj}) — ${tipo}...`);
          const item = await certidoesService.consultarUmTipo(empresa.cnpj, tipo);
          const seg = ((Date.now() - inicio) / 1000).toFixed(1);
          log(`  -> ${item.status} (${seg}s)`);
          ok++;
        } catch (err) {
          const seg = ((Date.now() - inicio) / 1000).toFixed(1);
          log(`  -> ERRO (${seg}s): ${err}`);
          falhas++;
        }
      }
    }

    log(`Concluído. ${ok} consulta(s) ok, ${falhas} falha(s).`);
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[local-runner] Erro fatal:', err);
    process.exit(1);
  });
