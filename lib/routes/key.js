/** GET/POST/DELETE /api/dsh-tts/key: inspect, save, or clear the plugin's own API key. */
import { clearApiKey, describeApiKey, isPlausibleKey, saveApiKey } from '../credentials.js';
import { json } from '../http.js';

export function keyHandler(ctx) {
  return async (request) => {
    if (request.method === 'GET') {
      const info = await describeApiKey(ctx);
      if (info.available === false) {
        return json(503, {
          error: 'credentials_unavailable',
          message: 'DSH 凭据服务不可用，无法保存 API Key。请改用浏览器本地保存。',
        });
      }
      return json(200, { configured: info.configured, writable: info.writable });
    }

    if (request.method === 'DELETE') {
      try {
        await clearApiKey(ctx);
        return json(200, { configured: false });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return json(500, { error: 'unset_failed', message });
      }
    }

    let input;
    try {
      input = await request.json();
    } catch {
      return json(400, { error: 'invalid_json', message: '请求体必须是 JSON。' });
    }
    const apiKey = typeof input?.apiKey === 'string' ? input.apiKey.trim() : '';
    if (!isPlausibleKey(apiKey)) {
      return json(400, {
        error: 'invalid_api_key',
        message: 'DeepSeek API Key 应以 sk- 开头，请检查后重试。',
      });
    }
    try {
      await saveApiKey(ctx, apiKey);
      return json(200, { configured: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(500, { error: 'set_failed', message });
    }
  };
}
