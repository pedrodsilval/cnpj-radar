import { Controller, Get, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { PgdasService } from './pgdas.service';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('pgdas')
export class PgdasController {
  constructor(private readonly service: PgdasService) {}

  // Rotas específicas antes da genérica com :empresaId
  @Get('alertas')
  alertas() {
    return this.service.listarAlertas();
  }

  @Get('relatorio-enquadramento')
  async relatorioEnquadramento(@Res() res: Response) {
    const pdf = await this.service.gerarRelatorioEnquadramento();
    const nome = `enquadramento-simples-${new Date().toISOString().slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.send(pdf);
  }

  @Get(':empresaId')
  listarPorEmpresa(@Param('empresaId') empresaId: string) {
    return this.service.listarPorEmpresa(empresaId);
  }

  @Post(':empresaId')
  @Roles('administrador', 'comercial')
  @UseInterceptors(FileInterceptor('arquivo', {
    storage: memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ext = extname(file.originalname).toLowerCase();
      if (ext === '.pdf') {
        cb(null, true);
      } else {
        cb(new Error('Apenas arquivos PDF (recibo do PGDAS-D) são aceitos.'), false);
      }
    },
  }))
  upload(@Param('empresaId') empresaId: string, @UploadedFile() arquivo: Express.Multer.File) {
    return this.service.uploadDeclaracao(empresaId, arquivo);
  }
}
