#!/usr/bin/env python3
"""
Reconstrói o mensagens.json INTEIRO a partir dos dumps brutos do WhatsApp
— decisão do Pedro (17/08/2026): o dump é a fonte única e sobrescreve tudo;
as marcas de formatação (*negrito*, _itálico_) são preservadas no corpo,
porque o site as renderiza.

Dois formatos de dump, detectados POR LINHA (podem coexistir):
  core        [dd/mm, hh:mm] Nome: ...        (sem ano; assume ANO = 2026)
  exportação  dd/mm/aaaa hh:mm - Nome: ...    ("Exportar conversa" oficial)

Uso (da raiz do movimento_cristao_api):
  python3 scripts/reconstruir_mensagens.py [dump1 dump2 ...]
  (default: dados-brutos/core.json)

Comando canônico da importação completa — A ORDEM DOS ARGUMENTOS GARANTE a
preferência de fonte (em data repetida entre fontes vence quem chega antes,
isto é, o core, que é o corpus já curado):
  python3 scripts/reconstruir_mensagens.py dados-brutos/core.json ../export-whatsapp.txt

O caminho da exportação fica FORA do repositório (../export-whatsapp.txt) por
decisão de privacidade (19/08/2026): o arquivo cru contém a conversa pessoal e
os repositórios são públicos. O .gitignore tem trava para ele nunca entrar.

Pipeline da exportação: filtro por assinatura (tolerante a typos) → extração
por características (4 eras de layout + layout de domingo) → decisões
editoriais → preferência de fonte → dedup por corpo extraído → validação
1 msg/dia (aborta ANTES de gravar, propondo remapeamentos prontos para colar
em REMAPEAR) → sanidade + leak-check → herança de tags → gravação das duas
cópias. Relatório completo em ../relatorio-importacao-whatsapp.txt.

Estrutura de cada bloco do core:
  [dd/mm, hh:mm] Nome: *TÍTULO*            -> titulo (sem marcas)
  _Arca da Sagrada Aliança – ..._          -> assinatura (sem marcas)
  ... corpo com marcas preservadas ...     -> corpo
  *(Mensagem revelada pelo Espírito...)*   \
  _(João 16:12–14 — ...)_                  -> proveniencia (sem marcas)
  *(A Arca ... é apenas o canal ...)*      -> canal (sem marcas)

"Medite e pense nisto." (e variantes) permanece no corpo. As tags não existem
nos dumps: são herdadas do mensagens.json anterior por (data, título). Grava
as DUAS cópias do JSON (src/data/ desta API, lida pelo seed; e a do repositório
irmão movimento_cristao/src/data/, empacotada no site como reserva) — elas
precisam mudar juntas.
"""

import difflib
import json
import re
import sys
import unicodedata
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

RAIZ_API = Path(__file__).resolve().parents[1]
COPIAS = [
    RAIZ_API / 'src/data/mensagens.json',
    RAIZ_API.parent / 'movimento_cristao/src/data/mensagens.json',
]
DUMP_PADRAO = RAIZ_API / 'dados-brutos/core.json'
RELATORIO = RAIZ_API.parent / 'relatorio-importacao-whatsapp.txt'
ANO = 2026

