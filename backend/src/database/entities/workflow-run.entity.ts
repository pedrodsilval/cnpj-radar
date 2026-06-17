import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('workflow_runs')
export class WorkflowRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'workflow_id', type: 'varchar' })
  workflowId: string;

  @Column({ name: 'execucao_id', nullable: true, type: 'varchar' })
  execucaoId: string | null;

  @Column({ type: 'varchar', length: 20 })
  status: string;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  resultado: Record<string, unknown> | null;

  @Column({ name: 'concluido_em', nullable: true, type: 'timestamptz' })
  concluidoEm: Date | null;

  @CreateDateColumn({ name: 'iniciado_em' })
  iniciadoEm: Date;
}
