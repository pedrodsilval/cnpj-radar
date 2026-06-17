import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Empresa } from './empresa.entity';

@Entity('socios')
export class Socio {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Empresa, (e) => e.socios, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'empresa_id' })
  empresa: Empresa;

  @Column({ name: 'empresa_id', type: 'varchar' })
  empresaId: string;

  @Column({ type: 'varchar' })
  nome: string;

  @Column({ nullable: true, type: 'varchar' })
  qualificacao: string | null;

  @Column({ name: 'faixa_etaria', nullable: true, type: 'varchar' })
  faixaEtaria: string | null;

  @CreateDateColumn({ name: 'criado_em' })
  criadoEm: Date;
}
