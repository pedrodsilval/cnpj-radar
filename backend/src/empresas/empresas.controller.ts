import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { EmpresasService } from './empresas.service';
import type { CriarEmpresaDto, AtualizarEmpresaDto, UploadCertificadoDto } from './empresas.dto';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('empresas')
export class EmpresasController {
  constructor(private readonly service: EmpresasService) {}

  @Get()
  listar(@Query('busca') busca?: string) {
    return this.service.listar(busca);
  }

  @Get(':id')
  buscarPorId(@Param('id') id: string) {
    return this.service.buscarPorId(id);
  }

  @Post()
  @Roles('administrador', 'comercial')
  criar(@Body() dto: CriarEmpresaDto) {
    return this.service.criar(dto);
  }

  @Patch(':id')
  @Roles('administrador', 'comercial')
  atualizar(@Param('id') id: string, @Body() dto: AtualizarEmpresaDto) {
    return this.service.atualizar(id, dto);
  }

  // Upload/substituição de certificado restrito a administrador — mesmo
  // nível de acesso do módulo `credenciais`, dado o nível de sensibilidade
  // (arquivo .pfx + senha, equivalente a uma assinatura digital da empresa).
  @Post(':id/certificado')
  @Roles('administrador')
  @UseInterceptors(FileInterceptor('arquivo', {
    storage: memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ext = extname(file.originalname).toLowerCase();
      if (ext === '.pfx' || ext === '.p12') {
        cb(null, true);
      } else {
        cb(new Error('Apenas arquivos de certificado (.pfx ou .p12) são aceitos.'), false);
      }
    },
  }))
  uploadCertificado(
    @Param('id') id: string,
    @UploadedFile() arquivo: Express.Multer.File,
    @Body() dto: UploadCertificadoDto,
  ) {
    return this.service.uploadCertificado(id, arquivo, dto);
  }

  @Delete(':id/certificado')
  @Roles('administrador')
  removerCertificado(@Param('id') id: string) {
    return this.service.removerCertificado(id);
  }
}
