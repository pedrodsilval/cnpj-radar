# 05 — Automação de Certidões (Scraping)

## Decisão de produto
O módulo de certidões nasce como **gestor**, não como emissor automático. O valor imediato está em organizar, centralizar validades, alertar vencimentos e atribuir responsáveis. A automação de consulta é implementada progressivamente, certidão por certidão, conforme viabilidade técnica confirmada por testes reais.

---

## Mapa de automatização por certidão

> Atualizado em ago/2026 — status real após implementação e teste em produção (Render). Ver Decisão #5 em `CLAUDE.md` para o achado sobre bloqueio de IP.

| Certidão | Status | Estratégia implementada | Observação |
|---|---|---|---|
| **FGTS / CRF (Caixa)** | ✅ Código funcional / ⛔ bloqueado em produção | Playwright — JSF sem CAPTCHA | Testado localmente (rede brasileira): funciona 100%, retorna REGULAR + PDF + validade. Em produção (Render), o WAF Azion do portal devolve 403 para o IP do datacenter — precisa de IP brasileiro (VPS) para destravar. Não é bug de código. |
| **CND Federal (Receita + PGFN)** | ✅ Código funcional / ⛔ bloqueado por saldo | Playwright + hCaptcha resolvido via 2captcha (fallback: api_captcha local primeiro) | Portal `servicos.receitafederal.gov.br`. Fluxo: resolve captcha → `validar-contribuinte` → `Emissao` (PDF em base64). Só falta saldo na conta 2captcha do cliente (ação dele, não técnica). |
| **CNDT Trabalhista (TST)** | ✅ Implementado | Playwright, resposta de captcha normalizada para minúsculas antes de submeter | `cndt-certidao.tst.jus.br`. Depende do mesmo fluxo de captcha do CND Federal. |
| **Dívida Ativa da União** | ✅ Implementado | Reusa `consultarCndFederal` | Mesmo scraper da CND Federal — mesma dependência de saldo 2captcha. |
| **Certidão Estadual** | ✅ Implementado (por UF cadastrada) | Playwright | Testado funcionando para BA. |
| **Certidão Municipal** | ✅ Implementado (por UF/município cadastrado) | Playwright | Depende do portal do município. |
| **Inscrição Estadual (IE)** | ✅ Implementado | Playwright | — |
| **Inscrição Municipal (IM)** | ✅ Implementado | Playwright | — |

**Opção paga salva para reavaliação futura:**
- **Infosimples** — cobre CND Federal, FGTS/CRF, CNDT TST e SEFAZ estadual em todas as UFs. Cobrança por consulta com desconto por volume. Preços exigem cadastro em `infosimples.com/consultas/precos/`. Avaliar quando o volume de CNPJs monitorados justificar o custo mensal.
- **Netrin** — API específica para FGTS/CRF. Verificar cobertura e preço.

**Regra para portais não automatizáveis:** backend cria registro com status `CONSULTA_MANUAL` para o responsável agir manualmente.

**Nunca automatizável sem infraestrutura adicional:**
- e-CAC (exige Gov.BR login ou certificado A1/A3)
- Qualquer portal com reCAPTCHA v3

---

## Arquitetura de scraping

```
n8n (cron diário)
  → POST /certidoes/consultar/:cnpj   (backend)
    → CertidoesService.consultarAutomatico(cnpj)
      → Para cada tipo automatizável:
          → ScraperService.consultar(tipo, cnpj)
            → HTTP direto (CND, FGTS, TST)
            → OU Playwright (estadual, municipal)
          → Salva resultado na tabela certidoes
          → Anexa PDF se retornado
      → Para tipos não automatizáveis:
          → Marca status CONSULTA_MANUAL
    → Retorna resumo: { consultados, atualizados, manuais }
  → n8n registra em workflow_runs
```

**Regra arquitetural inegociável:** o n8n nunca acessa portais externos diretamente. Toda consulta passa pelo backend (`/certidoes/consultar/:cnpj`). O backend é o único dono dos scrapers.

---

## Implementação dos scrapers — estado real (ago/2026)

Todos os 8 tipos têm scraper implementado em `backend/src/certidoes/certidoes-scraper.service.ts`, orquestrados por `CertidoesService.consultarAutomatico()`. O que falta não é código — é infraestrutura (ver Decisão #5 em `CLAUDE.md`):

- **FGTS / CRF (Caixa)**: `consultarFgts()`. JSF sem CAPTCHA. Testado ponta a ponta funcionando (localmente, rede brasileira). Em produção, bloqueado por WAF (403 Azion) no IP do Render — resolve com IP brasileiro (VPS planejada).
- **CND Federal / Dívida Ativa da União**: `consultarCndFederal()` / `consultarCndFederalCom2captcha()`. Portal `servicos.receitafederal.gov.br`, hCaptcha resolvido via `api_captcha` (local, tentado primeiro) com fallback pago no 2captcha. Bloqueado apenas por saldo zerado na conta 2captcha do cliente.
- **CNDT Trabalhista (TST)**: `consultarCndt()`. JSF com CAPTCHA de imagem — resposta normalizada para minúsculas antes de submeter (bug já corrigido). Mesma dependência de 2captcha.
- **Certidão Estadual / Municipal / Inscrição Estadual / Municipal**: `consultarCndEstadual()`, `consultarCertidaoMunicipal()`, `consultarInscricaoEstadual()`, `consultarInscricaoMunicipal()` — Playwright, seletores mapeados por UF/município conforme cadastro da empresa.

**Diagnóstico embutido no FGTS:** se o campo de inscrição não aparecer em 60s, o scraper captura `title` + trecho do `body` da página retornada e devolve isso na própria `mensagem` do resultado — evita precisar de acesso aos logs do Render pra saber o que travou (foi assim que o bloqueio Azion foi confirmado).

**2captcha:** requisições devem ser `application/x-www-form-urlencoded` (`URLSearchParams`), não JSON — a API legada do 2captcha (`/in.php`, `/res.php`) ignora corpo JSON silenciosamente e retorna erro de chave inválida mesmo com chave correta.

---

## Status atual do módulo

| Componente | Estado |
|---|---|
| Entidade `certidoes` | ✅ Implementada com enums e campos de auditoria |
| Entidade `anexos` | ✅ Implementada |
| CertidoesModule (CRUD) | ✅ Implementado |
| Rota `GET /certidoes/checklist/:cnpj` | ✅ Implementada |
| Rota `GET /certidoes/alertas` | ✅ Implementada |
| Rota `POST /certidoes/consultar/:cnpj` | ✅ Implementada — roda os 8 scrapers e salva resultado |
| ScraperService (todos os 8 tipos) | ✅ Implementado — ver ressalvas de infra acima |
| Workflow n8n cron diário | ✅ Implementado (`n8n/workflows/05-reconsulta-periodica.json`) |

---

## Extração de validade do PDF

A validade da certidão está sempre no corpo do PDF retornado pelos portais. A estratégia de extração:
1. Baixar PDF como buffer
2. Usar `pdf-parse` para extrair texto
3. Regex para capturar a data: ex. `válida até (\d{2}/\d{2}/\d{4})`
4. Converter para ISO 8601 (YYYY-MM-DD) antes de salvar

Biblioteca: `pdf-parse` (já instalada e em uso).
