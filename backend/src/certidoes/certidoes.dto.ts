import { CertidaoTipo, CertidaoStatus, CertidaoOrigem } from '../database/entities/certidao.entity';

export class RegistrarDto {
  tipo: CertidaoTipo;
  status?: CertidaoStatus;
  validade?: string;
  observacoes?: string;
  responsavelId?: string;
  urlArquivo?: string;
}

export class AtualizarStatusDto {
  status: CertidaoStatus;
  validade?: string;
  observacoes?: string;
  dataConsulta?: Date;
  origem?: CertidaoOrigem;
  urlArquivo?: string;
}
