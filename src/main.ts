import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import compression from 'compression';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Compressão HTTP: o acervo é texto puro e encolhe ~3,7×. Se um dia houver
  // nginx com gzip na frente, não há dupla compressão — ele pula respostas
  // que já chegam com Content-Encoding.
  app.use(compression());

  // Diferente do dacapo, whitelist+transform desde o início: DTOs descartam
  // campos extras (ex.: o "id" que o formulário admin envia) e convertem
  // tipos (publicarEm string -> Date).
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const origens = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5173',
    process.env.FRONTEND_URL,
  ].filter((origem): origem is string => Boolean(origem));

  app.enableCors({
    origin: origens,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
void bootstrap();
