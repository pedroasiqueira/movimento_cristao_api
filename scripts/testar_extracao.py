#!/usr/bin/env python3
"""
Teste de regressão da extração de mensagens.

A fonte real (a exportação do WhatsApp) fica fora do repositório por
privacidade, então o que se versiona é uma AMOSTRA — dados-brutos/
amostra-export.txt, só bolhas assinadas do Movimento (conteúdo que já é
público no site), uma para cada caso difícil que o parser precisa acertar:
as 4 eras de layout, typos na assinatura, rodapés colados, títulos fora do
padrão, layout de domingo, allowlist e substituição manual da 1ª linha.

O gabarito (dados-brutos/amostra-esperada.json) traz o resultado campo a
campo. Este script reprocessa a amostra com o parser atual e compara.

Uso (da raiz do movimento_cristao_api):
  python3 scripts/testar_extracao.py

Sai com código 1 em qualquer divergência. Se a mudança for intencional,
regenere o gabarito com --atualizar e revise o diff antes de commitar.
"""

import importlib.util
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
AMOSTRA = RAIZ / 'dados-brutos/amostra-export.txt'
GABARITO = RAIZ / 'dados-brutos/amostra-esperada.json'
CAMPOS = ('titulo', 'corpo', 'assinatura', 'proveniencia', 'canal', 'flags')


def carregar_parser():
    caminho = RAIZ / 'scripts/reconstruir_mensagens.py'
    spec = importlib.util.spec_from_file_location('reconstrutor', caminho)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)     # o guard __main__ impede o main()
    return modulo


def extrair(p):
    """Roda a extração sobre a amostra, aplicando as decisões que valem por
    bolha (LINHA1_MANUAL) — as demais (dedup, remapeamento) são do pipeline
    completo e não pertencem a este teste."""
    saida = []
    for bloco in p.separar_blocos(AMOSTRA.read_text(encoding='utf-8')):
        chave = (bloco['data'], bloco['hora'])
        if chave in p.LINHA1_MANUAL:
            bloco['linhas'][0] = p.LINHA1_MANUAL[chave]
        entrada, flags = p.interpretar_bloco_export(bloco)
        saida.append({'data': bloco['data'], 'hora': bloco['hora'],
                      **entrada, 'flags': flags})
    return saida


def main():
    p = carregar_parser()
    obtido = extrair(p)
    esperado = json.loads(GABARITO.read_text(encoding='utf-8'))

    if '--atualizar' in sys.argv:
        porque = {(e['data'], e['hora']): e.get('porque', '') for e in esperado}
        novo = [{'data': e['data'], 'hora': e['hora'],
                 'porque': porque.get((e['data'], e['hora']), ''), **e}
                for e in obtido]
        GABARITO.write_text(json.dumps(novo, ensure_ascii=False, indent=2) + '\n',
                            encoding='utf-8')
        print(f'Gabarito regravado com {len(novo)} bolhas — revise o diff.')
        return 0

    if len(obtido) != len(esperado):
        print(f'✗ a amostra tem {len(obtido)} bolhas, o gabarito {len(esperado)}')
        return 1

    falhas = 0
    for esp, obt in zip(esperado, obtido):
        onde = f"{esp['data']} {esp['hora']} — {esp.get('porque', '')}"
        if (esp['data'], esp['hora']) != (obt['data'], obt['hora']):
            print(f'✗ ordem/identidade divergente: {onde}')
            falhas += 1
            continue
        for campo in CAMPOS:
            if esp.get(campo) != obt.get(campo):
                falhas += 1
                print(f'✗ {onde}\n    campo {campo}:')
                print(f'      esperado: {esp.get(campo)!r}'[:300])
                print(f'      obtido  : {obt.get(campo)!r}'[:300])

    if falhas:
        print(f'\n{falhas} divergência(s). Se a mudança for intencional: '
              f'python3 scripts/testar_extracao.py --atualizar')
        return 1
    print(f'✓ extração confere com o gabarito nas {len(obtido)} bolhas da amostra')
    return 0


if __name__ == '__main__':
    sys.exit(main())
