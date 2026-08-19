# Plano de implementação — importação das mensagens da exportação do WhatsApp

> Documento de referência produzido a partir da análise de 18–19/08/2026.
> **Rev. 3 (19/08/2026).** Histórico:
> - Rev. 1: análise inicial (conversa + código).
> - Rev. 2: 1ª rodada de verificação (2 agentes: plano×código e casos-limite do .txt).
> - Rev. 3: 2ª rodada (3 agentes: cético re-verificando as afirmações do zero, **dry-run**
>   com protótipo descartável das regras de extração rodado contra o .txt real, e revisão
>   operacional). Números exatos fixados, novos casos do parser, protocolo de execução.
>
> Objetivo: retomar a implementação sem refazer a análise. **Nada foi implementado ainda**
> (o protótipo do dry-run viveu só no scratchpad temporário; os repositórios estão intactos).

---

## 1. Contexto e objetivo

**Problema.** O corpus de mensagens do Movimento Cristão no banco vem hoje de um dump
copiado manualmente do WhatsApp (`dados-brutos/core.json`), cobrindo apenas
**01/06/2026 → 15/08/2026** (65 mensagens; jun 25, jul 27, ago 13). Existe agora uma
**exportação oficial completa** da conversa com Maria De Fátima (`.zip` do WhatsApp
contendo um `.txt`), cobrindo **21/06/2023 → 18/08/2026**, com **995 mensagens assinadas**
do Movimento Cristão misturadas a conversas pessoais, mídias e ligações.

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
| `dados-brutos/core.json` | **Não é JSON** — texto puro, dump copiado manualmente do WhatsApp no formato `[dd/mm, hh:mm] Maria De Fátima: *TÍTULO*`. Sem ano (o parser fixa `ANO = 2026`). 66 cabeçalhos → 65 mensagens (1 em `DESCARTAR`). |
| `src/data/mensagens.json` | Fonte estruturada e versionada: 65 mensagens (01/06 → 15/08/2026), ordenadas por data, `id` == `data`. Lida pelo seed. |
| `../movimento_cristao/src/data/mensagens.json` | **Cópia idêntica** (hash conferido) empacotada no site como reserva/fallback. As duas mudam juntas — o parser grava ambas. |

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

O `id` é emitido pelo gravador comum do parser (`id` = `data`); o seed o ignora e o site
endereça mensagens por `data` (só músicas usam `id`) — nada a fazer, só manter.
A saída já é determinística e ordenada (`sort` por data + `json.dumps` com `indent=2`).

### Scripts existentes

**`scripts/reconstruir_mensagens.py`** — parser Python:

- Separa blocos pelo cabeçalho `[dd/mm, hh:mm]`; monta `data` como `2026-mm-dd`.
- Extrai `titulo` (1ª linha, sem marcas), `assinatura` (linha "Arca da Sagrada Aliança…"
  logo após o título, < 120 chars), `proveniencia` e `canal` (rodapés); resto = `corpo`
  **com marcas preservadas**. ⚠ O teste de canal (`'Arca' in linha and 'canal' in linha`)
  **não tem limite de tamanho** — ver caso P1 no §6-bis.
- Normaliza emendas quebradas pelo WhatsApp: `*a* *b*` → `*a b*`.
- **Herda tags** do `mensagens.json` anterior por (data, título normalizado). Detalhe: para
  mensagens em `REMAPEAR`, a busca usa a **data já remapeada** (inócuo p/ histórico sem tags).
- Decisões editoriais em código: `DESCARTAR` e `REMAPEAR` (dia vago **não-domingo**).
- **Valida 1 mensagem/dia** — aborta **antes de gravar** (falha não corrompe os JSONs).
- Grava as duas cópias. Aceita múltiplos dumps posicionais
  (default: só `dados-brutos/core.json` — ver comando obrigatório no §7, Etapa 6).

**`src/scripts/seed.ts`** (`npm run seed`) — lê `src/data/mensagens.json` (ou caminho por
argumento) e faz **upsert por `data`** → idempotente. `$setOnInsert: {publicarEm: null}` —
mensagem semeada **nasce publicada**; re-seed não altera `publicarEm` de docs existentes.

> ⚠ **O seed NÃO roda os validators do schema** (`updateOne`+upsert não executa
> `required`/`match` do Mongoose; verificado que não há plugin/config global que mude isso).
> Só valem o índice `unique` e o setter de tags. **O parser Python é o único gate de
> formato** → ele ganha validação de sanidade própria (Etapa 5) e a revisão da Etapa 6 usa
> o protocolo do §7, não "ler o diff".

> ⚠ **O seed também upserta o ADMIN e as MÚSICAS**: sobrescreve a senha/nome do admin com
> `ADMIN_EMAIL`/`ADMIN_PASSWORD`/`ADMIN_NOME` do `.env` local e reverte edições de músicas
> para o `musicas.json` local. Crítico na Etapa 8 (Atlas) — usar credenciais de produção
> no `.env` e incluir `usuarios`/`musicas` no backup. (Sem `ADMIN_*`, o seed aborta.)

> **README desatualizado:** descreve caminhos default do seed que não são os do código
> (`src/data/` da própria API é o real). Não seguir o README nesse ponto; corrigir junto.

### Schema do banco (`src/mensagens/mensagens.model.ts`)

