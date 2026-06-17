# Manual de Configuração dos Workflows n8n

**Forma recomendada:** importar o arquivo JSON diretamente no n8n:
`Menu lateral → Workflows → Import from file` → selecionar o `.json` da pasta `n8n/workflows/`.

Os arquivos já têm pinos de dados de teste, conexões e configurações prontas. Basta ativar quando pronto.

**Forma alternativa (manual):** criar do zero seguindo as instruções abaixo.

Endereço do n8n em desenvolvimento: `http://localhost:5678`

---

## Workflow 1 — Pipeline Comercial

**New Workflow** → renomear para `Pipeline Comercial — Everest/FK's`

### Nó 1 — Manual Trigger
- Tipo: **Manual Trigger**
- Sem configuração. Pin de dados de teste:
```json
[{ "cnpj": "30327128000125" }]
```

### Nó 2 — Registrar Início
- Tipo: **HTTP Request** | Nome: `Registrar Início`
- Method: `POST`
- URL: `http://host.docker.internal:3000/workflow-runs`
- Send Body: ON | Body Content Type: `JSON` | Specify Body: `Using JSON`
- JSON Body:
```json
{ "workflowId": "pipeline-comercial" }
```

### Nó 3 — Consultar CNPJ
- Tipo: **HTTP Request** | Nome: `Consultar CNPJ`
- Method: `GET`
- URL (modo expressão):
```
http://host.docker.internal:3000/cnpj/{{ $('Início').first().json.cnpj }}
```

### Nó 4 — Salvar Lead
- Tipo: **HTTP Request** | Nome: `Salvar Lead`
- Method: `POST`
- URL (modo expressão):
```
http://host.docker.internal:3000/leads/{{ $('Início').first().json.cnpj }}
```
- Sem body

### Nó 5 — Buscar Proposta
- Tipo: **HTTP Request** | Nome: `Buscar Proposta`
- Method: `GET`
- URL (modo expressão):
```
http://host.docker.internal:3000/leads/{{ $('Salvar Lead').first().json.id }}/proposta
```

### Nó 6 — Concluir com Sucesso
- Tipo: **HTTP Request** | Nome: `Concluir com Sucesso`
- Method: `PATCH`
- URL (modo expressão):
```
http://host.docker.internal:3000/workflow-runs/{{ $('Registrar Início').first().json.id }}/concluir
```
- Send Body: ON | Body Content Type: `JSON` | Specify Body: `Using JSON`
- JSON Body:
```json
{ "status": "concluido" }
```

### Conexões
```
Início → Registrar Início → Consultar CNPJ → Salvar Lead → Buscar Proposta → Concluir com Sucesso
```

---

## Workflow 2 — Consulta em Lote

**New Workflow** → renomear para `Consulta em Lote — Everest/FK's`

### Nó 1 — Manual Trigger
- Pin de dados de teste:
```json
[{ "cnpjs": ["30327128000125"] }]
```

### Nó 2 — Registrar Início
- Method: `POST`
- URL: `http://host.docker.internal:3000/workflow-runs`
- JSON Body:
```json
{ "workflowId": "consulta-em-lote" }
```

### Nó 3 — Consultar Lote
- Method: `POST`
- URL: `http://host.docker.internal:3000/cnpj/lote`
- Send Body: ON | Body Content Type: `JSON` | Specify Body: `Using JSON`
- **Clicar no ícone de expressão no campo JSON** e colar:
```
={{ { "cnpjs": $('Início').first().json.cnpjs } }}
```

### Nó 4 — Concluir com Sucesso
- Method: `PATCH`
- URL (modo expressão):
```
http://host.docker.internal:3000/workflow-runs/{{ $('Registrar Início').first().json.id }}/concluir
```
- JSON Body:
```json
{ "status": "concluido" }
```

### Conexões
```
Início → Registrar Início → Consultar Lote → Concluir com Sucesso
```

---

## Workflow 3 — Cron Certidões

**Importar:** `n8n/workflows/03-cron-certidoes.json`

### Fluxo
```
Schedule Trigger (06:00 diário)
  → Registrar Início
  → Consultar Certidões Lote        ← scraping de todos os leads (timeout 10min)
      → [sucesso] Buscar Alertas    ← certidões vencendo em 30 dias
          → Concluir
      → [erro]    Registrar Erro    ← marca run como erro (timeout, falha de rede)
```

### Nós (configuração manual, se preferir)

**Nó 1 — Schedule Trigger**
- Tipo: **Schedule Trigger**
- Trigger Interval: `Custom (Cron)` · Cron: `0 6 * * *`

**Nó 2 — Registrar Início**
- Method: `POST` · URL: `http://host.docker.internal:3000/workflow-runs`
- Body JSON: `{ "workflowId": "cron-certidoes" }`

**Nó 3 — Consultar Certidões Lote**
- Method: `POST` · URL: `http://host.docker.internal:3000/certidoes/consultar-lote`
- Sem body
- **Options → Timeout: `600000`** (10 minutos — scraping com Playwright é lento)
- **Settings → On Error: `Continue (using error output)`** ← essencial para o branch de erro

**Nó 4 — Buscar Alertas**
- Method: `GET` · URL: `http://host.docker.internal:3000/certidoes/alertas?dias=30`

**Nó 5 — Concluir**
- Method: `PATCH`
- URL (expressão): `http://host.docker.internal:3000/workflow-runs/{{ $('Registrar Início').first().json.id }}/concluir`
- Body JSON: `{ "status": "concluido" }`

**Nó 6 — Registrar Erro** (conectado à saída de erro do Nó 3)
- Method: `PATCH`
- URL (expressão): mesma do Nó 5
- Body JSON: `{ "status": "erro" }`

### Quando ativar
- FGTS scraper testado ✅
- IE scraper testado ✅
- CND Federal scraper implementado (requer chave 2captcha)
- Ativar o toggle no topo do workflow quando quiser iniciar execução diária automática.

### Notas
- O resultado de `Buscar Alertas` fica no histórico de execução do n8n e na tabela `workflow_runs`. Notificações automáticas (WhatsApp/email) chegam na Fase 5.
- Para teste manual: abrir o workflow → clicar **Test workflow** (executa uma vez imediatamente).

---

## Modo expressão nos campos de URL

Para colocar expressões nas URLs: hover no campo → ícone `{}` aparece à direita → clica → digita a expressão sem o `=`.

Exemplo:
```
http://host.docker.internal:3000/leads/{{ $('Início').first().json.cnpj }}
```
