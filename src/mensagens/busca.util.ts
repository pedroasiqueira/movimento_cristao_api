/*
 * Tokenizador canônico da busca — FR-7.
 *
 * Porte fiel de movimento_cristao/src/lib/busca.js: normalização de acento e
 * caixa, remoção de palavras vazias e equivalência de variações curadas.
 * A partir da migração da busca para a API, ESTA é a fonte única do
 * vocabulário: o site mantém apenas a queda offline (título + tags) e
 * qualquer mudança aqui precisa ser espelhada lá — teste de equivalência em
 * scripts/testar-equivalencia-busca.mjs.
 *
 * O ranking (título 3, tags 2, corpo 1; ordena por termos encontrados,
 * pontos, data) vive na aggregation de MensagensService.buscar, sobre os
 * campos termosTitulo/termosTags/termosCorpo que este módulo preenche.
 */

const PALAVRAS_VAZIAS = new Set(
  (
    'a o e é de da do das dos que em um uma uns umas para por com no na nos nas ' +
    'se ao aos à às as os não mas como mais ou ser sua seu suas seus este esta ' +
    'isso isto aquilo qual quais quando onde quem tem ter há sobre entre sem ' +
    'ainda já só pode podem foi são está estão me te lhe nós vós eles elas ele ela'
  ).split(' '),
);

/*
 * Grupos de variações que devem se encontrar. Curados à mão — o conjunto de
 * aceitação de FR-7 exige os dois primeiros pares. A lista precisa de dono
 * (nota em FR-7); enquanto não tiver, cresce aqui, com parcimônia.
 */
const EQUIVALENCIAS = [
  [
    'fraternal',
    'fraterno',
    'fraterna',
    'fraternos',
    'fraternas',
    'fraternidade',
  ],
  ['angustia', 'angustias', 'angustiado', 'angustiada'],
  ['perdao', 'perdoar', 'perdoa', 'perdoado', 'perdoados'],
  ['paz', 'pacificador', 'pacificadores'],
  ['amor', 'amar', 'amado', 'amados', 'amai'],
  ['oracao', 'oracoes', 'orar', 'ora'],
  ['familia', 'familias'],
  ['verdade', 'verdadeiro', 'verdadeira', 'verdadeiros', 'verdadeiras'],
];

const CANONICO = new Map<string, string>();
for (const grupo of EQUIVALENCIAS) {
  for (const termo of grupo) CANONICO.set(termo, grupo[0]);
}

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Texto → termos canônicos, sem repetição (só a presença pontua no ranking). */
export function tokens(texto: string): string[] {
  return [
    ...new Set(
      normalizar(texto)
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 1 && !PALAVRAS_VAZIAS.has(t))
        .map((t) => CANONICO.get(t) ?? t),
    ),
  ];
}

/** Os três campos indexados de uma mensagem, a partir do conteúdo dela. */
export function termosDe(m: {
  titulo: string;
  corpo: string;
  tags?: string[];
}) {
  return {
    termosTitulo: tokens(m.titulo),
    termosTags: tokens((m.tags ?? []).join(' ')),
    termosCorpo: tokens(m.corpo),
  };
}
