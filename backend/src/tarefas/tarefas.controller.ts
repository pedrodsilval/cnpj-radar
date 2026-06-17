import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { TarefasService } from './tarefas.service';
import type { AtualizarTarefaDto, CriarTarefaDto } from './tarefas.service';
import type { StatusTarefa } from './entities/tarefa.entity';

@Controller('tarefas')
export class TarefasController {
  constructor(private readonly service: TarefasService) {}

  @Get()
  listar(@Query('status') status?: StatusTarefa, @Query('responsavelId') responsavelId?: string) {
    return this.service.listar(status, responsavelId);
  }

  @Post()
  criar(@Body() dto: CriarTarefaDto) {
    return this.service.criar(dto);
  }

  @Patch(':id')
  atualizar(@Param('id') id: string, @Body() dto: AtualizarTarefaDto) {
    return this.service.atualizar(id, dto);
  }

  @Delete(':id')
  remover(@Param('id') id: string) {
    return this.service.remover(id);
  }
}