# ------------------------- decisões editoriais -------------------------
# Do Pedro (17/08/2026), sobre as ambiguidades do dump core:
# - "O REINO DOS CÉUS" de 10/06 é retransmissão idêntica à de 19/06 — sai.
# - "A JUSTIÇA DIVINA" veio junto de outra mensagem em 01/07; vai para o
#   dia vago 30/06 (não-domingo sem mensagem).
# As chaves (data, título) valem para as DUAS fontes — a cópia da exportação
# recebe a mesma decisão.
DESCARTAR = {('2026-06-10', 'o reino dos ceus')}
REMAPEAR = {
    ('2026-07-01', 'a justica divina'): '2026-06-30',
    # ---- Importação do histórico (19/08/2026): dias com 2+ mensagens. ----
    # Regra aprovada: a ÚLTIMA bolha do dia fica; as demais vão para o dia
    # vago não-domingo mais próximo (janela ±5, de preferência anterior),
    # em alocação gulosa cronológica. Propostas geradas pelo próprio parser.
    # Caso especial — dia inaugural 21/06/2023 (2 mensagens no MESMO minuto,
    # nenhuma vaga em ±5): fica O BRILHO DA VERDADE (a 1ª de todas) e
    # A UNIDADE DA VIDA vai para 15/07/2023, a única vaga de jun–jul/2023.
    ('2023-06-21', 'a unidade da vida'): '2023-07-15',  # 16:12 A UNIDADE DA VIDA
    ('2023-06-28', 'o medo'): '2023-06-27',  # 14:55 O MEDO
    ('2023-07-24', 'a vida e a consciencia'): '2023-07-22',  # 13:02 A VIDA E A CONSCIÊNCIA
    ('2023-08-04', 'a vida'): '2023-08-03',  # 14:39 A VIDA
    ('2023-10-26', 'as mudancas repentinas'): '2023-10-25',  # 16:43 AS MUDANÇAS REPENTINAS
    ('2023-11-28', 'a vida que se deve perder para que aflore a vida que se deve viver'): '2023-11-27',  # 15:49
    ('2024-01-02', 'a comunhao divina'): '2024-01-01',  # 21:45 A COMUNHÃO DIVINA
    ('2024-01-02', 'o recomeco'): '2024-01-03',  # 21:45 O RECOMEÇO
    ('2024-01-04', 'as grandes realizacoes'): '2024-01-05',  # 20:33 AS GRANDES REALIZAÇÕES
    ('2024-01-06', 'a perenidade das palavras de jesus'): '2024-01-11',  # 19:21 A PERENIDADE DAS PALAVRAS DE JESUS
    ('2024-01-12', 'a importante e necessaria decisao'): '2024-01-15',  # 14:13 A IMPORTANTE E NECESSÁRIA DECISÃO
    ('2024-01-16', 'as virtudes de quem ama'): '2024-01-20',  # 15:01 AS VIRTUDES DE QUEM AMA
    ('2024-01-23', 'a existencia humana'): '2024-01-22',  # 16:54 A EXISTÊNCIA HUMANA
    ('2024-02-08', 'a uniao com deus'): '2024-02-07',  # 20:56 A UNIÃO COM DEUS
    ('2024-02-13', 'o dominio de si mesmo'): '2024-02-12',  # 12:39 O DOMÍNIO DE SI MESMO
    ('2024-02-15', 'o poder da palavra'): '2024-02-14',  # 20:27 O PODER DA PALAVRA
    ('2024-02-21', 'a enfermidade'): '2024-02-20',  # 13:44 A ENFERMIDADE
    ('2024-02-27', 'as dimensoes superiores'): '2024-02-26',  # 14:46 AS DIMENSÕES SUPERIORES
    ('2024-03-07', 'a crianca e a revelacao da pureza divina'): '2024-03-06',  # 21:26
    ('2024-08-22', 'a volta do filho unigenito de deus'): '2024-08-21',  # 14:06 A VOLTA DO FILHO UNIGÊNITO DE DEUS
    ('2024-08-29', 'a salvacao'): '2024-08-28',  # 16:34 A SALVAÇÃO
    ('2024-09-10', 'as profecias'): '2024-09-09',  # 13:53 AS PROFECIAS
    ('2024-10-31', 'o tornarse instrumento da vontade divina'): '2024-10-30',  # 14:58
    ('2024-11-16', 'o projeto de deus'): '2024-11-15',  # 10:58 O PROJETO DE DEUS
    ('2024-12-05', 'quando se ama o que faz'): '2024-12-04',  # 11:37 QUANDO SE AMA O QUE FAZ
    ('2025-01-02', 'o renascer'): '2025-01-01',  # 21:45 O RENASCER
    ('2025-04-24', 'no caminhar da vida'): '2025-04-23',  # 13:33 NO CAMINHAR DA VIDA
    ('2025-07-17', 'a voz do silencio'): '2025-07-16',  # 11:25 A VOZ DO SILÊNCIO
    ('2025-08-13', 'os que ascenderao a plenitude celestial'): '2025-08-12',  # 14:04
    ('2025-09-25', 'o brilho da verdade'): '2025-09-24',  # 18:44 O BRILHO DA VERDADE
}

# Do Pedro (19/08/2026), sobre a exportação (Etapa 0 do plano em docs/):
# - Escopo: todo o histórico 2023–2026.
# - DOMINGOS FICAM FORA (o site declara "domingo tem mensagem em áudio");
#   domingo também não vale como destino de remapeamento.
# - Casos avulsos: os três foram APROVADOS (19/08/2026) e entram —
#   · NÃO MAIS PECAR (28/03/2025): a assinatura tem o typo "Arca da Aliança"
#     (sem "Sagrada") e não passa no filtro geral; entra por INCLUIR_EXPORT
#     e a extração aceita o typo (tem_assinatura flex).
#   · O MOMENTO PRESENTE (24/05/2025): layout "Leitura Pública" com a
#     assinatura na 1ª linha e o título real na seguinte — a extração resolve.
#   · A FÉ (20/04/2026): preâmbulo pessoal de condolências colado ao título
#     na 1ª linha — LINHA1_MANUAL o remove (também por privacidade).
EXCLUIR_DOMINGO = True
# Bolhas da exportação a descartar por decisão, chave (data, hh:mm) → motivo:
DESCARTAR_EXPORT = {}
# Bolhas aprovadas que o filtro de assinatura não reconhece sozinho:
INCLUIR_EXPORT = {('2025-03-28', '11:28')}
# Substituição manual da 1ª linha da bolha (preâmbulos, títulos à mão):
LINHA1_MANUAL = {('2026-04-20', '13:19'): '*A FÉ*'}
# Bolhas SEM assinatura reconhecível que merecem menção nominal no relatório
# (não entram no corpus; o filtro as descarta antes da extração):
NAO_ASSINADAS_NOTAVEIS = {}
# Citações legítimas da assinatura DENTRO do corpo (não são vazamento):
LEAK_EXCECOES = {'2025-04-18', '2025-06-26'}

