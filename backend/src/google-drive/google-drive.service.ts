import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { CredenciaisService } from '../credenciais/credenciais.service';
import { CredencialTipo } from '../credenciais/credencial.entity';

const SCOPE = 'https://www.googleapis.com/auth/drive';

export interface PastaCandidata {
  id: string;
  nome: string;
  pontuacao: number;
}

function normalizarNome(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Pontua o quão provável é que uma pasta do Drive corresponda a um cliente,
// comparando o nome da pasta (geralmente abreviado, ex: "MULTILOC") com a
// razão social completa (ex: "MULTILOC LOCACAO E CONSTRUCAO LTDA"). Nunca é
// usada pra decidir sozinha — só pra ordenar sugestões que o usuário confirma.
function pontuarCandidato(nomePasta: string, razaoSocial: string): number {
  const pasta = normalizarNome(nomePasta);
  const razao = normalizarNome(razaoSocial);
  if (!pasta) return 0;
  if (pasta === razao) return 100;
  if (razao.startsWith(pasta) || pasta.startsWith(razao)) return 90;
  if (razao.includes(pasta) || pasta.includes(razao)) return 75;

  const palavrasPasta = new Set(pasta.split(' ').filter((w) => w.length > 2));
  const palavrasRazao = new Set(razao.split(' ').filter((w) => w.length > 2));
  if (palavrasPasta.size === 0) return 0;
  const intersecao = [...palavrasPasta].filter((w) => palavrasRazao.has(w)).length;
  return intersecao === 0 ? 0 : Math.round((intersecao / palavrasPasta.size) * 60);
}

// Termos aceitos como "a subpasta de relatório de pré-análise desse
// cliente" — segue a convenção observada na estrutura real do escritório
// (pastas numeradas tipo "8.0 - Relatório de pré análise").
const TERMOS_SUBPASTA_RELATORIO = ['PRE ANALISE', 'PRÉ ANÁLISE', '8.0'];
const NOME_SUBPASTA_PADRAO = '8.0 - Relatório de pré análise';

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

  async obterPastaRaizClientes(): Promise<string | null> {
    return this.credenciais.obterValor(CredencialTipo.GOOGLE_DRIVE_PASTA_RAIZ_CLIENTES);
  }

  async salvarPastaRaizClientes(pastaId: string): Promise<void> {
    await this.credenciais.salvarOuAtualizarPorTipo(
      CredencialTipo.GOOGLE_DRIVE_PASTA_RAIZ_CLIENTES,
      'Pasta raiz de clientes no Drive (busca automática)',
      pastaId,
    );
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

  private async listarSubpastas(pastaId: string): Promise<{ id: string; nome: string }[]> {
    const cliente = await this.obterClienteAutorizado();
    const { token } = await cliente.getAccessToken();
    if (!token) throw new Error('Não foi possível obter token de acesso ao Google Drive.');

    const q = `'${pastaId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1000`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const detalhe = await res.text().catch(() => '');
      throw new Error(`Falha ao listar subpastas do Drive: HTTP ${res.status} ${detalhe}`);
    }
    const body = await res.json() as { files?: { id: string; name: string }[] };
    return (body.files ?? []).map((f) => ({ id: f.id, nome: f.name }));
  }

  private async criarSubpasta(pastaPaiId: string, nome: string): Promise<string> {
    const cliente = await this.obterClienteAutorizado();
    const { token } = await cliente.getAccessToken();
    const res = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nome, mimeType: 'application/vnd.google-apps.folder', parents: [pastaPaiId] }),
    });
    if (!res.ok) {
      const detalhe = await res.text().catch(() => '');
      throw new Error(`Falha ao criar a subpasta "${nome}": HTTP ${res.status} ${detalhe}`);
    }
    const nova = await res.json() as { id: string };
    return nova.id;
  }

  // Busca, dentro da pasta raiz de clientes, as subpastas cujo nome mais se
  // parece com a razão social — nunca decide sozinha, só sugere (quem
  // clicou no botão "Enviar pro Drive"/"Configurar pasta" confirma).
  async buscarCandidatos(razaoSocial: string): Promise<PastaCandidata[]> {
    const pastaRaiz = await this.obterPastaRaizClientes();
    if (!pastaRaiz) {
      throw new BadRequestException('Pasta raiz de clientes não configurada. Configure em Credenciais > Conta do Google Drive.');
    }
    const subpastas = await this.listarSubpastas(pastaRaiz);
    return subpastas
      .map((p) => ({ id: p.id, nome: p.nome, pontuacao: pontuarCandidato(p.nome, razaoSocial) }))
      .filter((p) => p.pontuacao > 0)
      .sort((a, b) => b.pontuacao - a.pontuacao)
      .slice(0, 5);
  }

  // Depois que o usuário confirma qual é a pasta do cliente, acha (ou cria,
  // se ainda não existir) a subpasta de relatório de pré-análise dentro
  // dela — é essa subpasta que vira o destino final salvo na empresa.
  async resolverPastaRelatorio(pastaClienteId: string): Promise<{ id: string; nome: string }> {
    const subpastas = await this.listarSubpastas(pastaClienteId);
    const existente = subpastas.find((p) => {
      const nome = normalizarNome(p.nome);
      return TERMOS_SUBPASTA_RELATORIO.some((termo) => nome.includes(normalizarNome(termo)));
    });
    if (existente) return { id: existente.id, nome: existente.nome };

    const novoId = await this.criarSubpasta(pastaClienteId, NOME_SUBPASTA_PADRAO);
    return { id: novoId, nome: NOME_SUBPASTA_PADRAO };
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
