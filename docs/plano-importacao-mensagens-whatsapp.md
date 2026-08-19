# Plano de implementação — importação das mensagens da exportação do WhatsApp

> Documento de referência produzido a partir da análise de 18–19/08/2026.
> **Rev. 2 (19/08/2026):** revisado após verificação em profundidade (dois agentes: um
> conferiu o plano contra o código dos dois repositórios; outro caçou casos-limite no
> `.txt`). Correções importantes estão marcadas com **[REV2]**.
> Objetivo: retomar a implementação sem refazer a análise. **Nada aqui foi implementado ainda.**

---

## 1. Contexto e objetivo

**Problema.** O corpus de mensagens do Movimento Cristão no banco vem hoje de um dump
copiado manualmente do WhatsApp (`dados-brutos/core.json`), cobrindo apenas
**01/06/2026 → 15/08/2026** (65 mensagens) **[REV2: era "04/08" na rev. 1 — o corpus real
vai até 15/08/2026: jun 25, jul 27, ago 13]**. Existe agora uma **exportação oficial
completa** da conversa com Maria De Fátima (arquivo `.zip` gerado pelo WhatsApp, contendo
um `.txt`), cobrindo **21/06/2023 → 18/08/2026**, com ~996 mensagens assinadas do
Movimento Cristão misturadas a conversas pessoais, mídias e ligações.

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
| `dados-brutos/core.json` | **Não é JSON** — é texto puro, dump copiado manualmente do WhatsApp no formato `[dd/mm, hh:mm] Maria De Fátima: *TÍTULO*`. Não tem ano (o parser fixa `ANO = 2026`). É a "fonte única" declarada do corpus atual. 66 cabeçalhos → 65 mensagens (1 em `DESCARTAR`). |
| `src/data/mensagens.json` | Fonte estruturada e versionada: 65 mensagens (01/06 → 15/08/2026). Lida pelo seed. |
| `../movimento_cristao/src/data/mensagens.json` | **Cópia idêntica** (verificada por hash) empacotada no site como reserva/fallback. As duas cópias precisam mudar juntas — o parser grava ambas. |

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
- **Herda tags** do `mensagens.json` anterior por chave (data, título normalizado).
  **[REV2]** Detalhe sutil: para mensagens em `REMAPEAR`, a busca de tags usa a **data já
  remapeada** (destino), não a original — inócuo para o histórico (sem tags), mas bom saber.
- Aplica decisões editoriais registradas em código: `DESCARTAR` (retransmissões) e
  `REMAPEAR` (mover mensagem para dia vago **não-domingo** — ver decisão 0.4).
- **Valida 1 mensagem/dia** — aborta com erro **antes de gravar** qualquer cópia
  (validação falha não corrompe os JSONs). Lê o JSON anterior antes de sobrescrever.
- Grava as duas cópias do JSON (API + site).
- Aceita múltiplos dumps por argumento: `python3 scripts/reconstruir_mensagens.py dump1 dump2...`
  (default: `dados-brutos/core.json`).

**`src/scripts/seed.ts`** (`npm run seed`) — lê `src/data/mensagens.json` (ou caminho por
argumento) e faz **upsert por `data`** (`updateOne` + `{upsert: true}`) → **idempotente**:
rodar de novo atualiza, não duplica. Também semeia admin (exige `ADMIN_EMAIL`/`ADMIN_PASSWORD`
no `.env` — **o seed aborta sem eles**) e músicas. `$setOnInsert: { publicarEm: null }` —
mensagem semeada nasce publicada; re-seed não mexe em `publicarEm` de docs existentes.

> **[REV2] Atenção — o seed NÃO roda os validators do schema.** `updateOne` com upsert não
> executa `required`/`match` do Mongoose por padrão (só o índice `unique` do Mongo e o setter
> de tags valem). Uma data malformada ou corpo vazio no JSON entraria no banco sem erro.
> **O parser Python é o único gate de formato** — por isso a revisão do diff (Etapa 6) é
> obrigatória, e vale acrescentar uma validação de sanidade no próprio parser (regex da data,
> título/corpo não vazios) antes de gravar.

> **[REV2] README desatualizado:** `README.md` diz que o seed lê `../mensagens.json` e o
> `musicas.json` do repositório irmão — o código real lê `src/data/` da própria API.
> Não seguir o README nesse ponto (opcional: corrigi-lo junto da implementação).

### Schema do banco (`src/mensagens/mensagens.model.ts`)

- `data: string` — `YYYY-MM-DD`, **`unique: true` → UMA mensagem por dia**. A data é o
  endereço público da mensagem no site (FR-3). **Não existe DELETE** em rota nenhuma;
  endereços publicados são permanentes; consertar é PATCH.
