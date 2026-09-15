import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { join } from 'path';
import helmet from 'helmet';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Aquece o pool de conexões com o banco antes de aceitar requisições.
  // TypeOrmModule inicializa o DataSource no boot, mas o pg Pool só abre a
  // conexão de fato na primeira query — sem isso, a primeira requisição de
  // um usuário paga o custo (às vezes falha) desse handshake inicial.
  try {
    await app.get(DataSource).query('SELECT 1');
  } catch (err) {
    Logger.warn(`Falha ao aquecer conexão com o banco: ${err}`, 'Bootstrap');
  }

  // upgrade-insecure-requests e Strict-Transport-Security (HSTS) mandam o
  // navegador só falar https com esse host — inofensivo atrás de proxies que
  // já servem https (Render), mas quebra o carregamento (e depois fica preso
  // por até 1 ano via HSTS) quando o Nest responde direto em http puro (ex:
  // VPS sem TLS na frente). Decide por requisição olhando x-forwarded-proto.
  app.use((req, res, next) => {
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const cspDirectives = { ...helmet.contentSecurityPolicy.getDefaultDirectives() };
    if (!isHttps) delete cspDirectives['upgrade-insecure-requests'];

    helmet({
      contentSecurityPolicy: {
        // useDefaults:true (o padrão) faz o helmet mesclar de volta as
        // diretivas default dele por baixo, inclusive a que acabamos de
        // remover — precisa desligar pra o delete acima realmente valer.
        useDefaults: false,
        // Permite as fontes externas (Google Fonts, Fontshare) que o frontend usa.
        directives: {
          ...cspDirectives,
          'style-src': ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'api.fontshare.com'],
          'font-src': ["'self'", 'fonts.gstatic.com', 'cdn.fontshare.com'],
        },
      },
      hsts: isHttps ? undefined : false,
    })(req, res, next);
  });

  // Valida e sanitiza todos os payloads — rejeita campos não declarados nos DTOs
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false }));

  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.useStaticAssets(join(__dirname, '..', 'uploads'), { prefix: '/uploads' });

  // Serve o build do frontend a partir do mesmo domínio do backend — evita
  // CORS entre os dois em produção, já que o frontend usa caminhos relativos
  // (/cnpj, /auth, etc.) para chamar a API, sem base URL configurável.
  const frontendDist = join(__dirname, '..', '..', 'frontend', 'dist');
  app.useStaticAssets(frontendDist, { index: 'index.html' });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
