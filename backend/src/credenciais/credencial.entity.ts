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
