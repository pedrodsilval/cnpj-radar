export class CriarCredencialDto {
  tipo: string;
  descricao: string;
  valor: string;
}

export class AtualizarCredencialDto {
  descricao?: string;
  valor?: string;
  ativo?: boolean;
}

export interface CredencialPublica {
  id: string;
  tipo: string;
  descricao: string;
  valorMascarado: string;
  ativo: boolean;
  ultimaVerificacao: Date | null;
  criadoEm: Date;
  atualizadoEm: Date;
}
