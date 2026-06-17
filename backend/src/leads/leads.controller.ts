import { Body, Controller, Get, Param, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { LeadsService } from './leads.service';

@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post(':cnpj')
  salvarLead(@Param('cnpj') cnpj: string) {
    return this.leadsService.salvarLead(cnpj);
  }

  @Get()
  listarLeads() {
    return this.leadsService.listarLeads();
  }

  // Rotas específicas declaradas antes das genéricas (:id)
  @Get('cnpj/:cnpj')
  buscarLeadPorCnpj(@Param('cnpj') cnpj: string) {
    return this.leadsService.buscarLeadPorCnpj(cnpj);
  }

  @Get(':id/proposta/pdf')
  async gerarPropostaPdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.leadsService.gerarPropostaPdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="proposta-${id}.pdf"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  @Get(':id/proposta')
  gerarProposta(@Param('id') id: string) {
    return this.leadsService.gerarProposta(id);
  }

  @Get(':id')
  buscarLead(@Param('id') id: string) {
    return this.leadsService.buscarLead(id);
  }

  @Patch(':id/status')
  atualizarStatus(@Param('id') id: string, @Body() body: { status: string }) {
    return this.leadsService.atualizarStatus(id, body.status);
  }
}
