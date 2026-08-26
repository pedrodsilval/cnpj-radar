import { Body, Controller, Get, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { CertidoesService } from './certidoes.service';
import type { RegistrarDto, AtualizarStatusDto } from './certidoes.dto';
import { CertidaoTipo } from '../database/entities/certidao.entity';
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

  // Consulta um tipo por vez — usado pelo frontend em vez do endpoint acima
  // pra não segurar uma única requisição HTTP por 15-20min (o Render free
  // recicla o container antes de chegar nos últimos tipos, ver
  // consultarUmTipo em certidoes.service.ts).
  @Post('consultar/:cnpj/:tipo')
  consultarUmTipo(@Param('cnpj') cnpj: string, @Param('tipo') tipo: CertidaoTipo) {
    return this.service.consultarUmTipo(cnpj, tipo);
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
      // Valida MIME type E extensão — MIME type sozinho é controlado pelo cliente
      const ext = extname(file.originalname).toLowerCase();
      if (file.mimetype === 'application/pdf' && ext === '.pdf') {
        cb(null, true);
      } else {
        cb(new Error('Apenas arquivos PDF são aceitos (.pdf).'), false);
      }
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