- `data: string` — `YYYY-MM-DD`, **`unique: true` → UMA mensagem por dia**; a data é o
  endereço público (`/mensagem/:data` no site, `/mensagens/:data` na API). **Sem DELETE**
  em rota nenhuma; consertar é PATCH.
- `titulo`, `corpo` obrigatórios; `assinatura`/`proveniencia`/`canal` opcionais (null).
- `tags: string[]` normalizadas no setter; `publicarEm: Date | null` (null = publicada).
- DTOs valem só para POST/PATCH via API, não para o seed.

### Contratos do frontend que a importação toca

- `movimento_cristao/src/lib/interpretarMensagem.js` **espelha as regras do parser Python**
  ("mudou lá, muda aqui") — usado no formulário admin. Decidir na Etapa 9: atualizar o
  espelho ou registrar que o admin cola só mensagens no layout atual.
- `movimento_cristao/src/lib/mensagens.js` importa o `mensagens.json` **estaticamente**
  (chunk de entrada do Vite; sem `manualChunks` no `vite.config.js`) → §9-bis.
- `main.jsx` **bloqueia o primeiro render** até `carregarMensagens()` (API, timeout 8 s);
  `GET /mensagens` devolve **tudo**, corpo inteiro, sem paginação/projeção → §9-bis.
- `encontros.js`/`busca.js`: sem suposições sobre datas; busca client-side escala OK.

---

## 3. Estrutura da exportação do WhatsApp

### Arquivos — e onde eles estão ⚠

- **`.zip`**: exportação oficial ("Exportar conversa" sem mídia), contém um único arquivo:
  `Conversa do WhatsApp com Maria De Fátima.txt`.
- **`.txt`**: o mesmo conteúdo extraído, **byte a byte idêntico** ao de dentro do zip.
- **Verificação de integridade ao copiar**: `wc -c` = **1.965.207** bytes; `wc -l` =
  **23.503** linhas; UTF-8; 1.192 cabeçalhos.
- ⚠ **O arquivo ainda NÃO está em nenhum repositório** — hoje existe só na máquina do
  Pedro (foi enviado ao chat da análise). **Primeiro passo de amanhã: localizar o arquivo
  e conferir os números acima** antes de qualquer código (Etapa 1).

### Formato das linhas (≠ do core.json!)

```
21/06/2023 16:12 - Maria De Fátima: O BRILHO DA VERDADE. Não se adentra...
```

- `dd/mm/aaaa hh:mm - Remetente: conteúdo` — **com ano**, separador ` - `, sem colchetes.
  O regex atual do parser NÃO casa com este formato.
- Linhas de continuação não repetem o cabeçalho. Horário com precisão de minuto.

### Boas notícias verificadas (duas rodadas independentes)

- **Zero falsos cabeçalhos**: nenhuma linha de corpo casa (nem contém) o padrão do
  cabeçalho, em 7 variações testadas. Agrupamento multilinha 100% seguro.
- **Zero caracteres invisíveis**: sem BOM, U+200E/U+200F, NBSP/NNBSP/ZWSP, `\r`, TAB —
  nenhum char de formato (categoria Cf) no arquivo. Não precisa sanitizar o cabeçalho.
  (Aspas curvas `“”‘’` abundam **no corpo** e uma mensagem começa com aspa — afeta título,
  não cabeçalho.)

### Números exatos (rev. 3 — medidos duas vezes, protótipo incluso)

| Métrica | Valor |
|---|---|
| Bolhas totais (cabeçalhos) | 1.192 — por ano (TOTAL, com ruído): 2023: 195 · 2024: 372 · 2025: 378 · 2026: 247 |
| Remetentes | Maria De Fátima 1.183 · Pedro Alexandre 8 · 1 linha de sistema sem remetente |
| **Assinadas (critério estrito por bolha)** | **995** — por ano: **2023: 165 · 2024: 315 · 2025: 310 · 2026: 205** |
| + typos de assinatura (ver §4) | +2 ensinamentos reais (24/10/2023 e 26/03/2025) |
| Ruído | `<Mídia oculta>` ×158 · `Mensagem apagada` ×10 · ligação ×1 · vazias ×4 · correntes ×2 · só-URL ×2 · pessoais ~15 |
| Não existem no arquivo | `<Mensagem editada>`, "apagada por você", "(arquivo anexado)", enquetes, .vcf, localização, `null` |
| Pós-dedup (16 grupos, 18 cópias removidas) | **977 mensagens** |
| Dias com 2+ assinadas | **42** antes do dedup → **34** depois (§4-bis) |
| Domingos | **22 mensagens assinadas** em domingo (2023: 5 · 2024: 11 · 2025: 3 · 2026: 3; 17 domingos distintos pós-dedup) |
| Sobreposição com o corpus | até **15/08/2026**; só 16–18/08 é novo. **64/65 mensagens do corpus aparecem na exportação no MESMO dia com corpo equivalente**; a exceção é exatamente a remapeada conhecida (A JUSTIÇA DIVINA, corpus 30/06 ← export 01/07) |

### "Multi-ensinamento" NÃO existe (confirmado 2×)

