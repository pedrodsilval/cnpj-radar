import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Consulta } from './consulta.entity';
import { Socio } from './socio.entity';
import { Cnae } from './cnae.entity';

@Entity('empresas')
export class Empresa {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, type: 'varchar', length: 14 })
  cnpj: string;

  @Column({ name: 'razao_social', type: 'varchar' })
  razaoSocial: string;

  @Column({ name: 'nome_fantasia', nullable: true, type: 'varchar' })
  nomeFantasia: string | null;

  @Column({ name: 'situacao_cadastral', type: 'varchar' })
  situacaoCadastral: string;

  @Column({ name: 'situacao_cadastral_codigo', nullable: true, type: 'int' })
  situacaoCadastralCodigo: number | null;

  @Column({ name: 'situacao_cadastral_data', nullable: true, type: 'varchar', length: 10 })
  situacaoCadastralData: string | null;

  @Column({ name: 'natureza_juridica', nullable: true, type: 'varchar' })
  naturezaJuridica: string | null;

  @Column({ nullable: true, type: 'varchar' })
  tipo: string | null;

  @Column({ nullable: true, type: 'varchar' })
  porte: string | null;

  @Column({ name: 'cnae_principal_codigo', nullable: true, type: 'varchar', length: 7 })
  cnaePrincipalCodigo: string | null;

  @Column({ name: 'cnae_principal_descricao', nullable: true, type: 'varchar' })
  cnaePrincipalDescricao: string | null;

  @Column({ nullable: true, type: 'varchar' })
  logradouro: string | null;

  @Column({ nullable: true, type: 'varchar', length: 20 })
  numero: string | null;

  @Column({ nullable: true, type: 'varchar' })
  complemento: string | null;

  @Column({ nullable: true, type: 'varchar' })
  bairro: string | null;

  @Index()
  @Column({ nullable: true, type: 'varchar' })
  municipio: string | null;

  @Column({ nullable: true, type: 'varchar', length: 2 })
  uf: string | null;

  @Column({ nullable: true, type: 'varchar', length: 8 })
  cep: string | null;

  @Column({ nullable: true, type: 'varchar' })
  email: string | null;

  @Column({ nullable: true, type: 'varchar', length: 11 })
  telefone: string | null;

  @Column({ name: 'capital_social', nullable: true, type: 'numeric', precision: 15, scale: 2 })
  capitalSocial: number | null;

  @Column({ name: 'optante_simples', nullable: true, type: 'boolean' })
  optanteSimples: boolean | null;

  @Column({ name: 'optante_mei', nullable: true, type: 'boolean' })
  optanteMei: boolean | null;

  @Column({ name: 'data_inicio_atividade', nullable: true, type: 'varchar', length: 10 })
  dataInicioAtividade: string | null;

  @CreateDateColumn({ name: 'criado_em' })
  criadoEm: Date;

  @UpdateDateColumn({ name: 'atualizado_em' })
  atualizadoEm: Date;

  @OneToMany(() => Consulta, (c) => c.empresa)
  consultas: Consulta[];

  @OneToMany(() => Socio, (s) => s.empresa)
  socios: Socio[];

  @OneToMany(() => Cnae, (c) => c.empresa)
  cnaesSecundarios: Cnae[];
}
