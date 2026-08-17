import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { Mensagem, MensagemSchema } from './mensagens.model';
import { MensagensController } from './mensagens.controller';
import { MensagensService } from './mensagens.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Mensagem.name, schema: MensagemSchema },
    ]),
    AuthModule,
  ],
  controllers: [MensagensController],
  providers: [MensagensService],
  exports: [MensagensService],
})
export class MensagensModule {}
