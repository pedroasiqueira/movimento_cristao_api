import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ _id: false })
export class Secao {
  @Prop({ required: true, enum: ['estrofe', 'refrao'] })
  tipo: string;

  @Prop({ type: [String], required: true })
  linhas: string[];
}
const SecaoSchema = SchemaFactory.createForClass(Secao);

/*
 * O código é o endereço público (/musica/<codigo>/<titulo-legivel> — FR-14) e é
 * único no banco. Ele é SORTEADO, não derivado do título: até 20/08/2026 o
 * endereço era o slug do título, e corrigir o título condenava a música a um
 * endereço que mentia para sempre. Agora o título é conteúdo livre e o trecho
 * legível do endereço é enfeite — quem resolve é o código.
 *
 * Chama-se `codigo`, e não `id`, porque o Mongoose já cria uma virtual `id`
 * (o _id em string) e um caminho real de mesmo nome colidiria com ela. O site
 * traduz para `id` na fronteira (movimento_cristao/src/lib/musicas.js).
 *
 * Retirar de circulação é despublicar (FR-21) — o endereço continua
 * respondendo, a listagem e a busca é que a escondem. É o caminho normal.
 *
 * DELETE existe desde 20/08/2026 e apaga de verdade — decisão do Pedro. Ao
 * contrário da despublicação, o endereço deixa de existir e um link colado no
 * WhatsApp quebra: o guarda-corpo é o modal de confirmação do site, que avisa
 * que a exclusão é permanente.
 */
@Schema({ timestamps: true, collection: 'musicas' })
export class Musica {
  @Prop({ required: true, unique: true })
  codigo: string;

  @Prop({ required: true, trim: true })
  titulo: string;

  // FR-13: aceita mais de um autor; vazio = autoria desconhecida (dita, não escondida).
  @Prop({ type: [String], default: [] })
  autores: string[];

  @Prop({ type: [SecaoSchema], required: true })
  secoes: Secao[];

  @Prop({ default: false })
  despublicada: boolean;

  // Marcador das músicas de avaliação de layout, herdado dos JSONs da Fase 1.
  @Prop({ default: false })
  exemplo: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export type MusicaDocument = Musica & Document;
export const MusicaSchema = SchemaFactory.createForClass(Musica);
