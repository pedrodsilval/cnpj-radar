# 00 — Visão Geral Executiva

## Conceito do produto
**Radar Empresarial Everest/FK's** — plataforma interna de inteligência comercial e cadastral.

A tela de consulta de CNPJ é apenas a porta de entrada. O produto completo tem dez módulos:

| Módulo | Descrição |
| --- | --- |
| Consulta CNPJ | Busca, validação e normalização de dados cadastrais |
| Relatório Inteligente | Consolidação com scores, regularidade e recomendação |
| Score Comercial | Cadastral + comercial + atenção/risco |
| Certidões e Pendências | Gestor de regularidade fiscal/documental |
| Base de Leads | Pipeline comercial interno |
| Base de Clientes | Cruzamento com carteira ativa e ex-clientes |
| Painel de CNAEs | Segmentos prioritários, penetração, abertas por período |
| Campanhas por Segmento | Oportunidades identificadas por CNAE e região |
| Histórico de Consultas | Auditoria, reconsulta, comparação de alterações |
| Relatórios para Gestão | Dashboard executivo de conversão e mercado |

## Sequência estratégica
A decisão arquitetural mais importante é manter o **backend como dono da regra** — dados, fontes externas, cache, logs e permissões. O n8n é a camada de orquestração, sempre consumindo a API da Everest/FK's. Isso evita duplicidade de lógica, reduz risco operacional e impede que automações "furem" as regras do sistema.

A sequência mais segura:
1. Confiabilidade técnica (Fase 1)
2. Inteligência comercial (Fase 2)
3. Regularidade assistida (Fase 3)
4. Painel de mercado por CNAE (Fase 4)
5. Orquestração operacional completa (Fase 5)

## Maturidade atual vs. destino

| Nível | Estágio | Situação |
| --- | --- | --- |
| 1 | Consulta visual de CNPJ | Existe parcialmente |
| 2 | Relatório cadastral organizado | Existe parcialmente |
| 3 | Diagnóstico preliminar automatizado | Não existe |
| 4 | Inteligência comercial integrada | Não existe |
| 5 | Plataforma de decisão e acompanhamento | Visão futura |

## Experiência por perfil de usuário
A mesma base de dados gera interfaces diferentes:

**Perfil Comercial** — foco em oportunidade e ação: score comercial, oferta sugerida, botão WhatsApp, salvar lead, gerar proposta, histórico de contato.

**Perfil Contábil/Fiscal** — foco em CNAE, certidões e checklist: regime, porte, Simples/MEI, certidões, documentação, pendências, risco de enquadramento.

**Perfil Gestão** — a tela vira dashboard: quantas empresas analisadas, quais segmentos têm mais oportunidade, quais consultores estão usando, quantos leads viraram clientes, quais CNAEs trazem mais receita, onde há oportunidade geográfica.

## O PDF como peça comercial
O relatório PDF não é impressão de tela — é peça de autoridade da Everest/FK's:

- Capa com marca Everest/FK's
- Resumo executivo
- Dados cadastrais
- Atividades econômicas
- Quadro societário
- Status de regularidade
- Pontos de atenção
- Oportunidades identificadas
- Recomendação técnica
- Próximos passos
- Disclaimer
- Data, fonte e responsável

Fechamento consultivo sugerido:
> "Identificamos alguns pontos que exigem validação complementar. A recomendação é realizar um diagnóstico fiscal e contábil para verificar oportunidades de economia, regularização e melhoria de gestão."

## Nota sobre certidões
Na prática brasileira, quase nenhuma certidão (CND federal, PGFN, estadual, municipal, FGTS, trabalhista) tem API pública limpa — a maioria exige captcha, certificado digital ou navegação manual. O módulo nasce como **gestor de regularidade**: marcar, anexar, alertar, atribuir responsável. A automação real vem devagar, fase a fase.
