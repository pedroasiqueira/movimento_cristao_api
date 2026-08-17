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

O seed lê, por padrão, `../mensagens.json` e `../movimento_cristao/src/data/musicas.json` (irmãos deste repositório). Outros caminhos: `npm run seed -- caminho/mensagens.json caminho/musicas.json`. É idempotente: rodar de novo atualiza em vez de duplicar.

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