- `titulo`, `corpo` obrigatórios; `assinatura`/`proveniencia`/`canal` opcionais (null).
- `tags: string[]` — setter normaliza (trim, lowercase, dedup).
- `publicarEm: Date | null` — null = publicada; futura = agendada.
- DTOs (`create/update-mensagem.dto.ts`) só valem para POST/PATCH via API, não para o seed.

### [REV2] Contratos do frontend que a importação toca

- `movimento_cristao/src/lib/interpretarMensagem.js` declara **espelhar as regras do
  `reconstruir_mensagens.py`** ("mudou lá, muda aqui") — é o parser usado no formulário
  admin ao colar uma mensagem. Ao estender o parser Python (assinatura no fim, novos
  rodapés), decidir explicitamente: atualizar o espelho JS ou registrar que o admin só
  cola mensagens no layout atual (impacto prático baixo, mas a decisão deve ficar escrita).
- `movimento_cristao/src/lib/mensagens.js` faz `import` **estático** do `mensagens.json` →
  o JSON inteiro entra no **chunk de entrada** do Vite. Ver §9-bis (impacto de tamanho).
- O site usa rota `/mensagem/:data` (singular); a API, `/mensagens/:data`.
- `encontros.js`/`busca.js`: sem suposições sobre datas das mensagens; busca é client-side
  com índice por mensagem — escala OK para ~1.000 itens. Nenhuma mudança necessária.

---

## 3. Estrutura da exportação do WhatsApp

### Arquivos

- **`.zip`**: exportação oficial do WhatsApp ("Exportar conversa" sem mídia). Contém um único
  arquivo: `Conversa do WhatsApp com Maria De Fátima.txt` (1.965.207 bytes).
- **`.txt`**: o mesmo conteúdo extraído. **Byte a byte idêntico ao de dentro do zip** — tanto
  faz partir de um ou de outro; o mais simples é versionar o `.txt` em `dados-brutos/`.
- UTF-8 válido, acentuação correta, 23.503 linhas (+ `\n` final — split ingênuo gera uma
  linha fantasma vazia no fim).

### Formato das linhas (≠ do core.json!)

```
21/06/2023 16:12 - Maria De Fátima: O BRILHO DA VERDADE. Não se adentra...
```

- Padrão: `dd/mm/aaaa hh:mm - Remetente: conteúdo` — **com ano**, separador ` - `,
  **sem colchetes** (o `core.json` usa `[dd/mm, hh:mm]`, sem ano). O regex atual NÃO casa
  com este formato.
- **Mensagens multilinhas**: linhas de continuação **não** repetem o cabeçalho de data.
- Precisão de horário: minuto (sem segundos). Suficiente.

### [REV2] Boas notícias confirmadas pela verificação profunda

- **Zero falsos cabeçalhos**: nenhuma linha de corpo começa com (nem contém) o padrão
  `dd/mm/aaaa hh:mm - `. O regex estrito casa exatamente as 1.192 mensagens — o
  agrupamento multilinha é 100% seguro.
- **Zero caracteres invisíveis**: sem BOM, sem U+200E/U+200F (marcas direcionais), sem
  NBSP/NNBSP/ZWSP, sem `\r`, sem TAB. Export Android clássico — não precisa sanitizar
  para casar o cabeçalho. (Aspas curvas `“”‘’` abundam **no corpo** e uma mensagem até
  **começa** com aspa antes do asterisco — afeta detecção de título, não o cabeçalho.)

### Números levantados

| Métrica | Valor |
|---|---|
| Mensagens totais (cabeçalhos) | 1.192 |
| Remetentes | Maria De Fátima (1.183), Pedro Alexandre (8), 1 linha de sistema **sem remetente** (aviso de criptografia, linha 1) |
| Mensagens assinadas do Movimento Cristão | **~996–998** (ver "atípicas" abaixo) |
| Por ano (assinadas) | 2023: 195 · 2024: 372 · 2025: 378 · 2026: 247 |
| Período | 21/06/2023 → 18/08/2026 |
| **Dias com MAIS de uma mensagem assinada** | **42** ⚠ (lista completa no §4-bis; 2 dias com 3 msgs, 1 dia com 4) |
| Mensagens com texto **vazio** após o `: ` | 4 (18/10/2024, 03/01/2026, 04/01/2026, 18/07/2026) — regex que exija conteúdo falha nelas |
| Mensagens com `: ` extra no corpo (títulos com dois-pontos, URLs) | 10 — **split do remetente só no primeiro `": "`** |

### [REV2] CORREÇÃO — "multi-ensinamento" NÃO existe