373 bolhas têm a assinatura 2+ vezes (372 com 2; 1 com 3 — citação em 26/06/2025), a
primeira em **18/04/2025**, e **todas são UM único ensinamento** (assinatura após o título
E no fim — layout das eras C/D). Zero bolhas com dois títulos ou dois fechos. Não há split
intra-bolha; contar por bolha, nunca por ocorrência da assinatura.

### Evolução do layout (4 eras — HEURÍSTICA de teste, não fronteira exata)

| Era | Período | Título | Assinatura | Rodapés |
|---|---|---|---|---|
| A | 21/06/2023 → 21/03/2025 | CAIXA-ALTA **inline** (`TÍTULO. corpo…`) | só no **fim**, geralmente `(Arca … – Natal/RN – Brasil)` | nenhum; fecho "Medite e pense nisto." e variantes |
| B | 22/03/2025 → 29/04/2025 | `*estrelado*` — ⚠ a 1ª (22/03) é **inline**: `*TÍTULO*. corpo na mesma linha` | ainda só no fim (a dupla estreia antes da era C: 18/04/2025) | nenhum |
| C | 30/04/2025 → ~28/02/2026 | `*CAIXA-ALTA*` | **DUPLA**: linha 2 `Leitura Pública – Arca…` (~214) + fim | proveniência estreia já em **12/07/2025** ("(Salmo 25, versículo 4)"); "Espírito Santo" dez/25–jan/26; "Espírito da Verdade" desde 07/01/2026 |
| D | ~mar/2026 → 18/08/2026 | `*CAIXA-ALTA*` | linha 2 `_Arca da Sagrada Aliança – …_` itálico (~195) + fim | "instrumento desta mensagem" mar–abr/26; citação `João 16:12-14` desde 22/04/2026; layout final desde 08/08/2026 |

Posições da assinatura (medidas no dry-run): pós-título ×409; fim em linha própria ×259;
**sufixo inline no fim do parágrafo ×547**; partida em 2 linhas físicas ×2. Canal ×116
(1ª em 29/12/2025). Proveniência ×194.

⚠ **Âncora "Medite e pense nisto."**: a frase EXATA aparece em só **686** bolhas (~69%) —
variantes: "nisso", "Medite sobre isso", "Medite. Reflita.". Usar como *sinal*, nunca como
âncora obrigatória de fim de corpo. (O "~874" da rev. 2 contava qualquer "medite".)

### Layout de domingo (transversal às eras — não catalogado até a rev. 2)

≥9 mensagens dominicais fogem do padrão da sua era: título caps **sem** estrelas e sem
ponto final (às vezes caixa mista), corpo multilinha, assinatura entre parênteses com
**hífen ASCII** — e, em 6 casos, **saudação "Bom dia!/Boa tarde!" + emojis DEPOIS da
assinatura** (quebra o loop de rodapés; ver P2 no §6-bis). Exemplos: 14/04/2024,
21/04/2024, 01/06/2025, 09/11/2025, 26/04/2026, 31/05/2026.

---

## 4. Identificação das mensagens do Movimento Cristão

### Critério principal (assinatura, com tolerância a typos) ⚠ atualizado na rev. 3

Após normalização agressiva (strip `*_()"` e aspas curvas, acentos NFD, casefold, unificar
`–—-`, colapsar espaços, tolerar quebra de linha no meio), detectar POR BOLHA:

```
arca da sagrada alianca   E   movimentos? crist(ao|o)
```

O `movimentos? crist(ao|o)` é obrigatório: existem **2 ensinamentos genuínos com typo na
assinatura** que o match exato perde e descartaria EM SILÊNCIO:

- 24/10/2023 14:16 — "O PORQUÊ DOS SOFRIMENTOS": `(Arca … – Movimento**s** Cristão – …)`
- 26/03/2025 12:34 — "A QUEM É DIRIGIDO O EVANGELHO": `(Arca … – Movimento **Cristo** – …)`

Há também `Brasi)` sem o "l" (06/08/2024) — não ancorar nada em "Brasil".
**NÃO** exigir "Natal/RN" no match: derrubaria o ensinamento genuíno de **05/01/2026**
("O REINO DOS CÉUS E AS MORADAS CELESTIAIS", assinado só pelo rodapé-canal, sem Natal/RN).
Para excluir o convite TeamLink (26/07/2026, ~280 chars, único "assinado" curto; faixa
300–699 chars vazia), usar **corte de tamanho: corpo ≥ 300 chars**.

Resultado esperado do filtro: **995 estritas + 2 typos = 997** candidatas.

### Casos pontuais (decisão editorial, não filtro)

- **NÃO MAIS PECAR** (28/03/2025 11:28, 1.501 chars) — o ÚNICO ensinamento sem assinatura
  nenhuma. Incluir?
- **LEITURA PÚBLICA** (24/05/2025 13:42) — bolha cujo título É a assinatura (anúncio de
  leitura). Incluir?
- **20/04/2026 13:19** — preâmbulo pessoal de condolências + `*A FÉ*` no fim da linha 1:
  título irrecuperável por regra automática → vai para o relatório de erros, decidir à mão.

### Descarte automático

Linha de sistema; vazias ×4; `<Mídia oculta>` ×158; `Mensagem apagada` ×10; ligações;
convite TeamLink; correntes (17 e 24/12/2024); só-URL; conversa pessoal (~15).

