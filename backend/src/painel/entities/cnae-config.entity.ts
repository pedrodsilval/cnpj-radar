import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('cnae_config')
export class CnaeConfig {
  @PrimaryColumn({ type: 'varchar', length: 10 })
  codigo: string;

  @Column({ type: 'varchar' })
  descricao: string;

  @Column({ type: 'varchar', nullable: true })
  segmento: string | null;

  @Column({ name: 'oferta_sugerida', type: 'text', nullable: true })
  ofertaSugerida: string | null;

  @Column({ type: 'boolean', default: true })
  prioritario: boolean;

  @CreateDateColumn({ name: 'criado_em' })
  criadoEm: Date;

  @UpdateDateColumn({ name: 'atualizado_em' })
  atualizadoEm: Date;
}