A rev. 1 supunha mensagens com 2+ ensinamentos na mesma bolha (1.348 assinaturas ÷ 996
mensagens). A verificação provou o contrário: **373 bolhas têm a assinatura 2 vezes
(1 tem 3), todas de 18/04/2025 em diante, e todas são UM único ensinamento** — é o layout
das eras C/D (assinatura após o título **e** no fim; ver tabela abaixo). Nenhuma bolha tem
dois títulos ou dois fechos "Medite e pense nisto.". Consequências:

- **Não é preciso split intra-bolha** (decisão editorial da rev. 1 eliminada);
- Contar "ensinamentos" por ocorrência da assinatura **superestima em ~374** — contar por
  bolha (mensagem);
- O extrator deve **remover a assinatura duplicada** (topo + fim) sem duplicá-la no corpo —
  o loop de rodapé atual já faz algo análogo para o core.json.

### [REV2] Evolução do layout por período (4 eras — datas de transição verificadas)

| Era | Período | Título | Assinatura | Rodapés |
|---|---|---|---|---|
| A | 21/06/2023 → 21/03/2025 | CAIXA-ALTA **inline**, `TÍTULO. corpo no mesmo parágrafo` | só no **fim**, geralmente `(Arca … – Natal/RN – Brasil)` entre parênteses | nenhum; fecho "Medite e pense nisto." |
| B | 22/03/2025 → 29/04/2025 | linha própria entre `*asteriscos*` | ainda só no fim | nenhum |
| C | 30/04/2025 → ~28/02/2026 | `*CAIXA-ALTA*` | **DUPLA**: linha 2 = `Leitura Pública – Arca …` (215 msgs) + parêntese no fim | proveniência surge aos poucos: "canal" 1ª em 29/12/2025; "Espírito Santo" (8 msgs, dez/25–jan/26); "Espírito da Verdade" desde 07/01/2026 (114) |
| D | ~mar/2026 → 18/08/2026 | `*CAIXA-ALTA*` | linha 2 = `_Arca da Sagrada Aliança – …_` em itálico + fim | "instrumento desta mensagem" (25 msgs, mar–abr/26); citação `João 16:12-14` desde 22/04/2026 (103); layout final desde 08/08/2026 |

- **"Medite e pense nisto." aparece em ~874 das assinadas** (todas as eras) — âncora útil de
  fim de corpo.
- **Retrocessos pontuais existem** (~8 mensagens fora do padrão da sua era: título em caixa
  mista 09/11/2025, `_*negrito+itálico*_` 03/03/2026, título com aspa inicial 12/05/2025,
  títulos com dois-pontos). O extrator não pode assumir layout homogêneo por período — usar
  detecção por características, com as eras apenas como referência de teste.

### Particularidades restantes

1. **Assinatura com 646 variantes de linha crua** (combinações de `* _ ( )`, quebras no meio
   como `– Natal/RN –* *Brasil`, travessão `–` vs hífen `-` — 6 ocorrências com hífen ASCII).
   Match somente **após normalização agressiva**: strip de `*_()"`, acentos, casefold,
   unificar `–—-`, tolerar quebra de linha interna.
2. **Ruído (contagens exatas)**: `<Mídia oculta>` ×158 (1 é do Pedro), `Mensagem apagada` ×10,
   `Ligação de voz perdida` ×1, vazias ×4, correntes/spam ×2 (17 e 24/12/2024), só-URL ×2,
   conversa pessoal ×~15. **Não existem** no arquivo: `<Mensagem editada>`, "apagada por
   você", "(arquivo anexado)", enquetes, .vcf, localização, `null`.
3. **A exportação SOBREPÕE o corpus atual até 15/08/2026** — só 16–18/08/2026 é período
   "novo" de 2026. A janela de conflito com o corpus revisado é maior do que a rev. 1 dizia.

---

## 4. Identificação das mensagens do Movimento Cristão

### Critério principal (alta precisão)

Mensagem cujo corpo (após a normalização agressiva acima) contém
**"arca da sagrada alianca" + "movimento cristao"**. Detectar por bolha (não por ocorrência).

### [REV2] Falsos positivos conhecidos do critério (excluir explicitamente)

Uma contagem mais frouxa ("Arca da Sagrada Alian*") dá 998 mensagens / 1.372 ocorrências;
as extras são menções que **não** são assinatura:

- **26/07/2026 11:41 — convite de reunião TeamLink** (291 chars): contém "Arca da Sagrada
  Aliança" mas **sem** "Natal/RN – Brasil". É a única assinada com corpo < 300 chars
  (faixa 300–699: zero; mediana das assinadas: 1.784 chars) → um corte de tamanho mínimo
  OU exigir "Natal/RN" no match elimina o caso.
- **24/05/2025 13:42 — bolha cujo TÍTULO é** `*LEITURA PÚBLICA – Arca da Sagrada Aliança –
  Movimento* *Cristão*` (anúncio de leitura, 1.993 chars) — decidir se entra no corpus
  (é conteúdo institucional, não ensinamento típico).
