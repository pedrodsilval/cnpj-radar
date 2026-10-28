import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { JWT } from 'google-auth-library';
import { CredenciaisService } from '../credenciais/credenciais.service';
import { CredencialTipo } from '../credenciais/credencial.entity';

// Sobe arquivos pra pastas do Google Drive usando uma única conta de serviço
// compartilhada (credencial GOOGLE_DRIVE_SERVICE_ACCOUNT em Credenciais) —
// cada usuário só precisa compartilhar SUA pasta de destino com o e-mail
// dessa conta de serviço (client_email da chave JSON) pra receber os
// relatórios que ele mesmo envia em lote (ver RelatoriosService.enviarLotePraDrive).
@Injectable()
export class GoogleDriveService {
  private readonly logger = new Logger(GoogleDriveService.name);
  private clienteCache: JWT | null = null;

  constructor(private readonly credenciais: CredenciaisService) {}

  private async obterCliente(): Promise<JWT> {
    if (this.clienteCache) return this.clienteCache;

    const json = await this.credenciais.obterValor(CredencialTipo.GOOGLE_DRIVE_SERVICE_ACCOUNT);
    if (!json) {
      throw new BadRequestException(
        'Credencial da conta de serviço do Google Drive não cadastrada. Adicione em Credenciais.',
      );
    }

    let chave: { client_email: string; private_key: string };
    try {
      chave = JSON.parse(json);
    } catch {
      throw new BadRequestException('A credencial do Google Drive não é um JSON válido.');
    }

    this.clienteCache = new JWT({
      email: chave.client_email,
      key: chave.private_key,
      scopes: ['https://www.googleapis.com/auth/drive'],
    });
    return this.clienteCache;
  }

  async enviarPdf(nomeArquivo: string, buffer: Buffer, pastaId: string): Promise<void> {
    const cliente = await this.obterCliente();
    const { token } = await cliente.getAccessToken();
    if (!token) throw new Error('Não foi possível obter token de acesso ao Google Drive.');

    const boundary = `cnpjradar-${Date.now()}`;
    const metadata = JSON.stringify({ name: nomeArquivo, parents: [pastaId] });
    const corpo = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`),
      buffer,
      Buffer.from(`\r\n--${boundary}--`),
    ]);

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: corpo,
    });

    if (!res.ok) {
      const detalhe = await res.text().catch(() => '');
      throw new Error(`Falha ao enviar "${nomeArquivo}" pro Drive: HTTP ${res.status} ${detalhe}`);
    }
  }
}
