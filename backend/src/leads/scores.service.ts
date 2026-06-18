import { Injectable } from '@nestjs/common';
import { Empresa } from '../cnpj/entities/empresa.entity';

export interface Scores {
  scoreCadastral: number;
  scoreComercial: number;
  scoreAtencao: number;
  recomendacao: string;
}

// Escala 0–100 para os três scores. Pontos são aditivos com teto em 100 (Math.min).
// scoreCadastral: completude dos dados (situação ativa + endereço + contato + QSA + capital).
// scoreAtencao:   fatores de risco (inativa, empresa jovem, sem QSA, sem contato, capital baixo).
// scoreComercial: potencial de prospecção (ativa, não-MEI, porte, CNAE, optante Simples, socios).
//                 Retorna 0 quando eClienteAtivo=true (empresa já é cliente, não é lead).
// recomendacao:   texto derivado dos três scores, sem lógica adicional de negócio.
@Injectable()
export class ScoresService {
  calcular(empresa: Empresa, sociosCount: number, eClienteAtivo = false): Scores {
    const scoreCadastral = this.cadastral(empresa, sociosCount);
    const scoreComercial = this.comercial(empresa, eClienteAtivo);
    const scoreAtencao = this.atencao(empresa, sociosCount);
    const recomendacao = this.recomendacao(empresa, scoreAtencao, scoreComercial, eClienteAtivo);
    return { scoreCadastral, scoreComercial, scoreAtencao, recomendacao };
  }

  private cadastral(empresa: Empresa, sociosCount: number): number {
    let pts = 0;

    // CNPJ válido e empresa encontrada na base
    pts += 5;

    // Situação cadastral ativa
    if (empresa.situacaoCadastral === 'ATIVA') pts += 20;

    // Endereço completo (todos os campos principais)
    const camposEndereco = [empresa.logradouro, empresa.numero, empresa.bairro, empresa.municipio, empresa.uf, empresa.cep];
    if (camposEndereco.every(Boolean)) pts += 15;
    else if (empresa.municipio && empresa.uf) pts += 7;

    // Contato disponível
    if (empresa.telefone) pts += 10;
    if (empresa.email) pts += 10;

    // CNAE principal informado
    if (empresa.cnaePrincipalCodigo) pts += 10;

    // QSA presente
    if (sociosCount > 0) pts += 10;

    // Data de início de atividade
    if (empresa.dataInicioAtividade) pts += 5;

    // Capital social declarado
    if (empresa.capitalSocial && empresa.capitalSocial > 0) pts += 10;

    // Porte informado
    if (empresa.porte) pts += 5;

    return Math.min(pts, 100);
  }

  private atencao(empresa: Empresa, sociosCount: number): number {
    let pts = 0;

    // Situação cadastral diferente de ativa
    if (empresa.situacaoCadastral !== 'ATIVA') pts += 30;

    // Empresa muito recente (menos de 1 ano)
    if (empresa.dataInicioAtividade) {
      const abertura = new Date(empresa.dataInicioAtividade);
      const umAnoAtras = new Date();
      umAnoAtras.setFullYear(umAnoAtras.getFullYear() - 1);
      if (abertura > umAnoAtras) pts += 20;
    }

    // QSA ausente
    if (sociosCount === 0) pts += 15;

    // Nenhum contato disponível
    if (!empresa.email && !empresa.telefone) pts += 15;
    else if (!empresa.email || !empresa.telefone) pts += 5;

    // Certidões não verificadas (módulo chega na Fase 3 — sempre verdadeiro aqui)
    pts += 10;

    // Capital social ausente ou muito baixo
    if (!empresa.capitalSocial || empresa.capitalSocial < 1000) pts += 5;

    return Math.min(pts, 100);
  }

  private comercial(empresa: Empresa, eClienteAtivo: boolean): number {
    if (eClienteAtivo) return 0;

    let pts = 0;

    // Empresa ativa e não MEI: alvo real para contabilidade plena
    if (empresa.situacaoCadastral === 'ATIVA' && !empresa.optanteMei) pts += 20;

    // Porte favorável
    if (empresa.porte) {
      const porte = empresa.porte.toUpperCase();
      if (porte.includes('PEQUENA') || porte.includes('EPP')) pts += 20;
      else if (porte.includes('MICRO')) pts += 15;
      else if (porte.includes('MEDIO') || porte.includes('MÉDIA') || porte.includes('MEDIA')) pts += 10;
    }

    // CNAE em setor produtivo (exclui agropecuária 01-03 e financeiro 64-66)
    if (empresa.cnaePrincipalCodigo) {
      const setor = parseInt(empresa.cnaePrincipalCodigo.substring(0, 2), 10);
      if (!isNaN(setor) && !(setor >= 1 && setor <= 3) && !(setor >= 64 && setor <= 66)) {
        pts += 20;
      }
    }

    // Tempo de atividade
    if (empresa.dataInicioAtividade) {
      const abertura = new Date(empresa.dataInicioAtividade);
      const anos = (Date.now() - abertura.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
      if (anos >= 2) pts += 15;
      else if (anos >= 1) pts += 8;
    }

    // Localização no mercado-alvo (BA)
    if (empresa.uf === 'BA') pts += 15;
    else if (empresa.uf) pts += 5;

    // Capital social como proxy de ticket potencial
    if (empresa.capitalSocial) {
      if (empresa.capitalSocial >= 50000) pts += 10;
      else if (empresa.capitalSocial >= 10000) pts += 5;
    }

    // MEI tem potencial apenas como oportunidade de migração MEI→ME — cap em 30
    if (empresa.optanteMei) return Math.min(pts, 30);

    return Math.min(pts, 100);
  }

  private recomendacao(empresa: Empresa, scoreAtencao: number, scoreComercial: number, eClienteAtivo: boolean): string {
    if (eClienteAtivo) {
      return "Empresa já é cliente Everest/FK's — encaminhar para responsável interno.";
    }
    if (empresa.situacaoCadastral !== 'ATIVA') {
      return 'Empresa inativa — não priorizar. Manter registro histórico.';
    }
    if (empresa.optanteMei) {
      return 'Empresa MEI — abordagem educacional. Avaliar potencial de migração MEI → ME.';
    }
    if (scoreAtencao >= 40) {
      return 'Score de atenção elevado — recomendado diagnóstico de regularidade antes de qualquer proposta.';
    }
    if (scoreComercial >= 70) {
      return 'Alta aderência comercial — abordagem consultiva prioritária.';
    }
    if (scoreComercial >= 40) {
      return 'Aderência comercial moderada — abordagem consultiva recomendada.';
    }
    return 'Empresa ativa — avaliar aderência antes de abordar.';
  }
}
