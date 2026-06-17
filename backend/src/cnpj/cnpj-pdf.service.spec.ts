import { CnpjPdfService } from './cnpj-pdf.service';
import { getMockCnpj } from './cnpj.mock';

describe('CnpjPdfService', () => {
  let service: CnpjPdfService;

  beforeEach(() => {
    service = new CnpjPdfService();
  });

  it('retorna um Buffer nao-vazio com assinatura PDF valida (%PDF)', async () => {
    const resultado = getMockCnpj(false);
    const buf = await service.gerarPdf(resultado);

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.slice(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('retorna PDF valido quando simulado e true (ambiente demo)', async () => {
    const resultado = getMockCnpj(true);
    const buf = await service.gerarPdf(resultado);

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 4).toString('ascii')).toBe('%PDF');
  });
});
