# Plano de implementação — importação das mensagens da exportação do WhatsApp

> Documento de referência produzido a partir da análise de 18–19/08/2026.
> Objetivo: retomar a implementação sem refazer a análise. **Nada aqui foi implementado ainda.**

---

## 1. Contexto e objetivo

**Problema.** O corpus de mensagens do Movimento Cristão no banco vem hoje de um dump
copiado manualmente do WhatsApp (`dados-brutos/core.json`), cobrindo apenas
01/06/2026 → 04/08/2026 (65 mensagens). Existe agora uma **exportação oficial completa**
da conversa com Maria De Fátima (arquivo `.zip` gerado pelo WhatsApp, contendo um `.txt`),
cobrindo **21/06/2023 → 18/08/2026**, com ~996 mensagens assinadas do Movimento Cristão
misturadas a conversas pessoais, mídias e ligações.

**O que queremos automatizar.** Ler a exportação, identificar apenas as mensagens do
Movimento Cristão, extrair a data de cada uma, transformá-las no formato do projeto e
populá-las no banco — reutilizando o pipeline que já existe.

**Como funciona hoje (resumo).**

```
dados-brutos/core.json ──▶ scripts/reconstruir_mensagens.py ──▶ mensagens.json (2 cópias) ──▶ npm run seed ──▶ MongoDB
     (dump bruto)                  (parser Python)                (fonte versionada)           (upsert por data)
```

---

## 2. Estrutura atual do projeto

### Arquivos de dados

| Arquivo | Papel |
|---|---|
| `dados-brutos/core.json` | **Não é JSON** — é texto puro, dump copiado manualmente do WhatsApp no formato `[dd/mm, hh:mm] Maria De Fátima: *TÍTULO*`. Não tem ano (o parser fixa `ANO = 2026`). É a "fonte única" declarada do corpus atual. |
| `src/data/mensagens.json` | Fonte estruturada e versionada: 65 mensagens (01/06 → 04/08/2026). Lida pelo seed. |
| `../movimento_cristao/src/data/mensagens.json` | **Cópia idêntica** empacotada no site como reserva/fallback. As duas cópias precisam mudar juntas — o parser grava ambas. |

### Formato de cada entrada do `mensagens.json`

```json
{
  "id": "2026-06-01",
  "data": "2026-06-01",
  "titulo": "A VOLTA DO CRISTO E ONDE ELE SE FARÁ PRESENTE",
  "corpo": "…texto com marcas *negrito* e _itálico_ preservadas…",
  "assinatura": "Arca da Sagrada Aliança – Movimento Cristão – Natal/RN – Brasil",
  "proveniencia": "Mensagem revelada pelo Espírito da Verdade. (João 16:12-14 • Marcos 12:29-31)",
  "canal": null,
  "tags": []
}
```

### Scripts existentes

**`scripts/reconstruir_mensagens.py`** — parser Python. Responsabilidades:

- Separa blocos pelo cabeçalho `[dd/mm, hh:mm]` (regex `CABECALHO`); monta `data` como `2026-mm-dd`.
- Extrai `titulo` (1ª linha, sem marcas), `assinatura` (linha "Arca da Sagrada Aliança…" logo
  após o título, < 120 chars), `proveniencia` (rodapé com "Espírito da Verdade" / referências
  bíblicas) e `canal` (rodapé com "Arca" + "canal"). O resto vira `corpo` **com marcas preservadas**.
- Normaliza emendas quebradas pelo WhatsApp: `*a* *b*` → `*a b*`, `_a_ _b_` → `_a b_`.
- **Herda tags** do `mensagens.json` anterior por chave (data, título normalizado) — tags são
  classificação manual do Pedro, não existem no dump.
- Aplica decisões editoriais registradas em código: `DESCARTAR` (retransmissões) e
  `REMAPEAR` (mover mensagem para dia vago).
- **Valida 1 mensagem/dia** — aborta com erro se sobrar data repetida.
- Grava as duas cópias do JSON (API + site).
- Aceita múltiplos dumps por argumento: `python3 scripts/reconstruir_mensagens.py dump1 dump2...`
  (default: `dados-brutos/core.json`).

