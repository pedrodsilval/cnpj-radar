import { Body, Controller, Get, Headers, Logger, Param, Patch, Post, UnauthorizedException } from '@nestjs/common';
import { WorkflowRunsService } from './workflow-runs.service';
import { Public } from '../auth/decorators/public.decorator';

const logger = new Logger('WorkflowRunsController');

function verificarSegredoN8n(secret: string | undefined): void {
  const esperado = process.env.N8N_WEBHOOK_SECRET;
  if (!esperado) {
    // Aviso uma vez por processo (não há estado de "já avisou", mas Logger já deduplicaria em prod)
    logger.warn('[SECURITY] N8N_WEBHOOK_SECRET não configurado — endpoints do n8n estão sem autenticação.');
    return;
  }
  if (secret !== esperado) {
    throw new UnauthorizedException('Segredo inválido para webhook n8n.');
  }
}

@Controller('workflow-runs')
export class WorkflowRunsController {
  constructor(private readonly service: WorkflowRunsService) {}

  @Public()
  @Post()
  registrar(
    @Body()
    body: {
      workflowId: string;
      execucaoId?: string;
      payload?: Record<string, unknown>;
    },
    @Headers('x-n8n-secret') secret?: string,
  ) {
    verificarSegredoN8n(secret);
    return this.service.registrar(body);
  }

  @Public()
  @Patch(':id/concluir')
  concluir(
    @Param('id') id: string,
    @Body() body: { status: 'concluido' | 'erro'; resultado?: Record<string, unknown> },
    @Headers('x-n8n-secret') secret?: string,
  ) {
    verificarSegredoN8n(secret);
    return this.service.concluir(id, body);
  }

  // GET requer JWT (não é @Public) — somente usuários autenticados consultam o audit trail
  @Get()
  listar() {
    return this.service.listar();
  }
}
