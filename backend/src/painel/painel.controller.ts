import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PainelService } from './painel.service';
import type { AtualizarCampanhaDto, CriarCampanhaDto, UpsertCnaeConfigDto } from './painel.service';
import type { StatusCampanha } from './entities/campanha.entity';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('painel')
export class PainelController {
  constructor(private readonly service: PainelService) {}

  @Get('indicadores')
  indicadores(@Query('uf') uf?: string) {
    return this.service.indicadores(uf);
  }

  @Get('cnae')
  listarCnaes(@Query('uf') uf?: string) {
    return this.service.listarCnaes(uf);
  }

  @Get('cnae-config')
  listarCnaeConfig() {
    return this.service.listarCnaeConfig();
  }

  @Roles('administrador', 'comercial')
  @Post('cnae-config')
  upsertCnaeConfig(@Body() dto: UpsertCnaeConfigDto) {
    return this.service.upsertCnaeConfig(dto);
  }

  @Roles('administrador')
  @Delete('cnae-config/:codigo')
  removerCnaeConfig(@Param('codigo') codigo: string) {
    return this.service.removerCnaeConfig(codigo);
  }

  // ── Campanhas ──────────────────────────────────────────────────────────────

  @Get('campanhas')
  listarCampanhas(@Query('status') status?: StatusCampanha) {
    return this.service.listarCampanhas(status);
  }

  @Roles('administrador', 'comercial')
  @Post('campanhas')
  criarCampanha(@Body() dto: CriarCampanhaDto) {
    return this.service.criarCampanha(dto);
  }

  @Roles('administrador', 'comercial')
  @Patch('campanhas/:id')
  atualizarCampanha(@Param('id') id: string, @Body() dto: AtualizarCampanhaDto) {
    return this.service.atualizarCampanha(id, dto);
  }

  @Roles('administrador')
  @Delete('campanhas/:id')
  removerCampanha(@Param('id') id: string) {
    return this.service.removerCampanha(id);
  }
}
