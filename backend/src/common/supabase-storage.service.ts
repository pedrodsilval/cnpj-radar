import { Injectable, Logger } from '@nestjs/common';

const BUCKET = 'certidoes';

// Substitui gravação em disco local (uploads/certidoes) — no Render o
// filesystem do container é efêmero e é apagado a cada deploy/restart, o
// que já causou PDFs "sumindo" em produção (achado real em 03/09/2026:
// downloads de certidões geradas antes de um redeploy passaram a retornar
// "arquivo não disponível no site"). Storage do Supabase é persistente e
// acessível tanto de produção quanto de qualquer execução local — resolve
// os dois problemas (perda em redeploy + PDFs gerados localmente nunca
// chegando no disco da produção) de uma vez.
@Injectable()
export class SupabaseStorageService {
  private readonly logger = new Logger(SupabaseStorageService.name);

  async uploadPdf(buffer: Buffer, prefixo: string): Promise<string> {
    // Lidas dentro do método (não como const de módulo) de propósito: um
    // const de topo de módulo é avaliado durante a fase de import, que
    // roda ANTES do ConfigModule.forRoot() carregar o .env — capturaria
    // string vazia pra sempre. Confirmado em teste real: erro "não
    // configuradas" mesmo com as duas variáveis certinhas no .env.
    const supabaseUrl = process.env.SUPABASE_URL ?? '';
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY não configuradas — não é possível salvar o PDF.');
    }

    const filename = `${prefixo}-${Date.now()}.pdf`;
    const res = await fetch(`${supabaseUrl}/storage/v1/object/${BUCKET}/${filename}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        'Content-Type': 'application/pdf',
      },
      body: new Uint8Array(buffer),
    });

    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      throw new Error(`Upload pro Supabase Storage falhou (HTTP ${res.status}): ${corpo.slice(0, 300)}`);
    }

    const urlPublica = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${filename}`;
    this.logger.log(`PDF salvo no Storage: ${filename}`);
    return urlPublica;
  }
}
