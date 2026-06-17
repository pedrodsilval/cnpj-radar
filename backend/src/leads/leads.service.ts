import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { sanitizeCnpj } from '../common/utils/cnpj.util';
import { Empresa } from '../cnpj/entities/empresa.entity';
import { Socio } from '../cnpj/entities/socio.entity';
import { Lead, LeadStatus } from './entities/lead.entity';
import { HistoricoStatus } from './entities/historico-status.entity';
import { ScoresService } from './scores.service';
import { LeadsPdfService } from './leads-pdf.service';

export interface Fator {
  categoria: string;
  valor: string;
  impacto: 'positivo' | 'atencao' | 'negativo' | 'info';
  detalhe: string;
}

export interface PropostaResponse {
  tipo: 'proposta' | 'diagnostico';
  titulo: string;
  cnpj: string;
  razaoSocial: string;
  scores: { cadastral: number | null; comercial: number | null; atencao: number | null };
  recomendacao: string | null;
  resumo: string;
  fatoresConsiderados: Fator[];
  servicosSugeridos: string[];
  proximosPassos: string[];
  geradoEm: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function idadeAnos(dataInicio: string | null): number | null {
  if (!dataInicio) return null;
  return (Date.now() - new Date(dataInicio).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
}

function idadeLabel(anos: number | null): string {
  if (anos === null) return '';
  const a = Math.floor(anos);
  if (anos < 0.5)  return 'menos de 6 meses de atividade';
  if (anos < 1)    return 'menos de 1 ano de atividade';
  return `${a} ano${a !== 1 ? 's' : ''} de atividade`;
}

function porteLabel(porte: string | null): string {
  if (!porte) return 'empresa';
  const p = porte.toUpperCase();
  if (p.includes('GRANDE'))                                              return 'grande empresa';
  if (p.includes('MEDIO') || p.includes('MÉDIA') || p.includes('MEDIA')) return 'empresa de médio porte';
  if (p.includes('EPP') || p.includes('PEQUENA'))                        return 'empresa de pequeno porte (EPP)';
  if (p.includes('MICRO'))                                               return 'microempresa (ME)';
  return 'empresa';
}

function setorCnae(codigo: string | null): string {
  if (!codigo) return 'setor não informado';
  const sec = parseInt(codigo.substring(0, 2), 10);
  if (isNaN(sec))                return 'setor não informado';
  if (sec >= 1  && sec <= 3)    return 'agropecuária';
  if (sec >= 5  && sec <= 9)    return 'mineração';
  if (sec >= 10 && sec <= 33)   return 'indústria';
  if (sec === 35)                return 'energia';
  if (sec >= 36 && sec <= 39)   return 'saneamento/meio ambiente';
  if (sec >= 41 && sec <= 43)   return 'construção civil';
  if (sec >= 45 && sec <= 47)   return 'comércio';
  if (sec >= 49 && sec <= 53)   return 'transporte e logística';
  if (sec >= 55 && sec <= 56)   return 'hospedagem e alimentação';
  if (sec >= 58 && sec <= 63)   return 'comunicação e tecnologia';
  if (sec >= 64 && sec <= 66)   return 'serviços financeiros';
  if (sec === 68)                return 'mercado imobiliário';
  if (sec >= 69 && sec <= 75)   return 'serviços profissionais';
  if (sec >= 77 && sec <= 82)   return 'serviços administrativos';
  if (sec === 85)                return 'educação';
  if (sec >= 86 && sec <= 88)   return 'saúde';
  if (sec >= 90 && sec <= 93)   return 'cultura e entretenimento';
  if (sec >= 94 && sec <= 96)   return 'outros serviços';
  return 'setor de serviços';
}

function capitalFmt(capital: number | null): string {
  if (!capital || capital <= 0) return 'não declarado';
  return capital.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

function capitalLabel(capital: number | null): string {
  if (!capital || capital <= 0) return 'capital social não declarado';
  if (capital < 1_000)    return `capital social de ${capitalFmt(capital)} — simbólico`;
  if (capital < 10_000)   return `capital social de ${capitalFmt(capital)}`;
  if (capital < 50_000)   return `capital de ${capitalFmt(capital)}`;
  if (capital < 200_000)  return `capital de ${capitalFmt(capital)} — empresa estruturada`;
  if (capital < 1_000_000) return `capital de ${capitalFmt(capital)} — médio porte`;
  return `capital de ${capitalFmt(capital)} — ticket potencial elevado`;
}

function contatoStr(empresa: Empresa | null): string {
  if (!empresa) return '';
  if (empresa.email && empresa.telefone) return `${empresa.email} / ${empresa.telefone}`;
  if (empresa.email)    return empresa.email;
  if (empresa.telefone) return empresa.telefone;
  return '';
}

function anexoSimples(codigo: string | null): string {
  if (!codigo) return 'Simples Nacional (verificar Anexo)';
  const sec = parseInt(codigo.substring(0, 2), 10);
  if (isNaN(sec)) return 'Simples Nacional (verificar Anexo)';
  if (sec >= 45 && sec <= 47) return 'Simples Nacional — Anexo I (Comércio)';
  if (sec >= 10 && sec <= 33) return 'Simples Nacional — Anexo II (Indústria)';
  if (sec >= 41 && sec <= 43) return 'Simples Nacional — Anexo IV (INSS patronal fora)';
  if ((sec >= 58 && sec <= 63) || (sec >= 69 && sec <= 75))
    return 'Simples Nacional — Anexo V ou III (depende do Fator R — folha/receita)';
  return 'Simples Nacional — Anexo III (Serviços)';
}

// ─── Fatores considerados ─────────────────────────────────────────────────────

function buildFatores(lead: Lead, empresa: Empresa | null, sociosCount: number): Fator[] {
  const fatores: Fator[] = [];
  const situacao = empresa?.situacaoCadastral ?? 'DESCONHECIDA';
  const anos     = idadeAnos(empresa?.dataInicioAtividade ?? null);

  // 1. Situação cadastral
  const situacaoImpacto: Record<string, Fator['impacto']> = {
    ATIVA: 'positivo', BAIXADA: 'negativo', INAPTA: 'negativo', SUSPENSA: 'negativo', NULA: 'negativo',
  };
  const situacaoDetalhe: Record<string, string> = {
    ATIVA:    'Empresa regularmente ativa na Receita Federal.',
    BAIXADA:  'Empresa encerrada definitivamente. Não elegível para proposta comercial.',
    INAPTA:   'Inapta por omissão de declarações — pode ser reativada com serviço de regularização.',
    SUSPENSA: 'Inscrição suspensa — verificar motivo junto à Receita Federal antes de abordar.',
    NULA:     'Situação cadastral nula — possível erro de registro.',
  };
  fatores.push({
    categoria: 'Situação Cadastral',
    valor: situacao,
    impacto: situacaoImpacto[situacao] ?? 'negativo',
    detalhe: situacaoDetalhe[situacao] ?? `Situação "${situacao}" — verificar junto à Receita.`,
  });

  // 2. Regime tributário
  if (empresa?.optanteMei) {
    fatores.push({
      categoria: 'Regime Tributário',
      valor: 'MEI',
      impacto: 'atencao',
      detalhe: 'Microempreendedor Individual — limite de faturamento R$81k/ano. Candidato à migração ME/EPP.',
    });
  } else if (empresa?.optanteSimples) {
    fatores.push({
      categoria: 'Regime Tributário',
      valor: anexoSimples(empresa.cnaePrincipalCodigo ?? null),
      impacto: 'positivo',
      detalhe: 'Optante pelo Simples Nacional — tributação unificada. Avaliar Anexo correto e possíveis economias.',
    });
  } else if (empresa) {
    fatores.push({
      categoria: 'Regime Tributário',
      valor: 'Lucro Presumido / Real (provável)',
      impacto: 'info',
      detalhe: 'Fora do Simples Nacional — maior complexidade contábil e maior potencial de honorários.',
    });
  }

  // 3. Porte
  if (empresa?.porte) {
    const p = empresa.porte.toUpperCase();
    const isIdeal = p.includes('EPP') || p.includes('PEQUENA') || p.includes('MICRO');
    const isMedio = p.includes('MEDIO') || p.includes('MÉDIA') || p.includes('MEDIA');
    fatores.push({
      categoria: 'Porte',
      valor: porteLabel(empresa.porte).toUpperCase(),
      impacto: isIdeal ? 'positivo' : isMedio ? 'positivo' : 'info',
      detalhe: isIdeal
        ? 'Porte alinhado ao portfólio principal da Everest/FK\'s.'
        : isMedio
          ? 'Médio porte — demanda estrutura contábil completa, ticket potencialmente alto.'
          : 'Grande empresa — pode exigir equipe dedicada e escopo diferenciado.',
    });
  } else {
    fatores.push({
      categoria: 'Porte',
      valor: 'Não informado',
      impacto: 'atencao',
      detalhe: 'Porte não declarado na Receita Federal — estimar pelo capital social e setor.',
    });
  }

  // 4. CNAE
  if (empresa?.cnaePrincipalCodigo) {
    const setor = setorCnae(empresa.cnaePrincipalCodigo);
    const setoresProdutivos = ['comércio','indústria','construção civil','serviços profissionais','saúde','educação','comunicação e tecnologia','transporte e logística','hospedagem e alimentação'];
    fatores.push({
      categoria: 'Atividade Principal (CNAE)',
      valor: `${empresa.cnaePrincipalDescricao ?? setor} (${empresa.cnaePrincipalCodigo})`,
      impacto: setoresProdutivos.includes(setor) ? 'positivo' : 'info',
      detalhe: `Setor: ${setor}. ${setoresProdutivos.includes(setor) ? 'Setor com alta demanda por serviços contábeis especializados.' : 'Verificar demanda específica do setor.'}`,
    });
  } else {
    fatores.push({
      categoria: 'Atividade Principal (CNAE)',
      valor: 'Não informado',
      impacto: 'atencao',
      detalhe: 'CNAE principal ausente — atividade da empresa desconhecida, impede personalização da proposta.',
    });
  }

  // 5. Tempo de operação
  if (anos !== null) {
    let impacto: Fator['impacto'] = 'positivo';
    let detalhe = '';
    if (anos < 0.5) {
      impacto = 'atencao';
      detalhe = 'Empresa com menos de 6 meses — em fase de estruturação. Foco em abertura de obrigações e enquadramento.';
    } else if (anos < 1) {
      impacto = 'atencao';
      detalhe = 'Primeiro ano de operação — ciclo fiscal ainda incompleto. Oportunidade de estruturar desde o início.';
    } else if (anos < 3) {
      impacto = 'positivo';
      detalhe = 'Empresa em fase de crescimento — momento ideal para planejamento tributário e estruturação contábil.';
    } else if (anos < 10) {
      impacto = 'positivo';
      detalhe = 'Empresa consolidada — necessidades contábeis estáveis, relacionamento de médio-longo prazo.';
    } else {
      impacto = 'positivo';
      detalhe = 'Empresa madura — potencial para serviços de planejamento sucessório e patrimonial, além da contabilidade regular.';
    }
    fatores.push({
      categoria: 'Tempo de Operação',
      valor: idadeLabel(anos),
      impacto,
      detalhe,
    });
  } else {
    fatores.push({
      categoria: 'Tempo de Operação',
      valor: 'Não informado',
      impacto: 'info',
      detalhe: 'Data de abertura não registrada na Receita Federal.',
    });
  }

  // 6. Capital social
  const cap = empresa?.capitalSocial ?? null;
  if (cap && cap > 0) {
    let impacto: Fator['impacto'] = 'info';
    if (cap >= 50_000) impacto = 'positivo';
    else if (cap < 1_000) impacto = 'atencao';
    fatores.push({
      categoria: 'Capital Social',
      valor: capitalFmt(cap),
      impacto,
      detalhe: cap < 1_000
        ? 'Capital simbólico — possível empresa em fase inicial ou informal. Verificar consistência.'
        : cap < 10_000
          ? 'Capital baixo — comum em microempresas de serviços.'
          : cap >= 200_000
            ? 'Capital relevante — indica empresa estruturada, ticket de honorários potencialmente alto.'
            : 'Capital adequado ao porte declarado.',
    });
  } else {
    fatores.push({
      categoria: 'Capital Social',
      valor: 'Não declarado',
      impacto: 'atencao',
      detalhe: 'Capital social ausente na Receita — indicador de cadastro incompleto ou empresa muito nova.',
    });
  }

  // 7. Localização
  if (empresa?.municipio && empresa?.uf) {
    fatores.push({
      categoria: 'Localização',
      valor: `${empresa.municipio}/${empresa.uf}`,
      impacto: empresa.uf === 'BA' ? 'positivo' : 'info',
      detalhe: empresa.uf === 'BA'
        ? 'Sediada na Bahia — dentro do mercado-alvo principal da Everest/FK\'s.'
        : 'Fora do mercado-alvo principal (BA) — verificar viabilidade de atendimento remoto.',
    });
  }

  // 8. Tipo (Matriz/Filial)
  if (empresa?.tipo) {
    const isFilial = empresa.tipo.toUpperCase().includes('FILIAL');
    fatores.push({
      categoria: 'Tipo de Estabelecimento',
      valor: empresa.tipo,
      impacto: isFilial ? 'atencao' : 'positivo',
      detalhe: isFilial
        ? 'Filial — decisões contábeis e financeiras podem depender da sede. Identificar onde fica a matriz.'
        : 'Sede principal (Matriz) — decisões centralizadas aqui, facilitando a negociação.',
    });
  }

  // 9. QSA — Quadro de Sócios
  fatores.push({
    categoria: 'QSA (Sócios)',
    valor: sociosCount === 0 ? 'Ausente' : `${sociosCount} sócio${sociosCount !== 1 ? 's' : ''}`,
    impacto: sociosCount === 0 ? 'negativo' : 'positivo',
    detalhe: sociosCount === 0
      ? 'Quadro societário ausente na Receita — responsável pela empresa não identificado. Dificulta abordagem.'
      : sociosCount === 1
        ? '1 sócio registrado — empresa individual. Decisão de compra concentrada em uma pessoa.'
        : `${sociosCount} sócios — identificar o responsável financeiro/administrativo para a abordagem.`,
  });

  // 10. Contatos
  const temEmail = !!empresa?.email;
  const temFone  = !!empresa?.telefone;
  fatores.push({
    categoria: 'Contatos na Receita',
    valor: temEmail && temFone ? 'E-mail + Telefone' : temEmail ? 'Só e-mail' : temFone ? 'Só telefone' : 'Nenhum',
    impacto: (temEmail || temFone) ? 'positivo' : 'negativo',
    detalhe: temEmail && temFone
      ? `Contatos disponíveis: ${empresa!.email} / ${empresa!.telefone}. Abordagem facilitada.`
      : temEmail
        ? `E-mail registrado: ${empresa!.email}. Fone não disponível na Receita.`
        : temFone
          ? `Telefone registrado: ${empresa!.telefone}. E-mail não disponível.`
          : 'Nenhum contato na Receita Federal — buscar via redes sociais, site ou consulta presencial.',
  });

  // 11. Scores
  const scoreAtencao  = lead.scoreAtencao  ?? 0;
  const scoreComercial = lead.scoreComercial ?? 0;
  const scoreCadastral = lead.scoreCadastral ?? 0;

  fatores.push({
    categoria: 'Score Comercial',
    valor: `${scoreComercial}/100`,
    impacto: scoreComercial >= 70 ? 'positivo' : scoreComercial >= 40 ? 'atencao' : 'negativo',
    detalhe: scoreComercial >= 70
      ? 'Alta aderência ao portfólio Everest/FK\'s — prioridade máxima de abordagem.'
      : scoreComercial >= 40
        ? 'Aderência moderada — validar necessidade antes de elaborar proposta formal.'
        : 'Aderência baixa ao perfil comercial atual — abordagem exploratória apenas.',
  });

  fatores.push({
    categoria: 'Score de Atenção',
    valor: `${scoreAtencao}/100`,
    impacto: scoreAtencao >= 60 ? 'negativo' : scoreAtencao >= 40 ? 'atencao' : 'positivo',
    detalhe: scoreAtencao >= 60
      ? 'Nível crítico — múltiplos pontos de risco detectados. Diagnóstico obrigatório antes de qualquer proposta.'
      : scoreAtencao >= 40
        ? 'Pontos de atenção identificados — verificar regularidade fiscal antes da proposta.'
        : 'Perfil regular — sem sinais de alerta significativos nos dados cadastrais.',
  });

  fatores.push({
    categoria: 'Score Cadastral',
    valor: `${scoreCadastral}/100`,
    impacto: scoreCadastral >= 70 ? 'positivo' : scoreCadastral >= 50 ? 'info' : 'atencao',
    detalhe: scoreCadastral >= 70
      ? 'Cadastro bem preenchido na Receita Federal — dados confiáveis para a análise.'
      : scoreCadastral >= 50
        ? 'Cadastro parcialmente preenchido — alguns dados relevantes ausentes.'
        : 'Cadastro incompleto — análise com menor confiabilidade; priorizar verificação presencial.',
  });

  return fatores;
}

// ─── Serviços sugeridos ───────────────────────────────────────────────────────

function buildServicos(empresa: Empresa | null): string[] {
  if (!empresa) return ['Escrituração contábil mensal', 'Declarações acessórias', 'Consultoria tributária'];

  const servicos: string[] = [];
  const mei     = empresa.optanteMei === true;
  const simples  = empresa.optanteSimples === true;
  const codigo   = empresa.cnaePrincipalCodigo ?? '';
  const sec      = parseInt(codigo.substring(0, 2), 10) || 0;

  // Base obrigatória para qualquer empresa ativa
  if (!mei) {
    servicos.push('Escrituração contábil mensal (Livro Diário, Razão, Balancetes)');
    servicos.push('Folha de pagamento e encargos sociais (eSocial)');
    servicos.push('Declarações acessórias: DCTF, EFD-Contribuições, ECF anual');
  }

  // Regime tributário
  if (mei) {
    servicos.push('Migração MEI → ME/EPP: abertura de novo CNPJ e enquadramento');
    servicos.push('Comparativo tributário MEI × Simples Nacional');
    servicos.push('Regularização de CNPJ MEI e declaração anual DASN-SIMEI');
  } else if (simples) {
    servicos.push(`${anexoSimples(codigo)} — escrituração e cálculo do DAS`);
    servicos.push('DEFIS (Declaração de Informações Socioeconômicas e Fiscais) anual');
    servicos.push('Avaliação do Fator R e otimização de Anexo (III vs V para serviços)');
  } else {
    servicos.push('Apuração IRPJ/CSLL — Lucro Presumido ou Real');
    servicos.push('PIS/COFINS — cumulativo ou não-cumulativo (SPED EFD-Contribuições)');
    servicos.push('Avaliação de enquadramento no Simples Nacional (se elegível)');
  }

  // Serviços por setor
  if (sec >= 45 && sec <= 47) {
    // Comércio
    servicos.push('SPED EFD Fiscal — escrituração de entradas e saídas');
    servicos.push('Controle de estoque fiscal e CIAP');
    servicos.push('Nota Fiscal Eletrônica (NF-e) — configuração e emissão');
    if (!simples && !mei) servicos.push('Substituição tributária (ST) — análise por produto e estado');
  } else if (sec >= 10 && sec <= 33) {
    // Indústria
    servicos.push('SPED EFD Fiscal com créditos de IPI');
    servicos.push('Controle de produção e apuração de IPI');
    servicos.push('Laudo de benefícios fiscais — ZFM, PADIS, PATVD (se aplicável)');
  } else if (sec >= 41 && sec <= 43) {
    // Construção civil
    servicos.push('Matrícula CEI/INSS de obra junto à Receita Federal');
    servicos.push('ISS retido na fonte — controle por município do tomador');
    servicos.push('Retenção previdenciária 11% — controle e compensação');
    servicos.push('RRT/ART — verificar obrigações junto ao CREA/CAU');
    if (!simples && !mei) servicos.push('Regime especial de tributação (RET) para incorporadoras');
  } else if (sec >= 55 && sec <= 56) {
    // Hospedagem / Alimentação
    servicos.push('NFS-e (Nota Fiscal de Serviço Eletrônica) — emissão e controle');
    servicos.push('Folha de pagamento com variação de jornada (extras, DSR)');
    servicos.push('ANVISA e vigilância sanitária — auxílio em licenças');
  } else if (sec >= 58 && sec <= 63) {
    // Comunicação / TI
    servicos.push('NFS-e e exportação de serviços — isenção de ISS e PIS/COFINS');
    servicos.push('Planejamento IRPJ — Lucro Presumido × Real para empresas de TI');
    servicos.push('Retenções CSRF (PIS/COFINS/CSLL) sobre serviços prestados a PJ');
    servicos.push('Lei do Bem / Lei de Informática — incentivos fiscais à P&D');
  } else if (sec >= 69 && sec <= 75) {
    // Serviços profissionais (advocacia, engenharia, contabilidade, consultoria)
    servicos.push('Avaliação PF × PJ — planejamento da remuneração dos sócios');
    servicos.push('Pro-labore e distribuição de lucros — cálculo de IRRF');
    servicos.push('Fator R — verificar se Simples Anexo III é mais vantajoso que V');
    servicos.push('NFS-e e ISS municipal — alíquotas por serviço e município');
  } else if (sec === 85) {
    // Educação
    servicos.push('Certificado de entidade beneficente (CEBAS) — se aplicável');
    servicos.push('Isenção de IRPJ e CSLL — verificar enquadramento');
    servicos.push('INSS patronal reduzido para entidades educacionais sem fins lucrativos');
    servicos.push('MEC — auxílio em obrigações acessórias e relatórios');
  } else if (sec >= 86 && sec <= 88) {
    // Saúde
    servicos.push('Avaliação PF × PJ para profissionais de saúde (médicos, dentistas)');
    servicos.push('IRRF sobre pro-labore e distribuição de lucros');
    servicos.push('CFM/CRO/CRM — auxílio em obrigações fiscais dos conselhos');
    servicos.push('Nota Fiscal de Serviço de Saúde (NFS-e) — configuração');
  } else if (sec >= 49 && sec <= 53) {
    // Transporte
    servicos.push('CIOT — Código Identificador da Operação de Transporte');
    servicos.push('ANTT — auxílio em obrigações regulatórias');
    servicos.push('Folha de pagamento com adiciais de motorista e periculosidade');
  } else {
    // Serviços gerais
    servicos.push('NFS-e — configuração e controle de emissão');
    servicos.push('ISS municipal — alíquota e base de cálculo por tipo de serviço');
  }

  // Serviços adicionais transversais (não-MEI)
  if (!mei) {
    servicos.push('Certidões de regularidade fiscal (FGTS, CND Federal, Estadual) — gestão e renovação');
    servicos.push('Planejamento tributário anual — análise de regime e oportunidades de economia');
  }

  // Remover duplicatas mantendo a ordem
  return [...new Set(servicos)];
}

// ─── Lógica principal ─────────────────────────────────────────────────────────

function buildProposta(lead: Lead, empresa: Empresa | null, sociosCount: number): PropostaResponse {
  const situacao  = empresa?.situacaoCadastral ?? 'DESCONHECIDA';
  const ativa     = situacao === 'ATIVA';
  const mei       = empresa?.optanteMei === true;
  const simples   = empresa?.optanteSimples === true;
  const atencao   = lead.scoreAtencao  ?? 0;
  const comercial = lead.scoreComercial ?? 0;
  const anos      = idadeAnos(empresa?.dataInicioAtividade ?? null);
  const setor     = setorCnae(empresa?.cnaePrincipalCodigo ?? null);
  const pLabel    = porteLabel(empresa?.porte ?? null);
  const nome      = empresa?.razaoSocial ?? lead.cnpj;
  const regiao    = empresa?.municipio
    ? `${empresa.municipio}${empresa.uf ? `/${empresa.uf}` : ''}`
    : null;
  const cnaDesc   = empresa?.cnaePrincipalDescricao ?? null;
  const contato   = contatoStr(empresa);
  const contatoPassso = contato
    ? `Contato disponível: ${contato}`
    : 'Sem contato na Receita — buscar via LinkedIn, site ou consulta presencial';

  const fatoresConsiderados = buildFatores(lead, empresa, sociosCount);
  const servicosSugeridos   = buildServicos(empresa);

  let tipo: 'proposta' | 'diagnostico';
  let titulo: string;
  let resumo: string;
  let proximosPassos: string[];

  // ── 1. Empresa inativa ──────────────────────────────────────────────────────
  if (!ativa && empresa) {
    tipo = 'diagnostico';
    const motivoMap: Record<string, string> = {
      BAIXADA: 'encerrada (baixada)', INAPTA: 'inapta (omissão de declarações)',
      SUSPENSA: 'com inscrição suspensa', NULA: 'nula (erro cadastral)',
    };
    const motivoLabel = motivoMap[situacao] ?? `com situação "${situacao}"`;

    titulo = `Diagnóstico — ${nome} (${situacao})`;
    resumo = `${nome} é uma ${pLabel} no setor de ${setor}` +
      (cnaDesc ? ` (${cnaDesc})` : '') +
      (regiao ? `, sediada em ${regiao},` : '') +
      ` com situação cadastral ${motivoLabel}.` +
      (anos !== null ? ` Possui ${idadeLabel(anos)}.` : '') +
      ' Não indicada para abordagem comercial imediata.';

    if (situacao === 'INAPTA') {
      proximosPassos = [
        contatoPassso,
        'Verificar no e-CAC as pendências que motivaram a inaptidão (omissão de DIRPJ, DEFIS ou DASN)',
        "Avaliar interesse do responsável em regularizar — oferecer serviço de reativação Everest/FK's",
        'Levantar estimativa de débitos e multas antes de apresentar proposta',
        'Se houver viabilidade, elaborar orçamento de regularização + honorários contínuos pós-regularização',
      ];
    } else if (situacao === 'SUSPENSA') {
      proximosPassos = [
        contatoPassso,
        'Verificar motivo da suspensão junto à Receita Federal (e-CAC ou solicitação formal)',
        'Avaliar se a suspensão é reversível com o responsável legal',
        "Oferecer consultoria de regularização cadastral — proposta de reativação Everest/FK's",
      ];
    } else {
      proximosPassos = [
        'Registrar como inativa na base de leads — não priorizar para abordagem comercial',
        'Monitorar abertura de nova empresa com os mesmos sócios',
        "Manter registro histórico para futuro relacionamento com a Everest/FK's",
      ];
    }

  // ── 2. MEI ──────────────────────────────────────────────────────────────────
  } else if (ativa && mei) {
    const cap = empresa?.capitalSocial ?? null;
    const proximoLimite = cap && cap > 60_000;
    tipo   = 'diagnostico';
    titulo = `Diagnóstico MEI → ME — ${nome}`;
    resumo = `${nome} é um MEI no setor de ${setor}` +
      (cnaDesc ? ` (${cnaDesc})` : '') +
      (regiao ? `, em ${regiao},` : '') +
      (anos !== null ? ` com ${idadeLabel(anos)}.` : '.') +
      (cap && cap > 0 ? ` Capital: ${capitalFmt(cap)}.` : '') +
      ' Limite MEI: R$81.000/ano. Abordagem educacional recomendada,' +
      ' com foco nos benefícios da migração para ME/EPP (acesso ao Simples Nacional completo,' +
      ' nota fiscal irrestrita, mais de 1 funcionário CLT e linha de crédito empresarial).';
    proximosPassos = [
      contatoPassso,
      'Apresentar os limites e riscos do MEI: ultrapassar R$81k gera tributação retroativa do excedente',
      proximoLimite
        ? '⚠ Capital próximo ou acima do limite MEI — migração urgente para ME'
        : 'Monitorar faturamento: se próximo de R$81k/ano, acelerar abordagem',
      'Preparar comparativo MEI × ME: DAS vs. Simples Nacional, INSS, nota fiscal, funcionários CLT',
      "Oferecer reunião gratuita de orientação tributária como gancho de conversão Everest/FK's",
      'Se decidir migrar: abertura de ME/EPP + enquadramento no Simples + baixa do MEI anterior',
    ];

  // ── 3. Atenção crítica (≥ 60) ───────────────────────────────────────────────
  } else if (ativa && atencao >= 60) {
    tipo   = 'diagnostico';
    titulo = `Diagnóstico Urgente — ${nome}`;
    resumo = `${nome} é uma ${pLabel} no setor de ${setor}` +
      (cnaDesc ? ` (${cnaDesc})` : '') +
      (regiao ? `, em ${regiao},` : '') +
      ` com score de atenção ${atencao}/100 — nível crítico.` +
      (simples ? ` ${anexoSimples(empresa?.cnaePrincipalCodigo ?? null)}.` : '') +
      (anos !== null ? ` ${idadeLabel(anos).charAt(0).toUpperCase() + idadeLabel(anos).slice(1)}.` : '') +
      ' Múltiplas pendências detectadas nos dados cadastrais.' +
      ' Diagnóstico completo de regularidade é obrigatório antes de qualquer proposta formal.';
    proximosPassos = [
      contatoPassso,
      'Solicitar acesso ao e-CAC para levantamento completo de pendências federais',
      'Verificar certidões: CND Federal/PGFN, FGTS/CRF, Trabalhista (CNDT), Estadual BA, Municipal',
      'Levantar passivo tributário: débitos com Receita Federal, PGFN, SEFAZ-BA',
      sociosCount === 0 ? 'QSA ausente — identificar responsável antes de qualquer contato' : 'Confirmar responsável pela área financeira junto ao QSA registrado',
      "Apresentar diagnóstico detalhado e orçamento de regularização — proposta Everest/FK's somente após regularização",
    ];

  // ── 4. Atenção elevada (40–59) ───────────────────────────────────────────────
  } else if (ativa && atencao >= 40) {
    tipo   = 'diagnostico';
    titulo = `Diagnóstico Inicial — ${nome}`;
    resumo = `${nome} é uma ${pLabel} no setor de ${setor}` +
      (cnaDesc ? ` (${cnaDesc})` : '') +
      (regiao ? `, em ${regiao},` : '') +
      ` com score de atenção ${atencao}/100 — pontos de verificação identificados.` +
      (simples ? ` ${anexoSimples(empresa?.cnaePrincipalCodigo ?? null)}.` : '') +
      (anos !== null ? ` ${idadeLabel(anos).charAt(0).toUpperCase() + idadeLabel(anos).slice(1)}.` : '') +
      ' Recomendado diagnóstico de regularidade antes de apresentar proposta formal.';
    proximosPassos = [
      contatoPassso,
      'Oferecer diagnóstico tributário e fiscal — pode ser a custo simbólico ou gratuito como prospecção',
      'Verificar regularidade das principais certidões (FGTS, CND Federal, Estadual)',
      simples
        ? `Confirmar Anexo correto do Simples Nacional (${anexoSimples(empresa?.cnaePrincipalCodigo ?? null)}) e calcular economia potencial`
        : 'Avaliar possibilidade de enquadramento no Simples Nacional',
      `Após diagnóstico: elaborar proposta de honorários mensais para ${pLabel} no setor de ${setor}`,
    ];

  // ── 5. Alta aderência comercial (≥ 70) ──────────────────────────────────────
  } else if (ativa && comercial >= 70) {
    tipo   = 'proposta';
    titulo = `Proposta Comercial — ${nome}`;
    const regimeStr = simples ? anexoSimples(empresa?.cnaePrincipalCodigo ?? null) : 'Lucro Presumido/Real';
    resumo = `${nome} é uma ${pLabel} no setor de ${setor}` +
      (cnaDesc ? ` (${cnaDesc})` : '') +
      (regiao ? `, em ${regiao},` : '') +
      ` com score comercial ${comercial}/100 — alta aderência ao portfólio Everest/FK's.` +
      ` Regime: ${regimeStr}.` +
      (anos !== null ? ` ${idadeLabel(anos).charAt(0).toUpperCase() + idadeLabel(anos).slice(1)}.` : '') +
      (empresa?.capitalSocial ? ` ${capitalLabel(empresa.capitalSocial).charAt(0).toUpperCase() + capitalLabel(empresa.capitalSocial).slice(1)}.` : '') +
      ' Perfil ideal: abordagem consultiva prioritária com escopo completo.';
    proximosPassos = [
      `Contato prioritário — ${contatoPassso}`,
      `Apresentar portfólio Everest/FK's com ênfase nos serviços para ${setor}`,
      simples
        ? `Mostrar economia no ${anexoSimples(empresa?.cnaePrincipalCodigo ?? null)} vs. regime atual`
        : 'Simular comparativo de regimes tributários (Simples × Lucro Presumido × Lucro Real)',
      'Elaborar proposta formal com escopo detalhado, prazo e honorários mensais',
      'Apresentar cronograma de onboarding e responsável interno Everest/FK\'s',
    ];

  // ── 6. Aderência moderada (40–69) ───────────────────────────────────────────
  } else if (ativa && comercial >= 40) {
    tipo   = 'proposta';
    titulo = `Proposta Comercial — ${nome}`;
    const regimeStr = simples ? anexoSimples(empresa?.cnaePrincipalCodigo ?? null) : 'Lucro Presumido/Real (provável)';
    resumo = `${nome} é uma ${pLabel} no setor de ${setor}` +
      (cnaDesc ? ` (${cnaDesc})` : '') +
      (regiao ? `, em ${regiao},` : '') +
      ` com score comercial ${comercial}/100 — aderência moderada.` +
      ` Regime: ${regimeStr}.` +
      (anos !== null ? ` ${idadeLabel(anos).charAt(0).toUpperCase() + idadeLabel(anos).slice(1)}.` : '') +
      ' Recomendada abordagem consultiva para validar necessidades antes de proposta formal.';
    proximosPassos = [
      `Contato exploratório — ${contatoPassso}`,
      `Entender necessidades específicas no setor de ${setor} e verificar se há contabilidade atual`,
      'Identificar principal dor: preço do atual escritório, atraso nas obrigações ou falta de planejamento?',
      "Apresentar diferenciais Everest/FK's para o segmento",
      'Se houver interesse claro: elaborar proposta customizada com escopo e honorários',
    ];

  // ── 7. Baixa aderência ──────────────────────────────────────────────────────
  } else {
    tipo   = 'proposta';
    titulo = `Análise Comercial — ${nome}`;
    resumo = `${nome} é uma ${pLabel} no setor de ${setor}` +
      (cnaDesc ? ` (${cnaDesc})` : '') +
      (regiao ? `, em ${regiao},` : '') +
      ` com score comercial ${comercial}/100 — aderência baixa ao perfil atual.` +
      (anos !== null ? ` ${idadeLabel(anos).charAt(0).toUpperCase() + idadeLabel(anos).slice(1)}.` : '') +
      ' Recomendado contato exploratório antes de investir em abordagem formal.';
    proximosPassos = [
      contatoPassso,
      'Pesquisar a empresa em redes sociais e site para entender melhor o perfil',
      'Contato exploratório para mapear necessidade real — não apresentar proposta neste momento',
      'Avaliar se o perfil justifica abordagem formal ou arquivar para reavaliação em 90 dias',
    ];
  }

  return {
    tipo,
    titulo,
    cnpj: lead.cnpj,
    razaoSocial: empresa?.razaoSocial ?? lead.cnpj,
    scores: { cadastral: lead.scoreCadastral, comercial: lead.scoreComercial, atencao: lead.scoreAtencao },
    recomendacao: lead.recomendacao,
    resumo,
    fatoresConsiderados,
    servicosSugeridos,
    proximosPassos,
    geradoEm: new Date().toISOString(),
  };
}

@Injectable()
export class LeadsService {
  constructor(
    @InjectRepository(Lead)
    private readonly leadRepo: Repository<Lead>,
    @InjectRepository(Empresa)
    private readonly empresaRepo: Repository<Empresa>,
    @InjectRepository(Socio)
    private readonly socioRepo: Repository<Socio>,
    @InjectRepository(HistoricoStatus)
    private readonly historicoRepo: Repository<HistoricoStatus>,
    private readonly scoresService: ScoresService,
    private readonly leadsPdfService: LeadsPdfService,
  ) {}

  async salvarLead(cnpj: string): Promise<Lead> {
    const sanitized = sanitizeCnpj(cnpj);

    const empresa = await this.empresaRepo.findOne({ where: { cnpj: sanitized } });
    if (!empresa) {
      throw new NotFoundException(
        'CNPJ não encontrado na base local. Consulte primeiro em GET /cnpj/:cnpj.',
      );
    }

    const socios = await this.socioRepo.find({ where: { empresaId: empresa.id } });
    const { scoreCadastral, scoreComercial, scoreAtencao, recomendacao } = this.scoresService.calcular(
      empresa,
      socios.length,
    );

    let lead = await this.leadRepo.findOne({ where: { cnpj: sanitized } });
    if (!lead) {
      lead = this.leadRepo.create({ cnpj: sanitized });
    }

    lead.empresaId = empresa.id;
    lead.scoreCadastral = scoreCadastral;
    lead.scoreComercial = scoreComercial;
    lead.scoreAtencao = scoreAtencao;
    lead.recomendacao = recomendacao;

    return this.leadRepo.save(lead);
  }

  async listarLeads(): Promise<Lead[]> {
    return this.leadRepo.find({ order: { salvoEm: 'DESC' } });
  }

  async buscarLead(id: string): Promise<Lead> {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) {
      throw new NotFoundException('ID inválido. Para buscar por CNPJ use GET /leads/cnpj/:cnpj.');
    }
    const lead = await this.leadRepo.findOne({ where: { id } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');
    return lead;
  }

  async buscarLeadPorCnpj(cnpj: string): Promise<Lead> {
    const sanitized = sanitizeCnpj(cnpj);
    const lead = await this.leadRepo.findOne({ where: { cnpj: sanitized } });
    if (!lead) throw new NotFoundException('Nenhum lead salvo para este CNPJ.');
    return lead;
  }

  async gerarProposta(id: string): Promise<PropostaResponse> {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) throw new NotFoundException('ID inválido.');

    const lead = await this.leadRepo
      .createQueryBuilder('lead')
      .leftJoinAndSelect('lead.empresa', 'empresa')
      .leftJoinAndSelect('empresa.socios', 'socios')
      .where('lead.id = :id', { id })
      .getOne();

    if (!lead) throw new NotFoundException('Lead não encontrado.');

    return buildProposta(lead, lead.empresa, lead.empresa?.socios?.length ?? 0);
  }

  async gerarPropostaPdf(id: string): Promise<Buffer> {
    const proposta = await this.gerarProposta(id);
    return this.leadsPdfService.gerarPdf(proposta);
  }

  async atualizarStatus(id: string, novoStatus: string): Promise<Lead> {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(id)) throw new NotFoundException('ID inválido.');

    const validos = Object.values(LeadStatus);
    if (!validos.includes(novoStatus as LeadStatus)) {
      throw new BadRequestException(`Status inválido. Valores aceitos: ${validos.join(', ')}`);
    }

    const lead = await this.leadRepo.findOne({ where: { id } });
    if (!lead) throw new NotFoundException('Lead não encontrado.');

    const statusAnterior = lead.status;
    lead.status = novoStatus as LeadStatus;

    // Recalcula scores quando eClienteAtivo muda (conversão ou reversão)
    if (lead.empresaId) {
      const eClienteAtivo = novoStatus === LeadStatus.CONVERTIDO;
      const eraClienteAtivo = statusAnterior === LeadStatus.CONVERTIDO;
      if (eClienteAtivo !== eraClienteAtivo) {
        const [empresa, socios] = await Promise.all([
          this.empresaRepo.findOne({ where: { id: lead.empresaId } }),
          this.socioRepo.find({ where: { empresaId: lead.empresaId } }),
        ]);
        if (empresa) {
          const { scoreCadastral, scoreComercial, scoreAtencao, recomendacao } =
            this.scoresService.calcular(empresa, socios.length, eClienteAtivo);
          lead.scoreCadastral = scoreCadastral;
          lead.scoreComercial = scoreComercial;
          lead.scoreAtencao = scoreAtencao;
          lead.recomendacao = recomendacao;
        }
      }
    }

    const salvo = await this.leadRepo.save(lead);

    await this.historicoRepo.save(
      this.historicoRepo.create({
        leadId: id,
        campoAlterado: 'status',
        valorAnterior: statusAnterior,
        valorNovo: novoStatus,
        alteradoPor: null,
      }),
    );

    return salvo;
  }
}
