# 05 — Automação de Certidões (Scraping)

## Decisão de produto
O módulo de certidões nasce como **gestor**, não como emissor automático. O valor imediato está em organizar, centralizar validades, alertar vencimentos e atribuir responsáveis. A automação de consulta é implementada progressivamente, certidão por certidão, conforme viabilidade técnica confirmada por testes reais.

---

## Mapa de automatização por certidão

> Atualizado após pesquisa e teste de portais em 10/06/2026.

| Certidão | Status gratuito | Estratégia | Observação |
|---|---|---|---|
| **FGTS / CRF (Caixa)** | ✅ Implementável | Playwright — JSF sem CAPTCHA | Portal: `consulta-crf.caixa.gov.br` |
| **CND Federal (Receita + PGFN)** | ⚠️ Investigar | Novo portal unificado lançado em 2026 | URL antiga morreu. Novo: `servicos.receitafederal.gov.br`. Testar manualmente. ConectaGov API (grátis, exige cert. digital ICP-Brasil + autorização Receita Federal) |
| **CNDT Trabalhista (TST)** | ⚠️ Experimental | Playwright + Tesseract OCR | Portal tem CAPTCHA de imagem. OCR pode funcionar para CAPTCHA simples. Sem garantia. |
| **Dívida Ativa da União** | ⚠️ Vinculada | Mesma solução da CND Federal | Cobertas pelo mesmo documento |
| **Certidão Estadual** | ❌ Manual | — | Muito fragmentado por UF |
| **Certidão Municipal** | ❌ Manual | — | Varia por cidade |
| **Inscrição Estadual (IE)** | ❌ Manual | — | BrasilAPI retorna para alguns estados |
| **Inscrição Municipal (IM)** | ❌ Manual | — | Portais municipais heterogêneos |

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

## Implementação dos scrapers (ordem de prioridade)

### Fase A — Playwright (prioridade imediata)

Instalar no backend:
```bash
npm install playwright
npx playwright install chromium --with-deps
```

**1. FGTS / CRF (Caixa) — PRIORIDADE 1**
- Portal: `https://consulta-crf.caixa.gov.br/consultacrf/pages/consultaEmpregador.jsf`
- JSF sem CAPTCHA identificado
- Precisa: session cookie + ViewState + CNPJ + UF
- Retorno: status regular/irregular na página HTML

**2. CNDT Trabalhista (TST) — PRIORIDADE 2 (experimental)**
- Portal: `https://cndt-certidao.tst.jus.br/gerarCertidao.faces`
- JSF **com** CAPTCHA de imagem simples
- Estratégia: Playwright captura screenshot do CAPTCHA → Tesseract.js OCR → resolve → submete
- Instalar: `npm install tesseract.js`
- Sem garantia — depende da dificuldade do CAPTCHA

**3. CND Federal — PENDENTE (investigação manual)**
- Portal novo em `servicos.receitafederal.gov.br` lançado em 2026
- Precisa de teste manual no browser para mapear formulário
- Alternativa gratuita de longo prazo: ConectaGov API (gratuita, exige Cert. Digital ICP-Brasil + autorização Receita Federal)
- Não implementar até URL e fluxo confirmados

### Fase B — Após validação da Fase A
- Certidão Estadual SEFAZ-BA e Municipal Salvador: Playwright, mapear seletores primeiro
- Reavaliação da Infosimples se volume justificar

### Critérios antes de produção (todos os scrapers)
- [ ] Teste com CNPJ regular — resultado correto
- [ ] Teste com CNPJ irregular — resultado correto
- [ ] Tratamento de timeout e portal indisponível
- [ ] Validade extraída e salva corretamente

---

## Status atual do módulo

| Componente | Estado |
|---|---|
| Entidade `certidoes` | ✅ Implementada com enums e campos de auditoria |
| Entidade `anexos` | ✅ Implementada |
| CertidoesModule (CRUD) | ✅ Implementado |
| Rota `GET /certidoes/checklist/:cnpj` | ✅ Implementada |
| Rota `GET /certidoes/alertas` | ✅ Implementada |
| Rota `POST /certidoes/consultar/:cnpj` | ✅ Placeholder — retorna mapa de status por tipo |
| ScraperService — Fase A (HTTP) | 🔲 Pendente |
| ScraperService — Fase B (Playwright) | 🔲 Pendente — após Fase A validada |
| Workflow n8n cron diário | 🔲 Pendente — após scraper funcional |

---

## Extração de validade do PDF

A validade da certidão está sempre no corpo do PDF retornado pelos portais. A estratégia de extração:
1. Baixar PDF como buffer
2. Usar `pdf-parse` para extrair texto
3. Regex para capturar a data: ex. `válida até (\d{2}/\d{2}/\d{4})`
4. Converter para ISO 8601 (YYYY-MM-DD) antes de salvar

Biblioteca: `npm install pdf-parse` (adicionar quando implementar scrapers).
