import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

/*
 * Conexão única com o MongoDB. Diferente do dacapo (dotenv + process.env em
 * tempo de import), a URI vem do ConfigService no bootstrap: getOrThrow
 * derruba a subida cedo, com mensagem clara, se o .env estiver ausente.
 */
@Module({
  imports: [
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        uri: configService.getOrThrow<string>('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),
  ],
  exports: [MongooseModule],
})
export class DatabaseModule {}
