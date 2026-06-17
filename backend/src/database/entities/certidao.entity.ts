import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum CertidaoTipo {
  CND_FEDERAL       = 'CND_FEDERAL',
  FGTS_CRF          = 'FGTS_CRF',
  CNDT_TRABALHISTA  = 'CNDT_TRABALHISTA',
  DIVIDA_ATIVA      = 'DIVIDA_ATIVA',
  ESTADUAL          = 'ESTADUAL',
  MUNICIPAL         = 'MUNICIPAL',
  INSCRICAO_ESTADUAL  = 'INSCRICAO_ESTADUAL',
  INSCRICAO_MUNICIPAL = 'INSCRICAO_MUNICIPAL',
}

export enum CertidaoStatus {
  NAO_CONSULTADA    = 'NAO_CONSULTADA',
  CONSULTA_MANUAL   = 'CONSULTA_MANUAL',
  REGULAR           = 'REGULAR',
  IRREGULAR         = 'IRREGULAR',
  INDISPONIVEL      = 'INDISPONIVEL',
  EXIGE_CERTIFICADO = 'EXIGE_CERTIFICADO',
}

export enum CertidaoOrigem {
  MANUAL     = 'MANUAL',
  AUTOMATICO = 'AUTOMATICO',
}

export const CERTIDAO_LABELS: Record<CertidaoTipo, string> = {
  [CertidaoTipo.CND_FEDERAL]:          'CND Federal (Receita + PGFN)',
  [CertidaoTipo.FGTS_CRF]:             'FGTS / CRF (Caixa)',
  [CertidaoTipo.CNDT_TRABALHISTA]:      'CNDT Trabalhista (TST)',
  [CertidaoTipo.DIVIDA_ATIVA]:          'Dívida Ativa da União',
  [CertidaoTipo.ESTADUAL]:              'Certidão Estadual',
  [CertidaoTipo.MUNICIPAL]:             'Certidão Municipal',
  [CertidaoTipo.INSCRICAO_ESTADUAL]:    'Inscrição Estadual (IE)',
  [CertidaoTipo.INSCRICAO_MUNICIPAL]:   'Inscrição Municipal (IM)',
};

export const CERTIDAO_AUTOMATIZAVEL: Record<CertidaoTipo, boolean> = {
  [CertidaoTipo.CND_FEDERAL]:          true,
  [CertidaoTipo.FGTS_CRF]:             true,
  [CertidaoTipo.CNDT_TRABALHISTA]:      true,
  [CertidaoTipo.DIVIDA_ATIVA]:          true,
  [CertidaoTipo.ESTADUAL]:              true,
  [CertidaoTipo.MUNICIPAL]:             false,
  [CertidaoTipo.INSCRICAO_ESTADUAL]:    false,
  [CertidaoTipo.INSCRICAO_MUNICIPAL]:   false,
};

@Entity('certidoes')
export class Certidao {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'empresa_id', type: 'varchar' })
  empresaId: string;

  @Index()
  @Column({ type: 'varchar', length: 20, nullable: true })
  cnpj: string | null;

  @Column({ type: 'varchar', length: 50 })
  tipo: CertidaoTipo;

  @Index()
  @Column({ type: 'varchar', length: 30, default: CertidaoStatus.NAO_CONSULTADA })
  status: CertidaoStatus;

  @Index()
  @Column({ type: 'varchar', length: 10, nullable: true })
  validade: string | null;

  @Column({ name: 'data_consulta', type: 'timestamptz', nullable: true })
  dataConsulta: Date | null;

  @Column({ type: 'varchar', length: 20, default: CertidaoOrigem.MANUAL })
  origem: CertidaoOrigem;

  @Column({ type: 'text', nullable: true })
  observacoes: string | null;

  @Column({ name: 'url_arquivo', nullable: true, type: 'varchar' })
  urlArquivo: string | null;

  @Column({ name: 'responsavel_id', nullable: true, type: 'varchar' })
  responsavelId: string | null;

  @CreateDateColumn({ name: 'criado_em' })
  criadoEm: Date;

  @UpdateDateColumn({ name: 'atualizado_em' })
  atualizadoEm: Date;
}
