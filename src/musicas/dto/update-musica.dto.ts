import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateMusicaDto } from './create-musica.dto';

// O código (endereço, FR-14) é sorteado no servidor e não muda nunca — por
// isso não está aqui. O título, sim: ele é conteúdo, e corrigi-lo não mexe no
// endereço desde que este deixou de nascer dele.
// despublicada: true retira de circulação preservando o endereço (FR-21).
export class UpdateMusicaDto extends PartialType(CreateMusicaDto) {
  @IsOptional()
  @IsBoolean()
  despublicada?: boolean;
}
