import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class SecaoDto {
  @IsIn(['estrofe', 'refrao'], {
    message: 'Cada seção é "estrofe" ou "refrao".',
  })
  tipo: 'estrofe' | 'refrao';

  @IsArray()
  @ArrayMinSize(1, { message: 'Cada seção precisa de ao menos um verso.' })
  @IsString({ each: true })
  linhas: string[];
}

// Espelha o JSON que o formulário da Área Admin do site gera. O campo "id"
// que o formulário inclui é descartado pelo whitelist do ValidationPipe —
// o slug nasce do título aqui no servidor, com a mesma normalização.
export class CreateMusicaDto {
  @IsString()
  @IsNotEmpty({ message: 'A música precisa de um título.' })
  titulo: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  autores?: string[];

  @IsArray()
  @ArrayMinSize(1, { message: 'A letra precisa de ao menos uma seção.' })
  @ValidateNested({ each: true })
  @Type(() => SecaoDto)
  secoes: SecaoDto[];
}
