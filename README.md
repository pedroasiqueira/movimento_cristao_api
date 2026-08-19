# movimento_cristao_api

API do site da **Arca da Sagrada Aliança – Movimento Cristão** — NestJS 11 + MongoDB (Mongoose), na mesma estrutura de módulos do `dacapo_api`.

## Subir em desenvolvimento

```bash
cp .env.example .env        # e troque os valores
docker compose up -d        # Mongo local na porta 27019
npm install
npm run seed                # admin + mensagens + músicas dos JSONs do projeto
npm run start:dev           # API em http://localhost:3000
```

O seed lê, por padrão, `src/data/mensagens.json` e `src/data/musicas.json` (desta própria API). Outros caminhos: `npm run seed -- caminho/mensagens.json caminho/musicas.json`. É idempotente: rodar de novo atualiza em vez de duplicar. Atenção: além das mensagens, o seed também upserta o admin (com `ADMIN_*` do `.env`) e as músicas — confira o `.env` antes de rodá-lo contra produção.

O `src/data/mensagens.json` (e a cópia-reserva empacotada no site) é gerado por `scripts/reconstruir_mensagens.py`. A **fonte única de verdade** é a exportação oficial da conversa no WhatsApp, com o histórico completo desde jun/2023. Ela fica **fora do repositório** por privacidade — contém conversa pessoal e os repositórios são públicos —, em `../export-whatsapp.txt` (trava no `.gitignore`; original guardado no Drive):

```bash
python3 scripts/reconstruir_mensagens.py          # usa ../export-whatsapp.txt
python3 scripts/testar_extracao.py                # regressão da extração
```

O parser é determinístico e idempotente: reconstrói o corpus inteiro, aplica as decisões editoriais registradas em código (descartes, remapeamentos de dias com 2+ mensagens, domingos fora), deduplica por corpo, valida uma mensagem por dia e herda as tags da versão anterior. Ele aborta **antes** de gravar se algo não fecha, e escreve o relatório completo em `../relatorio-importacao-whatsapp.txt`.

Como a fonte real não é versionada, `dados-brutos/` guarda uma **amostra** dela (`amostra-export.txt`, só bolhas assinadas — conteúdo já público no site, remetente anonimizado) com o gabarito da extração (`amostra-esperada.json`), cobrindo os casos difíceis: as 4 eras de layout, typos na assinatura, rodapés colados, títulos fora do padrão. É o que `scripts/testar_extracao.py` exercita; use `--atualizar` para regravar o gabarito quando a mudança for intencional.

## Rotas

| Rota | Acesso | O quê |
|---|---|---|
| `POST /auth/login` | público | `{ email, password }` → `{ access_token }` (JWT 7d) |
| `GET /auth/me` | Bearer | dados de quem está logado |
| `GET /mensagens` | público | publicadas, mais recente primeiro (agendadas ficam fora — FR-9) |
| `GET /mensagens/tags` | público | vocabulário de tags em uso (FR-6) |
| `GET /mensagens/:data` | público | uma mensagem por `AAAA-MM-DD` (FR-3) |
| `GET /mensagens/agendadas/lista` | admin | o que está programado e ainda não apareceu (FR-9) |
| `POST /mensagens` | admin | cria; `409` se o dia já tem mensagem |
| `PATCH /mensagens/:data` | admin | corrige texto/título/tags preservando o endereço (FR-20) |
| `GET /musicas` | público | repertório sem as despublicadas, por título (FR-10) |
| `GET /musicas/:slug` | público | uma música; despublicada ainda responde (FR-21) |
| `POST /musicas` | admin | cria; o slug nasce do título (FR-14) |
| `PATCH /musicas/:slug` | admin | corrige; `despublicada: true` retira de circulação (FR-21) |

Não há `DELETE`: endereços publicados são permanentes (PRD §7). Não há cadastro público de usuários (PRD §8, LGPD) — o admin nasce do seed.
