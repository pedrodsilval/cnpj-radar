import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Credencial } from './credencial.entity';
import { CredenciaisCriptService } from './credenciais-cript.service';
import { CredenciaisService } from './credenciais.service';
import { CredenciaisController } from './credenciais.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Credencial])],
  controllers: [CredenciaisController],
  providers: [CredenciaisCriptService, CredenciaisService],
  exports: [CredenciaisService],
})
export class CredenciaisModule {}
