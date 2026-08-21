# Pendências Técnicas — cnpj-radar

**Gerado em:** 14/08/2026, por auditoria completa (caixa-branca + caixa-preta em produção) via Claude Code.
**Propósito:** este arquivo alimenta esta e futuras sessões — leia-o inteiro antes de mexer em qualquer área listada aqui. Ele registra o que foi verificado, o que foi corrigido, e o que continua pendente, com localização exata no código para não precisar re-investigar do zero.

**Metodologia:** revisão de código de todos os módulos backend/frontend + teste funcional ao vivo em `https://cnpj-radar.onrender.com` via Claude in Chrome (usuário logado, sessão real), cobrindo Dashboard, Consulta CNPJ (todas as sub-abas), Alertas, Tarefas, Relatórios, Painel de Mercado (Mercado + Campanhas), Usuários e Configurações/Credenciais.

---

## 1. Corrigido nesta auditoria (já em produção)

| # | Achado | Severidade | Commit |
|---|---|---|---|
| 1 | SQL injection em `GET /painel/indicadores?uf=` e `GET /painel/cnae?uf=` — `uf` era interpolado direto na query raw (`painel.service.ts`). Qualquer usuário autenticado (inclusive perfil "leitura") conseguiria ler dados de outras tabelas (ex: hash de senha de `usuarios`) via UNION, ou potencialmente executar stacked queries. | 🔴 Crítica | `f031250` |
| 2 | Sessão expirada (401) mostrava "Não foi possível consultar agora" sem saída — agora `apiFetch` detecta 401, limpa a sessão e volta pro login com aviso claro. | 🟠 Alta (UX quebrada, reportada pelo usuário) | `fd2ed9a` |
| 3 | Header (`App.tsx`) não tinha branch pra `vista === 'relatorios'` — título ficava "Consulta de CNPJ" na tela de Relatórios. | 🟢 Cosmético | `f52f9c9` |
| 4 | **Autofill do Chrome preenchia a senha real do admin logado nos campos de "Novo usuário" (`UsuariosTab.tsx`) e nas 3 entradas de segredo em Credenciais (`CredenciaisTab.tsx`: senha do certificado A1, senha eCAC, chave API genérica)** — nenhum desses inputs tinha `autoComplete`, então o Chrome tratava como formulário de login e auto-preenchia com a credencial salva do próprio usuário. Confirmado ao vivo: o valor real da senha do Pedro apareceu no state React do form de novo usuário. Corrigido com `autoComplete="off"` / `"new-password"`. | 🔴 Crítica (exposição de credencial) | `f52f9c9` |

---

## 2. Bloqueado por infraestrutura/conta — não é bug de código

### 2.1 FGTS/CRF — código funciona, IP do Render é bloqueado
- `backend/src/certidoes/certidoes-scraper.service.ts` → `consultarFgts()`.
- **Testado localmente (rede brasileira normal) em ago/2026: funciona 100%** — encontra o campo, preenche, consulta, retorna REGULAR, baixa PDF, extrai validade.
- Em produção, o WAF Azion do portal da Caixa devolve **403 Forbidden** pro IP do datacenter do Render (edge Denver — confirmado via diagnóstico embutido no próprio scraper, que captura `title`+`body` da página quando o campo não aparece).
- **Não adianta trocar de nuvem americana** (Vercel etc.) — o bloqueio é por faixa de IP de datacenter, não só geografia. Um Lambda da Vercel em São Paulo (`gru1`) ainda sai de IP AWS, reconhecível como nuvem.
- **Resolve sozinho quando migrar pra VPS** (decisão do cliente, ago/2026) — idealmente IP comercial/residencial brasileiro "normal", não de um provedor de nuvem óbvio.