**`src/scripts/seed.ts`** (`npm run seed`) — lê `src/data/mensagens.json` (ou caminho por
argumento) e faz **upsert por `data`** (`updateOne` + `{upsert: true}`) → **idempotente**:
rodar de novo atualiza, não duplica. Também semeia admin (de `ADMIN_EMAIL`/`ADMIN_PASSWORD`)
e músicas. `$setOnInsert: { publicarEm: null }` — mensagem semeada nasce publicada.

### Schema do banco (`src/mensagens/mensagens.model.ts`)

- `data: string` — `YYYY-MM-DD`, **`unique: true` → UMA mensagem por dia**. A data é o
  endereço público da mensagem no site (FR-3). **Não existe DELETE** em rota nenhuma;
  endereços publicados são permanentes; consertar é PATCH.
- `titulo`, `corpo` obrigatórios; `assinatura`/`proveniencia`/`canal` opcionais (null).
- `tags: string[]` — setter normaliza (trim, lowercase, dedup).
- `publicarEm: Date | null` — null = publicada; futura = agendada.

---

## 3. Estrutura da exportação do WhatsApp

### Arquivos

- **`.zip`**: exportação oficial do WhatsApp ("Exportar conversa" sem mídia). Contém um único
  arquivo: `Conversa do WhatsApp com Maria De Fátima.txt` (1.965.207 bytes).
- **`.txt`**: o mesmo conteúdo extraído. **Byte a byte idêntico ao de dentro do zip** — tanto
  faz partir de um ou de outro; o mais simples é versionar o `.txt` em `dados-brutos/`.
- UTF-8 válido, acentuação correta, 23.503 linhas.

### Formato das linhas (≠ do core.json!)

```
21/06/2023 16:12 - Maria De Fátima: O BRILHO DA VERDADE. Não se adentra...
```

- Padrão: `dd/mm/aaaa hh:mm - Remetente: conteúdo` — **com ano**, separador ` - `,
  **sem colchetes** (o `core.json` usa `[dd/mm, hh:mm]`, sem ano). O regex atual NÃO casa
  com este formato.
- **Mensagens multilinhas**: linhas de continuação **não** repetem o cabeçalho de data —
  toda linha que não casa com o padrão pertence à mensagem anterior (mesma lógica do
  `separar_blocos` atual).
- Precisão de horário: minuto (sem segundos). Suficiente.

### Números levantados

| Métrica | Valor |
|---|---|
| Mensagens totais (linhas com cabeçalho de data) | 1.192 |
| Remetentes | Maria De Fátima (1.183), Pedro Alexandre (8), 1 linha de sistema |
| Mensagens contendo a assinatura do Movimento Cristão | **996 (~84%)** |
| Ocorrências totais da assinatura | 1.348 → **algumas mensagens trazem 2+ ensinamentos juntos** |
| Por ano (assinadas) | 2023: 195 · 2024: 372 · 2025: 378 · 2026: 247 |
| Período | 21/06/2023 → 18/08/2026 |
| **Dias com MAIS de uma mensagem assinada** | **42** ⚠ (conflita com `data unique`) |

### Particularidades encontradas

1. **Assinatura com 10+ variantes de grafia**: travessão `–` vs hífen `-`, espaços faltando
   (`-Movimento`), "cristão" minúsculo, marcas de formatação no meio (`Movimento_ _Cristão`,
   `–* *Brasil`). A detecção precisa normalizar antes de comparar (o `sem_marcas` +
   `normalizar_emendas` existentes já resolvem a maior parte).
2. **Assinatura em posição variável**: no `core.json` ela vem logo após o título; na
   exportação ela costuma vir **no fim** da mensagem: `(Arca da Sagrada Aliança – Movimento
   Cristão – Natal/RN – Brasil)`, entre parênteses. Em mensagens recentes (≈2025+) o padrão
   se aproxima do core.json (título entre asteriscos etc.).
3. **Mensagens multi-ensinamento**: 1.348 assinaturas em 996 mensagens — mensagens com dois ou
   mais ensinamentos encaminhados numa mesma bolha. Decidir: dividir em registros separados
   ou tratar a mensagem como uma unidade.
4. **Retransmissões/duplicatas**: o mesmo ensinamento reenviado em datas diferentes ao longo
   dos anos; e reenvios idênticos no mesmo minuto.
5. **Ruído com marcadores fixos, fáceis de filtrar**: `<Mídia oculta>`, `Mensagem apagada`,
   `Ligação de voz perdida`, aviso de criptografia (linha de sistema, sem remetente),
   mensagens vazias, links avulsos.
