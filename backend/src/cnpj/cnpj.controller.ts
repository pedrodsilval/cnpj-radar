import { BadRequestException, Body, Controller, Get, Param, Post, Request, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CnpjService } from './cnpj.service';
import { CnpjPdfService } from './cnpj-pdf.service';
import type { CnpjErrorCode } from './cnpj.types';
const HTTP_STATUS: Record<CnpjErrorCode, number> = {
  CNPJ_INVALIDO: 400,
  CNPJ_NAO_ENCONTRADO: 404,
  RATE_LIMIT: 429,
  SERVICO_INDISPONIVEL: 503,
  TIMEOUT: 504,
  ERRO_DE_REDE: 502,
  RESPOSTA_INCOMPLETA: 502,
};

@Controller('cnpj')
export class CnpjController {
  constructor(
    private readonly cnpjService: CnpjService,
    private readonly cnpjPdfService: CnpjPdfService,
  ) {}

  @Post('lote')
  async lote(
    @Body() body: { cnpjs?: unknown },
    @Request() req: { user: { id: string } },
  ) {
    if (!Array.isArray(body?.cnpjs) || body.cnpjs.length === 0) {
      throw new BadRequestException('Informe um array "cnpjs" com ao menos um CNPJ.');
    }
    if (body.cnpjs.length > 10) {
      throw new BadRequestException('Máximo de 10 CNPJs por requisição. Para volumes maiores use um fornecedor pago.');
    }
    return this.cnpjService.consultarLote(body.cnpjs as string[], req.user.id);
  }

  // Rota mais especifica declarada antes da rota parametrica generica
  @Get(':cnpj/pdf')
  async pdf(
    @Param('cnpj') cnpj: string,
    @Res() res: Response,
    @Request() req: { user: { id: string } },
  ) {
    const resultado = await this.cnpjService.consultarCnpj(cnpj, req.user.id);

    if ('error' in resultado) {
      const status = HTTP_STATUS[resultado.error] ?? 500;
      res.status(status).json(resultado);
      return;
    }

    const pdfBuffer = await this.cnpjPdfService.gerarPdf(resultado);
    const filename = `relatorio-cnpj-${resultado.dados.cnpj}.pdf`;

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(pdfBuffer.length),
    });
    res.end(pdfBuffer);
  }

  @Get(':cnpj')
  consultar(@Param('cnpj') cnpj: string, @Request() req: { user: { id: string } }) {
    return this.cnpjService.consultarCnpj(cnpj, req.user.id);
  }
}
