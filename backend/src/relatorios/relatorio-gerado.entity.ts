import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// Histórico de relatórios de pré-análise já gerados — sem isso, cada download
// regenerava tudo do zero (renderiza HTML + busca e junta PDF de cada
// certidão) e não ficava nada salvo pra consultar depois.
@Entity('relatorios_gerados')
export class RelatorioGerado {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'empresa_id', type: 'varchar' })
  empresaId: string;

  @Column({ name: 'url_arquivo', type: 'varchar' })
  urlArquivo: string;

  @Column({ name: 'nome_arquivo', type: 'varchar' })
  nomeArquivo: string;

  @CreateDateColumn({ name: 'criado_em' })
  criadoEm: Date;
}
