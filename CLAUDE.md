# CLAUDE.md — cnpj-radar
**Radar Empresarial Everest/FK's** | Versão 1.0 | Jun/2026

---

## Como usar este documento
Este é o documento-âncora do agente. Leia-o inteiro uma vez por sessão. Para tarefas específicas, acesse o arquivo de referência correspondente — não carregue todos de uma vez.

**Regra de ouro:** ao receber uma tarefa, identifique a fase e o domínio, carregue **apenas** o arquivo de `docs/` correspondente, depois execute. Isso preserva janela de contexto.

| Tipo de tarefa | Arquivo a carregar |
| --- | --- |
| Fluxo operacional geral | `docs/arquitetura/01-fluxo-principal.md` |
| Decisão de camadas / separação de responsabilidades | `docs/arquitetura/02-arquitetura.md` |
| Qualquer coisa envolvendo n8n | `docs/arquitetura/03-workflows-n8n.md` |
| Caminho crítico / o que bloqueia o quê | `docs/arquitetura/04-caminho-critico.md` |
| Visão executiva / contexto de negócio | `docs/arquitetura/00-visao-geral.md` |
| Fontes de dados, formato de CNPJ, autoridade do relatório | seção "Fontes de dados e autoridade" neste documento |
| Mock, ambientes (dev/demo/produção), dados simulados | seção "Estratégia de mock por ambiente" neste documento |
| Tarefas da Fase 1 (MVP) | `docs/roadmap/fase-1-mvp.md` |
| Tarefas da Fase 2 (Comercial) | `docs/roadmap/fase-2-comercial.md` |
| Tarefas da Fase 3 (Regularidade) | `docs/roadmap/fase-3-regularidade.md` |
| Tarefas da Fase 4 (CNAE/Mercado) | `docs/roadmap/fase-4-painel-cnae.md` |
| Tarefas da Fase 5 (Plataforma) | `docs/roadmap/fase-5-plataforma.md` |
| Sequenciamento, dependências, esforço | `docs/sequenciamento.md` |

---

## O projeto

**O que é:** plataforma interna de inteligência comercial e cadastral para a Everest/FK's (contabilidade em Salvador/BA). Consulta CNPJs, valida e normaliza dados, cruza com a base de clientes, gera scores e recomendação de próxima ação, organiza regularidade fiscal/documental, alimenta um painel de mercado por CNAE e apoia onboarding.

**O que é hoje:** protótipo React de consulta de CNPJ com lógica no frontend, sem backend, banco, autenticação, testes ou persistência.

**O que deve virar:** plataforma operacional em 5 fases. Ver `docs/arquitetura/00-visao-geral.md`.

**Trajetória (decisão de produto):** o sistema **inicia como ferramenta interna** da Everest/FK's e **evoluirá para produto comercial**, ofertado a outras contabilidades/empresas por meio de um site. Isso não muda o que é construído nas fases iniciais, mas define o destino: decisões de arquitetura daqui em diante devem ser tomadas de forma a **não bloquear a virada para produto**. Implicações concretas a manter no radar: (a) isolamento de dados entre clientes (multi-tenancy) será necessário — não acoplar dados a um único tenant implícito; (b) login/autenticação, hoje planejado para a Fase 5, provavelmente precisará ser antecipado quando a virada se aproximar; (c) a licença da API de dados precisa permitir uso comercial/revenda antes de produtizar (ver "Fontes de dados e autoridade"); (d) obrigações de LGPD, fiscal e suporte nascem com o produto, não com a ferramenta interna. Enquanto ferramenta interna, nada disso bloqueia o avanço — são pontos a decidir no momento da transição.

**Marca:** Everest e FK's são duas marcas distintas em co-branding. Toda saída visível (PDF, relatório, textos institucionais) usa "Everest/FK's". Paleta e logo da FK's necessários antes de finalizar o PDF como peça comercial — não bloqueia desenvolvimento.

---

## Stack

