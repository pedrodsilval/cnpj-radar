import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { TarefasModule } from '../tarefas/tarefas.module';

@Module({
  imports: [TarefasModule],
  providers: [DashboardService],
  controllers: [DashboardController],
})
export class DashboardModule {}
