import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum CredencialTipo {
  API_2CAPTCHA    = 'API_2CAPTCHA',
  CERTIFICADO_A1  = 'CERTIFICADO_A1',
  API_INFOSIMPLES = 'API_INFOSIMPLES',
  PORTAL_ECAC     = 'PORTAL_ECAC',
  // Descontinuado: contas de serviço não têm cota própria de armazenamento
  // no Drive (só funcionam com Shared Drives do Workspace). Mantido só pra
  // não quebrar a leitura da credencial já cadastrada antes dessa descoberta
  // (ver GOOGLE_OAUTH_CLIENT/GOOGLE_DRIVE_REFRESH_TOKEN, 28/10/2026).
  GOOGLE_DRIVE_SERVICE_ACCOUNT = 'GOOGLE_DRIVE_SERVICE_ACCOUNT',
  GOOGLE_OAUTH_CLIENT = 'GOOGLE_OAUTH_CLIENT',
  GOOGLE_DRIVE_REFRESH_TOKEN = 'GOOGLE_DRIVE_REFRESH_TOKEN',
  // ID da pasta raiz onde ficam as pastas de cada cliente — usada só pra
  // alimentar a busca automática de pasta por cliente (GoogleDriveService.
  // buscarCandidatos), nunca como destino de upload em si.
  GOOGLE_DRIVE_PASTA_RAIZ_CLIENTES = 'GOOGLE_DRIVE_PASTA_RAIZ_CLIENTES',
  OUTRO           = 'OUTRO',
}

export const CREDENCIAL_LABELS: Record<CredencialTipo, string> = {
  [CredencialTipo.API_2CAPTCHA]:    '2captcha (API Key)',
  [CredencialTipo.CERTIFICADO_A1]:  'Certificado A1 (.pfx + senha)',
  [CredencialTipo.API_INFOSIMPLES]: 'Infosimples (API Key)',
  [CredencialTipo.PORTAL_ECAC]:     'Portal e-CAC (login/senha)',
  [CredencialTipo.GOOGLE_DRIVE_SERVICE_ACCOUNT]: 'Google Drive (conta de serviço — descontinuado)',
  [CredencialTipo.GOOGLE_OAUTH_CLIENT]: 'Google OAuth (Client ID/Secret)',
  [CredencialTipo.GOOGLE_DRIVE_REFRESH_TOKEN]: 'Google Drive (conta autorizada)',
  [CredencialTipo.GOOGLE_DRIVE_PASTA_RAIZ_CLIENTES]: 'Google Drive (pasta raiz de clientes)',
  [CredencialTipo.OUTRO]:           'Outro',
};

@Entity('credenciais')
export class Credencial {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  tipo: CredencialTipo;

  @Column({ type: 'varchar', length: 200 })
  descricao: string;

  @Column({ name: 'valor_criptografado', type: 'text' })
  valorCriptografado: string;

  @Column({ type: 'varchar', length: 32 })
  iv: string;

  @Column({ type: 'varchar', length: 32 })
  tag: string;

  @Column({ default: true })
  ativo: boolean;

  @Column({ name: 'ultima_verificacao', type: 'timestamptz', nullable: true })
  ultimaVerificacao: Date | null;

  @CreateDateColumn({ name: 'criado_em' })
  criadoEm: Date;

  @UpdateDateColumn({ name: 'atualizado_em' })
  atualizadoEm: Date;
}