# Metas de conferência da exportação (plano §3, rev. 3) — o relatório compara.
ESPERADO = {
    'bolhas': 1192,
    'mídia oculta': 158,
    'mensagem apagada': 10,
    'ligação': 1,
    'vazia': 4,
    'candidatas': 997,
    'estritas': 995,
}

CAB_CORE = re.compile(r'^\[(\d{2})/(\d{2}), \d{2}:\d{2}\] [^:]+: (.*)$')
CAB_EXPORT = re.compile(r'^(\d{2})/(\d{2})/(\d{4}) (\d{2}:\d{2}) - (.*)$')


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


# ----------------------- formato core (inalterado) -----------------------

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


# --------------------- formato exportação (novo) ---------------------

def norm_filtro(texto):
    """Normalização agressiva para detecção de assinatura e dedup: sem
    acentos, sem marcas/parênteses/aspas, caixa baixa, traços unificados,
    espaço em branco (quebras de linha inclusas) colapsado."""
    t = unicodedata.normalize('NFD', texto)
    t = ''.join(c for c in t if not unicodedata.combining(c))
    t = t.casefold()
    t = re.sub(r'[*_()"“”‘’\']', '', t)
    t = re.sub(r'[–—-]', '-', t)
    return re.sub(r'\s+', ' ', t).strip()


# Tolerante aos typos reais da conversa: "Movimentos Cristão" (24/10/2023)
# e "Movimento Cristo" (26/03/2025). NÃO exigir "Natal/RN" nem "Brasil"
# (há assinatura sem Natal/RN em 05/01/2026 e "Brasi)" em 06/08/2024).
RE_MOVIMENTO = re.compile(r'movimentos? crist(?:ao|o)\b')


def tem_assinatura(n, flex=False):
    """`n` já normalizado por norm_filtro. Critério por bolha do plano §4.
    `flex` aceita também o typo "Arca da Aliança" (28/03/2025) — usado só na
    EXTRAÇÃO de bolhas já aprovadas, nunca no filtro geral."""
    arca = 'arca da sagrada alianca' in n or (flex and 'arca da alianca' in n)
    return arca and bool(RE_MOVIMENTO.search(n))


PROV_CHAVES = ('espirito da verdade', 'espirito santo', 'joao 16', 'salmo',
               'versiculo', 'mensagem revelada', 'mensagem transmitida',
               'mensagem inspirada')
RE_REFS = re.compile(r'^[a-z0-9 :;,.•\-]*\d+:\d+[a-z0-9 :;,.•\-]*$')
RE_SAUDACAO = re.compile(r'^(bom dia|boa tarde|boa noite)\b')
RE_TITULO_ESTRELA = re.compile(r'^\*([^*]+)\*[.\s]*(.*)$')
RE_FRASE_INICIAL = re.compile(r'^(.{2,120}?)([.?!…])\s*(.*)$', re.S)
# Cauda "(Arca ...)" no fim do último parágrafo — o miolo tolera quebra de
# linha (assinatura partida em 2 linhas físicas) e o fecho tolera marcas,
# ponto final e espaços ("... – Brasil)." é a forma comum da era A).
RE_PARENTESE_CAUDA = re.compile(r'\s*[*_]*\(([^()]{15,260})\)[*_.\s]*$')


def eh_bloco_canal(n):
    return 'arca' in n and ('canal' in n or 'instrumento desta mensagem' in n)


def eh_bloco_prov(n):
    return any(c in n for c in PROV_CHAVES) or bool(RE_REFS.fullmatch(n))


def limpar_rotulo(texto):
    """Assinatura sem marcas, sem parênteses externos, num espaço só."""
    t = re.sub(r'\s+', ' ', sem_marcas(texto)).strip()
    t = re.sub(r'^\(', '', t)
    t = re.sub(r'\)?\.?$', '', t)
    return t.strip()


def achatar(texto):
    """Campo de rodapé numa linha só, com marcas removidas."""
    return re.sub(r'\s+', ' ', sem_marcas(texto)).strip()


def separar_prov_canal(par):
    """Bloco único com proveniência E canal (ex.: 05/01/2026, 20/04/2026):
    "(Mensagem inspirada pelo Espírito Santo. A Arca ... é apenas o canal.)"
    Divide por sentença: as com Arca+canal/instrumento viram canal."""
    plano = achatar(par).strip('()')
    partes = re.split(r'(?<=[.!?])\s+', plano)
    canal = [p for p in partes if eh_bloco_canal(norm_filtro(p))]
    prov = [p for p in partes if p not in canal]
    return ' '.join(prov).strip() or None, ' '.join(canal).strip() or None


