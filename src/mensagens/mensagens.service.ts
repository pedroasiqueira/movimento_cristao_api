import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateMensagemDto } from './dto/create-mensagem.dto';
import { UpdateMensagemDto } from './dto/update-mensagem.dto';
import { Mensagem, MensagemDocument } from './mensagens.model';

/** Publicada = sem agendamento, ou com a hora marcada já vencida (FR-9). */
const publicada = () => ({
  $or: [{ publicarEm: null }, { publicarEm: { $lte: new Date() } }],
});

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

  findPublicadas() {
    return this.mensagemModel.find(publicada()).sort({ data: -1 }).exec();
  }

  // FR-9: "o Publicador vê o que está programado e ainda não apareceu."
  findAgendadas() {
    return this.mensagemModel
      .find({ publicarEm: { $gt: new Date() } })
      .sort({ publicarEm: 1 })
      .exec();
  }

  async findPorData(data: string) {
    const mensagem = await this.mensagemModel
      .findOne({ data, ...publicada() })
      .exec();
    if (!mensagem) {
      throw new NotFoundException('Não há mensagem publicada nessa data.');
    }
    return mensagem;
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
