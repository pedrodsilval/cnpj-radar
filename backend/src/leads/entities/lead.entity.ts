import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Empresa } from '../../cnpj/entities/empresa.entity';
import { Observacao } from './observacao.entity';
import { HistoricoStatus } from './historico-status.entity';

export enum LeadStatus {
  NOVO = 'novo',
  EM_CONTATO = 'em_contato',
  PROPOSTA_ENVIADA = 'proposta_enviada',
  CONVERTIDO = 'convertido',
  DESCARTADO = 'descartado',
}

@Entity('leads')
export class Lead {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 14 })
  cnpj: string;

  @ManyToOne(() => Empresa, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'empresa_id' })
  empresa: Empresa | null;

  @Column({ name: 'empresa_id', nullable: true, type: 'varchar' })
  empresaId: string | null;

  @Index()
  @Column({ type: 'varchar', default: LeadStatus.NOVO })
  status: LeadStatus;

  @Column({ name: 'score_cadastral', nullable: true, type: 'int' })
  scoreCadastral: number | null;

  @Column({ name: 'score_comercial', nullable: true, type: 'int' })
  scoreComercial: number | null;

  @Column({ name: 'score_atencao', nullable: true, type: 'int' })
  scoreAtencao: number | null;

  @Column({ nullable: true, type: 'text' })
  recomendacao: string | null;

  @Column({ name: 'usuario_id', nullable: true, type: 'varchar' })
  usuarioId: string | null;

  @CreateDateColumn({ name: 'salvo_em' })
  salvoEm: Date;

  @UpdateDateColumn({ name: 'atualizado_em' })
  atualizadoEm: Date;

  @OneToMany(() => Observacao, (o) => o.lead)
  observacoes: Observacao[];

  @OneToMany(() => HistoricoStatus, (h) => h.lead)
  historico: HistoricoStatus[];
}
