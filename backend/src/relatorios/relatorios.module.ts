import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Empresa } from '../cnpj/entities/empresa.entity';
import { Socio } from '../cnpj/entities/socio.entity';
import { Certidao } from '../database/entities/certidao.entity';
import { Usuario } from '../database/entities/usuario.entity';
import { RelatorioGerado } from './relatorio-gerado.entity';
import { RelatoriosService } from './relatorios.service';
import { RelatoriosController } from './relatorios.controller';
import { SupabaseStorageService } from '../common/supabase-storage.service';
import { CertidoesModule } from '../certidoes/certidoes.module';
import { CredenciaisModule } from '../credenciais/credenciais.module';
import { GoogleDriveService } from './google-drive.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Empresa, Socio, Certidao, RelatorioGerado, Usuario]),
    CertidoesModule,
    CredenciaisModule,
  ],
  providers: [RelatoriosService, SupabaseStorageService, GoogleDriveService],
  controllers: [RelatoriosController],
})
export class RelatoriosModule {}
