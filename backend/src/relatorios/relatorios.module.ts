import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Empresa } from '../cnpj/entities/empresa.entity';
import { Socio } from '../cnpj/entities/socio.entity';
import { Certidao } from '../database/entities/certidao.entity';
import { RelatoriosService } from './relatorios.service';
import { RelatoriosController } from './relatorios.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Empresa, Socio, Certidao])],
  providers: [RelatoriosService],
  controllers: [RelatoriosController],
})
export class RelatoriosModule {}
