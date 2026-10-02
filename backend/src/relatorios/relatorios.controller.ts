import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RelatoriosService } from './relatorios.service';

@Controller('relatorios')
export class RelatoriosController {
  constructor(private readonly service: RelatoriosService) {}

  @Get('pre-analise/:cnpj')
  async preAnalise(@Param('cnpj') cnpj: string, @Res() res: Response) {
    const { buffer, nomeArquivo } = await this.service.gerarPreAnalisePdf(cnpj);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${nomeArquivo}"`,
      'Content-Length': buffer.length,
    });
    res.send(buffer);
  }

  @Get('gerados/:cnpj')
  async listarGerados(@Param('cnpj') cnpj: string) {
    return this.service.listarGerados(cnpj);
  }
}
