import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
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

  @Get()
  findAll() {
    return this.musicasService.findPublicadas();
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string) {
    return this.musicasService.findPorSlug(slug);
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
  @Patch(':slug')
  update(@Param('slug') slug: string, @Body() dto: UpdateMusicaDto) {
    return this.musicasService.update(slug, dto);
  }
}
