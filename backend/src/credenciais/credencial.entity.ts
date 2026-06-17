import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum CredencialTipo {
  API_2CAPTCHA    = 'API_2CAPTCHA',
  CERTIFICADO_A1  = 'CERTIFICADO_A1',
  API_INFOSIMPLES = 'API_INFOSIMPLES',
  PORTAL_ECAC     = 'PORTAL_ECAC',
  OUTRO           = 'OUTRO',
}

export const CREDENCIAL_LABELS: Record<CredencialTipo, string> = {
  [CredencialTipo.API_2CAPTCHA]:    '2captcha (API Key)',
  [CredencialTipo.CERTIFICADO_A1]:  'Certificado A1 (.pfx + senha)',
  [CredencialTipo.API_INFOSIMPLES]: 'Infosimples (API Key)',
  [CredencialTipo.PORTAL_ECAC]:     'Portal e-CAC (login/senha)',
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