6. **Conversa pessoal**: cumprimentos curtos, emojis ("Feliz Natal dona Fátima!", "Boa tarde",
   "Tudo bem?") — sem assinatura, sem título em maiúsculas, curtas.
7. **A exportação SOBREPÕE o corpus atual**: as 247 mensagens de 2026 incluem o período
   já coberto pelo `core.json`/`mensagens.json` (01/06 → 04/08/2026 + mensagens até 18/08).

---

## 4. Identificação das mensagens do Movimento Cristão

### Critério principal (alta precisão)

Mensagem cujo corpo (após normalizar marcas) contém a assinatura
**"Arca da Sagrada Aliança … Movimento Cristão"**. Regex tolerante sugerida (aplicada ao
texto já passado por `sem_marcas`):

```
Arca da Sagrada Aliança\s*[-–]\s*Movimento [Cc]ristão
```

Captura ~996 mensagens com praticamente zero falso positivo.

### Critérios complementares (zona cinzenta)

Para ensinamentos **sem** assinatura (minoria): título inicial em MAIÚSCULAS terminado em
ponto (`O BRILHO DA VERDADE.`) ou entre asteriscos (`*A PROTEÇÃO DIVINA*`) + texto longo
devocional. Recomendação: **não classificar automaticamente** — listar num relatório
"ambíguas" para decisão manual do Pedro (mesmo espírito do `DESCARTAR`/`REMAPEAR`).

### Descarte automático

- Linhas de sistema (sem `Remetente:` após o ` - `);
- `<Mídia oculta>`, `Mensagem apagada`, `Ligação de voz perdida`, `Ligação de vídeo perdida`;
- Mensagens vazias;
- Qualquer mensagem sem assinatura que não entre na zona cinzenta (conversa pessoal, links).

---

## 5. Estratégia escolhida

**Opção adotada: JSON intermediário, estendendo o pipeline existente** (a "Opção 3" da
análise — variação da Opção 1). O parser `reconstruir_mensagens.py` passa a entender
**também** o formato da exportação; todo o resto do pipeline permanece intocado.

**Por quê (contra a importação direta .txt → banco):**

- Reaproveita 100% do seed e respeita a decisão arquitetural já documentada no projeto
  ("o dump é a fonte única; o parser reconstrói o mensagens.json inteiro").
- O JSON intermediário é **revisável em diff do git antes de tocar o banco** — essencial com
  ~900+ mensagens, 42 conflitos de dia e retransmissões, num sistema **sem DELETE**.
- Mantém o contrato das **duas cópias** (a do site é empacotada como fallback); importação
  direta deixaria o fallback do site defasado e criaria duas fontes de verdade.
- Idempotência e re-execução já resolvidas (upsert por data no seed).
- Herança de tags continua funcionando pelo mecanismo existente.

**Rejeitadas:**
- *Importação direta (Opção 2)*: duplicaria lógica do seed, sem artefato de revisão, erros
  descobertos só depois de estarem num banco sem DELETE.
- *Pipeline paralelo novo (Opção 1 "pura")*: criaria um segundo parser/fluxo a manter, sendo
  que o atual já aceita múltiplos dumps por argumento.

---

## 6. Fluxo de processamento proposto

```
.zip da exportação
   └─ extrair (manual, uma vez) → dados-brutos/export-whatsapp.txt  (versionado no git)
                                          │
                                          ▼
scripts/reconstruir_mensagens.py  (estendido)
   1. Detecta o formato pelo cabeçalho da linha:
        [dd/mm, hh:mm]  → formato "core" (ano fixo 2026, como hoje)
        dd/mm/aaaa hh:mm - → formato "exportação" (ano REAL da linha)
   2. Agrupa mensagens multilinhas (linha sem cabeçalho pertence à anterior)
   3. Filtra:
        - descarta ruído (mídia/apagada/ligação/sistema/vazia)
        - mantém mensagens com assinatura do Movimento Cristão (regex tolerante)
        - lista as "ambíguas" (título devocional sem assinatura) num relatório, sem incluir
   4. Extrai titulo / corpo / assinatura / proveniencia / canal
      (assinatura pode estar no FIM da mensagem, entre parênteses — novo caso)
   5. Normaliza emendas e marcas (funções existentes)
   6. Resolve duplicatas e conflitos:
        - dedup de reenvios idênticos
        - DESCARTAR / REMAPEAR ampliados com as decisões do Pedro para 2023–2025
        - valida 1 mensagem/dia (aborta listando os conflitos)  ← já existe
   7. Herda tags do mensagens.json anterior (já existe)
   8. Grava as DUAS cópias do mensagens.json (já existe)
                                          │
                                          ▼
REVISÃO MANUAL: git diff do mensagens.json + relatório de descartadas/ambíguas/conflitos
                                          │
                                          ▼
npm run seed   (INTOCADO — upsert idempotente por data)
                                          │
                                          ▼
MongoDB Atlas  (M0 é folgado: ~3 MB de dados p/ ~996 mensagens; seed sequencial ≪ 100 ops/s)
```

