import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Empresa } from '../cnpj/entities/empresa.entity';
import { CertificadoDigital } from './entities/certificado-digital.entity';
import { Certidao } from '../database/entities/certidao.entity';
import { Anexo } from '../database/entities/anexo.entity';
import { EmpresasService } from './empresas.service';
import { EmpresasController } from './empresas.controller';
import { CredenciaisModule } from '../credenciais/credenciais.module';

@Module({
  imports: [TypeOrmModule.forFeature([Empresa, CertificadoDigital, Certidao, Anexo]), CredenciaisModule],
  controllers: [EmpresasController],
  providers: [EmpresasService],
  exports: [EmpresasService],
})
export class EmpresasModule {}
