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
 * O slug é o endereço público (/musica/<slug> — FR-14) e é único no banco.
 * Não existe DELETE: retirar de circulação é despublicar (FR-21) — o
 * endereço continua respondendo, a listagem e a busca é que a escondem.
 */
@Schema({ timestamps: true, collection: 'musicas' })
export class Musica {
  @Prop({ required: true, unique: true })
  slug: string;

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