| Camada | Tecnologia | Observação |
| --- | --- | --- |
| Frontend | React + TypeScript | App separado do backend. Migração do código atual em andamento. |
| Backend | NestJS (standalone) | Dono da regra. Ver seção "Arquitetura" abaixo. |
| Banco | PostgreSQL / Supabase | 12 tabelas — ver schema abaixo. |
| Cache / estado | React Query ou SWR | No frontend. |
| Validação | Zod | Frontend e backend. |
| Testes | Vitest + React Testing Library + Playwright + MSW | — |
| Automação | n8n | Sempre cliente da API do backend, nunca direto nos serviços externos. |

### Schema do banco (12 tabelas)
`empresas` · `consultas` · `socios` · `cnaes` · `certidoes` · `leads` · `clientes` · `observacoes` · `usuarios` · `anexos` · `historico_status` · `workflow_runs`

> `workflow_runs` foi adicionada ao schema original (11 tabelas) para registrar trilha de auditoria de execuções do n8n. Decisão consciente.

---

## Arquitetura (resumo executivo)

O backend é o único dono de: autenticação, autorização, normalização, cache, logs, permissões, geração de PDF e integrações externas. O frontend só consome a API do backend. O n8n só consome a API do backend.

```
Frontend React
      ↓
Backend NestJS (API Everest)
      ↓                    ↓
  Banco PostgreSQL     Serviços externos
                       (BrasilAPI → fornecedor pago,
                        portais, CRM, WhatsApp)
                       ver "Fontes de dados e autoridade"

n8n → Backend NestJS (nunca direto nos serviços externos)
```

**Por que NestJS:** o backend vai concentrar RBAC, auditoria obrigatória, agendamento, filas e integrações. O NestJS estrutura isso nativamente — módulos por domínio (alinhados às 5 fases), guards para perfis (Fase 5), interceptors para trilha de auditoria, pipes para validação com Zod, `@nestjs/schedule` e BullMQ para consultas em lote e workflows assíncronos.

Ver diagrama completo em `docs/arquitetura/02-arquitetura.md`.

---

## Fontes de dados e autoridade

Esta seção governa de onde vêm os dados, como são citados e o que dá credibilidade técnica ao relatório. Vale para todas as fases.

### Formato do CNPJ — numérico E alfanumérico
Desde **06/07/2026** a Receita Federal emite CNPJ no formato **alfanumérico**, em paralelo ao numérico tradicional (que continua válido e não muda). Estrutura do novo formato:
- 14 posições, como antes.
- 12 primeiras posições (raiz de 8 + ordem de 4): podem conter letras A–Z e números 0–9.
- 2 últimas posições (dígitos verificadores): permanecem sempre numéricas.
- O DV continua sendo calculado por **módulo 11**, com a diferença de que cada caractere das 12 primeiras posições é convertido para seu valor pela tabela ASCII subtraindo 48 (`charCodeAt(0) - 48`: '0'→0 … '9'→9, 'A'→17 … 'Z'→42).

**Regra para o código:** todo validador, armazenamento e exibição de CNPJ aceita os dois formatos. Um validador só-numérico é incorreto e rejeitaria empresas reais abertas a partir de julho/2026. Ver implementação na Tarefa 4 da Fase 1.

### Hierarquia de fontes
O dado de CNPJ tem uma única origem real — a **Receita Federal** — acessada por diferentes caminhos. Não existe uma API oficial, pública e gratuita da Receita para consulta individual em tempo real e em volume; o que existe são terceiros que hospedam a base da Receita e a repassam via API, os arquivos abertos mensais (exigem hospedagem própria) e os serviços pagos do Serpro.

| Camada | Fonte | Uso | Custo |
| --- | --- | --- | --- |
| Primária (Fase 1, MVP) | **BrasilAPI** (`/api/cnpj/v1/{cnpj}`) | Consulta individual no MVP. Origem dos dados: Receita Federal. | Grátis |
| Fallback / produção (Fase 2+) | **Fornecedor pago** (a definir) | Volume, consultas em lote, maior disponibilidade | Pago — decisão do cunhado |
| Âncora oficial (longo prazo, opcional) | **Dados abertos da Receita Federal** | Base própria; independência de terceiros | Infra pesada (~150GB descompactado, ETL mensal) |

