# Pesquisa — Veri (Gestão Fiscal)

**Gerado em:** 14/08/2026, por pesquisa externa (site institucional + busca web + LinkedIn) via Claude Code.
**Propósito:** este arquivo documenta o que foi levantado sobre a ferramenta comercial **Veri**, um SaaS de gestão fiscal/contábil brasileiro, para servir de referência em sessões futuras — tanto como contexto de mercado/concorrência quanto como comparação técnica com o `cnpj-radar`.

**Aviso de confiabilidade:** parte deste documento vem de conteúdo que **eu naveguei e li diretamente** (alta confiança — marcado ✅ abaixo). Outra parte vem de resumos gerados por busca web (WebSearch), que podem conter imprecisões ou até alucinação do modelo de busca — está marcada ⚠️ e deve ser tratada como pista, não fato confirmado, até verificação direta. O produto é **comercial e fechado** (sem documentação pública, API pública ou página de preços aberta) — não existe "manual" para carregar; este documento é a melhor aproximação possível a partir de material público de marketing.

---

## 1. O que é (✅ verificado diretamente no site)

**Veri — Gestão Fiscal** (`https://veri.com.br`) é uma plataforma SaaS brasileira voltada para **escritórios de contabilidade**, focada em automatizar o acompanhamento fiscal de carteiras de clientes (múltiplos CNPJs). Posiciona-se como **"Homologados pela Receita Federal"** e "**Líder em monitoramento de pendências e obrigações fiscais**".

Em uma frase: é essencialmente o que o módulo de **certidões + painel de mercado** do `cnpj-radar` está tentando se tornar, só que já maduro, comercial, e (segundo material de marketing) com integração oficial em vez de scraping.

---

## 2. Funcionalidades (✅ extraído do conteúdo real da landing page)

| Funcionalidade | Descrição (como o site descreve) |
|---|---|
| **Raio-X fiscal por CNPJ** | "Com apenas um CNPJ, tenha um raio-x completo das pendências fiscais" — mapeamento instantâneo de débitos federais, estaduais e municipais antes de aceitar um cliente novo. Usado como demonstração de venda ("Raio-X Fiscal" ao vivo). |
| **Dashboards inteligentes** | Painéis com indicadores de risco, oportunidades e performance da carteira "sem depender de planilhas". |
| **Monitoramento de DCTFWeb** | Acompanhamento em tempo real de entregas e pendências da DCTFWeb, para evitar multas por atraso/inconsistência — inclui controle de obrigações previdenciárias. |
| **Score de risco fiscal por cliente** | Classificação automática das empresas da carteira por nível de risco/"saúde fiscal", pra priorizar quem precisa de atenção. |
| **Certidões (CNDs) automatizadas** | "Monitoramento automático em mais de 30 portais", emissão e controle centralizado, alertas antes de vencimento — este é o ponto de comparação mais direto com o módulo de certidões do `cnpj-radar` (que hoje cobre 8 tipos, com automação real só parcial). |
| **App mobile / acesso remoto** | "Sua empresa na palma da mão" — acompanhamento de indicadores, obrigações e faturamento de qualquer lugar. |

Funcionalidades adicionais mencionadas (⚠️ via busca, não confirmadas na página principal):
- Emissão/monitoramento de guias DAS (inclusive MEI), evitando pagamento em duplicidade ou omissão.
- Controle de documentos genérico (tipo, data de emissão/validade, prazo de renovação, alertas).
- Recálculo automático de DAS.

---

## 3. Como tecnicamente resolve o problema (⚠️ via busca — ponto mais importante pra comparar com o cnpj-radar)

Um resumo de busca (não confirmado diretamente por mim navegando) afirma que a Veri:

> "opera diretamente nos portais sem depender de acesso manual instável ao e-CAC, com protocolos de entrega gerados e armazenados automaticamente através de **conexão oficial Serpro autorizada pela Receita Federal, sem riscos de web scraping**."

Se isso for preciso, é a diferença arquitetural mais relevante frente ao `cnpj-radar`: a Veri usaria a **API Integra Contador (Serpro)** — um canal oficial, pago, com autorização da Receita Federal — em vez de Playwright/scraping de portais como o `cnpj-radar` faz hoje. Isso explicaria por que a Veri não sofre dos problemas que travaram o `cnpj-radar` nesta sessão (bloqueio de IP de datacenter pelo WAF da Caixa no FGTS, dependência de 2captcha pra hCaptcha no CND Federal) — a Integra Contador é uma API server-to-server oficial, não um formulário web pensado pra humano.

**Isso é uma pista de arquitetura, não uma confirmação técnica** — vale investigar a API Integra Contador do Serpro como alternativa de longo prazo para o `cnpj-radar` caso a automação via scraping continue instável mesmo após a migração pra VPS (ver `docs/pendencias-tecnicas.md`, seção 2.1). A API Integra Contador é paga e exige credenciamento junto ao Serpro/Receita Federal — não é gratuita nem instantânea de habilitar, mas é o caminho "profissional" que uma ferramenta madura como a Veri aparentemente usa.

---

## 4. Modelo de acesso e arquitetura (✅ parcialmente verificado)

