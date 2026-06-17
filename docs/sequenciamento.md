# Sequenciamento de Execução

Tabela completa de tarefas técnicas por fase, com ordem, dependências e esforço estimado.

**Legenda de esforço:** P = Pequeno (horas/1 dia) · M = Médio (2–5 dias) · G = Grande (1–2 semanas) · M/G = depende de fator externo

> Para o caminho crítico e o que bloqueia o quê, ver `docs/arquitetura/04-caminho-critico.md`.

---

| Fase | Ordem | Tarefa técnica | Dependência | Esforço |
| --- | --: | --- | --- | --- |
| Fase 1 | 1 | Migrar estrutura crítica do frontend para TypeScript | Código React atual | M |
| Fase 1 | 2 | Criar validador real de CNPJ (dígitos verificadores) | Frontend/backend definidos | P |
| Fase 1 | 3 | Criar backend mínimo NestJS | Definição de stack confirmada | M |
| Fase 1 | 4 | Criar endpoint de consulta CNPJ | Backend mínimo | M |
| Fase 1 | 5 | Mover consulta externa para o backend | Endpoint criado | M |
| Fase 1 | 6 | Implementar normalização de dados | Endpoint de consulta | M |
| Fase 1 | 7 | Implementar tratamento de erro específico | Backend de consulta | M |
| Fase 1 | 8 | Separar ambientes: dev, demo e produção | Backend e frontend configurados | P |
| Fase 1 | 9 | Remover mock automático em produção | Separação de ambientes | P |
| Fase 1 | 10 | Registrar data, hora e fonte da consulta | Modelo inicial de consulta | M |
| Fase 1 | 11 | Criar PDF simples no backend | Dados normalizados | M |
| Fase 1 | 12 | Adicionar disclaimers e links oficiais | Layout de relatório | P |
| Fase 1 | 13 | Criar testes unitários e de interface | Validação e componentes estabilizados | M |
| Fase 1 | 14 | Revisar acessibilidade | UI estabilizada | P |
| Fase 2 | 1 | Modelar tabelas: leads, clientes, observações, histórico | Banco inicial | M |
| Fase 2 | 2 | Integrar base interna de clientes (planilha/CRM) | Modelo de clientes/leads | M/G¹ |
| Fase 2 | 3 | Identificar cliente ativo, ex-cliente ou lead | Integração interna | M |
| Fase 2 | 4 | Criar tags comerciais e status de lead | Modelo de leads | P |
| Fase 2 | 5 | Implementar score cadastral | Dados normalizados | M |
| Fase 2 | 6 | Implementar score comercial | CNAE, base interna e regras comerciais | M |
| Fase 2 | 7 | Implementar score de atenção/risco | Dados cadastrais e regras de risco | M |
| Fase 2 | 8 | Criar motor de recomendação de próxima ação | Scores e status comercial | M |
| Fase 2 | 9 | Criar botão salvar lead | Modelo de leads e recomendação | P |
| Fase 2 | 10 | Criar botão gerar proposta/diagnóstico | Relatório e recomendação | M |
| Fase 2 | 11 | Introduzir n8n como cliente da API | Backend estável (Fase 1 concluída) | M |
| Fase 2 | 12 | Workflow n8n: lead salvo aciona score, tarefa e notificação | API de leads, score e tarefa | M |
| Fase 3 | 1 | Modelar certidões, anexos, validade e responsáveis | Banco e usuários básicos | M |
| Fase 3 | 2 | Criar status de certidão | Modelo de certidões | P |
| Fase 3 | 3 | Criar upload manual de PDF | Módulo de anexos | M |
| Fase 3 | 4 | Criar checklist de pendências | Certidões modeladas | M |
| Fase 3 | 5 | Criar relatório de pendências | Checklist | M |
| Fase 3 | 6 | Criar alertas de vencimento | Validade das certidões | M |
| Fase 3 | 7 | Expandir n8n para workflows de regularidade | API de certidões | M |
| Fase 3 | 8 | Workflow agendado de verificação de validade | n8n e certidões | M |
| Fase 3 | 9 | Encaminhar tarefa manual quando não automatizável | Módulo de tarefas e responsável | M |
| Fase 4 | 1 | Criar cadastro de CNAEs prioritários | Modelo de CNAEs | M |
| Fase 4 | 2 | Relacionar CNAEs com segmentos Everest/FK's | Cadastro CNAE | M |
| Fase 4 | 3 | Criar indicadores de mercado | Base de empresas, leads e clientes | M |
| Fase 4 | 4 | Calcular MEI vs não-MEI por segmento | Dados normalizados | M |
| Fase 4 | 5 | Calcular taxa de penetração Everest/FK's | Base de clientes e mercado | M |
| Fase 4 | 6 | Criar campanhas sugeridas por segmento | Segmentos e penetração | M |
| Fase 4 | 7 | Criar dashboard por CNAE e região | Indicadores calculados | G |
| Fase 4 | 8 | Workflow n8n de consolidação periódica do painel | API de indicadores | M |
| Fase 5 | 1 | Implementar login obrigatório | Backend e banco | M |
| Fase 5 | 2 | Criar perfis e permissões | Login | M |
| Fase 5 | 3 | Aplicar permissões por ação sensível | Perfis definidos | M |
| Fase 5 | 4 | Criar módulo completo de tarefas | Usuários e permissões | G |
| Fase 5 | 5 | Integrar WhatsApp e CRM via backend | Permissões e backend | M/G² |
| Fase 5 | 6 | Criar geração de propostas | Relatório, lead e permissões | G |
| Fase 5 | 7 | Criar dashboard executivo | Histórico, leads, conversão e mercado | G |
| Fase 5 | 8 | Criar reconsulta periódica de CNPJs | Histórico e n8n | M |
| Fase 5 | 9 | Criar monitoramento de mudanças cadastrais | Reconsulta periódica | M |
| Fase 5 | 10 | Criar distribuição automática de relatórios | PDF, permissões e n8n | M |
| Fase 5 | 11 | Consolidar auditoria completa | Logs, usuários e workflows | G |

---

¹ **Fase 2, tarefa 2 (M/G):** o esforço depende de onde está a base de clientes hoje — planilha, sistema contábil ou CRM. Mapear o formato e a chave de cruzamento antes de estimar. Ver `CLAUDE.md` Decisão #2.

² **Fase 5, tarefa 5 (M/G):** depende do CRM escolhido e da maturidade da integração disponível.
