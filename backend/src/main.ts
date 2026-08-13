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

  app.use(
    helmet({
      // Permite as fontes externas (Google Fonts, Fontshare) que o frontend usa.
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'style-src': ["'self'", "'unsafe-inline'", 'fonts.googleapis.com', 'api.fontshare.com'],
          'font-src': ["'self'", 'fonts.gstatic.com', 'cdn.fontshare.com'],
        },
      },
    }),
  );

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