### 2.2 CND Federal / CNDT Trabalhista / Dívida Ativa da União — endpoint desatualizado, não é captcha (ver 🎯 abaixo)
- `consultarCndFederalCom2captcha()`, `consultarCndt()` — usam hCaptcha resolvido via `api_captcha` local (tentativa grátis primeiro) com fallback pago no 2captcha.
- Formato de requisição pro 2captcha já corrigido nesta sessão (form-urlencoded, não JSON) — commit `81bc698`.
- **21/08/2026 — saldo recarregado pelo cliente, testado de novo com diagnóstico melhorado (commit `0fce6f1`):** a chave **funciona** (não é saldo zero nem chave inválida — isso daria `ERROR_ZERO_BALANCE`/`ERROR_WRONG_USER_KEY` no submit). O erro real é **`ERROR_CAPTCHA_UNSOLVABLE`** — o 2captcha tentou resolver o hCaptcha da Receita Federal e não conseguiu (em outra tentativa, deu timeout de 120s em vez disso). Isso é uma limitação do hCaptcha em si (possivelmente uma variante "enterprise"/mais difícil) ser difícil de resolver de forma confiável por serviços de captcha genéricos, não um problema de configuração da conta. Dívida Ativa (reusa o mesmo scraper) teve o mesmo tipo de falha. CNDT usa um captcha de imagem separado, ainda sem esse diagnóstico detalhado — só "não resolvido após 3 tentativas".
- **Nota de performance:** o teste completo (8 tipos de certidão) levou **~13 minutos** dessa vez — bem mais que os ~2 minutos observados antes. Suspeita: o `api_captcha` local (tentado antes do 2captcha, com timeout de `AbortSignal.timeout(120_000)`) provavelmente está inacessível a partir do Render, e cada uma das 3 tentativas do CND Federal (e possivelmente CNDT/Dívida Ativa) pode estar gastando o timeout completo de 120s à toa antes de cair pro 2captcha. Vale considerar reduzir esse timeout ou pular a tentativa local quando rodando em produção, se isso for confirmado.
- **Verificado direto no painel do 2captcha (21/08/2026):** no dia do teste, a conta processou **5 captchas resolvidos e 3 não resolvidos** (aba Costs, `/statistics/graph_captures`) — o 2captcha consegue resolver a maioria dos hCaptchas na prática.

> ### 🎯 Causa raiz real encontrada (21/08/2026) — não é captcha, é o CNPJ de teste
> Reproduzido o fluxo **manualmente, como usuário humano real**, direto no site da Receita Federal (`servicos.receitafederal.gov.br/servico/certidoes`), sem nenhum robô/captcha automatizado envolvido: pro CNPJ da Everest (`30327128000125`), o resultado foi **exatamente a mesma mensagem** que o scraper reporta — *"As informações disponíveis na Receita Federal sobre o contribuinte são insuficientes para emitir a certidão pela Internet."*
>
> Motivo: a Everest **já tem uma certidão "Positiva com efeitos de negativa"** válida até 02/12/2026 (visível em Consultar Certidão → histórico das últimas 8 emissões) — ou seja, existe alguma pendência federal com exigibilidade suspensa (ex: parcelamento). A própria página "Como Resolver?" do gov.br confirma: quando não é possível emitir pela internet, a orientação oficial é usar o serviço separado **"Comprovar Regularidade Fiscal"** pra resolver a pendência antes — não é uma falha técnica, é uma decisão de negócio do sistema da Receita.
>
> **Implicação prática: o CNPJ da Everest é um mau caso de teste pra essa automação.** Como o próprio site nega emissão automática pra esse CNPJ mesmo pra um humano, testar a automação com ele sempre vai "falhar" independente do captcha funcionar ou não — o que fez os erros de captcha (`ERROR_CAPTCHA_UNSOLVABLE`, timeouts) parecerem a causa raiz, quando na verdade eram só ruído em cima de um teste que já ia falhar de qualquer jeito.
>
> **Também descoberto:** o fluxo real do site **não usa o endpoint `/consulta/validar-contribuinte`** que o scraper usa (`certidoes-scraper.service.ts`) — o fluxo atual do site é `POST /Emissao/verificar` (checa se já existe certidão válida, sem captcha) → `POST /Emissao` (emite, com captcha). Não confirmado se `validar-contribuinte` é um endpoint legado ainda funcional em paralelo ou se está desatualizado — precisa investigar/atualizar o scraper pra usar o fluxo real (`Emissao/verificar` + `Emissao`) antes de tentar validar a automação de novo.
>
> **Confirmado com um segundo CNPJ limpo (`41530027000173`, fornecido pelo usuário, com 3 certidões "Negativa" recentes):** repeti o mesmo teste manual — `Emitir Nova Certidão` → **"A certidão foi emitida com sucesso"**, na hora, sem fricção. Isso prova que o hCaptcha invisível resolve normalmente num navegador real e que o site emite certidão automaticamente sem problema quando o CNPJ está de fato elegível.
>
> **21/08/2026 — código atualizado (commit `6bde470`)**, a pedido do usuário (que decidiu retomar essa frente pontualmente, apesar da pausa geral de e-CAC). Instrumentei o site real com interceptor de XHR/fetch pra capturar o payload exato de `Emissao/verificar` e `Emissao` em 3 cenários (CNPJ sem certidão prévia, CNPJ com certidão válida, CNPJ bloqueado) e reescrevi `consultarCndFederalCom2captcha()` pra usar o fluxo real:
> - `POST Emissao/verificar` — `{ni, tipoContribuinte:"PJ", tipoContribuinteEnum:"CNPJ"}`, header `X-Captcha-Token`, seta cookie de sessão. `status:"Emitida"` não impede seguir — o site sempre prossegue pra `Emissao` independente desse valor.
> - `POST Emissao` — mesmo body (com `tipoContribuinteEnum` corrigido pra `"CNPJ"` maiúsculo, antes estava `"Cnpj"`), header `Cookie` (não usa mais o token de captcha diretamente). Resposta real capturada do caso bloqueado: `{"statusEmissao":"SemDireitoCertidao","mensagem":{"texto":"...","data":"..."}}` — o campo `mensagem` é objeto, não string (tipo corrigido no código; a mensagem real da Receita agora aparece pro usuário em vez de um texto genérico nosso).
> - Ainda **não testado em produção** com o novo código — próximo passo depois do deploy.

