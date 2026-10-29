import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { CredenciaisService } from '../credenciais/credenciais.service';
import { CredencialTipo } from '../credenciais/credencial.entity';

const SCOPE = 'https://www.googleapis.com/auth/drive';

// Upload pro Drive via OAuth delegado (não conta de serviço) — conta de
// serviço não tem cota própria de armazenamento fora de Shared Drives do
// Workspace (erro real, 28/10/2026: "Service Accounts do not have storage
// quota"), e as contas usadas aqui são Gmail comuns. Nesse modelo, a conta
// que autorizou (ver /relatorios/drive/autorizar) sobe os arquivos como se
// fosse ela mesma, usando a cota normal de Drive dela.
@Injectable()
export class GoogleDriveService {
  private readonly logger = new Logger(GoogleDriveService.name);

  constructor(private readonly credenciais: CredenciaisService) {}

  private obterRedirectUri(): string {
    const appUrl = process.env.APP_URL;
    if (!appUrl) {
      throw new Error('Variável de ambiente APP_URL não configurada — necessária pro redirect URI do OAuth do Drive.');
    }
    return `${appUrl.replace(/\/$/, '')}/relatorios/drive/callback`;
  }

  private async obterClientOAuth(): Promise<{ client_id: string; client_secret: string }> {
    const json = await this.credenciais.obterValor(CredencialTipo.GOOGLE_OAUTH_CLIENT);
    if (!json) {
      throw new BadRequestException('Client ID/Secret do Google OAuth não cadastrado. Adicione em Credenciais.');
    }
    try {
      return JSON.parse(json);
    } catch {
      throw new BadRequestException('A credencial do Google OAuth Client não é um JSON válido.');
    }
  }

  async gerarUrlAutorizacao(): Promise<string> {
    const { client_id } = await this.obterClientOAuth();
    const oauth2 = new OAuth2Client({ clientId: client_id, redirectUri: this.obterRedirectUri() });
    return oauth2.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // força reemissão do refresh_token mesmo se o usuário já tiver autorizado antes
      scope: [SCOPE],
    });
  }

  async tratarCallback(code: string): Promise<{ email: string }> {
    const { client_id, client_secret } = await this.obterClientOAuth();
    const oauth2 = new OAuth2Client({ clientId: client_id, clientSecret: client_secret, redirectUri: this.obterRedirectUri() });

    const { tokens } = await oauth2.getToken(code);
    if (!tokens.refresh_token) {
      throw new BadRequestException(
        'O Google não retornou um refresh token. Revogue o acesso em myaccount.google.com/permissions (procure "cnpj-radar") e tente autorizar de novo.',
      );
    }
    oauth2.setCredentials(tokens);

    const resp = await oauth2.request<{ user: { emailAddress: string } }>({
      url: 'https://www.googleapis.com/drive/v3/about?fields=user',
    });
    const email = resp.data.user.emailAddress;

    await this.credenciais.salvarOuAtualizarPorTipo(
      CredencialTipo.GOOGLE_DRIVE_REFRESH_TOKEN,
      `Conta Drive conectada: ${email}`,
      tokens.refresh_token,
    );

    return { email };
  }

  async status(): Promise<{ conectado: boolean; descricao?: string }> {
    const lista = await this.credenciais.listar();
    const cred = lista.find((c) => c.tipo === CredencialTipo.GOOGLE_DRIVE_REFRESH_TOKEN && c.ativo);
    return cred ? { conectado: true, descricao: cred.descricao } : { conectado: false };
  }

  private async obterClienteAutorizado(): Promise<OAuth2Client> {
    const { client_id, client_secret } = await this.obterClientOAuth();
    const refreshToken = await this.credenciais.obterValor(CredencialTipo.GOOGLE_DRIVE_REFRESH_TOKEN);
    if (!refreshToken) {
      throw new BadRequestException('Nenhuma conta do Drive autorizada ainda. Vá em Credenciais e conecte uma conta.');
    }
    const oauth2 = new OAuth2Client({ clientId: client_id, clientSecret: client_secret, redirectUri: this.obterRedirectUri() });
    oauth2.setCredentials({ refresh_token: refreshToken });
    return oauth2;
  }

  async enviarPdf(nomeArquivo: string, buffer: Buffer, pastaId: string): Promise<void> {
    const cliente = await this.obterClienteAutorizado();
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
