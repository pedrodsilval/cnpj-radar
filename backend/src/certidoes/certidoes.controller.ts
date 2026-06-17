import { Body, Controller, Get, Header, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CertidoesService } from './certidoes.service';
import { RegistrarDto, AtualizarStatusDto } from './certidoes.dto';
@Controller('certidoes')
export class CertidoesController {
  constructor(private readonly service: CertidoesService) {}

  // Rotas específicas antes das genéricas com :id

  @Get('relatorio-pendencias')
  async relatorioPendencias(@Res() res: Response) {
    const pdf = await this.service.gerarRelatorioPendencias();
    const nome = `pendencias-certidoes-${new Date().toISOString().slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.send(pdf);
  }

  @Get('alertas')
  alertas(@Query('dias') dias?: string) {
    return this.service.alertas(dias ? Number(dias) : 30);
  }

  @Get('checklist/:cnpj')
  checklist(@Param('cnpj') cnpj: string) {
    return this.service.checklist(cnpj);
  }

  @Get('empresa/:cnpj')
  listarPorEmpresa(@Param('cnpj') cnpj: string) {
    return this.service.listarPorEmpresa(cnpj);
  }

  @Post('empresa/:cnpj')
  registrar(@Param('cnpj') cnpj: string, @Body() dto: RegistrarDto) {
    return this.service.registrar(cnpj, dto);
  }

  @Post('consultar-lote')
  consultarLote(@Body() body?: { cnpjs?: string[] }) {
    return this.service.consultarLote(body?.cnpjs);
  }

  @Post('consultar/:cnpj')
  consultarAutomatico(@Param('cnpj') cnpj: string) {
    return this.service.consultarAutomatico(cnpj);
  }

  @Patch(':id/status')
  atualizarStatus(@Param('id') id: string, @Body() dto: AtualizarStatusDto) {
    return this.service.atualizarStatus(id, dto);
  }

  @Post(':id/anexo')
  @UseInterceptors(FileInterceptor('arquivo', {
    storage: memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (file.mimetype === 'application/pdf') cb(null, true);
      else cb(new Error('Apenas arquivos PDF são aceitos.'), false);
    },
  }))
  upload(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.anexarPdf(id, file);
  }

  @Get(':id/anexos')
  listarAnexos(@Param('id') id: string) {
    return this.service.listarAnexos(id);
  }
}
