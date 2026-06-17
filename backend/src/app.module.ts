import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CnpjModule } from './cnpj/cnpj.module';
import { LeadsModule } from './leads/leads.module';
import { WorkflowRunsModule } from './workflow-runs/workflow-runs.module';
import { CertidoesModule } from './certidoes/certidoes.module';
import { CredenciaisModule } from './credenciais/credenciais.module';
import { PainelModule } from './painel/painel.module';
import { AuthModule } from './auth/auth.module';
import { TarefasModule } from './tarefas/tarefas.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { Usuario } from './database/entities/usuario.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      autoLoadEntities: true,
      synchronize: process.env.APP_ENV !== 'production',
      ssl: { rejectUnauthorized: false },
      entities: [Usuario],
    }),
    AuthModule,
    TarefasModule,
    DashboardModule,
    CnpjModule,
    LeadsModule,
    WorkflowRunsModule,
    CertidoesModule,
    CredenciaisModule,
    PainelModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
