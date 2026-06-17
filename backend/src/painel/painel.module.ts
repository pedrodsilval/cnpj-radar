import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CnaeConfig } from './entities/cnae-config.entity';
import { Campanha } from './entities/campanha.entity';
import { PainelService } from './painel.service';
import { PainelController } from './painel.controller';

@Module({
  imports: [TypeOrmModule.forFeature([CnaeConfig, Campanha])],
  providers: [PainelService],
  controllers: [PainelController],
})
export class PainelModule {}