- Citações da Arca em texto corrido (ex.: 26/06/2025).

### [REV2] Ambíguas (ensinamento sem assinatura): apenas UMA

A rev. 1 supunha uma "minoria" difusa. A verificação quantificou: **1 única mensagem** —
**28/03/2025 11:28, `*NÃO MAIS PECAR*`** (1.501 chars, formato idêntico à era B, sem
assinatura). Decisão editorial pontual: incluir ou não. (O único outro corpo não assinado
> 300 chars é a felicitação de aniversário ao Pedro, 23/09/2025 — não é ensinamento.)

### Descarte automático

- Linha de sistema (sem `Remetente:`); mensagens vazias;
- `<Mídia oculta>`, `Mensagem apagada`, `Ligação de voz perdida` (e variantes de ligação);
- Convite TeamLink, correntes (17 e 24/12/2024), só-URL, conversa pessoal
  (tudo sem assinatura ou pego pelos filtros acima).

## 4-bis. [REV2] Os 42 dias com 2+ mensagens assinadas (lista completa para decisão)

2 dias têm **3** mensagens (02/01/2024, 17/03/2024) e 1 dia tem **4** (26/05/2026); os
demais têm 2. Os marcados "duplicata exata" resolvem-se sozinhos com dedup por corpo:

```
21/06/2023  O BRILHO DA VERDADE | A UNIDADE DA VIDA
28/06/2023  O MEDO | O PODER VIRTUOSO DA HUMILDADE E DA SIMPLICIDADE
24/07/2023  A VIDA E A CONSCIÊNCIA | A NECESSIDADE DE SER AMOR
04/08/2023  A VIDA | A ASSISTÊNCIA DIVINA
26/10/2023  AS MUDANÇAS REPENTINAS | O ORAR E VIGIAR
28/11/2023  A VIDA QUE SE DEVE PERDER… | O SER POBRE DE ESPÍRITO
02/01/2024  A COMUNHÃO DIVINA | O RECOMEÇO | O COSMO, A SUA DINÂMICA…      (3 msgs)
04/01/2024  AS GRANDES REALIZAÇÕES | O REINO DOS CÉUS E AS MORADAS CELESTIAIS
06/01/2024  A PERENIDADE DAS PALAVRAS DE JESUS | A POSSE, AS LIGAÇÕES CONSANGUÍNEAS…
12/01/2024  A IMPORTANTE E NECESSÁRIA DECISÃO | A MISSÃO DE VIDA
16/01/2024  AS VIRTUDES DE QUEM AMA | A FÉ
23/01/2024  A EXISTÊNCIA HUMANA | A VERDADEIRA VIDA
08/02/2024  A UNIÃO COM DEUS | A MEDITAÇÃO – A REFLEXÃO – A ORAÇÃO
13/02/2024  O DOMÍNIO DE SI MESMO | A VERDADE
15/02/2024  O PODER DA PALAVRA | O DIVINO AMOR DE DEUS
18/02/2024  [sem título claro: "Divindade; é esta Divindade…"] | O FILHO UNIGÊNITO DE DEUS
21/02/2024  A ENFERMIDADE | O AMOR E O PERDÃO
27/02/2024  AS DIMENSÕES SUPERIORES | O BRILHO DA LUZ CELESTIAL
07/03/2024  A CRIANÇA É A REVELAÇÃO DA PUREZA DIVINA | O EVANGELHO
10/03/2024  UM DIÁLOGO COM DEUS | O DESPERTAR PARA A VIDA ETERNA
17/03/2024  CONFIANÇA EM DEUS | AS TENTAÇÕES DO MUNDO | A FELICIDADE       (3 msgs)
10/06/2024  A FELICIDADE E A PAZ INTERIOR ×2                               (duplicata exata)
11/07/2024  QUEM SOMOS NÓS?… ×2                                            (duplicata exata)
22/08/2024  A VOLTA DO FILHO UNIGÊNITO DE DEUS | NÃO SE PODE CAMINHAR…
29/08/2024  A SALVAÇÃO | A LUZ DO MUNDO
10/09/2024  AS PROFECIAS | A RESSURREIÇÃO DOS MORTOS
05/10/2024  O RENASCER (reenvio de 04/10) | AS INSEGURANÇAS DE ALGUNS DOUTRINADORES
31/10/2024  O TORNAR-SE INSTRUMENTO DA VONTADE DIVINA | A ONIPRESENÇA DE DEUS
16/11/2024  O PROJETO DE DEUS | O AMOR E A GRATIDÃO
05/12/2024  QUANDO SE AMA O QUE FAZ | O SER FELIZ
14/12/2024  A DIVINDADE QUE SE É ×2                                        (duplicata exata)
25/12/2024  O NATAL TRANSFORMA A HUMANIDADE (reenvio de 24/12) | O AMOR SUBSISTIRÁ SEMPRE
02/01/2025  O RENASCER | O PERDÃO
24/04/2025  NO CAMINHAR DA VIDA | AS VIRTUDES DE DEUS E AS ILUSÕES DO MUNDO
17/07/2025  A VOZ DO SILÊNCIO | A MISSÃO
13/08/2025  OS QUE ASCENDERÃO À PLENITUDE CELESTIAL | A ALFORRIA DAS FORÇAS IMPERFEITAS
25/09/2025  O BRILHO DA VERDADE | O PODER TRANSFORMADOR DA ALMA
12/01/2026  A VERDADE ×2                                                   (duplicata exata)
15/01/2026  O SACRIFÍCIO DE QUEM SE TORNA AMOR (reenvio de 30/09/2025) | A MISSÃO DE VIDA
26/05/2026  MISSÃO REDENTORA ×4                                            (duplicata exata quádrupla)
10/06/2026  O REINO DOS CÉUS | A LIBERTAÇÃO DA ALMA
01/07/2026  A JUSTIÇA DIVINA | A PAZ, O AMOR E A HARMONIA INTERIOR
```

