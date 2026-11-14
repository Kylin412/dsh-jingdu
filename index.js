/**
 * Host half of dsh-deepseek-tts.
 *
 * Registers same-origin routes used by the browser plugin:
 * - POST   /api/dsh-tts/speak      text -> WAV via DeepSeek TTS
 * - POST   /api/dsh-tts/summarize  full answer -> short spoken summary
 * - GET/POST /api/dsh-tts/soul     read or replace the soul.md persona
 * - GET/POST/DELETE /api/dsh-tts/key  DEEPSEEK_API_KEY status / save / clear
 *
 * The API key is read from DSH credentials (or the launching environment), so a
 * key saved on one device works for every browser that uses the same DSH host.
 */
import { keyHandler } from './lib/routes/key.js';
import { soulHandler } from './lib/routes/soul.js';
import { speakHandler } from './lib/routes/speak.js';
import { summarizeHandler } from './lib/routes/summarize.js';

export const inject = ['connection'];

const ROUTES = [
  {
    path: '/api/dsh-tts/speak',
    methods: ['POST'],
    label: 'dsh-deepseek-tts speak route',
    handler: speakHandler,
  },
  {
    path: '/api/dsh-tts/summarize',
    methods: ['POST'],
    label: 'dsh-deepseek-tts summarize route',
    handler: summarizeHandler,
  },
  {
    path: '/api/dsh-tts/soul',
    methods: ['GET', 'POST'],
    label: 'dsh-deepseek-tts soul route',
    handler: soulHandler,
  },
  {
    path: '/api/dsh-tts/key',
    methods: ['GET', 'POST', 'DELETE'],
    label: 'dsh-deepseek-tts key route',
    handler: keyHandler,
  },
];

export function apply(ctx) {
  for (const route of ROUTES) {
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path: route.path,
          methods: route.methods,
          requestBody: 'buffered',
          fetch: route.handler(ctx),
        }),
      route.label,
    );
  }
}
