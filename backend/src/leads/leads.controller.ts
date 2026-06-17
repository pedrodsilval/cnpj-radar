import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
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
