import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
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
import { CreateMensagemDto } from './dto/create-mensagem.dto';
import { UpdateMensagemDto } from './dto/update-mensagem.dto';
import { MensagensService } from './mensagens.service';

/**
 * limite: inteiro 1..500, ou indefinido. Fora disso é erro do chamador —
 * melhor avisar que devolver silenciosamente outra quantidade.
 */
function lerLimite(bruto: string | undefined, padrao?: number) {
  if (bruto === undefined || bruto === '') return padrao;
  const n = Number(bruto);
  if (!Number.isInteger(n) || n < 1 || n > 500) {
    throw new BadRequestException(
      'O parâmetro "limite" deve ser um inteiro entre 1 e 500.',
    );
  }
  return n;
}

@Controller('mensagens')
export class MensagensController {
  constructor(private readonly mensagensService: MensagensService) {}

  // ---- Leitura pública: o site lê sem autenticação (FR-1 a FR-8) ----
  // Cache-Control em toda rota pública: o conteúdo muda no máximo umas
  // poucas vezes por dia, e o público-alvo reabre o site diariamente —
  // stale-while-revalidate serve o cache na hora e atualiza por trás.
  // O ETag do Express completa com 304 quando nada mudou.

  /**
   * Padrão: o índice leve `{ total, itens: [{data, titulo, tags}] }` — ~3%
   * do peso do acervo completo.
   *
   * `?formato=completo` NÃO é mais compatibilidade: desde 20/08/2026 é a fonte
   * de dados da pré-renderização do site (movimento_cristao/scripts/prerender.mjs),
   * que gera uma página HTML por Mensagem a cada build. Uma requisição no lugar
   * de novecentas. Removê-la não quebra o build de forma visível — ele cai em
   * silêncio para a cópia versionada do acervo e passa a publicar páginas
   * paradas no tempo.
   *
   * `desde` (exclusivo, mais antigas que) e `limite` são o cursor de reserva
   * para quando o acervo crescer a ponto de o índice inteiro pesar.
   */
  @Get()
  @Header('Cache-Control', 'public, max-age=120, stale-while-revalidate=604800')
  findAll(
    @Query('formato') formato?: string,
    @Query('desde') desde?: string,
    @Query('limite') limite?: string,
  ) {
    if (formato === 'completo') return this.mensagensService.findPublicadas();
    return this.mensagensService.findLista({
      desde,
      limite: lerLimite(limite),
    });
  }

  // Rotas fixas declaradas antes de :data para não serem engolidas por ela.

  /** O primeiro conteúdo da home: a mensagem de hoje (ou a mais recente),
   *  a data de referência pelo relógio do servidor e o total do acervo. */
  @Get('destaque')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=86400')
  destaque() {
    return this.mensagensService.findDestaque();
  }

  /** Busca por termos e filtros — FR-7/FR-8, mesmo ranking do site. */
  @Get('busca')
  @Header('Cache-Control', 'public, max-age=120, stale-while-revalidate=86400')
  buscar(
    @Query('q') q?: string,
    @Query('tag') tag?: string,
    @Query('de') de?: string,
    @Query('ate') ate?: string,
    @Query('limite') limite?: string,
  ) {
    return this.mensagensService.buscar({
      q,
      tag,
      de,
      ate,
      limite: lerLimite(limite, 60) as number,
    });
  }

  @Get('tags')
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=604800')
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
  @Header(
    'Cache-Control',
    'public, max-age=300, stale-while-revalidate=2592000',
  )
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