> ⚠️ **Decisão do usuário (14/08/2026): pausar investimento adicional em automação de e-CAC (CND Federal, PGFN, futura API Integra Contador) até o fim das eleições federais de 2026.** O motivo é a incerteza sobre como o governo federal vai conduzir o e-CAC após a mudança/confirmação de gestão — o sistema pode ser reformulado ou ter prioridades alteradas. Isso **não bloqueia** as outras frentes de certidões (FGTS/Caixa, SEFAZ estadual/municipal de Salvador, login no Nota Salvador — ver seção 3.1) que não dependem do e-CAC. Não propor mais trabalho nessa frente específica sem reconfirmar com o usuário que a situação política já se resolveu.

### 2.3 n8n — 100% inativo, nunca foi para produção
- Os 5 workflows em `n8n/workflows/*.json` têm **`"active": false`** — nenhum roda.
- **Todas as URLs internas apontam pra `http://host.docker.internal:3000`** (rede Docker local) — isso só funciona quando n8n roda em Docker no mesmo host que o backend local. Não há absolutamente nenhuma referência à URL de produção (`https://cnpj-radar.onrender.com`) em nenhum workflow.
- `render.yaml` só define o serviço `cnpj-radar` — **não existe nenhuma instância n8n hospedada em lugar nenhum**. O `N8N_WEBHOOK_SECRET` está configurado no Render mas não tem consumidor real.
- `n8n/MANUAL-N8N.md` confirma: "Endereço do n8n em desenvolvimento: `http://localhost:5678`" — é setup local de dev, nunca adaptado.
- **Para n8n funcionar de verdade em produção, falta:** (a) decidir onde hospedar a instância n8n (mesma VPS do backend? serviço separado?), (b) atualizar as ~20 URLs hardcoded nos 5 JSONs pra apontar pro domínio de produção, (c) importar os workflows na instância real e ativar o toggle de cada um.
- Isso é o item "5.10 n8n orquestração plena" do roadmap (`CLAUDE.md`), e ainda está tão distante quanto antes — o código dos workflows existe, mas é só um protótipo de desenvolvimento.

