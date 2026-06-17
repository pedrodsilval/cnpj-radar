import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Empresa } from './empresa.entity';

@Entity('consultas')
export class Consulta {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 14 })
  cnpj: string;

  @ManyToOne(() => Empresa, (e) => e.consultas, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'empresa_id' })
  empresa: Empresa | null;

  @Column({ name: 'empresa_id', nullable: true, type: 'varchar' })
  empresaId: string | null;

  @Column({ type: 'varchar' })
  fonte: string;

  @Column({ name: 'erro', nullable: true, type: 'varchar', length: 30 })
  erro: string | null;

  @Column({ name: 'usuario_id', nullable: true, type: 'varchar' })
  usuarioId: string | null;

  @Index()
  @CreateDateColumn({ name: 'consultado_em' })
  consultadoEm: Date;
}
