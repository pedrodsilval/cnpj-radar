import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Empresa } from './empresa.entity';

@Entity('cnaes')
export class Cnae {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Empresa, (e) => e.cnaesSecundarios, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'empresa_id' })
  empresa: Empresa;

  @Column({ name: 'empresa_id', type: 'varchar' })
  empresaId: string;

  @Column({ type: 'varchar', length: 7 })
  codigo: string;

  @Column({ type: 'varchar' })
  descricao: string;

  @Column({ name: 'prioritario', type: 'boolean', default: false })
  prioritario: boolean;

  @CreateDateColumn({ name: 'criado_em' })
  criadoEm: Date;
}