## 4-bis. Dias com 2+ mensagens assinadas

**42 dias** antes do dedup (39 com 2, 2 com 3 — 02/01/2024 e 17/03/2024 —, 1 com 4 —
26/05/2026). **O dedup por corpo resolve 8** (5 duplicatas mesmo-dia + 3 reenvios
cross-day que caíam em dia duplo: 05/10/2024, 25/12/2024, 15/01/2026) → **restam 34 dias
(36 mensagens excedentes)**. Três dos 34 são **domingos** (18/02, 10/03, 17/03/2024).

```
21/06/2023  O BRILHO DA VERDADE | A UNIDADE DA VIDA          ⚠ dia inaugural: vaga mais próxima a 6 dias
28/06/2023  O MEDO | O PODER VIRTUOSO DA HUMILDADE E DA SIMPLICIDADE
24/07/2023  A VIDA E A CONSCIÊNCIA | A NECESSIDADE DE SER AMOR
04/08/2023  A VIDA | A ASSISTÊNCIA DIVINA
26/10/2023  AS MUDANÇAS REPENTINAS | O ORAR E VIGIAR
28/11/2023  A VIDA QUE SE DEVE PERDER… | O SER POBRE DE ESPÍRITO
02/01/2024  A COMUNHÃO DIVINA | O RECOMEÇO | O COSMO…                    (3 msgs)
04/01/2024  AS GRANDES REALIZAÇÕES | O REINO DOS CÉUS E AS MORADAS CELESTIAIS
06/01/2024  A PERENIDADE DAS PALAVRAS DE JESUS | A POSSE, AS LIGAÇÕES…   ⚠ cluster jan/24 aperta as vagas
12/01/2024  A IMPORTANTE E NECESSÁRIA DECISÃO | A MISSÃO DE VIDA
16/01/2024  AS VIRTUDES DE QUEM AMA | A FÉ
23/01/2024  A EXISTÊNCIA HUMANA | A VERDADEIRA VIDA
08/02/2024  A UNIÃO COM DEUS | A MEDITAÇÃO – A REFLEXÃO – A ORAÇÃO
13/02/2024  O DOMÍNIO DE SI MESMO | A VERDADE
15/02/2024  O PODER DA PALAVRA | O DIVINO AMOR DE DEUS
18/02/2024  [sem título: "Divindade; é esta Divindade…"] | O FILHO UNIGÊNITO DE DEUS   (domingo)
21/02/2024  A ENFERMIDADE | O AMOR E O PERDÃO
27/02/2024  AS DIMENSÕES SUPERIORES | O BRILHO DA LUZ CELESTIAL
07/03/2024  A CRIANÇA É A REVELAÇÃO DA PUREZA DIVINA | O EVANGELHO
10/03/2024  UM DIÁLOGO COM DEUS | O DESPERTAR PARA A VIDA ETERNA         (domingo)
17/03/2024  CONFIANÇA EM DEUS | AS TENTAÇÕES DO MUNDO | A FELICIDADE     (3 msgs, domingo)
22/08/2024  A VOLTA DO FILHO UNIGÊNITO DE DEUS | NÃO SE PODE CAMINHAR…
29/08/2024  A SALVAÇÃO | A LUZ DO MUNDO
10/09/2024  AS PROFECIAS | A RESSURREIÇÃO DOS MORTOS
31/10/2024  O TORNAR-SE INSTRUMENTO DA VONTADE DIVINA | A ONIPRESENÇA DE DEUS
16/11/2024  O PROJETO DE DEUS | O AMOR E A GRATIDÃO
05/12/2024  QUANDO SE AMA O QUE FAZ | O SER FELIZ
02/01/2025  O RENASCER | O PERDÃO
24/04/2025  NO CAMINHAR DA VIDA | AS VIRTUDES DE DEUS E AS ILUSÕES DO MUNDO
17/07/2025  A VOZ DO SILÊNCIO | A MISSÃO
13/08/2025  OS QUE ASCENDERÃO À PLENITUDE CELESTIAL | A ALFORRIA DAS FORÇAS IMPERFEITAS
25/09/2025  O BRILHO DA VERDADE | O PODER TRANSFORMADOR DA ALMA
10/06/2026  O REINO DOS CÉUS | A LIBERTAÇÃO DA ALMA          (decisão já existe: DESCARTAR)
01/07/2026  A JUSTIÇA DIVINA | A PAZ, O AMOR E A HARMONIA…   (decisão já existe: REMAPEAR p/ 30/06)
```

(Resolvidos pelo dedup e fora da lista: 10/06/2024, 11/07/2024, 14/12/2024, 12/01/2026,
26/05/2026, 05/10/2024, 25/12/2024, 15/01/2026.)

### Duplicatas e retransmissões — dedup por CORPO EXTRAÍDO, nunca por título

- 131 títulos repetem com **textos diferentes** ("A VIDA"/"A VERDADE" ×14) → título NÃO é
  critério de dedup.
