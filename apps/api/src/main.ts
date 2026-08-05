import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ZodError } from 'zod';
import { AppModule } from './app';

// BigInt kobo serialises as strings over the wire (ADR-001)
(BigInt.prototype as any).toJSON = function () { return this.toString(); };

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'], bodyParser: false });
  const express = require('express');
  const inst = app.getHttpAdapter().getInstance();
  inst.disable('x-powered-by');                       // no stack disclosure
  // Security response headers (defence in depth; TLS/HSTS handled at the proxy)
  app.use((_req: any, res: any, next: any) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    next();
  });
  app.use(express.json({ limit: '15mb' })); // DMS base64 uploads (10MB decoded cap)
  app.use(express.urlencoded({ extended: true, limit: '15mb' }));
  app.use(cookieParser());
  // Production: set CORS_ORIGIN to the web origin; default stays permissive for dev.
  const corsOrigin = process.env.CORS_ORIGIN;
  app.enableCors({ origin: corsOrigin ? corsOrigin.split(',') : true, credentials: true });
  (app.getHttpAdapter().getInstance() as any).set?.('trust proxy', 1); // secure cookies behind TLS proxy

  // API-01: the versioned REST surface is a product — document it.
  const doc = SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle('WEWE ERP API')
    .setDescription('Five-stage approval workflow ERP for WEWE. Session-cookie auth; all money as kobo strings.')
    .setVersion('1.0')
    .build());
  SwaggerModule.setup('docs', app, doc);

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
      // body-parser errors carry their own HTTP status (e.g. 413 PayloadTooLarge)
      const rawStatus = (exception as any)?.getStatus?.() ?? (exception as any)?.status ?? (exception as any)?.statusCode ?? 500;
      const status = typeof rawStatus === 'number' ? rawStatus : 500;
      const body = (exception as any)?.getResponse?.() ?? { statusCode: status, message: status === 413 ? 'Payload too large' : 'Internal server error' };
      if (status >= 500) console.error(exception);
      res.status(status).json(typeof body === 'string' ? { statusCode: status, message: body } : body);
    },
  } as any);

  const port = Number(process.env.PORT) || 3001;
  await app.listen(port);
  console.log(`WEWE ERP API listening on :${port}`);
}
bootstrap();
