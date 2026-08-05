import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { ZodError } from 'zod';
import { AppModule } from './app';

// BigInt kobo serialises as strings over the wire (ADR-001)
(BigInt.prototype as any).toJSON = function () { return this.toString(); };

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'], bodyParser: false });
  const express = require('express');
  app.use(express.json({ limit: '15mb' })); // DMS base64 uploads (10MB decoded cap)
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.enableCors({ origin: true, credentials: true });

  // zod errors → 400 with readable details
  app.useGlobalFilters({
    catch(exception: unknown, host: any) {
      const res = host.switchToHttp().getResponse();
      if (exception instanceof ZodError) {
        res.status(400).json({
          statusCode: 400, error: 'Validation failed',
          issues: exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
        return;
      }
      const status = (exception as any)?.getStatus?.() ?? 500;
      const body = (exception as any)?.getResponse?.() ?? { statusCode: 500, message: 'Internal server error' };
      if (status === 500) console.error(exception);
      res.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
    },
  } as any);

  const port = Number(process.env.PORT) || 3001;
  await app.listen(port);
  console.log(`WEWE ERP API listening on :${port}`);
}
bootstrap();