- **16 grupos de corpo idêntico** (18 cópias a remover): 5 mesmo-dia (incl. MISSÃO
  REDENTORA ×4 em 26/05/2026) + **11 retransmissões cross-day**. ⚠ O 16º grupo
  (**A ILUSÃO E A VERDADE**, 14/10/2025 → 27/05/2026) **só aparece comparando o corpo
  EXTRAÍDO** (os wrappers de era diferem; o texto bruto dá 0,954 de similaridade) —
  por isso o dedup roda DEPOIS da extração. Também fora da lista da rev. 2:
  O APRENDIZADO 21→22/05/2026. Quase-duplicatas na faixa 0,90–0,95: zero — não há
  zona cinzenta além desses grupos.
- ⚠ **Qual cópia fica é decisão, não default**: "keep-first" manteria O REINO DOS CÉUS em
  10/06/2026 — o **oposto** da decisão já commitada (DESCARTAR 10/06, ficou 19/06, que
  resolvia o conflito do dia). Precedente: escolher a cópia que cai em dia livre.
  Regra sugerida na Etapa 0.3.
- O dedup **abre vagas novas** (22/05, 27/05/2026, dias de fev/2026…) que a lista acima
  não mostra — o relatório do parser deve recalcular as vagas após o dedup.

---

## 5. Estratégia escolhida

**JSON intermediário, estendendo o pipeline existente** (parser passa a entender também o
formato da exportação; seed e schema intocados).

**Por quê (vs. importação direta):** reaproveita 100% do seed; artefato revisável ANTES de
tocar um banco **sem DELETE** (e o seed não valida — §2); mantém o contrato das duas
cópias/fallback do site; idempotência resolvida; herança de tags preservada.

**Validação da rev. 3 que sustenta a estratégia:** as fontes são textualmente equivalentes
na sobreposição (64/65 no mesmo dia, corpo contido; divergências = exatamente as 2 decisões
editoriais já tomadas) → **"o corpus atual vence" é seguro e barato**.

**Como garantir a preferência de fonte:** processar os dumps em ordem (core.json ANTES da
exportação) e, em chave repetida entre fontes, manter a primeira ocorrência, logando no
relatório. ⚠ Não usar `DESCARTAR` para isso — a chave (data, título) é igual nas duas
fontes e descartaria AMBAS as cópias (verificado no código). ⚠ A ordem dos argumentos na
invocação É a garantia — comando fixado na Etapa 6.

---

## 6. Fluxo de processamento proposto

```
.zip → extrair (1×) → dados-brutos/export-whatsapp.txt   (⚠ decisão de privacidade: Etapa 0.8)
                                   │
                                   ▼
scripts/reconstruir_mensagens.py (estendido)
  1. Detecta formato por linha: [dd/mm, hh:mm] → "core" (ANO fixo 2026)
                                dd/mm/aaaa hh:mm - → "exportação" (ano real)
     Cuidados: linha 1 sem remetente; 4 vazias; split do remetente no PRIMEIRO ": ";
     \n final do arquivo (linha fantasma).
  2. Agrupa multilinhas (seguro: zero falsos cabeçalhos).
  3. Filtra: descarta ruído (158/10/1/4…); mantém assinadas por bolha com o regex
     tolerante a typos + corte corpo ≥ 300 chars (§4). Esperado: 997 candidatas.
     Relatório: TeamLink, LEITURA PÚBLICA, NÃO MAIS PECAR, 20/04/2026.
  4. Extrai titulo/corpo/assinatura/proveniencia/canal por CARACTERÍSTICAS (eras só como
     referência de teste) — casos P1–P6 do §6-bis.
  5. Normaliza emendas e marcas (funções existentes).
  6. Dedup por CORPO EXTRAÍDO normalizado (16 grupos; regra de qual cópia fica = Etapa 0.3)
     + preferência por fonte (core primeiro) + DESCARTAR/REMAPEAR ampliados
     + validação 1/dia (aborta listando conflitos)
     + sanidade: data AAAA-MM-DD, titulo e corpo não vazios
     + leak-check: corpo final não contém "arca da sagrada" (exceções legítimas
       conhecidas: citações em 18/04/2025 e 26/06/2025).
  7. Herda tags (histórico novo → []).
  8. Grava as DUAS cópias.
  9. RELATÓRIO: contagens por etapa/ano vs. §3 (995/997, 158/10/1/4, 16 grupos, 34 dias),
     descartes por motivo, dedups com a cópia escolhida, conflitos restantes com
     PROPOSTA AUTOMÁTICA de dia vago não-domingo mais próximo (recalculado pós-dedup),
     casos de erro (títulos falhos etc.).
                                   │
                                   ▼
REVISÃO (protocolo em 3 camadas — Etapa 6, substitui "ler o diff" de 3 MB)
                                   │
                                   ▼
npm run seed  (intocado; exige ADMIN_*; Atlas = go-live imediato — Etapa 8)
                                   │
                                   ▼
MongoDB  (M0 folgado: ~3 MB p/ 977 msgs; seed sequencial ≪ 100 ops/s; 1–3 min)
```

## 6-bis. Casos do parser descobertos no dry-run (protótipo rodado contra o .txt)

Calibração do protótipo: 1.192 bolhas, 995 assinadas, ruído exato — as regras do plano
funcionam em ~98–99% das bolhas; os casos abaixo são o 1–2% que precisa de tratamento:

