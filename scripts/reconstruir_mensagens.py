#!/usr/bin/env python3
"""
Reconstrói o mensagens.json INTEIRO a partir do dump bruto do WhatsApp
(core.json) — decisão do Pedro (17/08/2026): o dump é a fonte única e
sobrescreve tudo; as marcas de formatação (*negrito*, _itálico_) são
preservadas no corpo, porque o site as renderiza.

Uso (da raiz do movimento_cristao_api):
  python3 scripts/reconstruir_mensagens.py [dump1 dump2 ...]
  (default: dados-brutos/core.json)

Estrutura de cada bloco do dump:
  [dd/mm, hh:mm] Nome: *TÍTULO*            -> titulo (sem marcas)
  _Arca da Sagrada Aliança – ..._          -> assinatura (sem marcas)
  ... corpo com marcas preservadas ...     -> corpo
  *(Mensagem revelada pelo Espírito...)*   \
  _(João 16:12–14 — ...)_                  -> proveniencia (sem marcas)
  *(A Arca ... é apenas o canal ...)*      -> canal (sem marcas)

"Medite e pense nisto." permanece no corpo. As tags não existem no dump:
são herdadas do mensagens.json anterior por (data, título). Grava as DUAS
cópias do JSON (src/data/ desta API, lida pelo seed; e a do repositório
irmão movimento_cristao/src/data/, empacotada no site como reserva) —
elas precisam mudar juntas.
"""

import json
import re
import sys
import unicodedata
from pathlib import Path

RAIZ_API = Path(__file__).resolve().parents[1]
COPIAS = [
    RAIZ_API / 'src/data/mensagens.json',
    RAIZ_API.parent / 'movimento_cristao/src/data/mensagens.json',
]
DUMP_PADRAO = RAIZ_API / 'dados-brutos/core.json'
ANO = 2026

# Decisões do Pedro (17/08/2026) sobre as ambiguidades do dump:
# - "O REINO DOS CÉUS" de 10/06 é retransmissão idêntica à de 19/06 — sai.
# - "A JUSTIÇA DIVINA" veio junto de outra mensagem em 01/07; vai para o
#   dia vago 30/06 (não-domingo sem mensagem).
DESCARTAR = {('2026-06-10', 'o reino dos ceus')}
REMAPEAR = {('2026-07-01', 'a justica divina'): '2026-06-30'}

CABECALHO = re.compile(r'^\[(\d{2})/(\d{2}), \d{2}:\d{2}\] [^:]+: (.*)$')


def normalizar_emendas(texto):
    """Junta os pares partidos pelo WhatsApp: `*a* *b*` -> `*a b*` (idem _)."""
    texto = texto.replace('_ _', ' ')
    texto = texto.replace('* *', ' ')
    return texto


def sem_marcas(texto):
    texto = normalizar_emendas(texto)
    texto = re.sub(r'[*_]', '', texto)
    return re.sub(r'  +', ' ', texto).strip()


def chave_titulo(titulo):
    nfd = unicodedata.normalize('NFD', titulo)
    plano = ''.join(c for c in nfd if not unicodedata.combining(c))
    plano = re.sub(r'[^\w ]', '', plano)
    return re.sub(r'\s+', ' ', plano).strip().casefold()


def eh_proveniencia(linha):
    plano = sem_marcas(linha)
    if 'canal' in plano:
        return False
    if 'Espírito da Verdade' in plano or 'João 16:12' in plano:
        return True
    # Linha inteira de referências bíblicas entre parênteses, ex.:
    # "(João 14:6; João 11:25-26; Mateus 5:8)" — variante de proveniência.
    return bool(re.fullmatch(r'\((?:[A-ZÀ-Ü][a-zà-ü]+ \d+[\d:;,.\-– ]*)+\)', plano))


def eh_canal(linha):
    plano = sem_marcas(linha)
    return 'Arca' in plano and 'canal' in plano


