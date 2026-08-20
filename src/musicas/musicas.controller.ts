import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { Role } from '../auth/roles.enum';
import { CreateMusicaDto } from './dto/create-musica.dto';
import { UpdateMusicaDto } from './dto/update-musica.dto';
import { MusicasService } from './musicas.service';

@Controller('musicas')
export class MusicasController {
  constructor(private readonly musicasService: MusicasService) {}

  // ---- Leitura pública (FR-10, FR-14, FR-21) ----

  // ?incluir=despublicadas devolve o repertório inteiro: o site precisa das
  // despublicadas para a página de aviso do FR-21 (o endereço nunca quebra).
  @Get()
  findAll(@Query('incluir') incluir?: string) {
    return incluir === 'despublicadas'
      ? this.musicasService.findTodas()
      : this.musicasService.findPublicadas();
  }

  @Get(':codigo')
  findOne(@Param('codigo') codigo: string) {
    return this.musicasService.findPorCodigo(codigo);
  }

  // ---- Escrita do administrador ----

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post()
  create(@Body() dto: CreateMusicaDto) {
    return this.musicasService.create(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':codigo')
  update(@Param('codigo') codigo: string, @Body() dto: UpdateMusicaDto) {
    return this.musicasService.update(codigo, dto);
  }

  /** Apaga de verdade — ver a nota em musicas.model.ts. Retirar de circulação
   *  sem quebrar o endereço continua sendo o PATCH com `despublicada`. */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Delete(':codigo')
  remove(@Param('codigo') codigo: string) {
    return this.musicasService.remove(codigo);
  }
}