---

## 3. Certidões que faltam ser implementadas (resposta direta)

O plano original da Fase 3 (`docs/roadmap/fase-3-regularidade.md`) lista 8 tipos de certidão, e **todos os 8 têm uma função de scraper no código** — nesse sentido, "nada falta ser criado do zero". Mas a automação **real** (não um stub que só devolve link manual) tem cobertura bem mais restrita do que a lista sugere:

| Certidão | Automação real | Cobertura |
|---|---|---|
| FGTS / CRF | ✅ Sim | Nacional (bloqueado só por IP, ver 2.1) |
| CND Federal + Dívida Ativa da União | ✅ Sim | Nacional (bloqueado só por saldo 2captcha, ver 2.2) |
| CNDT Trabalhista | ✅ Sim | Nacional (idem) |
| **Certidão Estadual** | ⚠️ Parcial | **Só Bahia** (`consultarCndEstadual`, SEFAZ-BA). Outros 26 estados: sempre devolve link manual pro portal da SEFAZ do estado, nunca tenta automatizar. |
| **Inscrição Estadual (IE)** | ⚠️ Parcial | **Só Bahia** (`consultarIeSefazBa`). Mesma limitação. Curiosamente `CERTIDAO_AUTOMATIZAVEL[INSCRICAO_ESTADUAL] = false` no código — a UI nem mostra o selo "Automático" pra esse tipo, apesar de ter automação real funcionando pra BA. |
| **Certidão Municipal** | ⚠️ Parcial (✅ desde 14/08/2026) | **Salvador**: automatizada via `consultarCertidaoMunicipalSalvador()` — Certidão de Regularidade Fiscal PJ (SEFAZ+PGMS), sem login, endpoint público `ProxyValidaCNPJCertidao.asp`. Caminho de erro (não inscrito/insuficiente) validado contra resposta real do portal — testado com 2 CNPJs reais de Salvador (incluindo o da própria Everest), **ambos caíram em "informações insuficientes" (código "1")**, nenhum bateu no caminho "regular" (código "0"). Caminho de sucesso **ainda não testado com CNPJ regular real**. Outros municípios continuam stub com link manual (mapa `portaisMunicipais` tem só 5 entradas, e RS/PR apontam erroneamente pra portais estaduais). |
| **Inscrição Municipal (IM/CCM)** | ❌ **Nenhuma** | `consultarInscricaoMunicipal()` — 100% stub, nenhuma automação real pra nenhum município, nem Salvador. Investigado em 14/08/2026: a ferramenta pública da SEFAZ Salvador pra dados cadastrais (`CertidaoDadosCadastraisFrm.aspx`) pede o **número da inscrição municipal como entrada**, não o CNPJ — ou seja, exige já saber o dado que a gente quer descobrir. Automatizar isso exigiria primeiro resolver como obter a inscrição a partir do CNPJ (não achado nenhum caminho público pra isso). |