---

## 7. Plano de implementação (etapas pequenas e sequenciais)

**Etapa 0 — Decisões editoriais (ANTES de codar)** ⚠ bloqueante
1. Escopo: importar todo o histórico 2023–2026 ou só o período não coberto pelo corpus atual?
2. Política para os **42 dias com 2+ mensagens**: manter "1/dia" escolhendo/remapeando
   (recomendado; o script lista os conflitos para decisão), ou relaxar o modelo
   (não recomendado — `data` é o endereço público).
3. Retransmissões plurianuais: manter a primeira ocorrência? A última? Cada caso?
4. Mensagens multi-ensinamento (uma bolha, 2+ ensinamentos): dividir ou manter juntas?
5. Conflito exportação × corpus 2026 atual: qual fonte vence no período sobreposto?
   (Sugestão: o corpus atual vence — já foi revisado e tem tags.)

**Etapa 1 — Preparar dados**
- Colocar o `.txt` da exportação em `dados-brutos/export-whatsapp.txt` (nome sem espaços/acentos).

**Etapa 2 — Parser: reconhecer o novo formato**
- Novo regex de cabeçalho da exportação + detecção automática de formato por linha.
- Usar o **ano real** nas linhas da exportação (eliminar a dependência do `ANO = 2026` fixo
  para esse formato).
- Testar isolado: contagem de blocos = 1.192.

**Etapa 3 — Parser: filtro Movimento Cristão**
- Descarte de ruído por marcadores fixos.
- Filtro por assinatura (regex tolerante sobre texto normalizado). Esperado: ~996.
- Relatório de ambíguas (candidatas sem assinatura) — só listar.

**Etapa 4 — Parser: extração de campos no novo layout**
- Assinatura no fim da mensagem (entre parênteses) além do caso atual (após o título).
- Título: 1ª linha até o primeiro `.` quando em caixa-alta, ou linha inteira entre asteriscos.
- Multi-ensinamento conforme decisão da Etapa 0.

**Etapa 5 — Dedup e conflitos**
- Dedup de reenvios idênticos (mesmo dia + mesmo título normalizado, ou corpo igual).
- Ampliar `DESCARTAR`/`REMAPEAR` com as decisões da Etapa 0.
- Rodar até a validação 1/dia passar limpa.

**Etapa 6 — Gerar e revisar**
- Rodar o parser gerando as duas cópias do `mensagens.json`.
- Revisar `git diff` + relatório (contagens por ano, descartadas, remapeadas, sem tags).

**Etapa 7 — Semear em ambiente local primeiro**
- `docker compose up -d` (Mongo local, porta 27019) + `npm run seed`.
- Conferir pelo site/rotas (`GET /mensagens`, `GET /mensagens/:data`).

**Etapa 8 — Semear no Atlas**
- Trocar `MONGODB_URI` no `.env` para o Atlas e rodar `npm run seed`.
- (M0/512 MB: dados estimados < 10 MB; seed sequencial fica bem abaixo de 100 ops/s.
  Sem cota mensal de requisições. Duração estimada: 1–3 min.)

**Reaproveitado sem mudanças:** `seed.ts`, `mensagens.model.ts`, service/controller/DTOs,
herança de tags, gravação das duas cópias, validação 1/dia, frontend inteiro.

---

## 8. Arquivos envolvidos

