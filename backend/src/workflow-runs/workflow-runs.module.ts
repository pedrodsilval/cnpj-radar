import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkflowRun } from '../database/entities/workflow-run.entity';
import { WorkflowRunsService } from './workflow-runs.service';
import { WorkflowRunsController } from './workflow-runs.controller';

@Module({
  imports: [TypeOrmModule.forFeature([WorkflowRun])],
  controllers: [WorkflowRunsController],
  providers: [WorkflowRunsService],
  exports: [WorkflowRunsService],
})
export class WorkflowRunsModule {}