- **P1 — Canal precisa de limite de tamanho.** `'Arca' in linha and 'canal' in linha` SEM
  guard engole a linha única inteira de **38 mensagens da era A** cujo ensinamento contém a
  palavra "canal" (corpo ficaria VAZIO — ex.: O BRILHO DA VERDADE 21/06/2023). Guard:
  linha candidata a canal ≤ ~250 chars (rodapé real ≈ 165); idem por prudência para
  proveniência. O `eh_canal` atual herdaria o bug.
- **P2 — Saudação depois da assinatura** (layout de domingo, 6 casos): "Bom dia!/Boa
  tarde!"+emojis após a assinatura final quebra o loop de rodapés e a assinatura vaza para
  o corpo. Tratar: no rodapé, pular/extrair linhas curtas de saudação (ex.: ≤ 40 chars com
  emoji) antes de testar assinatura. Casos: 14/04/2024, 21/04/2024, 01/06/2025,
  09/11/2025, 26/04/2026, 31/05/2026.
- **P3 — Títulos fora do padrão** (7 falhas em 995 no protótipo): terminam em `?`
  (27/05/2024 "QUEM SOU EU?", 11/07/2024 "QUEM SOMOS NÓS?"), minúsculo (05/07/2024
  "O objetivo da vida."), caixa mista (09/11/2025), sem título (18/02/2024), preâmbulo
  (20/04/2026). Regra do título era A: fim da sequência em caixa-alta OU primeira
  pontuação de fim de sentença (`.?!…`) — não apenas ".". O que ainda falhar → relatório.
- **P4 — Era B inline**: a 1ª estrelada (22/03/2025) é `*TÍTULO*. corpo` na MESMA linha —
  aplicar `sem_marcas` antes do teste de caixa-alta (o fallback caps resgata).
- **P5 — Sufixo inline**: a assinatura da era A é maioritariamente **sufixo no fim do
  parágrafo único** (×547), não linha própria — remoção por regex de cauda, não por linha.
- **P6 — Assinatura partida em 2 linhas físicas**: ×2 — o match precisa tolerar `\n` interno.

**Amostras de teste obrigatórias da Etapa 4** (cobrem P1–P6 + typos): 21/06/2023,
24/10/2023 (typo "Movimentos"), 18/02/2024, 14/04/2024, 27/05/2024, 05/07/2024,
06/08/2024 ("Brasi)"), 11/07/2024, 22/03/2025, 26/03/2025 (typo "Cristo"), 18/04/2025
(citação legítima), 09/11/2025, 05/01/2026 (sem Natal/RN), 04/04/2026 (subtítulo interno),
20/04/2026, 26/05/2026 (×4), 27/05/2026 (16º grupo de dedup).

---

## 7. Plano de implementação (etapas sequenciais)

**Etapa 0 — Decisões editoriais (ANTES de codar)** ⚠ bloqueante — agora com os dados:

1. **Escopo**: todo o histórico 2023–2026 ou só o não coberto? (Sobreposição vai até
   15/08/2026 e é textualmente equivalente — importar tudo não conflita com o curado.)
2. **34 dias com 2+ mensagens (36 excedentes)**: manter "1/dia" remapeando. **Viabilidade
   verificada**: 33/34 dias têm vaga não-domingo a ≤3 dias; janela ±3 aloca 34/36
   excedentes; **±5 aloca tudo exceto o dia inaugural 21/06/2023** (1ª vaga a 6 dias) —
   e o cluster de jan/2024 consome as vagas próximas. Recomendação: relatório propõe
   destino automático (janela ±5), Pedro aprova/veta; decisão pontual só para 21/06/2023
   (e 06/01/2024 se a janela ficar em ±3).
3. **Retransmissões (11 grupos cross-day)**: qual cópia fica? Precedente (O REINO DOS
   CÉUS): ficou a cópia que caía em dia livre. Regra sugerida: manter a que resolve
   conflito de dia; empate → a primeira.
4. **Domingos**: **22 mensagens** assinadas caem em domingo (5/11/3/3 por ano). O corpus
   atual tem zero e o site declara "domingo tem mensagem em áudio". Importar domingos
   (quebra a convenção), excluí-los (resolveria também 3 dos 34 conflitos → 31) ou
   remapeá-los? E domingos valem como "dia vago" de destino?
5. **Fonte vencedora na sobreposição**: corpus atual (recomendado; equivalência textual
   verificada — implementar via ordem de dumps, §5).
6. **Casos pontuais**: NÃO MAIS PECAR (28/03/2025)? LEITURA PÚBLICA (24/05/2025)?
   Preâmbulo 20/04/2026 (título à mão)?
7. **Frontend** (§9-bis): aceitar o custo do bundle/payload por ora ou mitigar junto?
8. **Privacidade** ⚠ novo: versionar o `.txt` cru publica no GitHub a conversa pessoal
   (felicitações, ligações, mensagens do Pedro). Se o repo for/puder ser público:
   gitignore + guardar fora do repo, ou versionar uma cópia expurgada (só bolhas
   assinadas). Registrar a escolha.

**Etapa 1 — Obter e conferir o arquivo**
- Localizar o `.zip`/`.txt` na máquina (origem: exportação enviada ao chat em 19/08).
- Conferir: `wc -c` = 1.965.207 e `wc -l` = 23.503.
- Colocar como `dados-brutos/export-whatsapp.txt` (ou fora do repo, conforme 0.8).

