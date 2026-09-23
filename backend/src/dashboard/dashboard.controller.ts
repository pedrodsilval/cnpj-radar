import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get()
  resumo(@Query('dias') dias?: string) {
    const permitidos = [7, 30, 90];
    const d = permitidos.includes(Number(dias)) ? Number(dias) : 30;
    return this.service.resumo(d);
  }

  @Get('funil-conversao')
  funil() {
    return this.service.funilConversao();
  }

  @Get('acoes')
  acoes() {
    return this.service.acoesPrioritarias();
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
