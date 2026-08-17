import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateMensagemDto } from './create-mensagem.dto';

// FR-20: corrige texto, título ou tags PRESERVANDO o endereço — a data
// (que é o endereço) fica de fora do que pode mudar.
export class UpdateMensagemDto extends PartialType(
  OmitType(CreateMensagemDto, ['data'] as const),
) {}
