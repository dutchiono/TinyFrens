import { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) => {
    let statusCode = (error as FastifyError).statusCode || 500;
    let message = error.message;

    if (message === 'Origin not allowed') {
      return reply.status(403).type('text/plain; charset=utf-8').send(message);
    } else if (
      message.includes('JSON') ||
      message.includes('validation') ||
      message.includes('required') ||
      (error as FastifyError).code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' ||
      (error as FastifyError).code === 'FST_ERR_CTP_BODY_TOO_LARGE'
    ) {
      statusCode = 400;
    }

    // Redact sensitive patterns (private keys, tokens, api keys)
    message = redactSecrets(message);

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
