import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get()
  resumo() {
    return this.service.resumo();
  }

  @Get('funil-conversao')
  funil() {
    return this.service.funilConversao();
  }

  @Get('relatorio-consultores')
  relatorioConsultores(
    @Query('de')  de:  string | undefined,
    @Query('ate') ate: string | undefined,
  ) {
    const hoje  = new Date().toISOString().slice(0, 10);
    const inicio = de  ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
    const fim    = ate ?? hoje;
    return this.service.relatorioConsultores(inicio, fim);
  }
}