Nota: 10/06/2026 e 01/07/2026 já têm decisões no `DESCARTAR`/`REMAPEAR` atuais (vindas do
core.json) — ver o cuidado com colisão de chave no §5.

### [REV2] Duplicatas e retransmissões — dedup por CORPO, não por título

- 131 títulos se repetem (410 mensagens envolvidas; "A VIDA" e "A VERDADE" ×14 cada), mas
  **a maioria com mesmo título tem texto DIFERENTE** (retrabalho do tema) → **título igual
  NÃO é critério de dedup**.
- **Corpos exatamente duplicados (normalizado): 15 grupos**, de dois tipos:
  - duplo-envio no mesmo dia/minuto (5 casos, incl. MISSÃO REDENTORA ×4 em 26/05/2026);
  - retransmissão em dias distintos (10 casos, ex.: O RENASCER 04→05/10/2024; bloco de
    reenvios de out–dez/2025 reaparecendo em jan–fev/2026; O REINO DOS CÉUS 10/06→19/06/2026,
    que é exatamente o caso já tratado no `DESCARTAR` atual).

---

## 5. Estratégia escolhida

**Opção adotada: JSON intermediário, estendendo o pipeline existente** (a "Opção 3" da
análise — variação da Opção 1). O parser `reconstruir_mensagens.py` passa a entender
**também** o formato da exportação; todo o resto do pipeline permanece intocado.

**Por quê (contra a importação direta .txt → banco):**

- Reaproveita 100% do seed e respeita a decisão arquitetural já documentada no projeto.
- O JSON intermediário é **revisável em diff do git antes de tocar o banco** — essencial com
  ~900+ mensagens, 42 conflitos de dia e retransmissões, num sistema **sem DELETE** — e,
  **[REV2]**, essencial também porque o seed não roda validators (§2): o diff é o único
  ponto de inspeção humana.
- Mantém o contrato das **duas cópias** (a do site é empacotada como fallback).
- Idempotência e re-execução já resolvidas (upsert por data no seed).
- Herança de tags continua funcionando pelo mecanismo existente.

**Rejeitadas:** importação direta (sem artefato de revisão, duplicaria lógica, fallback do
site defasado); pipeline paralelo novo (segundo parser a manter sem necessidade).

### [REV2] Cuidado de implementação: "o corpus atual vence" não sai de graça

Se `core.json` e a exportação forem processados juntos, a mesma mensagem vinda das duas
fontes tem a **mesma chave (data, título)** — o `DESCARTAR` atual eliminaria **as duas**
cópias, não só a da exportação. A preferência por fonte precisa de lógica própria no parser:
processar os dumps **em ordem de prioridade** (core.json primeiro) e, em caso de chave
repetida entre fontes, manter a primeira ocorrência (registrando no relatório). O mesmo
mecanismo resolve as duplicatas exatas intra-exportação (manter a 1ª, descartar reenvios).

---

## 6. Fluxo de processamento proposto

