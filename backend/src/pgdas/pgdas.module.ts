import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Empresa } from '../cnpj/entities/empresa.entity';
import { PgdasDeclaracao } from './entities/pgdas-declaracao.entity';
import { PgdasService } from './pgdas.service';
import { PgdasController } from './pgdas.controller';
import { SupabaseStorageService } from '../common/supabase-storage.service';

@Module({
  imports: [TypeOrmModule.forFeature([Empresa, PgdasDeclaracao])],
  controllers: [PgdasController],
  providers: [PgdasService, SupabaseStorageService],
})
export class PgdasModule {}
