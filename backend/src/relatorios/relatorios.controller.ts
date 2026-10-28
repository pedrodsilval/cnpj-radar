import { Controller, Get, Param, Post, Request, Res } from '@nestjs/common';
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

  @Get('pre-analise-lote')
  async preAnaliseLote(@Res() res: Response) {
    const { buffer, nomeArquivo, total } = await this.service.gerarPreAnaliseLote();
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${nomeArquivo}"`,
      'Content-Length': buffer.length,
      'X-Total-Relatorios': String(total),
    });
    res.send(buffer);
  }

  @Post('pre-analise-lote/drive')
  async preAnaliseLoteDrive(@Request() req: { user: { id: string } }) {
    return this.service.enviarLotePraDrive(req.user.id);
  }
}