**Etapa 2 — Parser: reconhecer o novo formato**
- Regex novo + detecção por linha; ano real; linha de sistema; vazias; primeiro `": "`.
- Aceite: **1.192 blocos**.

**Etapa 3 — Filtro**
- Ruído (aceite: 158/10/1/4); assinatura tolerante a typos + corte ≥300 chars.
- Aceite: **997 candidatas** (995 + 2 typos); relatório com os 4 casos pontuais.

**Etapa 4 — Extração por características**
- Implementar P1–P6 (§6-bis); título com `.?!…`; rodapés das 4 eras.
- Aceite: rodar as **17 amostras obrigatórias** + leak-check zerado (2 exceções) +
  zero corpos < 200 chars + ≤ ~7 títulos no relatório de erro.

**Etapa 5 — Dedup e conflitos**
- Dedup no corpo extraído (aceite: 16 grupos/18 cópias); regra da Etapa 0.3;
  preferência de fonte; `DESCARTAR`/`REMAPEAR` ampliados; sanidade de campos.
- Aceite: validação 1/dia passa; **977 − remapeios/descartes decididos** mensagens.

**Etapa 6 — Gerar e revisar (protocolo, não "ler o diff")**
- Comando fixado (a ordem garante a prioridade):
  `python3 scripts/reconstruir_mensagens.py dados-brutos/core.json dados-brutos/export-whatsapp.txt`
- Revisão em 3 camadas:
  (a) **Igualdade das 65** por script: comparar velho×novo por `data` e exigir igualdade
  profunda das 65 entradas atuais (não confiar no olho);
  (b) **Reconciliação de contagens** do relatório contra este documento (§3: 995/997,
  por ano 165/315/310/205, 16 grupos, 34 dias, 22 domingos…);
  (c) **Spot-check**: ~10 mensagens por era contra o `.txt` cru + leitura integral dos
  dias de conflito remapeados e dos casos do relatório de erro.

**Etapa 7 — Semear LOCAL primeiro**
- `cp .env.example .env` **completo** (`MONGODB_URI` local, `ADMIN_*`, **`JWT_SECRET`** —
  sem ele a API nem sobe); `npm install` nos DOIS repos; `docker compose up -d` (porta
  27019; se a auth falhar por volume antigo: apagar `./data` e subir de novo);
  `npm run seed`; `npm run start:dev`; site: `npm run dev` no repo irmão (API_URL default
  já aponta p/ localhost:3000).
- Conferir: `GET /mensagens`, `GET /mensagens/:data`, site `/mensagem/:data`, acervo.
- **Testar aqui o ciclo backup→restauração** da Etapa 8 antes de ir ao Atlas.

**Etapa 8 — Semear no ATLAS (= go-live imediato!)**
- ⚠ `.env` com **credenciais de PRODUÇÃO** (`ADMIN_EMAIL`/`ADMIN_PASSWORD`/`ADMIN_NOME`) —
  o seed sobrescreve a senha do admin e as músicas com o que estiver no `.env` local.
- Backup ANTES (Database Tools instalados à parte; IP liberado no Network Access do Atlas;
  `--uri "$MONGODB_URI"` para não expor a senha no histórico):
  `mongoexport --uri "$MONGODB_URI" -c mensagens --jsonArray -o backup-mensagens-$(date +%F).json`
  (idem `-c musicas` e `-c usuarios`).
- Restauração, se preciso: `mongoimport --uri "$MONGODB_URI" -c mensagens --mode upsert
  --upsertFields data --jsonArray backup-mensagens-*.json`. Desfazer inserções novas:
  `mongosh` + `deleteMany({data: {$nin: [datas do backup]}})` (a API não tem DELETE).
- `npm run seed` → **as ~900+ históricas ficam públicas no site imediatamente**
  (nascem com `publicarEm: null`; `GET /mensagens` devolve tudo). Conferir produção logo após.
- Depois: **redeploy do site** para atualizar o fallback empacotado (deploy usa cache de
  1 ano por asset) e merge dos branches de trabalho dos dois repos.

**Etapa 9 — Pós-importação**
- `interpretarMensagem.js`: atualizar o espelho ou documentar a limitação.
- Mitigação do bundle/payload (§9-bis), se decidido em 0.7.
- Corrigir o parágrafo do seed no `README.md`.

**Reaproveitado sem mudanças:** `seed.ts`, `mensagens.model.ts`, service/controller/DTOs,
herança de tags, gravação das duas cópias, validação 1/dia, busca/encontros do site.

---

## 8. Arquivos envolvidos

| Arquivo | Ação futura | Responsabilidade |
|---|---|---|
| `scripts/reconstruir_mensagens.py` | **modificar** | Formato da exportação; filtro tolerante a typos; extração P1–P6; dedup por corpo extraído; preferência de fonte; sanidade; leak-check; relatório com propostas de remap |
| `dados-brutos/export-whatsapp.txt` | **criar** (conforme decisão 0.8) | Fonte bruta do histórico 2023–2026 |
| `src/data/mensagens.json` + cópia do site | regenerados pelo parser | Fonte estruturada (seed) + fallback (site) |
| `src/scripts/seed.ts` | **sem mudanças** | Upsert idempotente |
| `src/mensagens/mensagens.model.ts` | **sem mudanças** | Schema/validações |
| `../movimento_cristao/src/lib/interpretarMensagem.js` | **decidir** (Etapa 9) | Espelho JS do parser |
| `README.md` | corrigir (Etapa 9) | Defaults do seed |
| `docs/plano-importacao-mensagens-whatsapp.md` | este documento | Referência |

