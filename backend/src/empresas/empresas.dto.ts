export interface CriarEmpresaDto {
  cnpj: string;
  razaoSocial: string;
  inscricaoMobiliaria?: string;
  cga?: string;
  inscricaoEstadual?: string;
}

export interface AtualizarEmpresaDto {
  razaoSocial?: string;
  inscricaoMobiliaria?: string;
  cga?: string;
  inscricaoEstadual?: string;
}

export interface UploadCertificadoDto {
  tipo: 'A1' | 'A3';
  senha: string;
  titular?: string;
  validade?: string;
}

export interface CertificadoPublico {
  id: string;
  tipo: string;
  titular: string | null;
  validade: string | null;
  nomeArquivo: string;
  criadoEm: Date;
}
