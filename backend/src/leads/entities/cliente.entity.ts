import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Empresa } from '../../cnpj/entities/empresa.entity';

export enum ClienteStatus {
  ATIVO = 'ativo',
  EX_CLIENTE = 'ex_cliente',
}

@Entity('clientes')
export class Cliente {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ unique: true, type: 'varchar', length: 14 })
  cnpj: string;

  @ManyToOne(() => Empresa, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'empresa_id' })
  empresa: Empresa | null;

  @Column({ name: 'empresa_id', nullable: true, type: 'varchar' })
  empresaId: string | null;

  @Index()
  @Column({ type: 'varchar', default: ClienteStatus.ATIVO })
  status: ClienteStatus;

  @Column({ name: 'data_inicio', nullable: true, type: 'varchar', length: 10 })
  dataInicio: string | null;

  @Column({ name: 'data_fim', nullable: true, type: 'varchar', length: 10 })
  dataFim: string | null;

  @Column({ name: 'responsavel_interno', nullable: true, type: 'varchar' })
  responsavelInterno: string | null;

  @CreateDateColumn({ name: 'criado_em' })
  criadoEm: Date;

  @UpdateDateColumn({ name: 'atualizado_em' })
  atualizadoEm: Date;
}
