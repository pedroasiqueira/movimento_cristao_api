import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateMusicaDto } from './create-musica.dto';

// O slug (endereço, FR-14) não muda nunca — por isso não está aqui.
// despublicada: true retira de circulação preservando o endereço (FR-21).
export class UpdateMusicaDto extends PartialType(CreateMusicaDto) {
  @IsOptional()
  @IsBoolean()
  despublicada?: boolean;
}
