// Executor local — roda FGTS/CRF, CND Federal e Dívida Ativa a partir de uma
// máquina com IP residencial. A Receita rejeita com erro 023 qualquer
// tentativa vinda de IP de datacenter (Render ou VPS), com ou sem browser
// headed — confirmado em 18-21/09/2026: do VPS deu 023 em todas as
// tentativas, de IP residencial emitiu em ~20s. Ver o comentário grande em
// certidoes-scraper.service.ts sobre consultarCndFederalHeadedLocal.
//
// Ferramenta manual de apoio, não é a solução pro produto (clientes do
// serviço não têm como rodar isso na máquina deles).
//
// Uso:  cd backend && npm run local-runner
//       (LOCAL_RUNNER_CNPJ=<cnpj> restringe a uma empresa)
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

// CND Federal e Dívida Ativa são a mesma certidão: uma emissão grava os dois.
const TAREFAS_LOCAIS: { nome: string; rodar: (svc: CertidoesService, cnpj: string) => Promise<{ tipo: string; status: string }[]> }[] = [
  { nome: 'FGTS_CRF', rodar: async (svc, cnpj) => [await svc.consultarUmTipo(cnpj, CertidaoTipo.FGTS_CRF)] },
  { nome: 'CND_FEDERAL+DIVIDA_ATIVA', rodar: (svc, cnpj) => svc.consultarFederalEDividaAtiva(cnpj) },
];

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
      for (const tarefa of TAREFAS_LOCAIS) {
        const inicio = Date.now();
        try {
          log(`${empresa.razaoSocial} (${empresa.cnpj}) — ${tarefa.nome}...`);
          const itens = await tarefa.rodar(certidoesService, empresa.cnpj);
          const seg = ((Date.now() - inicio) / 1000).toFixed(1);
          log(`  -> ${itens.map((i) => `${i.tipo}=${i.status}`).join(', ')} (${seg}s)`);
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