```
.zip da exportação
   └─ extrair (manual, uma vez) → dados-brutos/export-whatsapp.txt  (versionado no git)
                                          │
                                          ▼
scripts/reconstruir_mensagens.py  (estendido)
   1. Detecta o formato pelo cabeçalho da linha:
        [dd/mm, hh:mm]      → formato "core" (ano fixo 2026, como hoje)
        dd/mm/aaaa hh:mm -  → formato "exportação" (ano REAL da linha)
      Cuidados [REV2]: linha 1 sem remetente; 4 mensagens vazias; split do
      remetente só no PRIMEIRO ": "; \n final do arquivo.
   2. Agrupa mensagens multilinhas (seguro: zero falsos cabeçalhos)
   3. Filtra:
        - descarta ruído (mídia ×158 / apagada ×10 / ligação / sistema / vazias ×4)
        - mantém mensagens com assinatura (normalização agressiva; detecção POR BOLHA;
          exigir "Natal/RN" ou corpo ≥ 300 chars p/ excluir o convite TeamLink)
        - relatório de exclusões notáveis: TeamLink, LEITURA PÚBLICA 24/05/2025,
          NÃO MAIS PECAR 28/03/2025 (a única ambígua — decisão editorial)
   4. Extrai titulo / corpo / assinatura / proveniencia / canal conforme a ERA:
        A: título inline "CAIXA-ALTA. corpo…" + assinatura no fim entre parênteses
        B: título *estrelado* + assinatura no fim
        C/D: título *estrelado* + assinatura DUPLA (linha 2 e fim — não duplicar no corpo)
             + rodapés de proveniência/canal (variantes novas: "Leitura Pública",
             "Espírito Santo", "instrumento", "transmitida", "autoria espiritual")
        (detecção por características, não por data; ~8 mensagens fogem do padrão da era)
   5. Normaliza emendas e marcas (funções existentes)
   6. Resolve duplicatas e conflitos:
        - dedup por CORPO normalizado (15 grupos conhecidos), nunca por título
        - preferência por fonte: core.json antes da exportação (§5)
        - DESCARTAR / REMAPEAR ampliados com as decisões do Pedro (§4-bis)
        - valida 1 mensagem/dia (aborta listando os conflitos)  ← já existe
        - [REV2] validação de sanidade: data AAAA-MM-DD, titulo/corpo não vazios
   7. Herda tags do mensagens.json anterior (já existe; histórico novo → tags: [])
   8. Grava as DUAS cópias do mensagens.json (já existe)
                                          │
                                          ▼
REVISÃO MANUAL: git diff do mensagens.json + relatório (contagens, descartes, conflitos)
                                          │
                                          ▼
npm run seed   (INTOCADO — upsert idempotente por data; exige ADMIN_EMAIL/ADMIN_PASSWORD)
                                          │
                                          ▼
MongoDB Atlas  (M0 folgado: ~3 MB p/ ~950 mensagens; seed sequencial ≪ 100 ops/s)
```

---

## 7. Plano de implementação (etapas pequenas e sequenciais)

**Etapa 0 — Decisões editoriais (ANTES de codar)** ⚠ bloqueante — **[REV2: lista revisada]**
1. **Escopo**: importar todo o histórico 2023–2026 ou só o período não coberto?
   (Lembrar: a sobreposição com o corpus atual vai até **15/08/2026**; só 16–18/08 é novo.)