def so_letras(texto):
    return re.sub(r'[\W\d_]+', '', texto, flags=re.UNICODE)


def extrair_titulo(linhas):
    """Devolve (titulo, resto_da_linha, próximo_índice, assinatura_pré, flags).

    Cobre as 4 eras: `*TÍTULO*` em linha própria (C/D), `*TÍTULO*. corpo`
    inline (1ª da era B, 22/03/2025), `TÍTULO. corpo` inline caixa-alta
    (era A, fim em `.?!…` — títulos como "QUEM SOU EU?"), linha própria em
    caixa mista (layout de domingo) e o layout "Leitura Pública" com a
    assinatura NA 1ª linha e o título real na seguinte (24/05/2025)."""
    flags = []
    assinatura_pre = None
    idx = 0
    while idx < len(linhas):
        primeira = normalizar_emendas(linhas[idx]).strip()
        if not primeira:
            idx += 1
            continue

        m = RE_TITULO_ESTRELA.match(primeira)
        if m:
            interno, resto = m.group(1).strip(), m.group(2).strip()
            if not resto and assinatura_pre is None and tem_assinatura(norm_filtro(interno)):
                assinatura_pre = limpar_rotulo(interno)
                flags.append('assinatura na 1ª linha (layout "Leitura Pública")')
                idx += 1
                continue
            return sem_marcas(interno).rstrip('.').strip(), resto, idx + 1, assinatura_pre, flags

        m = RE_FRASE_INICIAL.match(primeira)
        if m:
            cand, pont, resto = m.group(1).strip(), m.group(2), m.group(3)
            titulo = sem_marcas(cand + (pont if pont in '?!…' else ''))
            letras = so_letras(cand)
            if letras and letras == letras.upper():
                return titulo, resto, idx + 1, assinatura_pre, flags
            if len(cand) <= 40 and len(resto) >= 200:
                flags.append('título fora do padrão (caixa mista/minúsculas) — conferir')
                return titulo, resto, idx + 1, assinatura_pre, flags

        if len(primeira) <= 90 and idx + 1 < len(linhas):
            titulo = sem_marcas(primeira)
            letras = so_letras(titulo)
            if not (letras and letras == letras.upper()):
                flags.append('título fora do padrão (caixa mista) — conferir')
            return titulo, '', idx + 1, assinatura_pre, flags

        flags.append('ERRO: título não identificado')
        return None, '', idx, assinatura_pre, flags
    flags.append('ERRO: bolha sem conteúdo após a 1ª linha')
    return None, '', idx, assinatura_pre, flags


def ultimo_paragrafo(linhas):
    """(i, j) do último parágrafo (bloco contíguo não vazio no fim)."""
    j = len(linhas)
    while j and not linhas[j - 1].strip():
        j -= 1
    i = j
    while i and linhas[i - 1].strip():
        i -= 1
    return i, j


