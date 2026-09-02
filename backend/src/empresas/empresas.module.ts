import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Empresa } from '../cnpj/entities/empresa.entity';
import { CertificadoDigital } from './entities/certificado-digital.entity';
import { EmpresasService } from './empresas.service';
import { EmpresasController } from './empresas.controller';
import { CredenciaisModule } from '../credenciais/credenciais.module';

@Module({
  imports: [TypeOrmModule.forFeature([Empresa, CertificadoDigital]), CredenciaisModule],
  controllers: [EmpresasController],
  providers: [EmpresasService],
  exports: [EmpresasService],
})
export class EmpresasModule {}
