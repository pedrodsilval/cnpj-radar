import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Lead } from './lead.entity';

@Entity('historico_status')
export class HistoricoStatus {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Lead, (l) => l.historico, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'lead_id' })
  lead: Lead | null;

  @Index()
  @Column({ name: 'lead_id', nullable: true, type: 'varchar' })
  leadId: string | null;

  @Column({ name: 'campo_alterado', type: 'varchar', length: 50 })
  campoAlterado: string;

  @Column({ name: 'valor_anterior', nullable: true, type: 'varchar' })
  valorAnterior: string | null;

  @Column({ name: 'valor_novo', nullable: true, type: 'varchar' })
  valorNovo: string | null;

  @Column({ name: 'alterado_por', nullable: true, type: 'varchar' })
  alteradoPor: string | null;

  @CreateDateColumn({ name: 'alterado_em' })
  alteradoEm: Date;
}
