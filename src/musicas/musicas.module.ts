import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { Musica, MusicaSchema } from './musicas.model';
import { MusicasController } from './musicas.controller';
import { MusicasService } from './musicas.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Musica.name, schema: MusicaSchema }]),
    AuthModule,
  ],
  controllers: [MusicasController],
  providers: [MusicasService],
  exports: [MusicasService],
})
export class MusicasModule {}
