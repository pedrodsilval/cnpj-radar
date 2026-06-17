import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Empresa } from '../../cnpj/entities/empresa.entity';
import { Lead } from './lead.entity';

@Entity('observacoes')
export class Observacao {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Empresa, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'empresa_id' })
  empresa: Empresa;

  @Column({ name: 'empresa_id', type: 'varchar' })
  empresaId: string;

  @ManyToOne(() => Lead, (l) => l.observacoes, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'lead_id' })
  lead: Lead | null;

  @Column({ name: 'lead_id', nullable: true, type: 'varchar' })
  leadId: string | null;

  @Column({ type: 'text' })
  texto: string;

  @Column({ nullable: true, type: 'varchar' })
  autor: string | null;

  @CreateDateColumn({ name: 'criado_em' })
  criadoEm: Date;
}
