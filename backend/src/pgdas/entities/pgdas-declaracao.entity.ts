import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('pgdas_declaracoes')
@Index(['empresaId', 'periodoApuracao'], { unique: true })
export class PgdasDeclaracao {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'empresa_id', type: 'varchar' })
  empresaId: string;

  // Formato 'YYYY-MM' — ordenação lexicográfica já fica cronológica.
  @Column({ name: 'periodo_apuracao', type: 'varchar', length: 7 })
  periodoApuracao: string;

  @Column({ type: 'numeric', precision: 15, scale: 2 })
  rbt12: number;

  @Column({ name: 'receita_bruta_mes', nullable: true, type: 'numeric', precision: 15, scale: 2 })
  receitaBrutaMes: number | null;

  @Column({ name: 'cnpj_declarado', type: 'varchar', length: 14 })
  cnpjDeclarado: string;

  @Column({ name: 'nome_arquivo', type: 'varchar' })
  nomeArquivo: string;

  @Column({ name: 'url_arquivo', type: 'varchar' })
  urlArquivo: string;

  @CreateDateColumn({ name: 'criado_em' })
  criadoEm: Date;
}
