import { WinstonModuleOptions } from 'nest-winston';
import * as winston from 'winston';
import 'winston-daily-rotate-file';

export const createWinstonConfig = (
  logDir: string,
  logLevel: string,
  maxFiles: string,
  maxSize: string,
): WinstonModuleOptions => {
  const { combine, timestamp, errors, json, colorize, printf } = winston.format;

  const consoleFormat = combine(
    colorize({ all: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    printf(({ timestamp, level, message, context, stack, ...meta }) => {
      const ctx = context ? `[${context}]` : '';
      const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
      return `${timestamp} ${level} ${ctx} ${message} ${metaStr}${stack ? '\n' + stack : ''}`;
    }),
  );

  const fileFormat = combine(timestamp(), errors({ stack: true }), json());

  const transports: winston.transport[] = [
    new winston.transports.Console({
      format: consoleFormat,
    }),
    new (winston.transports as any).DailyRotateFile({
      filename: `${logDir}/app-%DATE%.log`,
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize,
      maxFiles,
      format: fileFormat,
    }),
    new (winston.transports as any).DailyRotateFile({
      filename: `${logDir}/error-%DATE%.log`,
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize,
      maxFiles,
      level: 'error',
      format: fileFormat,
    }),
  ];

  return {
    level: logLevel,
    format: fileFormat,
    transports,
  };
};
