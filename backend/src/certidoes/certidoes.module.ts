import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CnpjModule } from '../cnpj/cnpj.module';
import { CredenciaisModule } from '../credenciais/credenciais.module';
import { Certidao } from '../database/entities/certidao.entity';
import { Anexo } from '../database/entities/anexo.entity';
import { Lead } from '../leads/entities/lead.entity';
import { CertidoesService } from './certidoes.service';
import { CertidoesController } from './certidoes.controller';
import { CertidoesScraperService } from './certidoes-scraper.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Certidao, Anexo, Lead]),
    CnpjModule,
    CredenciaisModule,
  ],
  controllers: [CertidoesController],
  providers: [CertidoesService, CertidoesScraperService],
  exports: [CertidoesService],
})
export class CertidoesModule {}
