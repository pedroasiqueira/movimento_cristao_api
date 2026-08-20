import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { termosDe } from './busca.util';

/*
 * Uma Mensagem por dia: o endereço público é a própria data (FR-3) e o
 * índice único garante isso no banco — mitigação combinada da escolha
 * não-relacional. Consertar é PATCH (FR-20), e é o caminho normal.
 *
 * DELETE existe desde 20/08/2026 e apaga de verdade — decisão do Pedro, que
 * abre a segunda exceção à permanência de endereços do PRD §7 (a primeira é
 * FR-21). O endereço passa a responder 404, e um link colado no WhatsApp
 * quebra: por isso o guarda-corpo é no site, um modal que diz em voz alta que
 * a exclusão não pode ser desfeita, e não uma lixeira aqui no banco.
 */
@Schema({ timestamps: true, collection: 'mensagens' })
export class Mensagem {
  @Prop({ required: true, unique: true, match: /^\d{4}-\d{2}-\d{2}$/ })
  data: string;

  @Prop({ required: true, trim: true })
  titulo: string;

  @Prop({ required: true })
  corpo: string;

  // Blocos institucionais: presentes em parte do corpus (addendum §1.5) —
  // exibidos quando existem, nulos quando não.
  @Prop({ type: String, default: null })
  assinatura: string | null;

  @Prop({ type: String, default: null })
  proveniencia: string | null;

  @Prop({ type: String, default: null })
  canal: string | null;

  // FR-6: normalização no set evita "fé"/"Fé" virarem tags distintas.
  @Prop({
    type: [String],
    default: [],
    set: (tags: string[]) => [
      ...new Set(
        (tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
      ),
    ],
  })
  tags: string[];

  // FR-9: data futura = agendada (fora das rotas públicas até a hora);
  // nulo = publicada desde a criação.
  @Prop({ type: Date, default: null })
  publicarEm: Date | null;

  /*
   * Termos canônicos para a busca (FR-7) — derivados de titulo/tags/corpo
   * pelo tokenizador de busca.util.ts, no pre('save') abaixo. Internos:
   * select:false os mantém fora de toda resposta da API; os índices multikey
   * fazem o $match da busca ser indexado. Mensagens anteriores a este campo
   * são preenchidas por scripts/backfill-termos.ts (e pelo seed).
   */
  @Prop({ type: [String], select: false, index: true })
  termosTitulo?: string[];

  @Prop({ type: [String], select: false, index: true })
  termosTags?: string[];

  @Prop({ type: [String], select: false, index: true })
  termosCorpo?: string[];

  createdAt?: Date;
  updatedAt?: Date;
}

export type MensagemDocument = Mensagem & Document;
export const MensagemSchema = SchemaFactory.createForClass(Mensagem);

// Cobre a leitura pública: filtro por publicarEm ($or usa as duas pontas do
// campo) já ordenado por data descendente — sem varredura nem sort em memória.
MensagemSchema.index({ publicarEm: 1, data: -1 });

// Escreveu titulo/tags/corpo → os termos de busca acompanham. Vale para o
// create() e para o update() (Object.assign + save) do service; cargas por
// updateOne (seed, backfill) calculam os termos por conta própria.
MensagemSchema.pre('save', function () {
  if (
    this.isModified('titulo') ||
    this.isModified('tags') ||
    this.isModified('corpo')
  ) {
    Object.assign(this, termosDe(this));
  }
});