**Resumindo pra priorização:** se o objetivo é aumentar cobertura automática, os dois itens com ROI mais claro são **Certidão Municipal e Inscrição Municipal de Salvador** (não têm nada implementado hoje, e é a cidade onde a maioria dos clientes da Everest/FK's provavelmente está) — o portal é o NFSe da Prefeitura (`https://nfse.salvador.ba.gov.br`), que **exige login**, então precisaria de credencial cadastrada (como já existe pra certificado A1) antes de dar pra automatizar.

### 3.1 Por que "código 1" (informações insuficientes) aparece tanto — decisão pendente

Testado ao vivo em 14/08/2026 com 2 CNPJs reais de Salvador (Everest, `30327128000125`, e outro fornecido pelo usuário, `27950582000123`) — **os dois** caíram em "informações insuficientes para emissão automática", nunca no caminho "regular". A resposta do proxy inclui, nos dois casos, uma coluna que dispara a mensagem "Para consultar sua situação fiscal acesse o **PAD**".

**PAD = Parcelamento Administrativo de Débitos** (`pad.salvador.ba.gov.br`) — não é uma ferramenta de consulta, é o programa de **parcelamento de dívidas** da prefeitura. Isso sugere que a coluna que dispara esse redirecionamento provavelmente indica que **o CNPJ tem algum débito/parcelamento em aberto** com a Fazenda Municipal — o sistema não emite negativa automática pra quem tem pendência. Ou seja, "informações insuficientes" pode não ser uma limitação técnica do endpoint, e sim um sinal real de pendência fiscal.

O acesso ao PAD exige login no sistema **SenhaWeb / Nota Salvador** (mesmo login do portal NFSe, `nfse.salvador.ba.gov.br`) — investigado o mecanismo desse login:
- **Usuário/CNPJ + senha**: exige resolver um **captcha de imagem real** (servido por `captcha.aspx`, não é decorativo como o do endpoint de certidão) — mesma dependência de 2captcha que já bloqueia CND Federal/CNDT/Dívida Ativa (ver 2.2). Sem saldo no 2captcha, não funciona.
- **"Acessar com certificado digital (ICP-Brasil)"**: existe um botão de login via certificado digital, que evitaria o captcha inteiramente. A Everest/FK's já tem um **Certificado A1** cadastrado em Configurações → Credenciais — mas **não foi confirmado se esse certificado é um e-CNPJ válido da empresa com autorização pra esse portal especificamente** (o usuário não tinha certeza no momento da pergunta).

**Status: decisão pendente do usuário** (precisa conversar com o responsável/chefe antes de decidir). Opções discutidas:
1. Marcar "código 1" automaticamente como `IRREGULAR` (em vez de `INDISPONIVEL`) já que provavelmente indica pendência real — não escolhida ainda, não implementada.
2. Estender a automação com login completo no Nota Salvador (usuário/senha + 2captcha, ou certificado digital se confirmado válido) — maior escopo, não iniciado.
3. Deixar como está — status atual (`INDISPONIVEL` genérico) permanece até decisão.

**Não fazer sem essa decisão:** não presumir que "código 1" = irregular no código sem confirmação explícita do usuário — a inferência é razoável mas não 100% certa (poderia haver outros motivos pra "informações insuficientes" além de débito).

---

## 4. Bugs/gaps menores documentados (não corrigidos)

| # | Achado | Local | Impacto |
|---|---|---|---|
| 5 | `alertas()` em `certidoes.service.ts` (linha ~141-148) filtra certidões REGULAR com `validade <= hoje+30d`, **sem limite inferior**. Uma certidão vencida há 32 dias (status ainda REGULAR porque não foi reconsultada) aparece na seção "Vencendo em até 30 dias" com o texto confuso "há 32 dias" — deveria estar numa categoria separada tipo "Já vencidas". Reproduzido ao vivo na tela Alertas. | `backend/src/certidoes/certidoes.service.ts:141` | UX confusa, não é dado errado |
| 6 | Cards de alerta na tela **Alertas** (`AlertasTab.tsx`) não são clicáveis — não tem link pra ir direto pro CNPJ. Usuário precisa copiar o CNPJ manualmente e ir em Consulta CNPJ. | `frontend/src/AlertasTab.tsx` | Fricção de UX |
| 7 | Ações destrutivas usam `window.confirm()` nativo (`TarefasTab.tsx` remover, `UsuariosTab.tsx` desativar) em vez de modal customizado como o resto do app. Visualmente inconsistente, e um `confirm()` nativo chegou a travar a automação de teste por ~30s durante essa auditoria (Chrome DevTools Protocol não dispara o dialog nativo do mesmo jeito que clique normal). | `frontend/src/TarefasTab.tsx`, `frontend/src/UsuariosTab.tsx` | Cosmético + risco de travamento em automação |
| 8 | Proposta comercial gerada (`leads-pdf`/scores) não diferencia bem entidades sem fins lucrativos. Testado com uma "Caixa Escolar" (associação privada, capital social R$0) e a recomendação saiu "grande empresa — pode exigir equipe dedicada" / "maior potencial de honorários", que não faz sentido pra esse tipo de entidade. | `backend/src/leads/leads.service.ts` (heurísticas de score/proposta) | Qualidade de conteúdo, não é erro técnico |
| 9 | `TypeOrmModule.forRoot({ synchronize: process.env.APP_ENV !== 'production' })` em `app.module.ts` — **contraria o princípio "fail closed" que o próprio `CLAUDE.md` define pra estratégia de mock** ("se a variável estiver ausente ou desconhecida, tratar como produção"). Aqui é o oposto: qualquer valor de `APP_ENV` que não seja literalmente a string `"production"` liga o `synchronize`, que altera o schema do banco automaticamente no boot. Hoje protegido porque o Render tem `APP_ENV=production` explícito, mas é uma armadilha se algum ambiente futuro (staging, preview) rodar sem essa env var certinha. | `backend/src/app.module.ts:26` | Risco latente, não ativo hoje |

---

## 5. Infraestrutura

- **Render free tier hiberna após ~15min de inatividade** — gera uma tela de "cold start" (~15-20s, às vezes mais) na primeira requisição do dia, incluindo uma vez em que uma request de `GET /credenciais` ficou "pending" indefinidamente até eu recarregar a página. Isso por si só já é motivo de peso pra migração de hospedagem (junto com o bloqueio de IP do FGTS, ver 2.1) — mais um argumento a favor da VPS.
- Gotchas de deploy no Render (Blueprint sync manual necessário pra mudanças em `render.yaml`, `PLAYWRIGHT_BROWSERS_PATH=0`) já documentados na Decisão #5 do `CLAUDE.md` — não repetir aqui.

---

## 6. O que foi testado e está sólido

Cobertura funcional completa em produção, sem erros de console, todas as respostas de API corretas:

- **Dashboard**: KPIs (consultas/mês, leads, conversão, oportunidades paradas, certidões críticas), gráfico de consultas 6 meses, top CNAEs, top consultores — tudo com dado real, sem erro.
- **Consulta CNPJ**: validação de formato client-side, consulta real via BrasilAPI, as 4 sub-abas (Cadastro, Scores, Sócios, Certidões), salvar como lead, gerar proposta comercial, registro manual de certidão (fluxo completo testado: status → validade → observações → salvar → refletido na lista).
- **Alertas**: filtro de janela (15/30/60/90 dias) funcional, link de relatório PDF de pendências.
- **Tarefas**: criar, marcar concluída, remover (via API — ver item 7 sobre o `confirm()` nativo) — CRUD completo.
- **Relatórios**: funil de conversão, tabela de desempenho por consultor, filtro de data.
- **Painel de Mercado**: indicadores agregados, tabela de CNAEs com priorização, filtro por UF (**re-testado após o fix de SQL injection — funciona corretamente**, 9→4 empresas ao filtrar BA), sub-aba Campanhas (CRUD, vazio testado).
- **Usuários**: listagem, perfis, criar (cancelado antes de submeter por causa do achado de autofill — ver item 4), desativar.
- **Configurações/Credenciais**: listagem com valores mascarados, toggle ativo/inativo — Certificado A1 e Chave 2captcha cadastrados corretamente.
- **DTOs**: nenhuma recorrência do bug `class` vs `interface` (todos os DTOs do backend são `interface`, confirmado por grep em todo `backend/src`).
- **Segurança geral**: nenhum outro uso de SQL raw com interpolação de string encontrado (só o caso já corrigido em `painel.service.ts`); nenhum `as any`/`@ts-ignore`/catch vazio no backend.

---

## 7. Não investigado a fundo (fora do escopo desta rodada)

- `backend/src/leads/leads.service.ts` (817 linhas) — módulo de CRM/propostas revisado só por amostragem (helpers de scoring no topo do arquivo). Funcionalmente oculto no frontend (`Leads`/`Clientes` com `disabled` no nav, aguardando decisão #2 do `CLAUDE.md` sobre onde vive a base de clientes) — baixa prioridade enquanto continuar oculto.
- Testes automatizados (Vitest/Playwright E2E mencionados no `CLAUDE.md`) não foram executados nesta auditoria — só teste manual ao vivo em produção.
