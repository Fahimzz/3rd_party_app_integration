import { ValidationPipe } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false, cors: true });
  const adapter = app.getHttpAdapter() as ExpressAdapter;

  adapter.useBodyParser('json', false, { limit: '8mb' });
  adapter.useBodyParser('urlencoded', false, { extended: true, limit: '8mb' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  await app.listen(4000);
}

void bootstrap();
