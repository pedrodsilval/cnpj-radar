import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CnpjModule } from '../cnpj/cnpj.module';
import { Lead } from './entities/lead.entity';
import { Cliente } from './entities/cliente.entity';
import { Observacao } from './entities/observacao.entity';
import { HistoricoStatus } from './entities/historico-status.entity';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';
import { ScoresService } from './scores.service';
import { LeadsPdfService } from './leads-pdf.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Lead, Cliente, Observacao, HistoricoStatus]),
    CnpjModule,
  ],
  controllers: [LeadsController],
  providers: [LeadsService, ScoresService, LeadsPdfService],
})
export class LeadsModule {}