def interpretar_bloco_export(bloco):
    """Extrai os campos de uma bolha da exportação POR CARACTERÍSTICAS.

    O rodapé é processado por PARÁGRAFOS, de baixo para cima — na era D
    final a proveniência e o canal ocupam blocos de várias linhas físicas
    (emendados com `* *`), o que quebraria um laço por linha. Guardas de
    tamanho impedem que o parágrafo único de uma mensagem da era A que
    contenha a palavra "canal" seja engolido como rodapé (caso P1)."""
    linhas = [l.rstrip() for l in bloco['linhas']]
    titulo, resto1, idx, assinatura, flags = extrair_titulo(linhas)

    corpo = ([resto1] if resto1 else []) + linhas[idx:]
    while corpo and not corpo[0].strip():
        corpo.pop(0)

    # Assinatura pós-título (eras C/D: "Leitura Pública – Arca…" ou "_Arca…_").
    if corpo:
        cand = normalizar_emendas(corpo[0]).strip()
        n = norm_filtro(cand)
        if len(cand) <= 250 and tem_assinatura(n, flex=True) and not eh_bloco_canal(n) \
                and not eh_bloco_prov(n):
            if assinatura is None:
                assinatura = limpar_rotulo(cand)
            corpo.pop(0)
            while corpo and not corpo[0].strip():
                corpo.pop(0)

    proveniencia, canal = [], None
    while corpo:
        i, j = ultimo_paragrafo(corpo)
        if i == j:
            break
        par = normalizar_emendas('\n'.join(corpo[i:j]).strip())
        n = norm_filtro(par)
        eh_can, eh_pro = eh_bloco_canal(n), eh_bloco_prov(n)

        if len(par) <= 40 and RE_SAUDACAO.match(n):
            # Layout de domingo: "Bom dia!/Boa tarde!" + emojis APÓS a
            # assinatura final (caso P2) — sai, com registro no relatório.
            flags.append(f'saudação removida do rodapé: {par!r}')
            del corpo[i:]
        elif len(par) <= 420 and eh_can and eh_pro:
            pro, can = separar_prov_canal(par)
            if pro:
                proveniencia.insert(0, pro)
            if can and canal is None:
                canal = can
            del corpo[i:]
        elif len(par) <= 420 and eh_can:
            if canal is None:
                canal = achatar(par)
            del corpo[i:]
        elif len(par) <= 420 and eh_pro:
            proveniencia.insert(0, achatar(par))
            del corpo[i:]
        else:
            m = RE_PARENTESE_CAUDA.search(par)
            if m and tem_assinatura(norm_filtro(m.group(1)), flex=True):
                if assinatura is None:
                    assinatura = limpar_rotulo(m.group(1))
                else:
                    flags.append('assinatura final repetida removida')
                sobra = par[:m.start()].rstrip()
                del corpo[i:]
                if sobra:
                    # Era A: a assinatura era sufixo do parágrafo do corpo —
                    # o que sobrou É corpo; o rodapé terminou.
                    corpo.extend(sobra.split('\n'))
                    break
                continue
            if len(par) <= 250 and tem_assinatura(n, flex=True):
                if assinatura is None:
                    assinatura = limpar_rotulo(par)
                else:
                    flags.append('assinatura final repetida removida')
                del corpo[i:]
                continue
            # Sufixo com parêntese defeituoso (05/08/2023: "… pense nisto.
            # Arca da Sagrada Aliança – … – Brasil)." sem o "(" de abertura).
            # Exige fim de sentença antes do "Arca" para não confundir com
            # citação da assinatura no meio do texto (18/04 e 26/06/2025).
            pos = par.rfind('Arca da Sagrada')
            if pos > 0:
                antes, cauda = par[:pos], par[pos:]
                if len(cauda) <= 260 and tem_assinatura(norm_filtro(cauda), flex=True) \
                        and re.search(r'(?:[.!?…]|\n)[*_\s]*$', antes):
                    if assinatura is None:
                        assinatura = limpar_rotulo(cauda)
                    else:
                        flags.append('assinatura final repetida removida')
                    flags.append('assinatura-sufixo sem parêntese de abertura')
                    del corpo[i:]
                    sobra = antes.rstrip()
                    if sobra:
                        corpo.extend(sobra.split('\n'))
                    break
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
    }, flags


# ----------------------------- pipeline -----------------------------

def separar_blocos(texto):
    """Fatia um dump em blocos, detectando o formato POR LINHA. Linhas de
    continuação não repetem cabeçalho (zero falsos cabeçalhos no arquivo,
    verificado no plano §3). O remetente da exportação é o trecho antes do
    PRIMEIRO ": "; sem ": " é linha de sistema (criptografia)."""
    blocos = []
    for linha in texto.split('\n'):
        m = CAB_CORE.match(linha)
        if m:
            dd, mm, resto = m.groups()
            blocos.append({'fonte': 'core', 'data': f'{ANO}-{mm}-{dd}',
                           'hora': '', 'linhas': [resto]})
            continue
        m = CAB_EXPORT.match(linha)
        if m:
            dd, mm, aaaa, hora, resto = m.groups()
            if ': ' in resto:
                remetente, conteudo = resto.split(': ', 1)
            else:
                remetente, conteudo = None, resto
            blocos.append({'fonte': 'export', 'data': f'{aaaa}-{mm}-{dd}',
                           'hora': hora, 'remetente': remetente,
                           'linhas': [conteudo]})
            continue
        if blocos:
            blocos[-1]['linhas'].append(linha)
    return blocos


def categoria_ruido(txt):
    if not txt:
        return 'vazia'
    if txt == '<Mídia oculta>':
        return 'mídia oculta'
    if len(txt) < 60 and 'apagada' in txt:
        return 'mensagem apagada'
    if len(txt) < 80 and ('Ligação' in txt or 'Chamada' in txt):
        return 'ligação'
    return None


def eh_domingo(data):
    return date.fromisoformat(data).weekday() == 6


def propor_remapeamentos(conflitos, ocupadas, minimo):
    """Para cada dia com 2+ mensagens: a ÚLTIMA bolha do dia fica (precedente
    de 01/07/2026: A JUSTIÇA DIVINA, a 1ª do dia, foi para a véspera); as
    demais vão para o dia vago não-domingo mais próximo na janela ±5,
    preferindo dias ANTERIORES. Alocação gulosa em ordem cronológica."""
    propostas, sem_vaga = [], []
    for dia in sorted(conflitos):
        regs = sorted(conflitos[dia], key=lambda r: (r['fonte'] != 'core', r['hora']))
        manter, mover = regs[-1], regs[:-1]
        for reg in mover:
            base = date.fromisoformat(dia)
            candidatos = sorted(
                (base + timedelta(days=delta) for delta in range(-5, 6) if delta),
                key=lambda d: (abs((d - base).days), (d - base).days > 0))
            destino = next(
                (d for d in candidatos
                 if d.weekday() != 6 and d >= minimo and d.isoformat() not in ocupadas),
                None)
            if destino:
                ocupadas.add(destino.isoformat())
                propostas.append((reg, destino.isoformat()))
            else:
                sem_vaga.append(reg)
        ocupadas.add(dia)
    return propostas, sem_vaga


