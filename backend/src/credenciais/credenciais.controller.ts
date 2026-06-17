import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CredenciaisService } from './credenciais.service';
import { CriarCredencialDto, AtualizarCredencialDto } from './credenciais.dto';
import { Roles } from '../auth/decorators/roles.decorator';

@Roles('administrador')
@Controller('credenciais')
export class CredenciaisController {
  constructor(private readonly service: CredenciaisService) {}

  @Get()
  listar() {
    return this.service.listar();
  }

  @Post()
  criar(@Body() dto: CriarCredencialDto) {
    return this.service.criar(dto);
  }

  @Patch(':id')
  atualizar(@Param('id') id: string, @Body() dto: AtualizarCredencialDto) {
    return this.service.atualizar(id, dto);
  }

  @Delete(':id')
  remover(@Param('id') id: string) {
    return this.service.remover(id);
  }
}
