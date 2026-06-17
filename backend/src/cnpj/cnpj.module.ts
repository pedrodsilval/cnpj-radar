import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CnpjController } from './cnpj.controller';
import { CnpjService } from './cnpj.service';
import { CnpjPdfService } from './cnpj-pdf.service';
import { Empresa } from './entities/empresa.entity';
import { Consulta } from './entities/consulta.entity';
import { Socio } from './entities/socio.entity';
import { Cnae } from './entities/cnae.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Empresa, Consulta, Socio, Cnae])],
  controllers: [CnpjController],
  providers: [CnpjService, CnpjPdfService],
  exports: [TypeOrmModule, CnpjService],
})
export class CnpjModule {}
