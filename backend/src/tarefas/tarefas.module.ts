import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tarefa } from './entities/tarefa.entity';
import { TarefasService } from './tarefas.service';
import { TarefasController } from './tarefas.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Tarefa])],
  providers: [TarefasService],
  controllers: [TarefasController],
  exports: [TarefasService],
})
export class TarefasModule {}
