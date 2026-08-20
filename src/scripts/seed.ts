/*
 * Seed da Fase 1 — carrega no Mongo os JSONs versionados nesta API:
 *   node --require ts-node/register src/scripts/seed.ts [mensagens.json] [musicas.json]
 * Sem argumentos, lê src/data/mensagens.json e src/data/musicas.json —
 * a API semeia sozinha, sem depender do repositório do site ao lado.
 * (mensagens.json é gerado por scripts/reconstruir_mensagens.py a partir da
 * exportação do WhatsApp, que fica fora do repositório — ver README.)
 * Idempotente: upsert por data (mensagens) e código (músicas) — rodar de novo
 * atualiza em vez de duplicar. O admin vem de ADMIN_EMAIL/ADMIN_PASSWORD.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as bcrypt from 'bcrypt';
import { connect, disconnect, model } from 'mongoose';
import { termosDe } from '../mensagens/busca.util';
import { MensagemSchema } from '../mensagens/mensagens.model';
import { MusicaSchema } from '../musicas/musicas.model';
import { UsuarioSchema } from '../users/users.model';

type MensagemJson = {
  data: string;
  titulo: string;
  corpo: string;
  assinatura?: string | null;
  proveniencia?: string | null;
  canal?: string | null;
  tags?: string[];
};

type MusicaJson = {
  id: string;
  titulo: string;
  autores?: string[];
  secoes: { tipo: string; linhas: string[] }[];
  despublicada?: boolean;
  exemplo?: boolean;
};

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      'MONGODB_URI não está definido — crie o .env a partir do .env.example.',
    );
  }

  const email = process.env.ADMIN_EMAIL;
  const senha = process.env.ADMIN_PASSWORD;
  if (!email || !senha) {
    throw new Error('Defina ADMIN_EMAIL e ADMIN_PASSWORD no .env para o seed.');
  }

  await connect(uri);
  const Usuario = model('Usuario', UsuarioSchema);
  const Mensagem = model('Mensagem', MensagemSchema);
  const Musica = model('Musica', MusicaSchema);

  // Admin (upsert): garante que existe e que a senha é a do .env atual.
  const password = await bcrypt.hash(senha, await bcrypt.genSalt());
  await Usuario.updateOne(
    { email: email.toLowerCase() },
    {
      $set: {
        nome: process.env.ADMIN_NOME ?? 'Administrador',
        password,
        role: 'admin',
      },
    },
    { upsert: true },
  );
  console.log(`Admin garantido: ${email.toLowerCase()}`);

  // Mensagens
  const caminhoMensagens = resolve(
    process.argv[2] ?? resolve(__dirname, '../data/mensagens.json'),
  );
  const mensagens = JSON.parse(
    readFileSync(caminhoMensagens, 'utf8'),
  ) as MensagemJson[];
  for (const m of mensagens) {
    await Mensagem.updateOne(
      { data: m.data },
      {
        $set: {
          titulo: m.titulo,
          corpo: m.corpo,
          assinatura: m.assinatura ?? null,
          proveniencia: m.proveniencia ?? null,
          canal: m.canal ?? null,
          tags: m.tags ?? [],
          // updateOne não passa pelo pre('save') do model — os termos de
          // busca (FR-7) são calculados aqui com o mesmo tokenizador.
          ...termosDe(m),
        },
        $setOnInsert: { publicarEm: null },
      },
      { upsert: true },
    );
  }
  console.log(`Mensagens: ${mensagens.length} (de ${caminhoMensagens})`);

  // Músicas
  const caminhoMusicas = resolve(
    process.argv[3] ?? resolve(__dirname, '../data/musicas.json'),
  );
  const musicas = JSON.parse(
    readFileSync(caminhoMusicas, 'utf8'),
  ) as MusicaJson[];
  for (const m of musicas) {
    await Musica.updateOne(
      { codigo: m.id },
      {
        $set: {
          titulo: m.titulo,
          autores: m.autores ?? [],
          secoes: m.secoes,
          despublicada: Boolean(m.despublicada),
          exemplo: Boolean(m.exemplo),
        },
      },
      { upsert: true },
    );
  }
  console.log(`Músicas: ${musicas.length} (de ${caminhoMusicas})`);

  await disconnect();
  console.log('Seed concluído.');
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