---

## 9. Validações e segurança da importação

- **Duplicidade**: dedup por corpo extraído + preferência de fonte + validação 1/dia
  (aborta antes de gravar) + upsert por `data` no seed. Nunca deduplicar por título.
- **Datas**: exportação traz o ano → parse direto. `ANO` fixo só para o formato core.
- **Conversas comuns**: filtro positivo por assinatura (com typos); exclusões notáveis no
  relatório, nunca silenciosas — os 2 typos provaram que descarte silencioso acontece sem
  regex tolerante.
- **Gate humano**: protocolo de 3 camadas da Etapa 6 (igualdade das 65 por script +
  reconciliação de contagens + spot-check) — não "ler 3 MB de diff".
- **Gate de formato**: o parser (o seed não valida — §2): sanidade de campos + leak-check.
- **Re-execução**: parser determinístico; seed idempotente. Repetir é seguro.
- **Fora do padrão**: casos que o extrator não estruturar → relatório com data/trecho
  (casos conhecidos: P3 do §6-bis).
- **Logs**: contagens por etapa com os valores deste documento como metas de teste
  (atenção: usar a linha de assinadas 165/315/310/205, não a de bolhas totais).
- **Backup/rollback**: comandos concretos na Etapa 8; ciclo testado no local (Etapa 7);
  cobre `mensagens`, `musicas` e `usuarios` (o seed toca os três).
- **Privacidade**: decisão 0.8 antes de commitar o `.txt` cru.

## 9-bis. Impacto no frontend (custo conhecido, mitigação opcional)

- `mensagens.json` importado **estaticamente** → chunk de entrada: ~186 KB → **~3 MB**
  brutos (~0,7–1 MB gzip) para todo visitante.
- `main.jsx` bloqueia o 1º render até o `GET /mensagens` (tudo, sem paginação, timeout
  8 s) → mais ~3 MB por visita. Total ~6 MB antes da primeira pintura.
- `Acervo.jsx` renderiza tudo sem virtualização (~950 cartões, ~38 meses).
- Deploy com cache imutável de 1 ano → cada regeração = bundle novo.
- Mitigações (Etapa 0.7 / Etapa 9): fallback reduzido (ex.: ano corrente) + resto via API;
  `import()` dinâmico do JSON; paginação/projeção no `GET /mensagens` (listagem sem
  corpo); virtualização do Acervo.

---

## 10. Checklist para amanhã

- [ ] **Localizar o `.txt`/`.zip`** e conferir `wc -c` 1.965.207 / `wc -l` 23.503 (Etapa 1)
- [ ] **Decidir os 8 pontos da Etapa 0** (escopo, 34 dias/remap ±5, retransmissões,
      domingos ×22, fonte vencedora, casos pontuais, frontend, **privacidade do .txt**)
- [ ] Copiar para `dados-brutos/export-whatsapp.txt` (conforme 0.8)
- [ ] Parser: novo formato (meta: 1.192 blocos) — Etapa 2
- [ ] Filtro tolerante a typos + corte ≥300 (meta: 997) — Etapa 3
- [ ] Extração P1–P6 + 17 amostras obrigatórias + leak-check — Etapa 4
- [ ] Dedup no corpo extraído (meta: 16 grupos) + fonte + DESCARTAR/REMAPEAR até 1/dia
      passar — Etapa 5
- [ ] Gerar com o comando fixado (core.json ANTES do export) e revisar pelo protocolo de
      3 camadas (65 intactas por script!) — Etapa 6
- [ ] Local: `.env` completo (JWT_SECRET!), `npm install` ×2, docker (volume estale?),
      seed, API, site; testar backup→restauração — Etapa 7
- [ ] Atlas: `.env` com ADMIN de PRODUÇÃO; backup `mensagens`+`musicas`+`usuarios`;
      seed (= go-live imediato); conferir produção — Etapa 8
- [ ] Redeploy do site (fallback novo) + merge dos branches + commit das cópias
- [x] Etapa 9: espelho `interpretarMensagem.js` (limitação registrada), README corrigido;
      mitigação do bundle FEITA em 19/08/2026 via `import()` dinâmico do fallback em
      `mensagens.js` (entrada ~100 KB gzip; reserva de 573 KB só baixa em falha da API).
      Resta em aberto o payload do `GET /mensagens` (~2 MB/visita — §9-bis)

### Estado das pendências (rev. 3)

1. **Decisões da Etapa 0** — únicas pendências reais; todas agora têm os dados necessários
   (viabilidade do remap medida, domingos contados, equivalência da sobreposição provada).
2. ~~Evolução do layout~~ — mapeada (4 eras + layout de domingo + posições da assinatura).
3. ~~Multi-ensinamento~~ — não existe (confirmado 2×).
4. ~~Viabilidade das regras de extração~~ — **provada em dry-run**: ~99% de acerto com os
   tratamentos P1–P6; falhas residuais conhecidas e nominadas (P3).
5. Tags do histórico nascem vazias — classificar depois, no seu ritmo.