| Arquivo | Ação futura | Responsabilidade |
|---|---|---|
| `scripts/reconstruir_mensagens.py` | **modificar** | Suporte ao formato da exportação, filtro por assinatura, descartes, dedup, relatório de ambíguas/conflitos |
| `dados-brutos/export-whatsapp.txt` | **criar** (copiar o .txt da exportação) | Fonte bruta versionada do histórico 2023–2026 |
| `src/data/mensagens.json` | regenerado pelo parser | Fonte estruturada lida pelo seed |
| `../movimento_cristao/src/data/mensagens.json` | regenerado pelo parser | Cópia fallback empacotada no site |
| `src/scripts/seed.ts` | **sem mudanças** | Upsert idempotente no banco |
| `src/mensagens/mensagens.model.ts` | **sem mudanças** (salvo decisão contrária na Etapa 0.2) | Schema/validações |
| `docs/plano-importacao-mensagens-whatsapp.md` | este documento | Referência do plano |

Opcional, se preferir isolar: um `scripts/importar_export_whatsapp.py` que só converte a
exportação para o formato do `core.json` e alimenta o parser atual — só vale a pena se a
extensão do parser ficar grande demais; a recomendação segue sendo estender o existente.

---

## 9. Validações e segurança da importação

- **Duplicidade**: 3 camadas — dedup no parser (reenvios), validação 1/dia (aborta com lista
  de conflitos), upsert por `data` no seed (re-rodar nunca duplica).
- **Datas**: exportação traz o ano → parse direto `dd/mm/aaaa` → `aaaa-mm-dd`. Nenhuma
  inferência. Atenção apenas ao `ANO` fixo que continua valendo só para o formato core.
- **Conversas comuns**: nunca entram — filtro positivo por assinatura; ambíguas vão para
  relatório, não para o JSON.
- **Revisão antes do banco**: o JSON é versionado — `git diff` é o gate de qualidade.
  Nada vai ao banco sem passar por ele. (Crítico: o sistema não tem DELETE.)
- **Re-execução**: parser é determinístico (mesma entrada → mesmo JSON); seed é idempotente.
  Rodar tudo de novo é seguro.
- **Fora do padrão**: mensagem assinada que o extrator não conseguir estruturar (sem título
  reconhecível etc.) → relatório de erro com data/trecho, não entra silenciosamente.
- **Logs**: manter e ampliar o padrão do parser atual — imprimir contagens (blocos lidos,
  assinadas, descartadas por motivo, remapeadas, ambíguas, sem tags) ao final de cada rodada.
- **Backup**: antes do seed no Atlas, exportar a collection atual (`mongodump`/`mongoexport`)
  — barato e elimina o único risco real (upsert sobrescrevendo mensagem já revisada, dado o
  período sobreposto de 2026).

---

## 10. Checklist para amanhã

- [ ] **Decidir os 5 pontos da Etapa 0** (escopo, dias duplicados, retransmissões,
      multi-ensinamento, quem vence no período sobreposto de 2026)
- [ ] Copiar o `.txt` da exportação para `dados-brutos/export-whatsapp.txt`
- [ ] Estender o parser: novo regex + ano real + detecção de formato (Etapa 2)
- [ ] Adicionar filtro por assinatura + descartes + relatório de ambíguas (Etapa 3)
- [ ] Extração de campos no layout da exportação (Etapa 4)
- [ ] Dedup + ampliar `DESCARTAR`/`REMAPEAR` até a validação 1/dia passar (Etapa 5)
- [ ] Gerar `mensagens.json` e revisar `git diff` + relatório (Etapa 6)
- [ ] `mongoexport` de backup da collection `mensagens` do Atlas
- [ ] Seed no Mongo local + conferência no site (Etapa 7)
- [ ] Seed no Atlas (Etapa 8)
- [ ] Commit das duas cópias do JSON + parser + dado bruto

### Pendências a verificar antes de começar

1. As **decisões editoriais da Etapa 0** — nada de código antes delas.
2. Conferir se as mensagens de **2025+ na exportação** seguem o layout novo (título entre
   asteriscos, assinatura após o título) ou o antigo (título em caixa-alta com ponto,
   assinatura no fim) — a amostra analisada sugere que o layout muda ao longo do tempo, e o
   extrator precisa cobrir os dois.
3. Definir se as mensagens históricas (2023–2025) devem **herdar tags vazias** (para você
   classificar depois) — comportamento natural do mecanismo atual — ou se haverá alguma
   classificação automática mínima.
