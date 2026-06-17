import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type StatusCampanha = 'ativa' | 'pausada' | 'encerrada';

@Entity('campanhas')
export class Campanha {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  titulo: string;

  @Column({ type: 'varchar', nullable: true })
  segmento: string | null;

  @Column({ name: 'cnae_codigo', type: 'varchar', nullable: true })
  cnaeCodigo: string | null;

  @Column({ type: 'text', nullable: true })
  descricao: string | null;

  @Column({ name: 'oferta_sugerida', type: 'text', nullable: true })
  ofertaSugerida: string | null;

  @Column({ type: 'varchar', length: 20, default: 'ativa' })
  status: StatusCampanha;

  @Column({ name: 'data_inicio', type: 'date', nullable: true })
  dataInicio: string | null;

  @Column({ name: 'data_fim', type: 'date', nullable: true })
  dataFim: string | null;

  @CreateDateColumn({ name: 'criado_em' })
  criadoEm: Date;

  @UpdateDateColumn({ name: 'atualizado_em' })
  atualizadoEm: Date;
}