**Limites a respeitar:**
- A BrasilAPI é um projeto **experimental/beta** que pede explicitamente para não fazer crawling, full scan ou uso abusivo. **Não usá-la como fonte única para consultas em lote** (Fase 2) — para volume, usar fornecedor pago.
- A base oficial da Receita é atualizada **mensalmente**, não em tempo real. Qualquer dado de origem Receita pode ter defasagem de até ~1 mês.
- A escolha do fornecedor pago é decisão da **Fase 2, com aprovação do cunhado**, e deve passar por teste real de latência e completude — não confiar em material de marketing dos próprios fornecedores.

### O papel do n8n nas fontes
O n8n **orquestra** o acesso às fontes (consulta em lote, agendamento, reconsulta, gravação no banco) — sempre chamando a API do backend, que por sua vez chama a fonte externa. O n8n **não é uma fonte** e não elimina a necessidade de uma API ou base: ele automatiza o acesso a algo que já está acessível.

### Três requisitos de autoridade do relatório
Para o PDF ter credibilidade técnica perante um contador, todo dado exibido carrega:
1. **Procedência:** fonte específica (ex.: "BrasilAPI — origem: Receita Federal") + data/hora da consulta.
2. **Ressalva de defasagem:** aviso honesto de que dados de origem Receita podem ter até ~1 mês de atraso (base oficial mensal). Não prometer "tempo real" quando a fonte é mensal.
3. **Separação cadastro × regularidade:** deixar visualmente claro que situação cadastral ativa não é prova de regularidade fiscal (certidões — Fase 3).

---

## Estratégia de mock por ambiente

O mock existe para **desenvolvimento e demonstração**, nunca para enganar um usuário real. O princípio inegociável: **é impossível um dado simulado aparecer em produção por acidente**. Um relatório com dado falso entregue a um cliente destrói a autoridade do projeto.

### Controle por `APP_ENV`
Uma única variável de ambiente governa tudo: `APP_ENV` com valores `development`, `demo` ou `production`. Default seguro: se a variável estiver ausente ou com valor desconhecido, o sistema trata como `production` (o modo mais restritivo) — falha fechada, nunca aberta.

| `APP_ENV` | Comportamento do mock |
| --- | --- |
| `development` | Mock disponível para CNPJ(s) de teste; demais CNPJs consultam a API real |
| `demo` | Igual a development, mas o mock retorna com `simulado: true` nos metadados para o frontend estampar o selo "dados simulados" |
| `production` | O caminho do mock **não existe**. API falhou → erro específico, sem relatório. Nenhum dado simulado é alcançável |

### Regras de implementação
- O mock **não** é um fallback dentro do fluxo de consulta que liga quando a API falha. Se fosse, bastaria a BrasilAPI cair em produção para o mock vazar. O mock é decidido **antes**, por ambiente.
- Em `production`, o código não deve sequer ter um ramo alcançável que retorne mock. A checagem de `APP_ENV` vem antes de qualquer lógica de mock.
- O gatilho em dev/demo é um **CNPJ de teste conhecido** (CNPJ "mágico"): ao consultá-lo, retorna o mock; qualquer outro CNPJ vai para a API real. Isso permite desenvolver o fluxo real e ter o mock sob demanda.
- O mock reutiliza o mesmo formato de retorno da consulta real (`dados` + `metadados`), para o frontend não precisar de lógica separada. Em `demo`, acrescenta `simulado: true`.
- A regra 3 ("Produção nunca exibe mock") governa esta seção.

---

## Regras inegociáveis

Estas regras nunca são violadas, independentemente do contexto da tarefa:

