/*
 * Backfill dos campos de busca (FR-7) — termosTitulo/termosTags/termosCorpo —
 * nas mensagens criadas antes desses campos existirem:
 *   node --require ts-node/register src/scripts/backfill-termos.ts
 * Idempotente, no molde do seed: recalcula com o tokenizador canônico
 * (busca.util.ts) e grava por $set; rodar de novo produz o mesmo resultado.
 * Só toca nos três campos internos — nenhum conteúdo publicado muda.
 * Rode também depois de qualquer mudança no vocabulário do tokenizador.
 */
import 'dotenv/config';
import { connect, disconnect, model } from 'mongoose';
import { termosDe } from '../mensagens/busca.util';
import { MensagemSchema } from '../mensagens/mensagens.model';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI ausente no ambiente (.env).');
  await connect(uri);
  const Mensagem = model('Mensagem', MensagemSchema, 'mensagens');

  const todas = await Mensagem.find()
    .select('data titulo corpo tags')
    .lean<{ data: string; titulo: string; corpo: string; tags?: string[] }[]>()
    .exec();

  let alteradas = 0;
  for (const m of todas) {
    const { modifiedCount } = await Mensagem.updateOne(
      { data: m.data },
      { $set: termosDe(m) },
      // O updatedAt conta a última correção editorial, não este recálculo.
      { timestamps: false },
    ).exec();
    alteradas += modifiedCount;
  }
  console.log(
    `Termos de busca: ${todas.length} mensagens visitadas, ${alteradas} alteradas.`,
  );

  await disconnect();
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
