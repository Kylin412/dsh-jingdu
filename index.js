/**
 * Host half of dsh-jingdu (鲸读).
 *
 * Registers same-origin routes used by the browser plugin:
 * - POST   /api/dsh-tts/speak      text -> WAV via DeepSeek TTS
 * - POST   /api/dsh-tts/summarize  full answer -> short spoken summary
 * - GET/POST /api/dsh-tts/soul     read or replace the soul.md persona
 * - GET/POST/DELETE /api/dsh-tts/key  plugin-private API key status / save / clear
 *
 * The API key is stored only in this plugin's private credential record
 * (legacy record name `dsh-deepseek-tts/api-key`) or read from
 * `DSH_TTS_API_KEY`, never from DSH's shared `DEEPSEEK_API_KEY`.
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
    label: 'dsh-jingdu speak route',
    handler: speakHandler,
  },
  {
    path: '/api/dsh-tts/summarize',
    methods: ['POST'],
    label: 'dsh-jingdu summarize route',
    handler: summarizeHandler,
  },
  {
    path: '/api/dsh-tts/soul',
    methods: ['GET', 'POST'],
    label: 'dsh-jingdu soul route',
    handler: soulHandler,
  },
  {
    path: '/api/dsh-tts/key',
    methods: ['GET', 'POST', 'DELETE'],
    label: 'dsh-jingdu key route',
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
