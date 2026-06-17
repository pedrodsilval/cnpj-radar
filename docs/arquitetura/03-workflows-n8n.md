# 03 — Workflows do n8n

## Princípio
O n8n é a camada de orquestração. Nunca acessa BrasilAPI, portais, fornecedores, CRM ou WhatsApp diretamente. Toda chamada passa pela API do backend. Toda execução é registrada em `workflow_runs`.

## Tipos de gatilho

| Gatilho | Quando ocorre |
| --- | --- |
| Manual via app | Usuário aciona ação no frontend (ex: salvar lead, gerar relatório em lote) |
| Agendado / cron | Rotina programada (ex: verificar validade de certidões diariamente) |
| Evento do banco | Backend registra evento que dispara o workflow (ex: lead salvo, cliente fechado) |

## Diagrama completo

```mermaid
flowchart TD
  A["Gatilhos n8n"] --> B{"Tipo de gatilho?"}

  B -->|Manual via app| C["Usuário aciona ação no app"]
  B -->|Agendado ou cron| D["Rotina programada"]
  B -->|Evento do banco| E["Evento registrado pelo backend"]

  C --> F["n8n chama API do Backend Everest"]
  D --> F
  E --> F

  F --> G{"Workflow solicitado?"}

  G -->|Consulta em lote| H["API recebe lista de CNPJs"]
  H --> I["Backend valida CNPJs"]
  I --> J["Backend consulta cache"]
  J --> K{"Precisa consultar fonte externa?"}
  K -->|Sim| L["Backend consulta BrasilAPI, fallback ou fornecedor pago"]
  K -->|Não| M["Backend usa dados existentes"]
  L --> N["Backend normaliza e persiste dados"]
  M --> N
  N --> O["n8n registra execução em workflow_runs"]

  G -->|Pipeline comercial| P["Lead salvo ou cliente fechado"]
  P --> Q["API calcula scores"]
  Q --> R["API define oferta sugerida"]
  R --> S["API cria tarefa comercial"]
  S --> T["API envia para CRM ou planilha"]
  T --> U["API notifica via WhatsApp ou e-mail — somente com permissão"]
  U --> O

  G -->|Regularidade| V["API lista certidões e validades"]
  V --> W{"Certidão vencida ou próxima do vencimento?"}
  W -->|Não| X["Registrar status sem ação"]
  W -->|Sim| Y{"Consulta automatizável?"}
  Y -->|Sim| Z["Backend executa consulta ou integração disponível"]
  Y -->|Não| AA["Backend cria tarefa manual para responsável"]
  Z --> AB{"Resultado?"}
  AB -->|Regular| AC["API atualiza status Regular e validade"]
  AB -->|Irregular| AD["API cria pendência de regularidade"]
  AB -->|Indisponível| AE["API registra indisponibilidade e motivo"]
  AB -->|Exige certificado ou login| AA
  AA --> AF["Responsável recebe tarefa de conferência manual"]
  AC --> O
  AD --> O
  AE --> O
  AF --> O
  X --> O

  G -->|Reconsulta e monitoramento| AG["API seleciona CNPJs para reconsulta periódica"]
  AG --> AH["Backend reconsulta fontes configuradas"]
  AH --> AI["Backend compara com último snapshot"]
  AI --> AJ{"Houve alteração cadastral?"}
  AJ -->|Não| AK["Registrar sem mudança"]
  AJ -->|Sim| AL["Criar evento de alteração"]
  AL --> AM["Notificar responsável ou gestão"]
  AK --> O
  AM --> O

  G -->|Geração e distribuição de relatórios| AN["API gera PDF no backend"]
  AN --> AO{"Destino permitido pelo perfil?"}
  AO -->|CRM| AP["API envia ao CRM"]
  AO -->|E-mail| AQ["API envia por e-mail"]
  AO -->|Responsável interno| AR["API notifica responsável"]
  AO -->|Não permitido| AS["Bloquear e registrar tentativa"]
  AP --> O
  AQ --> O
  AR --> O
  AS --> O

  G -->|Painel CNAE e mercado| AT["API consolida empresas, CNAEs, leads e clientes"]
  AT --> AU["Calcular volume, abertas no período, MEI vs não-MEI"]
  AU --> AV["Calcular clientes e taxa de penetração Everest/FK's"]
  AV --> AW["Atualizar campanhas sugeridas"]
  AW --> AX["Atualizar dashboard estratégico"]
  AX --> O

  O --> AY["Registrar trilha: workflow, data, resultado, erros, responsável"]
  AY --> AZ["Fim do workflow"]
```

## Quando cada workflow entra

| Workflow | Fase de entrada | Gatilho principal |
| --- | --- | --- |
| Consultas em lote | Fase 2 | Manual via app |
| Pipeline comercial | Fase 2 | Evento: lead salvo / cliente fechado |
| Regularidade | Fase 3 | Cron diário |
| Reconsulta e monitoramento | Fase 5 | Cron semanal |
| Distribuição de relatórios | Fase 5 | Manual ou evento |
| Painel CNAE e mercado | Fase 4 | Cron semanal |

## Nota crítica sobre permissões
Os ramos "somente com permissão" e "destino permitido pelo perfil" só passam a valer de fato na Fase 5, quando o sistema de login e perfis estiver ativo. Até lá, os passos de **envio externo de dados ficam desabilitados ou com confirmação manual obrigatória**. Não ligar a saída automática antes de existir autenticação.
