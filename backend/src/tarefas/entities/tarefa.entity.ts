import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type StatusTarefa  = 'pendente' | 'em_andamento' | 'concluida' | 'cancelada';
export type PrioridadeTarefa = 'baixa' | 'media' | 'alta';

@Entity('tarefas')
export class Tarefa {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  titulo: string;

  @Column({ type: 'text', nullable: true })
  descricao: string | null;

  @Column({ type: 'varchar', length: 20, default: 'pendente' })
  status: StatusTarefa;

  @Column({ type: 'varchar', length: 10, default: 'media' })
  prioridade: PrioridadeTarefa;

  @Column({ name: 'responsavel_id', type: 'uuid', nullable: true })
  responsavelId: string | null;

  @Column({ name: 'responsavel_nome', type: 'varchar', nullable: true })
  responsavelNome: string | null;

  @Column({ name: 'cnpj_vinculado', type: 'varchar', nullable: true })
  cnpjVinculado: string | null;

  @Column({ name: 'lead_id', type: 'uuid', nullable: true })
  leadId: string | null;

  @Column({ name: 'certidao_id', type: 'uuid', nullable: true })
  certidaoId: string | null;

  @Column({ name: 'data_limite', type: 'date', nullable: true })
  dataLimite: string | null;

  @Column({ name: 'concluida_em', type: 'timestamptz', nullable: true })
  concluidaEm: Date | null;

  @CreateDateColumn({ name: 'criado_em' })
  criadoEm: Date;

  @UpdateDateColumn({ name: 'atualizado_em' })
  atualizadoEm: Date;
}
