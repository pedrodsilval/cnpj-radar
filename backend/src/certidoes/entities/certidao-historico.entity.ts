import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { CertidaoStatus, CertidaoTipo } from '../../database/entities/certidao.entity';

// Uma linha por mudança real de resultado (status/validade/arquivo) — não por
// consulta. Rodar a mesma consulta automática várias vezes sem o resultado
// mudar (ex. testando) não deve acumular linhas idênticas aqui.
@Entity('certidoes_historico')
@Index(['empresaId', 'tipo'])
export class CertidaoHistorico {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'empresa_id', type: 'varchar' })
  empresaId: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  cnpj: string | null;

  @Column({ type: 'varchar', length: 50 })
  tipo: CertidaoTipo;

  @Column({ type: 'varchar', length: 30 })
  status: CertidaoStatus;

  @Column({ type: 'varchar', length: 10, nullable: true })
  validade: string | null;

  @Column({ name: 'url_arquivo', nullable: true, type: 'varchar' })
  urlArquivo: string | null;

  @Column({ type: 'text', nullable: true })
  observacoes: string | null;

  @CreateDateColumn({ name: 'criado_em' })
  criadoEm: Date;
}