- **Multi-tenant por subdomínio**: cada escritório cliente parece ter seu próprio subdomínio de login (ex.: `frcontabil.veri.com.br/login`, `contas.veri.com.br`, `merca.veri.com.br/painel` — encontrados via busca, não eram meu alvo de pesquisa e não foram acessados). Não tentei entrar em nenhum — são instâncias privadas de clientes reais, sem relação com esta pesquisa.
- **Site institucional único** (`veri.com.br`) é uma landing page de vendas — sem portal de documentação pública, sem página de preços aberta, sem cadastro self-service visível. O único CTA é "Teste Gratuito", que leva a um formulário de contato (`#formcontato`) — modelo comercial é **sales-led** (fala com um vendedor antes de ver o produto).
- Uma página específica sobre e-CAC (`lp.veri.com.br/ecac/`) existe mas **estava com erro de SSL no momento desta pesquisa** (`TLSV1_ALERT_INTERNAL_ERROR`) — não consegui acessar o conteúdo. Vale tentar de novo em sessão futura.

---

## 5. Modelo de precificação (⚠️ via busca, não confirmado diretamente)

> "Veri usa um modelo SaaS escalável, onde o valor do plano é definido pelo volume de CNPJs monitorados, permitindo que tanto pequenos escritórios quanto grandes empresas Enterprise usem a ferramenta de forma justa."

Nenhum valor numérico de preço foi encontrado publicamente — nem no site, nem em buscas. Preço só é revelado no funil de vendas (formulário de contato → demonstração "Raio-X Fiscal" → proposta comercial).

---

## 6. Empresa (✅ via LinkedIn)

| Campo | Valor |
|---|---|
| Nome | Veri (Veri Soluções / Veri Sistema) |
| Fundação | 2017 |
| Sede | São Paulo, SP — Rua Luiz Seraphico Junior, 511, Conj. 81, CEP 04729-080 |
| Endereço alternativo (site) | Av. das Nações Unidas, 17007, 4º andar, Várzea de Baixo (Torre) |
| Setor | Desenvolvimento de Software |
| Tamanho | 51–200 funcionários (~125 listados no LinkedIn, 4.270 seguidores) |
| Posicionamento | "Especialista no e-CAC" |
| Contato | contato@veri.com.br |
| Redes | [LinkedIn](https://www.linkedin.com/company/veri-sistema/), [Facebook](https://www.facebook.com/GrupoVeri) |

---

## 7. Validação de mercado (✅ depoimentos reais no site)

O site lista depoimentos de escritórios de contabilidade reais e nomeados, o que dá algum peso de credibilidade (não é só marketing genérico):

- **Expressão Contábil** (Rodrigo Vitorino, Diretor) — "acompanhamento das certidões e controle de pendências otimizou muito nossa rotina operacional."
- **Contmais Assessoria Contábil** (Lethicia Secherini) — "processos que antes eram morosos, hoje são executados em segundos."
- **Logos Contabilidade** (Calebe de Brito Alencar, Sócio Administrador) — fechou contrato na primeira reunião.
- **Flecha Soluções Contábeis** (Felipe Augusto Lopes Fernandes, CEO).
- **Contas Contabilidade** (Gustavo Freitas) — destaca especificamente "a função de certidões e mapeamento das empresas."
- **Lojas Guaibim / Grupo Gaubim** (Osmar Santos) — cliente fora do nicho contábil puro (varejo), sugerindo uso também por empresas que não são escritórios de contabilidade.

---

## 8. Relevância direta para o cnpj-radar

Por que isso importa pro trabalho no `cnpj-radar` (ver `CLAUDE.md` e `docs/pendencias-tecnicas.md`):

1. **Confirma que o problema é real e vale dinheiro** — existe uma empresa de 50-200 funcionários, fundada em 2017, com clientes reais pagando por resolver exatamente o que o módulo de certidões do `cnpj-radar` tenta resolver de graça/internamente.
2. **Sugere um caminho técnico alternativo** ao scraping puro: a API Integra Contador (Serpro) — oficial, paga, mas sem os problemas de bloqueio de IP/captcha que o `cnpj-radar` enfrentou com FGTS e CND Federal. Vale avaliar como opção de médio prazo se a migração pra VPS não resolver tudo.
3. **"Raio-X fiscal" e "Score de risco por cliente"** são conceitualmente muito parecidos com o que o `Painel de Mercado` e os `Scores` (cadastral/comercial/atenção) do `cnpj-radar` já fazem — bom ponto de comparação de UX/proposta de valor caso o `cnpj-radar` avance para virar produto comercial (ver "Trajetória" no `CLAUDE.md`).
4. **Preço não é público** — se a Everest/FK's quiser avaliar Veri como alternativa "comprar vs. construir" para os gaps do `cnpj-radar` (especialmente Certidão/Inscrição Municipal fora de Salvador, e Estadual/IE fora da Bahia), o próximo passo seria pedir uma demonstração comercial diretamente — não há como estimar custo-benefício sem isso.

---

## 9. Lacunas desta pesquisa (o que não consegui verificar)

- Não tive acesso a nenhuma documentação técnica, API pública ou changelog — o produto não expõe isso publicamente.
- Não confirmei a afirmação sobre uso da API Integra Contador/Serpro além do que apareceu em resumo de busca — vale tentar validar isso diretamente (ex.: pedir pro vendedor deles, ou reler a página `/ecac/` quando o SSL for corrigido).
- Não explorei nenhuma instância de cliente (subdomínios tipo `frcontabil.veri.com.br`) — são ambientes privados, não fazia sentido tentar acessar.
- Não encontrei nenhuma reclamação pública (Reclame Aqui, reviews negativos) — pode ser que não existam indexadas, ou que a busca não tenha capturado.

## Fontes

- [Veri – Gestão Fiscal (site institucional)](https://veri.com.br/)
- [LinkedIn — Veri Soluções](https://www.linkedin.com/company/veri-sistema/)
- [Facebook — Grupo Veri](https://www.facebook.com/GrupoVeri)
- Buscas web realizadas em 14/08/2026 (resultados agregados, ver ressalvas de confiabilidade na seção introdutória)
