import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, RootFilterQuery } from 'mongoose';
import { CreateMensagemDto } from './dto/create-mensagem.dto';
import { UpdateMensagemDto } from './dto/update-mensagem.dto';
import { tokens } from './busca.util';
import { Mensagem, MensagemDocument } from './mensagens.model';

/** Publicada = sem agendamento, ou com a hora marcada já vencida (FR-9). */
const publicada = () => ({
  $or: [{ publicarEm: null }, { publicarEm: { $lte: new Date() } }],
});

/** Os campos que o site usa — nada de _id, __v, timestamps ou termos*. */
const CAMPOS_PUBLICOS =
  'data titulo corpo assinatura proveniencia canal tags -_id';
const CAMPOS_LISTA = 'data titulo tags -_id';

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Data de hoje no fuso do Movimento, pelo relógio DO SERVIDOR — não do
 *  aparelho do visitante, que pode estar errado (FR-1). */
const hojeEmFortaleza = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

@Injectable()
export class MensagensService {
  constructor(
    @InjectModel(Mensagem.name)
    private readonly mensagemModel: Model<MensagemDocument>,
  ) {}

  async create(dto: CreateMensagemDto) {
    const existente = await this.mensagemModel
      .findOne({ data: dto.data })
      .exec();
    if (existente) {
      throw new ConflictException(
        `Já existe uma mensagem no dia ${dto.data}. Para corrigi-la, use a edição.`,
      );
    }
    return this.mensagemModel.create(dto);
  }

  /** Todas as publicadas, documento completo — mantida para compatibilidade
   *  (GET /mensagens?formato=completo). A listagem normal é findLista. */
  findPublicadas() {
    return this.mensagemModel
      .find(publicada())
      .sort({ data: -1 })
      .select(CAMPOS_PUBLICOS)
      .lean()
      .exec();
  }

  /**
   * O índice do Acervo: só data/titulo/tags — ~3% do peso do documento
   * completo. `desde` (exclusivo) e `limite` deixam a porta do cursor aberta
   * para quando o índice inteiro pesar; hoje o site pede tudo de uma vez.
   */
  async findLista({ desde, limite }: { desde?: string; limite?: number } = {}) {
    if (desde !== undefined && !DATA_ISO.test(desde)) {
      throw new BadRequestException('O parâmetro "desde" deve ser AAAA-MM-DD.');
    }
    const filtro: RootFilterQuery<MensagemDocument> = desde
      ? { $and: [publicada(), { data: { $lt: desde } }] }
      : publicada();
    const [total, itens] = await Promise.all([
      this.mensagemModel.countDocuments(publicada()).exec(),
      this.mensagemModel
        .find(filtro)
        .sort({ data: -1 })
        .limit(limite ?? 0)
        .select(CAMPOS_LISTA)
        .lean()
        .exec(),
    ]);
    return { total, itens };
  }

  /**
   * O que a home precisa para pintar o primeiro conteúdo: a mensagem de hoje
   * — ou, sem ela, a mais recente publicada (a maior `data` publicada é
   * exatamente isso) — mais a data de referência e o total do acervo.
   */
  async findDestaque() {
    const [mensagem, total] = await Promise.all([
      this.mensagemModel
        .findOne(publicada())
        .sort({ data: -1 })
        .select(CAMPOS_PUBLICOS)
        .lean()
        .exec(),
      this.mensagemModel.countDocuments(publicada()).exec(),
    ]);
    return { hoje: hojeEmFortaleza(), total, mensagem: mensagem ?? null };
  }

  // FR-9: "o Publicador vê o que está programado e ainda não apareceu."
  findAgendadas() {
    return this.mensagemModel
      .find({ publicarEm: { $gt: new Date() } })
      .sort({ publicarEm: 1 })
      .lean()
      .exec();
  }

  async findPorData(data: string) {
    const mensagem = await this.mensagemModel
      .findOne({ data, ...publicada() })
      .select(CAMPOS_PUBLICOS)
      .lean()
      .exec();
    if (!mensagem) {
      throw new NotFoundException('Não há mensagem publicada nessa data.');
    }
    return mensagem;
  }

