import { Type } from 'class-transformer';
import {
  IsArray,
  IsDate,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class CreateMensagemDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'A data deve estar no formato AAAA-MM-DD.',
  })
  data: string;

  @IsString()
  @IsNotEmpty({ message: 'A mensagem precisa de um título.' })
  titulo: string;

  @IsString()
  @IsNotEmpty({ message: 'A mensagem precisa de um corpo.' })
  corpo: string;

  @IsOptional()
  @IsString()
  assinatura?: string;

  @IsOptional()
  @IsString()
  proveniencia?: string;

  @IsOptional()
  @IsString()
  canal?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  // FR-9: agendamento — no futuro publica na hora marcada.
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'publicarEm deve ser uma data válida.' })
  publicarEm?: Date;
}
