# Fase 4 — Painel CNAE e Mercado

**Objetivo:** transformar dados em estratégia de prospecção.
**n8n:** consolida o painel periodicamente via cron.

## Resultado esperado
A gestão decide onde prospectar e quais segmentos priorizar com base em dados reais de mercado cruzados com a carteira da Everest/FK's.

## Fluxograma de entregas

```mermaid
flowchart TD
  A["Fase 3 concluída"] --> B["Criar cadastro de CNAEs prioritários"]
  B --> C["Relacionar CNAEs a segmentos Everest/FK's"]
  C --> D["Criar modelo de dados para indicadores de mercado"]
  D --> E["Cruzar empresas consultadas com CNAE, região, porte e MEI"]
  E --> F["Cruzar com base de clientes e leads"]
  F --> G["Calcular taxa de penetração Everest/FK's por segmento"]
  G --> H["Criar campanhas sugeridas por segmento"]
  H --> I["Criar dashboard por CNAE e região"]
  I --> J["Expandir n8n para consolidação periódica do painel"]
  J --> K["Workflow agendado consolida dados via API do backend"]
  K --> L["Atualizar indicadores do dashboard"]
  L --> M["Fase 4 concluída"]
```

## Como a consulta individual alimenta o painel
Ao consultar uma empresa, o sistema identifica o CNAE e responde internamente:

- Esse CNAE está na lista de segmentos monitorados?
- Quantas empresas desse CNAE existem na cidade/UF?
- Quantas abriram recentemente?
- Quantas são MEI?
- Quantas já são clientes Everest/FK's?
- Qual é a taxa de penetração da Everest nesse segmento?
- Há campanha ativa para esse CNAE?

A consulta individual vira uma peça dentro da inteligência de mercado.

## Indicadores do painel
- Volume de empresas por CNAE e região
- Empresas abertas por período (últimos 3/6/12 meses)
- MEI vs. não-MEI por segmento
- Clientes Everest/FK's por CNAE
- Taxa de penetração por segmento
- Leads prioritários por CNAE
- Campanhas ativas por segmento

## Exemplo de insight gerado
```
Campanha: Clínicas odontológicas em Salvador
CNAE: 8630-5/04
Empresas abertas nos últimos 12 meses: 320
MEIs: 80 | Não MEIs: 240
Clientes Everest/FK's: 12
Leads prioritários: 65
Oferta sugerida: Contabilidade especializada + planejamento tributário
```

## Visão do fluxo estratégico
```
Consulta CNPJ → Identifica CNAE → Cruza com painel de mercado
→ Cruza com base de clientes → Gera oportunidade comercial
→ Alimenta dashboard estratégico
```