1. **n8n nunca acessa serviço externo diretamente.** Sempre via API do backend. Sem exceção.
2. **Frontend nunca acessa serviço externo diretamente.** Toda consulta passa pelo backend.
3. **Produção nunca exibe mock.** O mock é controlado pela variável de ambiente `APP_ENV` (`development` | `demo` | `production`): só pode ser retornado quando `APP_ENV` é `development` ou `demo`, e em `production` o caminho do mock não existe no código. Em erro real de produção: mensagem clara, sem relatório. Em `demo`: mock com flag `simulado: true` nos metadados, que o frontend usa para estampar o selo "dados simulados". Ver "Estratégia de mock por ambiente".
4. **Toda consulta é rastreável.** Data, hora, fonte e usuário registrados. Relatório exibe "Dado consultado em dd/mm/aaaa às hh:mm".
5. **Erro sempre específico.** Nunca uma mensagem genérica única. Tipos: CNPJ inválido, inexistente, timeout, rate limit, 5xx, CORS, parsing, campo ausente, resposta incompleta.
6. **Nunca inventar dado cadastral ou fiscal.** Sempre citar a procedência (fonte + data da consulta). Em caso de dúvida, omitir e sinalizar. Ver seção "Fontes de dados e autoridade".
7. **Backend é o dono da regra.** Nenhuma regra de negócio, permissão ou cálculo de score vive no frontend.
8. **n8n entra só na Fase 2 e sobre API estável.** Fase 1 não tem n8n. O caminho crítico é: backend estável → n8n.
9. **Certidões são quase sempre manuais.** Não assumir que portais públicos têm API limpa. O módulo nasce como gestor de regularidade (marcar, anexar, alertar, atribuir) — não como emissor automático.
10. **Anotações internas são o dado mais sensível.** Mais que o CNPJ em si. Governança de dados (finalidade, retenção, auditoria) vale desde a Fase 1, não só quando login chegar na Fase 5.
11. **Cadastro não é regularidade.** "Situação cadastral ativa" (dado de CNPJ) nunca é tratado nem exibido como prova de regularidade fiscal. São camadas distintas: cadastro vem da consulta de CNPJ; regularidade vem das certidões (Fase 3).
12. **CNPJ tem dois formatos válidos.** Desde 06/07/2026 existe o CNPJ alfanumérico, além do numérico antigo. Todo código que valida, armazena ou exibe CNPJ aceita ambos. Ver seção "Fontes de dados e autoridade".

---

## Roadmap (5 fases)

| Fase | Nome | n8n | Status |
| --- | --- | --- | --- |
| 1 | MVP confiável | ✗ | Próxima |
| 2 | Inteligência comercial | ✓ (entra aqui) | — |
| 3 | Regularidade assistida | ✓ | — |
| 4 | Painel CNAE e mercado | ✓ | — |
| 5 | Plataforma operacional | ✓ (orquestração plena) | — |

Fluxogramas detalhados e dependências entre entregas: `docs/roadmap/`.
Tabela de sequenciamento completa (ordem, dependência, esforço P/M/G): `docs/sequenciamento.md`.

---

## Decisões registradas

### #1 — Login: Fase 5
Login obrigatório e perfis completos chegam na Fase 5. As Fases 2–4 já executam ações sensíveis (envio a CRM, WhatsApp, e-mail) sem controle de perfil.
**Mitigação obrigatória:** construir os workflows normalmente, mas manter passos de envio externo **desabilitados ou com confirmação manual** até existir autenticação. Orquestração pronta; saída automática de dados só ligada na Fase 5.

### #2 — Base de clientes: em aberto [RESOLVER ANTES DA FASE 2]
Descobrir antes de iniciar a Fase 2: (a) onde a base vive — planilha, sistema contábil ou CRM; (b) formato de exportação; (c) chave de cruzamento (presumivelmente CNPJ). Determina se a integração é esforço M ou subprojeto. Bloqueia score comercial e motor de recomendação.

### #3 — Backend: NestJS standalone
Decisão tomada. Justificativa: ver seção "Arquitetura" acima.

### #4 — "FK's": segunda marca
Co-branding com Everest. Toda saída visível usa "Everest/FK's". Paleta/logo FK's necessários antes de finalizar o PDF comercial — não bloqueia o desenvolvimento.

---

## Ambiente de desenvolvimento
- **SO:** Windows
- **Terminal:** CMD (não PowerShell — evita problemas de execution policy do npm)
- **Repositório:** `cnpj-radar`
