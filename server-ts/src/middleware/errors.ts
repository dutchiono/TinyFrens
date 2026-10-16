import { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';

export function registerErrorHandler(app: FastifyInstance, context: AppContext): void {
  app.setErrorHandler((error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) => {
    let statusCode = (error as FastifyError).statusCode || 500;
    let message = error.message;

    if ((error as FastifyError).code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      (reply as FastifyReply & { skipOriginHeaders?: boolean }).skipOriginHeaders = true;
      return reply.status(413).type('text/plain; charset=utf-8').send('Maximum request body size 4096 exceeded.');
    }

    if (message === 'Origin not allowed') {
      return reply.status(403).type('text/plain; charset=utf-8').send(message);
    } else if (
      message.includes('JSON') ||
      message.includes('validation') ||
      message.includes('required') ||
      (error as FastifyError).code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE'
    ) {
      statusCode = 400;
    }

    const propertyNameError = message.match(
      /^Expected property name or '}' in JSON at position (\d+) \(line (\d+) column (\d+)\)$/
    );
    if (propertyNameError) {
      message = `Expecting property name enclosed in double quotes: line ${propertyNameError[2]} column ${propertyNameError[3]} (char ${propertyNameError[1]})`;
    }

    message = redactSecrets(message);

    if (statusCode >= 500) {
      const route = request.routeOptions.url || request.url.split('?', 1)[0];
      void context.operationalAlerts.report(
        `http:${request.method}:${route}`,
        `Unhandled HTTP ${statusCode} from ${request.method} ${route}`,
        message
      );
    }

    reply.status(statusCode).send({ error: message });
  });
}

function redactSecrets(text: string): string {
  return text
    .replace(/0x[a-fA-F0-9]{64}/g, '[REDACTED_KEY]')
    .replace(/AIza[0-9A-Za-z-_]{35}/g, '[REDACTED_KEY]')
    .replace(/ghp_[0-9A-Za-z]{36}/g, '[REDACTED_TOKEN]')
    .replace(/github_pat_[0-9A-Za-z_]{82}/g, '[REDACTED_TOKEN]');
}
