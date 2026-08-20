import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { randomBytes } from 'node:crypto';
import { Model } from 'mongoose';
import { CreateMusicaDto } from './dto/create-musica.dto';
import { UpdateMusicaDto } from './dto/update-musica.dto';
import { Musica, MusicaDocument } from './musicas.model';

/**
 * O código do endereço público (FR-14): 8 caracteres base36, sorteados.
 *
 * Sorteado de propósito, e não derivado do título como era até 20/08/2026: o
 * endereço precisa sobreviver a uma correção de título. São ~2,8e12
 * combinações — folga absurda para um repertório de dezenas de músicas, e o
 * índice único do banco cobre o azar.
 *
 * Só minúsculas e dígitos: o endereço circula colado no WhatsApp, onde
 * maiúscula é ruído e fonte de erro ao redigitar.
 */
export function gerarCodigo(): string {
  return BigInt('0x' + randomBytes(8).toString('hex'))
    .toString(36)
    .slice(-8)
    .padStart(8, '0');
}

@Injectable()
export class MusicasService {
  constructor(
    @InjectModel(Musica.name)
    private readonly musicaModel: Model<MusicaDocument>,
  ) {}

  /**
   * Duas músicas de mesmo título convivem sem conflito desde que o endereço
   * deixou de nascer do título — por isso não há mais checagem de duplicata
   * aqui. O retry cobre a colisão de sorteio, que a chave única do banco
   * denuncia com o código 11000.
   */
  async create(dto: CreateMusicaDto) {
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      try {
        return await this.musicaModel.create({ ...dto, codigo: gerarCodigo() });
      } catch (erro) {
        if ((erro as { code?: number })?.code !== 11000) throw erro;
      }
    }
    throw new InternalServerErrorException(
      'Não foi possível gerar o endereço da música. Tente de novo.',
    );
  }

  // FR-10: listagem pública sem as despublicadas, por título (colação pt).
  findPublicadas() {
    return this.musicaModel
      .find({ despublicada: false })
      .collation({ locale: 'pt' })
      .sort({ titulo: 1 })
      .exec();
  }

  // Repertório inteiro, despublicadas incluídas — o site usa para o aviso
  // do FR-21. Elas ficam de fora só da LISTAGEM pública, não do dado.
  findTodas() {
    return this.musicaModel
      .find()
      .collation({ locale: 'pt' })
      .sort({ titulo: 1 })
      .exec();
  }

  // FR-21: devolve também despublicada — a página é quem exibe o aviso.
  async findPorCodigo(codigo: string) {
    const musica = await this.musicaModel.findOne({ codigo }).exec();
    if (!musica) {
      throw new NotFoundException('Não há música nesse endereço.');
    }
    return musica;
  }

  /**
   * O título entra aqui como qualquer outro campo: o endereço é o código, que
   * ninguém edita, então corrigir o nome da música não move a música de lugar.
   *
   * Só o que veio no corpo é gravado. O ValidationPipe materializa as chaves
   * do DTO que o cliente NÃO mandou como `undefined`, e um Object.assign cru
   * as escrevia por cima: um PATCH que só corrigia o título apagava
   * `despublicada` do documento, e a música desaparecia da listagem pública —
   * que filtra por `despublicada: false` e não casa com campo ausente.
   *
   * `null` passa: é como o site pede para APAGAR um campo opcional de
   * propósito, diferente de não ter falado nele.
   */
  async update(codigo: string, dto: UpdateMusicaDto) {
    const musica = await this.findPorCodigo(codigo);
    const mudancas = Object.fromEntries(
      Object.entries(dto).filter(([, valor]) => valor !== undefined),
    );
    Object.assign(musica, mudancas);
    return musica.save();
  }

  /**
   * Exclusão definitiva — diferente de despublicar (FR-21), aqui o endereço
   * deixa de existir. Ver a nota em musicas.model.ts.
   *
   * Devolve o código em vez do documento: a letra apagada não tem por que
   * trafegar de volta.
   */
  async remove(codigo: string) {
    const apagada = await this.musicaModel.findOneAndDelete({ codigo }).exec();
    if (!apagada) {
      throw new NotFoundException('Não há música nesse endereço.');
    }
    return { codigo };
  }
}
