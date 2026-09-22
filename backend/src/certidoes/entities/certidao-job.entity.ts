import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum CertidaoJobStatus {
  PENDENTE = 'PENDENTE',
  EM_ANDAMENTO = 'EM_ANDAMENTO',
  CONCLUIDO = 'CONCLUIDO',
  ERRO = 'ERRO',
}

// Fila consumida pela extensão de Chrome instalada no navegador do usuário —
// CND Federal/Dívida Ativa só passam no hCaptcha da Receita rodando de
// navegador real com IP residencial, impossível a partir do servidor (ver
// certidoes-scraper.service.ts, consultarCndFederalHeadedLocal).
@Entity('certidao_jobs')
export class CertidaoJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'empresa_id', type: 'varchar' })
  empresaId: string;

  @Column({ type: 'varchar', length: 14 })
  cnpj: string;

  @Index()
  @Column({ type: 'varchar', length: 20, default: CertidaoJobStatus.PENDENTE })
  status: CertidaoJobStatus;

  @Column({ name: 'solicitado_por', nullable: true, type: 'varchar' })
  solicitadoPor: string | null;

  @Column({ name: 'assumido_por', nullable: true, type: 'varchar' })
  assumidoPor: string | null;

  @Column({ name: 'assumido_em', nullable: true, type: 'timestamptz' })
  assumidoEm: Date | null;

  @Column({ name: 'resultado_status', nullable: true, type: 'varchar', length: 20 })
  resultadoStatus: 'REGULAR' | 'IRREGULAR' | 'INDISPONIVEL' | null;

  @Column({ name: 'resultado_mensagem', nullable: true, type: 'text' })
  resultadoMensagem: string | null;

  @CreateDateColumn({ name: 'criado_em' })
  criadoEm: Date;

  @UpdateDateColumn({ name: 'atualizado_em' })
  atualizadoEm: Date;
}