2. **Os 42 dias com 2+ mensagens** (lista completa no §4-bis): manter "1/dia"
   escolhendo/remapeando. Das 42, ~6 se resolvem sozinhas com dedup por corpo; sobram
   ~36 escolhas manuais (ou uma regra tipo "fica a primeira do dia; a outra remapeia
   para o dia vago mais próximo").
3. **Retransmissões em dias distintos** (10 grupos): manter a primeira ocorrência
   (recomendado, é o precedente do `DESCARTAR` atual com O REINO DOS CÉUS)?
4. **Domingos** ⚠ novo: o corpus atual tem **zero mensagens aos domingos** — convenção
   codificada no site ("Domingo tem Mensagem em áudio", `mensagens.js`) e usada pelo
   `REMAPEAR` ("dia vago não-domingo"). O histórico 2023–2025 certamente tem mensagens
   dominicais. Decidir: importar domingos normalmente (quebra a convenção editorial) ou
   tratá-los de alguma forma? E: domingos contam como "dia vago" para remapeamentos?
5. **Período sobreposto de 2026**: qual fonte vence (recomendação: o corpus atual, já
   revisado e com tags — implementado via ordem de prioridade das fontes, §5).
6. **Casos pontuais**: incluir `NÃO MAIS PECAR` (28/03/2025, sem assinatura)? Incluir a
   bolha `LEITURA PÚBLICA` (24/05/2025)?
7. **Frontend** (ver §9-bis): aceitar o crescimento do bundle/payload por ora, ou tratar
   junto (fallback reduzido / import dinâmico / paginação da API)? Pode ser um passo
   separado DEPOIS da importação, mas a decisão de aceitar o custo deve ser consciente.

~~Multi-ensinamento~~ — **eliminada**: verificado que não existe bolha com 2+ ensinamentos.

**Etapa 1 — Preparar dados**
- Copiar o `.txt` para `dados-brutos/export-whatsapp.txt` (nome sem espaços/acentos).

**Etapa 2 — Parser: reconhecer o novo formato**
- Novo regex de cabeçalho + detecção automática de formato por linha; ano real da linha.
- Cuidados: linha de sistema, 4 vazias, split no primeiro `": "`, linha fantasma final.
- Teste de aceitação: **1.192 blocos** contados.

**Etapa 3 — Parser: filtro Movimento Cristão**
- Descarte de ruído por marcadores fixos (contagens esperadas: 158/10/1/4).
- Filtro por assinatura com normalização agressiva, POR BOLHA, com exclusão do TeamLink.
- Teste de aceitação: **~996 assinadas**; relatório lista TeamLink, LEITURA PÚBLICA e
  NÃO MAIS PECAR.

**Etapa 4 — Parser: extração de campos por era**
- Implementar os 4 layouts (§3); título até o primeiro `.` na era A; assinatura dupla nas
  eras C/D sem vazar para o corpo; rodapés novos de proveniência/canal.
- Testar com amostras de cada era + os ~8 casos fora do padrão (§3).

**Etapa 5 — Dedup e conflitos**
- Dedup por corpo normalizado; preferência por fonte (core.json primeiro).
- Ampliar `DESCARTAR`/`REMAPEAR` com as decisões da Etapa 0 até a validação 1/dia passar.
- Validação de sanidade dos campos antes de gravar (o seed não valida — §2).

**Etapa 6 — Gerar e revisar**
- Rodar o parser gerando as duas cópias; revisar `git diff` + relatório completo.
- Conferir no diff: as 65 mensagens atuais devem permanecer **intactas** (fonte prioritária).

**Etapa 7 — Semear em ambiente local primeiro**
- `.env` com `MONGODB_URI` local + `ADMIN_EMAIL`/`ADMIN_PASSWORD` (seed aborta sem eles).
- `docker compose up -d` (porta 27019) + `npm run seed`.
- Conferir rotas (`GET /mensagens`, `GET /mensagens/:data`) e o site (rota `/mensagem/:data`).

**Etapa 8 — Semear no Atlas**
- `mongoexport` de backup da collection `mensagens` ANTES.
- Trocar `MONGODB_URI` para o Atlas e rodar `npm run seed`.
- (M0/512 MB: dados < 10 MB; seed sequencial ≪ 100 ops/s; sem cota de requisições; 1–3 min.)

**Etapa 9 — [REV2] Pós-importação (registrar decisão, mesmo que fique para depois)**
- `interpretarMensagem.js`: atualizar o espelho ou documentar que o admin usa só o layout atual.
- Mitigação do bundle/payload do site (§9-bis), se decidido na Etapa 0.7.
- Opcional: corrigir o parágrafo do seed no `README.md` (§2).

**Reaproveitado sem mudanças:** `seed.ts`, `mensagens.model.ts`, service/controller/DTOs,
herança de tags, gravação das duas cópias, validação 1/dia, busca e encontros do frontend.

---

## 8. Arquivos envolvidos

| Arquivo | Ação futura | Responsabilidade |
|---|---|---|
| `scripts/reconstruir_mensagens.py` | **modificar** | Formato da exportação, filtro por assinatura, 4 eras de layout, dedup por corpo, preferência por fonte, sanidade de campos, relatório |
| `dados-brutos/export-whatsapp.txt` | **criar** (copiar o .txt) | Fonte bruta versionada do histórico 2023–2026 |
| `src/data/mensagens.json` | regenerado pelo parser | Fonte estruturada lida pelo seed |
| `../movimento_cristao/src/data/mensagens.json` | regenerado pelo parser | Cópia fallback empacotada no site |
| `src/scripts/seed.ts` | **sem mudanças** | Upsert idempotente no banco |
| `src/mensagens/mensagens.model.ts` | **sem mudanças** (salvo decisão contrária na Etapa 0.2) | Schema/validações |
| `../movimento_cristao/src/lib/interpretarMensagem.js` | **decidir** (Etapa 9) | Espelho JS das regras do parser ("mudou lá, muda aqui") |
| `README.md` | opcional | Corrigir descrição dos defaults do seed |
| `docs/plano-importacao-mensagens-whatsapp.md` | este documento | Referência do plano |

---

## 9. Validações e segurança da importação

- **Duplicidade**: dedup por corpo no parser + preferência por fonte + validação 1/dia
  (aborta antes de gravar) + upsert por `data` no seed (re-rodar nunca duplica).
  **[REV2]** Nunca deduplicar por título (títulos repetem com textos diferentes).
- **Datas**: exportação traz o ano → parse direto `dd/mm/aaaa` → `aaaa-mm-dd`. `ANO` fixo
  continua valendo só para o formato core.
- **Conversas comuns**: filtro positivo por assinatura; exclusões notáveis vão para
  relatório, não para o JSON.
- **Revisão antes do banco**: o `git diff` do JSON é **o único gate humano — e também o
  único gate de formato**, porque o seed com upsert não roda os validators do schema
  **[REV2]**. Por isso o parser ganha validação de sanidade própria (Etapa 5).
- **Re-execução**: parser determinístico; seed idempotente. Rodar tudo de novo é seguro.
- **Fora do padrão**: mensagem assinada que o extrator não estruturar → relatório de erro
  com data/trecho, nunca entra silenciosamente. (Casos conhecidos: título com aspa inicial
  12/05/2025, caixa mista 09/11/2025, `_*…*_` 03/03/2026, "Divindade; …" 18/02/2024.)
- **Logs**: contagens por etapa (blocos, assinadas, descartes por motivo, dedups, conflitos,
  remapeadas, sem tags) — com os valores esperados deste documento como referência de teste.
- **Backup**: `mongoexport` da collection `mensagens` do Atlas ANTES do seed — mitiga o
  único risco real (upsert sobrescrevendo mensagem já revisada/editada via PATCH no período
  sobreposto, que vai até 15/08/2026).

## 9-bis. [REV2] Impacto no frontend — custo que a rev. 1 não mencionava

Crescer o corpus de 65 → ~950+ mensagens não quebra nada, mas tem custo de UX real:

- `mensagens.json` é importado **estaticamente** em `src/lib/mensagens.js` → entra no chunk
  de entrada do Vite: ~186 KB → **~3 MB brutos** (~0,7–1 MB gzip) para todo visitante.
- `main.jsx` **bloqueia o primeiro render** até `carregarMensagens()` resolver, e
  `GET /mensagens` devolve **todas** as mensagens com corpo inteiro, sem paginação —
  mais ~3 MB por visita (timeout de 8 s). Payload total antes da primeira pintura: ~6 MB.
- `Acervo.jsx` renderiza o acervo inteiro sem virtualização (~1.000 cartões, ~38 meses).
- O deploy usa cache imutável de 1 ano por asset — cada regeração do JSON = bundle novo.

Mitigações possíveis (decisão na Etapa 0.7; podem vir depois da importação): fallback
empacotado reduzido (ex.: só o ano corrente) com o restante via API; `import()` dinâmico
do JSON fora do chunk de entrada; paginação/projeção no `GET /mensagens` (ex.: sem corpo
na listagem); virtualização/paginação do Acervo.

---

## 10. Checklist para amanhã

- [ ] **Decidir os 7 pontos da Etapa 0** (escopo, 42 dias, retransmissões, **domingos**,
      fonte vencedora na sobreposição até 15/08, casos pontuais, frontend)
- [ ] Copiar o `.txt` da exportação para `dados-brutos/export-whatsapp.txt`
- [ ] Estender o parser: novo regex + ano real + detecção de formato (Etapa 2 — meta: 1.192 blocos)
- [ ] Filtro por assinatura + descartes + relatório (Etapa 3 — meta: ~996 assinadas)
- [ ] Extração de campos pelas 4 eras de layout (Etapa 4)
- [ ] Dedup por corpo + preferência por fonte + `DESCARTAR`/`REMAPEAR` até a validação 1/dia
      passar + sanidade de campos (Etapa 5)
- [ ] Gerar `mensagens.json`, revisar `git diff` (as 65 atuais intactas!) + relatório (Etapa 6)
- [ ] `mongoexport` de backup da collection `mensagens` do Atlas
- [ ] Seed no Mongo local (lembrar `ADMIN_EMAIL`/`ADMIN_PASSWORD` no `.env`) + conferência no site (Etapa 7)
- [ ] Seed no Atlas (Etapa 8)
- [ ] Commit das duas cópias do JSON + parser + dado bruto
- [ ] Registrar decisão sobre `interpretarMensagem.js` e sobre a mitigação do bundle (Etapa 9)

### Pendências restantes (rev. 2)

1. As **decisões editoriais da Etapa 0** — nada de código antes delas. As três novas em
   relação à rev. 1: **domingos** (0.4), **casos pontuais** NÃO MAIS PECAR e LEITURA
   PÚBLICA (0.6) e **custo no frontend** (0.7).
2. ~~Conferir a evolução do layout~~ — **feito**: 4 eras mapeadas com datas de transição (§3).
3. ~~Multi-ensinamento~~ — **resolvido**: não existe; era a assinatura dupla das eras C/D.
4. Tags do histórico 2023–2025 nascem vazias (comportamento natural da herança) — classificar
   depois, no ritmo que preferir.
