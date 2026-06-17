import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('anexos')
export class Anexo {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'empresa_id', type: 'varchar' })
  empresaId: string;

  @Column({ name: 'certidao_id', nullable: true, type: 'varchar' })
  certidaoId: string | null;

  @Column({ name: 'nome_arquivo', type: 'varchar' })
  nomeArquivo: string;

  @Column({ type: 'varchar' })
  url: string;

  @Column({ name: 'enviado_por', nullable: true, type: 'varchar' })
  enviadoPor: string | null;

  @CreateDateColumn({ name: 'uploaded_em' })
  uploadedEm: Date;
}