def separar_blocos(texto):
    blocos = []
    for linha in texto.split('\n'):
        m = CABECALHO.match(linha)
        if m:
            dd, mm, resto = m.groups()
            blocos.append({'data': f'{ANO}-{mm}-{dd}', 'linhas': [resto]})
        elif blocos:
            blocos[-1]['linhas'].append(linha)
    return blocos


def interpretar_bloco(bloco):
    linhas = [l.rstrip() for l in bloco['linhas']]

    titulo = sem_marcas(linhas[0])

    corpo = linhas[1:]
    while corpo and not corpo[0].strip():
        corpo.pop(0)

    assinatura = None
    if corpo and 'Arca da Sagrada Aliança' in corpo[0] and len(corpo[0]) < 120:
        assinatura = sem_marcas(corpo.pop(0))

    # Rodapé: só as linhas institucionais CONTÍGUAS no fim — "Espírito da
    # Verdade" também aparece em citações no meio do corpo e não pode sair.
    # Alguns blocos (02–06/06) repetem a assinatura antes do rodapé; ela é
    # descartada para não duplicar no corpo.
    proveniencia, canal = [], None
    while corpo:
        ultima = corpo[-1].strip()
        if not ultima:
            corpo.pop()
        elif canal is None and eh_canal(ultima):
            canal = sem_marcas(corpo.pop())
        elif eh_proveniencia(ultima):
            proveniencia.insert(0, sem_marcas(corpo.pop()))
        elif assinatura and sem_marcas(ultima).rstrip('.') == assinatura.rstrip('.'):
            corpo.pop()
        else:
            break

    texto_corpo = normalizar_emendas('\n'.join(corpo))
    texto_corpo = re.sub(r'\n{3,}', '\n\n', texto_corpo).strip()

    return {
        'data': bloco['data'],
        'titulo': titulo,
        'corpo': texto_corpo,
        'assinatura': assinatura,
        'proveniencia': ' '.join(proveniencia) or None,
        'canal': canal,
    }


def main():
    dumps = [Path(a) for a in sys.argv[1:]] or [DUMP_PADRAO]

    blocos = []
    for dump in dumps:
        blocos += separar_blocos(dump.read_text(encoding='utf-8'))

    anterior = json.loads(COPIAS[0].read_text(encoding='utf-8'))
    tags_por_chave = {(e['data'], chave_titulo(e['titulo'])): e.get('tags', []) for e in anterior}

    entradas, descartadas, remapeadas = [], [], []
    for bloco in blocos:
        msg = interpretar_bloco(bloco)
        chave = (msg['data'], chave_titulo(msg['titulo']))
        if chave in DESCARTAR:
            descartadas.append(f"{msg['data']} {msg['titulo']}")
            continue
        if chave in REMAPEAR:
            remapeadas.append(f"{msg['titulo']}: {msg['data']} -> {REMAPEAR[chave]}")
            msg['data'] = REMAPEAR[chave]
        tags = tags_por_chave.get((msg['data'], chave[1]), [])
        entradas.append({'id': msg['data'], **msg, 'tags': tags})

    entradas.sort(key=lambda e: e['data'])

    datas = [e['data'] for e in entradas]
    repetidas = sorted({d for d in datas if datas.count(d) > 1})
    if repetidas:
        sys.exit(f'ERRO: datas com mais de uma mensagem após os ajustes: {repetidas}')

    conteudo = json.dumps(entradas, ensure_ascii=False, indent=2) + '\n'
    for copia in COPIAS:
        copia.write_text(conteudo, encoding='utf-8')

    sem_tags = [e['data'] for e in entradas if not e['tags']]
    print(f'Mensagens no corpus: {len(entradas)} ({datas[0]} -> {datas[-1]})')
    print(f'Descartadas ({len(descartadas)}): ' + '; '.join(descartadas))
    print(f'Remapeadas ({len(remapeadas)}): ' + '; '.join(remapeadas))
    print(f'Sem tags — para o Pedro classificar ({len(sem_tags)}):')
    print('  ' + ', '.join(sem_tags))
    print(f"Gravadas as duas cópias: {', '.join(str(c) for c in COPIAS)}")


if __name__ == '__main__':
    main()