def main():
    dumps = [Path(a) for a in sys.argv[1:]] or [DUMP_PADRAO]

    blocos = []
    for dump in dumps:
        blocos += separar_blocos(dump.read_text(encoding='utf-8'))

    rel = []           # linhas do relatório

    def r(linha=''):
        rel.append(linha)

    def meta(nome, valor):
        alvo = ESPERADO.get(nome)
        ok = '✓' if alvo == valor else f'✗ ESPERADO {alvo}'
        r(f'  {nome}: {valor} {ok}')

    # ---------- filtro da exportação ----------
    export = [b for b in blocos if b['fonte'] == 'export']
    ruido = Counter()
    descartes_filtro = []          # (bloco, motivo)
    registros = []                 # dicts: entrada extraída + metadados
    n_estritas = 0

    for b in blocos:
        if b['fonte'] == 'core':
            registros.append({'fonte': 'core', 'hora': '', 'data_original': b['data'],
                              'entrada': interpretar_bloco(b), 'flags': []})
            continue
        txt = '\n'.join(b['linhas']).strip()
        cat = categoria_ruido(txt)
        if b.get('remetente') is None:
            cat = 'linha de sistema'
        if cat:
            ruido[cat] += 1
            continue
        n = norm_filtro(txt)
        chave_bolha = (b['data'], b['hora'])
        passou_filtro = tem_assinatura(n) and len(txt) >= 300
        if not passou_filtro and chave_bolha not in INCLUIR_EXPORT:
            motivo = NAO_ASSINADAS_NOTAVEIS.get(
                chave_bolha,
                'sem assinatura' if len(txt) >= 300 else 'sem assinatura (curta)')
            descartes_filtro.append((b, txt, motivo))
            continue
        if passou_filtro and 'movimento cristao' in n:
            n_estritas += 1
        extras = []
        if not passou_filtro:
            extras.append('incluída por allowlist (assinatura fora do padrão)')
        if chave_bolha in LINHA1_MANUAL:
            b['linhas'][0] = LINHA1_MANUAL[chave_bolha]
            extras.append('1ª linha substituída à mão (preâmbulo pessoal removido)')
        entrada, flags = interpretar_bloco_export(b)
        registros.append({'fonte': 'export', 'hora': b['hora'],
                          'data_original': b['data'], 'entrada': entrada,
                          'flags': flags + extras, 'allowlist': not passou_filtro})

    candidatas = [reg for reg in registros if reg['fonte'] == 'export']
    r('RELATÓRIO DA IMPORTAÇÃO — exportação do WhatsApp')
    r(f'Dumps (a ordem define a preferência de fonte): '
      + ', '.join(str(d) for d in dumps))
    r()
    r('— Filtro (metas do plano §3) —')
    if export:
        meta('bolhas', len(export))
        for nome in ('mídia oculta', 'mensagem apagada', 'ligação', 'vazia'):
            meta(nome, ruido.get(nome, 0))
        pelo_filtro = [reg for reg in candidatas if not reg.get('allowlist')]
        meta('candidatas', len(pelo_filtro))
        meta('estritas', n_estritas)
        r(f'  incluídas por allowlist (além do filtro): {len(candidatas) - len(pelo_filtro)}')
        anos = Counter(reg['data_original'][:4] for reg in pelo_filtro)
        r(f'  candidatas por ano: {dict(sorted(anos.items()))} '
          f'(esperado 166/315/311/205 = estritas 165/315/310/205 + 2 typos)')
        notaveis = [(b, m) for b, _, m in descartes_filtro
                    if (b['data'], b['hora']) in NAO_ASSINADAS_NOTAVEIS]
        r('  casos notáveis fora do filtro:')
        for b, m in notaveis:
            r(f'    • {b["data"]} {b["hora"]}: {m}')
        outros = [t for t in descartes_filtro
                  if (t[0]['data'], t[0]['hora']) not in NAO_ASSINADAS_NOTAVEIS]
        r(f'  demais descartes não-assinados: {len(outros)}')
        for b, txt, motivo in outros:
            resumo = re.sub(r'\s+', ' ', txt)[:60]
            r(f'    · {b["data"]} {b["hora"]} [{b.get("remetente")}] ({motivo}) {resumo!r}')
    else:
        r('  (nenhum dump no formato exportação — modo somente core)')

    # ---------- decisões editoriais ----------
    r()
    r('— Decisões editoriais —')
    finais = []
    domingos, descartadas, remapeadas = [], [], []
    for reg in registros:
        e = reg['entrada']
        if reg['fonte'] == 'export':
            decisao = DESCARTAR_EXPORT.get((reg['data_original'], reg['hora']))
            if decisao:
                descartadas.append(f"{reg['data_original']} {reg['hora']} — {decisao}")
                continue
            if EXCLUIR_DOMINGO and eh_domingo(reg['data_original']):
                domingos.append(f"{reg['data_original']} {reg['hora']} {e['titulo']}")
                continue
        chave = (e['data'], chave_titulo(e['titulo'] or ''))
        if chave in DESCARTAR:
            descartadas.append(f"{e['data']} {e['titulo']} [{reg['fonte']}]")
            continue
        if chave in REMAPEAR:
            remapeadas.append(f"{e['titulo']}: {e['data']} -> {REMAPEAR[chave]} [{reg['fonte']}]")
            e['data'] = REMAPEAR[chave]
        finais.append(reg)
    r(f'  domingos excluídos ({len(domingos)}):')
    for d in domingos:
        r(f'    · {d}')
    r(f'  descartadas por decisão ({len(descartadas)}): ' + '; '.join(descartadas))
    r(f'  remapeadas ({len(remapeadas)}): ' + '; '.join(remapeadas))

    # ---------- preferência de fonte (mesma data, fontes diferentes) ----------
    r()
    r('— Preferência de fonte (data repetida entre dumps; 1º dump vence) —')
    vistos = {}
    apos_fonte = []
    n_pref, piores = 0, []
    for reg in finais:
        d = reg['entrada']['data']
        primeiro = vistos.get(d)
        if primeiro and primeiro['fonte'] != reg['fonte']:
            n_pref += 1
            ratio = difflib.SequenceMatcher(
                None, norm_filtro(primeiro['entrada']['corpo']),
                norm_filtro(reg['entrada']['corpo'])).ratio()
            if ratio < 0.95:
                piores.append((d, reg['entrada']['titulo'], ratio))
            continue
        if not primeiro:
            vistos[d] = reg
        apos_fonte.append(reg)
    r(f'  cópias da exportação preteridas pelo core: {n_pref} '
      f'(esperado 65 = 64 mesmas datas + 1 remapeada)')
    if piores:
        r('  ⚠ corpos com similaridade < 0,95 entre as fontes (CONFERIR À MÃO):')
        for d, t, ratio in piores:
            r(f'    ✗ {d} {t}: {ratio:.3f}')
    else:
        r('  todos os corpos preteridos têm similaridade ≥ 0,95 com o core ✓')

    # ---------- dedup por corpo extraído ----------
    r()
    r('— Dedup por corpo extraído (retransmissões e cópias mesmo-dia) —')
    grupos = {}
    for reg in apos_fonte:
        grupos.setdefault(norm_filtro(reg['entrada']['corpo']), []).append(reg)
    ocupacao = Counter(reg['entrada']['data'] for reg in apos_fonte)
    removidos = set()
    n_grupos = 0
    for corpo_n in sorted(grupos, key=lambda c: min(r_['entrada']['data'] for r_ in grupos[c])):
        grupo = grupos[corpo_n]
        if len(grupo) < 2:
            continue
        n_grupos += 1
        com_core = [g for g in grupo if g['fonte'] == 'core']
        livres = [g for g in grupo if ocupacao[g['entrada']['data']] == 1]
        manter = (com_core or sorted(livres or grupo, key=lambda g: g['entrada']['data']))[0]
        datas = ', '.join(f"{g['entrada']['data']}{'*' if g is manter else ''}" for g in grupo)
        r(f'  grupo: {grupo[0]["entrada"]["titulo"]} [{datas}] (* = mantida)')
        for g in grupo:
            if g is not manter:
                removidos.add(id(g))
                ocupacao[g['entrada']['data']] -= 1
    r(f'  grupos com 2+ cópias: {n_grupos}; cópias removidas: {len(removidos)}')
    r('  (plano previa 16 grupos/18 cópias ANTES das exclusões de domingo '
      'e da preferência de fonte — a diferença deve se explicar por elas)')
    apos_dedup = [reg for reg in apos_fonte if id(reg) not in removidos]

    # ---------- validação 1 mensagem/dia ----------
    contagem = Counter(reg['entrada']['data'] for reg in apos_dedup)
    conflitos = {}
    for reg in apos_dedup:
        if contagem[reg['entrada']['data']] > 1:
            conflitos.setdefault(reg['entrada']['data'], []).append(reg)
    r()
    r('— Conflitos de dia (validação 1 mensagem/dia) —')
    if conflitos:
        minimo = date.fromisoformat(min(contagem))
        # Dia em conflito também conta como ocupado: a mensagem mantida fica nele.
        ocupadas = set(contagem)
        propostas, sem_vaga = propor_remapeamentos(conflitos, ocupadas, minimo)
        r(f'  dias em conflito: {len(conflitos)}; mensagens a realocar: {len(propostas) + len(sem_vaga)}')
        r('  PROPOSTA (colar as linhas aprovadas em REMAPEAR e rodar de novo;')
        r('  regra: a última bolha do dia fica; as demais vão para o dia vago')
        r('  não-domingo mais próximo em ±5, de preferência anterior):')
        for reg, destino in propostas:
            e = reg['entrada']
            r(f"    ('{e['data']}', '{chave_titulo(e['titulo'])}'): '{destino}',"
              f"  # {reg['hora']} {e['titulo']}")
        for reg in sem_vaga:
            e = reg['entrada']
            r(f'    ✗ SEM VAGA ±5: {e["data"]} {reg["hora"]} {e["titulo"]} — decidir à mão')
        RELATORIO.write_text('\n'.join(rel) + '\n', encoding='utf-8')
        print('\n'.join(rel))
        sys.exit(f'\nERRO: {len(conflitos)} dias com mais de uma mensagem — '
                 f'nada foi gravado. Propostas de remapeamento no relatório '
                 f'({RELATORIO}).')
    r('  nenhum ✓')

    # ---------- sanidade e leak-check ----------
    problemas = []
    for reg in apos_dedup:
        e = reg['entrada']
        onde = f"{e['data']} ({reg['fonte']} {reg['hora']}) {e['titulo']!r}"
        if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', e['data'] or ''):
            problemas.append(f'data inválida: {onde}')
        if not e['titulo']:
            problemas.append(f'sem título: {onde}')
        if len(e['corpo']) < 200:
            problemas.append(f'corpo suspeito ({len(e["corpo"])} chars): {onde}')
        if 'arca da sagrada' in norm_filtro(e['corpo']) and e['data'] not in LEAK_EXCECOES:
            problemas.append(f'assinatura vazou para o corpo: {onde}')
    r()
    r('— Sanidade e leak-check —')
    if problemas:
        for p in problemas:
            r(f'  ✗ {p}')
        RELATORIO.write_text('\n'.join(rel) + '\n', encoding='utf-8')
        print('\n'.join(rel))
        sys.exit(f'\nERRO: {len(problemas)} problemas de sanidade — nada foi gravado.')
    r(f'  ok para as {len(apos_dedup)} mensagens ✓ (leak-check com '
      f'{len(LEAK_EXCECOES)} exceções legítimas: {sorted(LEAK_EXCECOES)})')

    # ---------- avisos de extração ----------
    r()
    r('— Avisos de extração (conferir no spot-check) —')
    avisos = [(reg['entrada']['data'], reg['hora'], f)
              for reg in apos_dedup for f in reg['flags']]
    frequencia = Counter(f for _, _, f in avisos)
    for f, qtd in frequencia.most_common():
        casos = [(d, h) for d, h, f_ in avisos if f_ == f]
        if qtd > 5:
            # Ex.: a assinatura dupla da era C (pós-título E no fim) gera um
            # aviso por mensagem — agregado para o relatório respirar.
            r(f'  · {f}: {qtd}× ({casos[0][0]} → {casos[-1][0]})')
        else:
            for d, h in casos:
                r(f'  · {d} {h}: {f}')
    if not avisos:
        r('  nenhum')

    # ---------- herança de tags, ordenação e gravação ----------
    anterior = json.loads(COPIAS[0].read_text(encoding='utf-8'))
    tags_por_chave = {(e['data'], chave_titulo(e['titulo'])): e.get('tags', [])
                      for e in anterior}

    entradas = []
    for reg in apos_dedup:
        msg = reg['entrada']
        tags = tags_por_chave.get((msg['data'], chave_titulo(msg['titulo'])), [])
        entradas.append({'id': msg['data'], **msg, 'tags': tags})
    entradas.sort(key=lambda e: e['data'])

    conteudo = json.dumps(entradas, ensure_ascii=False, indent=2) + '\n'
    for copia in COPIAS:
        copia.write_text(conteudo, encoding='utf-8')

    datas = [e['data'] for e in entradas]
    por_ano = Counter(d[:4] for d in datas)
    sem_tags = sum(1 for e in entradas if not e['tags'])
    r()
    r('— Resultado —')
    r(f'  mensagens no corpus: {len(entradas)} ({datas[0]} -> {datas[-1]}); '
      f'por ano: {dict(sorted(por_ano.items()))}')
    r(f'  sem tags (histórico novo, classificar depois): {sem_tags}')
    r(f'  gravadas as duas cópias: ' + ', '.join(str(c) for c in COPIAS))

    RELATORIO.write_text('\n'.join(rel) + '\n', encoding='utf-8')
    print('\n'.join(rel))
    print(f'\nRelatório salvo em {RELATORIO}')


if __name__ == '__main__':
    main()