  /**
   * Busca por termos — FR-7, o MESMO ranking que o site fazia no navegador:
   * por termo presente, título vale 3, tag 2, corpo 1; ordena por quantos
   * termos a mensagem tem, depois pontos, depois data. Como os pesos são
   * aditivos por termo, a fórmula vira interseções de conjuntos sobre os
   * campos termos* (multikey, então o $match é indexado). Equivalência
   * garantida por scripts/testar-equivalencia-busca.mjs.
   */
  async buscar({
    q,
    tag,
    de,
    ate,
    limite,
  }: {
    q?: string;
    tag?: string;
    de?: string;
    ate?: string;
    limite: number;
  }) {
    for (const [nome, valor] of Object.entries({ de, ate })) {
      if (valor !== undefined && !DATA_ISO.test(valor)) {
        throw new BadRequestException(
          `O parâmetro "${nome}" deve ser AAAA-MM-DD.`,
        );
      }
    }

    const condicoes: RootFilterQuery<MensagemDocument>[] = [publicada()];
    if (tag) condicoes.push({ tags: tag });
    if (de) condicoes.push({ data: { $gte: de } });
    if (ate) condicoes.push({ data: { $lte: ate } });

    const termos = q ? tokens(q) : [];

    // Sem termos: filtro puro (tag e/ou período), mais recente primeiro —
    // o mesmo que o Acervo faz hoje ao clicar numa tag sem digitar nada.
    if (termos.length === 0) {
      if (!tag && !de && !ate) return { total: 0, itens: [] };
      const filtro = { $and: condicoes };
      const [total, itens] = await Promise.all([
        this.mensagemModel.countDocuments(filtro).exec(),
        this.mensagemModel
          .find(filtro)
          .sort({ data: -1 })
          .limit(limite)
          .select(CAMPOS_LISTA)
          .lean()
          .exec(),
      ]);
      return { total, itens };
    }

    condicoes.push({
      $or: [
        { termosTitulo: { $in: termos } },
        { termosTags: { $in: termos } },
        { termosCorpo: { $in: termos } },
      ],
    });

    const nosTitulos = { $ifNull: ['$termosTitulo', []] };
    const nasTags = { $ifNull: ['$termosTags', []] };
    const noCorpo = { $ifNull: ['$termosCorpo', []] };
    const pipeline: PipelineStage[] = [
      { $match: { $and: condicoes } },
      {
        $addFields: {
          _titulo: { $size: { $setIntersection: [nosTitulos, termos] } },
          _tags: { $size: { $setIntersection: [nasTags, termos] } },
          _corpo: { $size: { $setIntersection: [noCorpo, termos] } },
          _encontrados: {
            $size: {
              $setIntersection: [
                { $setUnion: [nosTitulos, nasTags, noCorpo] },
                termos,
              ],
            },
          },
        },
      },
      {
        $addFields: {
          _pontos: {
            $add: [
              { $multiply: [3, '$_titulo'] },
              { $multiply: [2, '$_tags'] },
              '$_corpo',
            ],
          },
        },
      },
      { $sort: { _encontrados: -1, _pontos: -1, data: -1 } },
      {
        $facet: {
          contagem: [{ $count: 'total' }],
          itens: [
            { $limit: limite },
            { $project: { _id: 0, data: 1, titulo: 1, tags: 1 } },
          ],
        },
      },
    ];

    const [resultado] = await this.mensagemModel.aggregate<{
      contagem: { total: number }[];
      itens: { data: string; titulo: string; tags: string[] }[];
    }>(pipeline);
    return { total: resultado.contagem[0]?.total ?? 0, itens: resultado.itens };
  }

  // FR-6: tags já usadas, oferecidas para reaproveitamento.
  async tags() {
    const tags = await this.mensagemModel.distinct('tags', publicada()).exec();
    return tags.sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  async update(data: string, dto: UpdateMensagemDto) {
    const mensagem = await this.mensagemModel.findOne({ data }).exec();
    if (!mensagem) {
      throw new NotFoundException('Não há mensagem nessa data.');
    }
    Object.assign(mensagem, dto);
    return mensagem.save();
  }
}
