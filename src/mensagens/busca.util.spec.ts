import { termosDe, tokens } from './busca.util';

/**
 * O tokenizador canônico da busca (FR-7). O ranking completo é conferido por
 * scripts/testar-equivalencia-busca.mjs contra o algoritmo original do site;
 * aqui ficam as propriedades que o vocabulário precisa manter.
 */
describe('tokens', () => {
  it('normaliza acento e caixa', () => {
    expect(tokens('Angústia')).toEqual(['angustia']);
    expect(tokens('PAZ')).toEqual(['paz']);
  });

  it('reduz variações curadas ao termo canônico — conjunto de aceitação de FR-7', () => {
    expect(tokens('fraternidade')).toEqual(['fraternal']);
    expect(tokens('fraterno')).toEqual(['fraternal']);
    expect(tokens('angustiado')).toEqual(['angustia']);
    expect(tokens('perdoar')).toEqual(['perdao']);
  });

  it('descarta palavras vazias e termos de uma letra', () => {
    expect(tokens('o que é ser fraternal')).toEqual(['fraternal']);
    expect(tokens('a e o de da do')).toEqual([]);
  });

  it('não repete termos — só a presença pontua no ranking', () => {
    expect(tokens('paz paz PAZ pacificador')).toEqual(['paz']);
  });

  it('separa em qualquer coisa que não seja letra ou número', () => {
    expect(tokens('“luz—e–vida!”')).toEqual(['luz', 'vida']);
  });
});

describe('termosDe', () => {
  it('deriva os três campos indexados do conteúdo', () => {
    expect(
      termosDe({
        titulo: 'A Fraternidade',
        corpo: 'Que a paz esteja em vossa família.',
        tags: ['perdão'],
      }),
    ).toEqual({
      termosTitulo: ['fraternal'],
      termosTags: ['perdao'],
      termosCorpo: ['paz', 'esteja', 'vossa', 'familia'],
    });
  });

  it('tolera tags ausentes', () => {
    expect(termosDe({ titulo: 'Luz', corpo: 'Vida' }).termosTags).toEqual([]);
  });
});
