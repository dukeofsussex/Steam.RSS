import { oneLine, stripIndent } from 'common-tags';
import { createLogger, format, transports } from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import env from './env';

const {
  colorize,
  combine,
  errors,
  printf,
  timestamp,
} = format;

const logFormat = combine(
  timestamp(),
  errors({ stack: true }),
  printf((info) => stripIndent`
    ${oneLine`
      ${info.timestamp}
      [${info.level.toUpperCase()}]:
      ${(info.group ? `[${info.group}] ` : '')}
    `} ${info.message}
  `),
);

const logger = createLogger({
  level: env.logging.level,
  format: logFormat,
  transports: [
    new DailyRotateFile({
      datePattern: 'YYYY-MM-DD',
      dirname: 'logs',
      filename: '%DATE%.log',
      handleExceptions: true,
      level: 'info',
      format: logFormat,
      maxFiles: '30d',
      utc: true,
    }),
  ],
});

if (env.debug) {
  logger.add(new transports.Console({
    format: combine(
      colorize({ all: true }),
      logFormat,
    ),
    handleExceptions: true,
  }));
}

export default logger;
