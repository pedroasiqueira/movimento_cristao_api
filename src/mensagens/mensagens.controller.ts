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
import { CreateMensagemDto } from './dto/create-mensagem.dto';
import { UpdateMensagemDto } from './dto/update-mensagem.dto';
import { MensagensService } from './mensagens.service';

@Controller('mensagens')
export class MensagensController {
  constructor(private readonly mensagensService: MensagensService) {}

  // ---- Leitura pública: o site lê sem autenticação (FR-1 a FR-8) ----

  @Get()
  findAll() {
    return this.mensagensService.findPublicadas();
  }

  // Rotas fixas declaradas antes de :data para não serem engolidas por ela.
  @Get('tags')
  tags() {
    return this.mensagensService.tags();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Get('agendadas/lista')
  agendadas() {
    return this.mensagensService.findAgendadas();
  }

  @Get(':data')
  findOne(@Param('data') data: string) {
    return this.mensagensService.findPorData(data);
  }

  // ---- Escrita do Publicador (FR-9, FR-20) ----

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Post()
  create(@Body() dto: CreateMensagemDto) {
    return this.mensagensService.create(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @Patch(':data')
  update(@Param('data') data: string, @Body() dto: UpdateMensagemDto) {
    return this.mensagensService.update(data, dto);
  }
}
