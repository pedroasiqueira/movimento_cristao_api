import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateMusicaDto } from './dto/create-musica.dto';
import { UpdateMusicaDto } from './dto/update-musica.dto';
import { Musica, MusicaDocument } from './musicas.model';

/**
 * Slug a partir do título (FR-14) — mesma normalização usada no site:
 * minúsculas, sem acento, não-alfanumérico vira hífen.
 */
export function gerarSlug(titulo: string): string {
  return titulo
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

@Injectable()
export class MusicasService {
  constructor(
    @InjectModel(Musica.name)
    private readonly musicaModel: Model<MusicaDocument>,
  ) {}

  async create(dto: CreateMusicaDto) {
    const slug = gerarSlug(dto.titulo);
    if (!slug) {
      throw new BadRequestException(
        'O título precisa conter letras ou números.',
      );
    }
    const existente = await this.musicaModel.findOne({ slug }).exec();
    if (existente) {
      throw new ConflictException(
        'Já existe uma música nesse endereço. Mude o título.',
      );
    }
    return this.musicaModel.create({ ...dto, slug });
  }

  // FR-10: listagem pública sem as despublicadas, por título (colação pt).
  findPublicadas() {
    return this.musicaModel
      .find({ despublicada: false })
      .collation({ locale: 'pt' })
      .sort({ titulo: 1 })
      .exec();
  }

  // FR-21: devolve também despublicada — a página é quem exibe o aviso.
  async findPorSlug(slug: string) {
    const musica = await this.musicaModel.findOne({ slug }).exec();
    if (!musica) {
      throw new NotFoundException('Não há música nesse endereço.');
    }
    return musica;
  }

  async update(slug: string, dto: UpdateMusicaDto) {
    const musica = await this.findPorSlug(slug);
    Object.assign(musica, dto);
    return musica.save();
  }
}
