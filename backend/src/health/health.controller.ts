import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '../auth/decorators/public.decorator';

// Endpoint público de health check. Executa um SELECT 1 de propósito: isso conta
// como atividade no banco e evita a pausa automática do Supabase free tier (~7 dias
// sem queries). O ping periódico (GitHub Action keepalive.yml) também acorda o Render.
// @Public() porque o guard de auth é global; sem prefixo /api, a rota fica em /health.
@Public()
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get()
  async check() {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ok', db: 'up', timestamp: new Date().toISOString() };
    } catch {
      throw new ServiceUnavailableException({ status: 'error', db: 'down' });
    }
  }
}
