import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Empresa } from '../../cnpj/entities/empresa.entity';

export type CertificadoTipo = 'A1' | 'A3';

// Guarda o certificado digital (.pfx/.p12) + senha de uma empresa, criptografados.
// Diferente da tabela `credenciais` (1 segredo genérico por linha, sem dono):
// aqui o certificado é sempre de UMA empresa específica, e arquivo+senha viajam
// juntos como um único blob JSON criptografado (reaproveita
// CredenciaisCriptService.encrypt(string), sem duplicar lógica de cripto).
@Entity('certificados_digitais')
export class CertificadoDigital {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @ManyToOne(() => Empresa, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'empresa_id' })
  empresa: Empresa;

  @Column({ type: 'varchar', length: 2 })
  tipo: CertificadoTipo;

  @Column({ nullable: true, type: 'varchar' })
  titular: string | null;

  @Column({ nullable: true, type: 'date' })
  validade: string | null;

  // Nome original do arquivo — não é sensível, só pra exibição na UI.
  @Column({ name: 'nome_arquivo', type: 'varchar' })
  nomeArquivo: string;

  // JSON { arquivoBase64, senha } cifrado com AES-256-GCM (CredenciaisCriptService).
  @Column({ name: 'conteudo_criptografado', type: 'text' })
  conteudoCriptografado: string;

  @Column({ type: 'varchar', length: 32 })
  iv: string;

  @Column({ type: 'varchar', length: 32 })
  tag: string;

  @Column({ default: true })
  ativo: boolean;

  @CreateDateColumn({ name: 'criado_em' })
  criadoEm: Date;

  @UpdateDateColumn({ name: 'atualizado_em' })
  atualizadoEm: Date;
}
