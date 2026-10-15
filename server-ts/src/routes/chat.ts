import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppContext } from '../context.js';
import { normalizeProfile } from '../domain/profile.js';
import { getClientIp } from '../rate-limit.js';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent';

export function registerChatRoutes(app: FastifyInstance, context: AppContext): void {
  app.post('/api/chat', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const ip = getClientIp(request, context.config.TRUST_PROXY);
      context.rateLimiter.limit(`chat:${ip}`, 30, 3600, context.now());

      const body = request.body as any;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return reply.status(400).send({ error: 'Pet chat is having trouble right now' });
      }

      const p = normalizeProfile(body.pet);
      const rawMessage = String(body.message || '');
      const cleaned = rawMessage.replace(/[\x00-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim();
      if (cleaned.length < 1 || cleaned.length > 400) {
        return reply.status(400).send({ error: 'Pet chat is having trouble right now' });
      }

      const apiKey = context.config.GEMINI_API_KEY || context.config.GOOGLE_API_KEY;
      if (!apiKey) {
        return reply.status(503).send({ error: 'Pet chat is not connected yet' });
      }

      const model = context.config.GEMINI_MODEL || 'gemini-3.5-flash-lite';
      const system =
        'You are a TinyFren: a tiny, warm, playful pocket-pet companion. ' +
        'Reply in one or two short sentences. No markdown. No financial advice, trading instructions, ' +
        'private-key handling, seed phrases, or promises about prices. If wallet or token data is missing, say so gently.';
      const prompt = `Pet name: ${p.name}. Pet shape: ${p.shape}. User says: ${cleaned}`;

      const payload = {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 120 },
      };

      const targetUrl = GEMINI_URL.replace('{model}', model);
      let responseData: any;

      try {
        const res = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(18000),
        });

        if (!res.ok) {
          return reply.status(400).send({ error: 'Pet chat is having trouble right now' });
        }
        responseData = await res.json();
      } catch {
        return reply.status(400).send({ error: 'Pet chat is having trouble right now' });
      }

      const parts = responseData?.candidates?.[0]?.content?.parts || [];
      let replyText = parts
        .map((part: any) => String(part.text || ''))
        .join(' ')
        .trim();
      replyText = replyText.replace(/[*_`#>\[\]]/g, '');
      if (!replyText) {
        replyText = `${p.name} blinks, thinking very hard.`;
      }

      return reply.status(200).send({ reply: replyText.slice(0, 500) });
    } catch {
      return reply.status(400).send({ error: 'Pet chat is having trouble right now' });
    }
  });
}
