import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { WorkflowRunsService } from './workflow-runs.service';
import { Public } from '../auth/decorators/public.decorator';

@Public()
@Controller('workflow-runs')
export class WorkflowRunsController {
  constructor(private readonly service: WorkflowRunsService) {}

  @Post()
  registrar(
    @Body()
    body: {
      workflowId: string;
      execucaoId?: string;
      payload?: Record<string, unknown>;
    },
  ) {
    return this.service.registrar(body);
  }

  @Patch(':id/concluir')
  concluir(
    @Param('id') id: string,
    @Body() body: { status: 'concluido' | 'erro'; resultado?: Record<string, unknown> },
  ) {
    return this.service.concluir(id, body);
  }

  @Get()
  listar() {
    return this.service.listar();
  }
}
