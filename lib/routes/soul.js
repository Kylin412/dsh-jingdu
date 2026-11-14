/** GET/POST /api/dsh-tts/soul: read or replace soul.md. */
import { MAX_SOUL_BYTES } from '../config.js';
import { json } from '../http.js';
import { readSoul, saveSoul } from '../soul.js';

export function soulHandler() {
  return async (request) => {
    if (request.method === 'GET') return json(200, readSoul());

    let input;
    try {
      input = await request.json();
    } catch {
      return json(400, { error: 'invalid_json', message: '请求体必须是 JSON。' });
    }
    const content = typeof input?.content === 'string' ? input.content : '';
    if (content.trim().length === 0) {
      return json(400, { error: 'empty_soul', message: 'soul.md 不能为空。' });
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_SOUL_BYTES) {
      return json(413, { error: 'soul_too_large', message: `soul.md 不能超过 ${MAX_SOUL_BYTES} 字节。` });
    }
    try {
      saveSoul(content);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(500, { error: 'soul_write_failed', message: `无法写入 soul.md：${message}` });
    }
    return json(200, readSoul());
  };
}
