import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkflowRun } from '../database/entities/workflow-run.entity';

@Injectable()
export class WorkflowRunsService {
  constructor(
    @InjectRepository(WorkflowRun)
    private readonly repo: Repository<WorkflowRun>,
  ) {}

  async registrar(dto: {
    workflowId: string;
    execucaoId?: string;
    payload?: Record<string, unknown>;
  }): Promise<WorkflowRun> {
    const run = this.repo.create({
      workflowId: dto.workflowId,
      execucaoId: dto.execucaoId ?? null,
      status: 'iniciado',
      payload: dto.payload ?? null,
    });
    return this.repo.save(run);
  }

  async concluir(
    id: string,
    dto: { status: 'concluido' | 'erro'; resultado?: Record<string, unknown> },
  ): Promise<WorkflowRun> {
    const run = await this.repo.findOne({ where: { id } });
    if (!run) throw new NotFoundException('WorkflowRun não encontrado.');

    run.status = dto.status;
    run.resultado = dto.resultado ?? null;
    run.concluidoEm = new Date();
    return this.repo.save(run);
  }

  listar(): Promise<WorkflowRun[]> {
    return this.repo.find({ order: { iniciadoEm: 'DESC' } });
  }
}
