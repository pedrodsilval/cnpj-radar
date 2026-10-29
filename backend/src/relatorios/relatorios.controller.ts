import { Controller, Get, Param, Post, Query, Request, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RelatoriosService } from './relatorios.service';
import { GoogleDriveService } from './google-drive.service';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('relatorios')
export class RelatoriosController {
  constructor(
    private readonly service: RelatoriosService,
    private readonly googleDrive: GoogleDriveService,
  ) {}

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

  @Roles('administrador')
  @Get('drive/status')
  async driveStatus() {
    return this.googleDrive.status();
  }

  @Roles('administrador')
  @Get('drive/autorizar')
  async driveAutorizar() {
    return { url: await this.googleDrive.gerarUrlAutorizacao() };
  }

  // O Google redireciona o navegador do usuário direto pra cá, sem o header
  // Authorization da sessão — precisa ser pública. O "code" só é válido se
  // o usuário acabou de passar pela tela de consentimento do Google.
  @Public()
  @Get('drive/callback')
  async driveCallback(@Query('code') code: string, @Res() res: Response) {
    try {
      const { email } = await this.googleDrive.tratarCallback(code);
      res.redirect(`/?vista=config&drive_conectado=${encodeURIComponent(email)}`);
    } catch (err) {
      res.redirect(`/?vista=config&drive_erro=${encodeURIComponent((err as Error).message)}`);
    }
  }
}
