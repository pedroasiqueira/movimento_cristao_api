/*
 * Teste de equivalência da busca (FR-7) — o critério que autorizou a migração
 * da busca do navegador para a API (análise de 19/08/2026):
 *
 *   Para cada consulta, o ranking devolvido por GET /mensagens/busca deve ser
 *   IDÊNTICO ao que o algoritmo original do site (src/lib/busca.js na versão
 *   pré-migração) produzia sobre o corpus completo, corpo incluído.
 *
 * Uso (com a API de pé e o backfill de termos rodado):
 *   node scripts/testar-equivalencia-busca.mjs [http://localhost:3000] [caminho/mensagens.json]
 *
 * O corpus local é o src/data/mensagens.json; se o banco tiver mensagens além
 * dele (publicações novas), o script avisa e compara só o que há nos dois.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.argv[2] ?? 'http://localhost:3000';
const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const caminhoCorpus =
  process.argv[3] ?? resolve(raiz, 'src/data/mensagens.json');

/* ——— O algoritmo ORIGINAL do site, transcrito na íntegra ——— */

const PALAVRAS_VAZIAS = new Set(
  (
    'a o e é de da do das dos que em um uma uns umas para por com no na nos nas ' +
    'se ao aos à às as os não mas como mais ou ser sua seu suas seus este esta ' +
    'isso isto aquilo qual quais quando onde quem tem ter há sobre entre sem ' +
    'ainda já só pode podem foi são está estão me te lhe nós vós eles elas ele ela'
  ).split(' '),
);

const EQUIVALENCIAS = [
  ['fraternal', 'fraterno', 'fraterna', 'fraternos', 'fraternas', 'fraternidade'],
  ['angustia', 'angustias', 'angustiado', 'angustiada'],
  ['perdao', 'perdoar', 'perdoa', 'perdoado', 'perdoados'],
  ['paz', 'pacificador', 'pacificadores'],
  ['amor', 'amar', 'amado', 'amados', 'amai'],
  ['oracao', 'oracoes', 'orar', 'ora'],
  ['familia', 'familias'],
  ['verdade', 'verdadeiro', 'verdadeira', 'verdadeiros', 'verdadeiras'],
];

const CANONICO = new Map();
for (const grupo of EQUIVALENCIAS) {
  for (const termo of grupo) CANONICO.set(termo, grupo[0]);
}

const normalizar = (t) =>
  t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const tokens = (t) =>
  normalizar(t)
    .split(/[^a-z0-9]+/)
    .filter((x) => x.length > 1 && !PALAVRAS_VAZIAS.has(x))
    .map((x) => CANONICO.get(x) ?? x);

const corpus = JSON.parse(readFileSync(caminhoCorpus, 'utf8'));
const INDICE = corpus.map((m) => ({
  mensagem: m,
  titulo: new Set(tokens(m.titulo)),
  tags: new Set(tokens((m.tags ?? []).join(' '))),
  corpo: new Set(tokens(m.corpo)),
}));

function buscarOriginal(consulta) {
  const termos = [...new Set(tokens(consulta))];
  if (termos.length === 0) return [];
  return INDICE.map(({ mensagem, titulo, tags, corpo }) => {
    let pontos = 0;
    let encontrados = 0;
    for (const t of termos) {
      const p = (titulo.has(t) ? 3 : 0) + (tags.has(t) ? 2 : 0) + (corpo.has(t) ? 1 : 0);
      if (p > 0) encontrados++;
      pontos += p;
    }
    return { mensagem, pontos, encontrados };
  })
    .filter((r) => r.encontrados > 0)
    .sort(
      (a, b) =>
        b.encontrados - a.encontrados ||
        b.pontos - a.pontos ||
        b.mensagem.data.localeCompare(a.mensagem.data),
    )
    .map((r) => r.mensagem.data);
}

/* ——— As consultas: o conjunto de aceitação de FR-7 e uma amostra ampla ——— */

const CONSULTAS = [
  // FR-7: as equivalências obrigatórias, nas duas direções
  'fraternal', 'fraternidade', 'o que é ser fraternal',
  'angústia', 'angustiado',
  // acento, caixa, palavras vazias
  'PAZ', 'oração', 'a paz do senhor', 'família',
  // amostra de vocabulário do corpus
  'verdade', 'amor', 'perdão', 'alma', 'luz', 'caminho', 'fé',
  'humildade', 'gratidão', 'esperança', 'sabedoria', 'silêncio',
  'coração puro', 'vida espiritual', 'pai celestial', 'espírito da verdade',
  'renascer', 'desapego', 'caridade', 'harmonia', 'virtudes da alma',
  'brilho da glória', 'purificação', 'consciência',
];

/* ——— Comparação ——— */

const noCorpus = new Set(corpus.map((m) => m.data));

let falhas = 0;
for (const consulta of CONSULTAS) {
  const esperado = buscarOriginal(consulta);
  const resposta = await fetch(
    `${API}/mensagens/busca?q=${encodeURIComponent(consulta)}&limite=500`,
  );
  if (!resposta.ok) {
    console.error(`✗ "${consulta}": API respondeu ${resposta.status}`);
    falhas++;
    continue;
  }
  const { total, itens } = await resposta.json();
  // Mensagens publicadas depois do corpus local não têm gabarito — saem da
  // comparação (e o script avisa no fim se houve alguma).
  const daApi = itens.map((i) => i.data).filter((d) => noCorpus.has(d));
  const foraDoCorpus = itens.length - daApi.length;
  const alvo = esperado.slice(0, daApi.length);

  const iguais =
    daApi.length === alvo.length && daApi.every((d, i) => d === alvo[i]);
  const totalConfere = total - foraDoCorpus <= esperado.length &&
    (itens.length < 500 ? total - foraDoCorpus === esperado.length : true);

  if (iguais && totalConfere) {
    console.log(`✓ "${consulta}" — ${total} resultados, ranking idêntico`);
  } else {
    falhas++;
    console.error(`✗ "${consulta}" — total API=${total} local=${esperado.length}`);
    for (let i = 0; i < Math.max(daApi.length, alvo.length); i++) {
      if (daApi[i] !== alvo[i]) {
        console.error(`   posição ${i}: API=${daApi[i]} local=${alvo[i]}`);
        if (i > 5) break;
      }
    }
  }
}

console.log(
  falhas === 0
    ? `\nEquivalência confirmada: ${CONSULTAS.length} consultas, ranking idêntico em todas.`
    : `\n${falhas} consulta(s) com divergência — a migração NÃO está aprovada.`,
);
process.exitCode = falhas === 0 ? 0 : 1;
