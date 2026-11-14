/** POST /api/dsh-tts/speak: text -> WAV via DeepSeek TTS. */
import { MAX_CHARACTERS, TTS_URL } from '../config.js';
import { isPlausibleKey, resolveApiKey } from '../credentials.js';
import { json } from '../http.js';

export function speakHandler(ctx) {
  return async (request) => {
    let input;
    try {
      input = await request.json();
    } catch {
      return json(400, { error: 'invalid_json', message: '请求体必须是 JSON。' });
    }

    const text = typeof input?.text === 'string' ? input.text.trim() : '';
    if (text.length === 0) {
      return json(400, { error: 'empty_text', message: '没有可朗读的正文。' });
    }
    if (text.length > MAX_CHARACTERS) {
      return json(413, { error: 'text_too_long', message: `正文超过 ${MAX_CHARACTERS} 字，已拒绝朗读。` });
    }

    const voice = input?.voice === 'tide' ? 'tide' : 'stella';
    const apiKey = await resolveApiKey(ctx, request, input);
    if (apiKey === undefined) {
      return json(409, {
        error: 'missing_api_key',
        message:
          '未配置 DeepSeek API Key。请点击 🔊 后按提示填写 sk- 开头的 Key，或在「设置 → 鲸读」里保存。',
      });
    }
    if (!isPlausibleKey(apiKey)) {
      return json(400, {
        error: 'invalid_api_key',
        message: 'DeepSeek API Key 应以 sk- 开头，请检查后重试。',
      });
    }

    let upstream;
    try {
      upstream = await fetch(TTS_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ text, voice_id: voice, format: 'wav' }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(504, { error: 'tts_unreachable', message: `无法连接 DeepSeek TTS：${message}` });
    }

    if (!upstream.ok) {
      let detail = '';
      try {
        detail = (await upstream.text()).slice(0, 800);
      } catch {
        // Ignore an unreadable error body.
      }
      return json(upstream.status === 401 || upstream.status === 402 ? upstream.status : 502, {
        error: 'tts_failed',
        status: upstream.status,
        message: `DeepSeek TTS 返回 ${upstream.status}。${detail}`,
      });
    }

    const audio = Buffer.from(await upstream.arrayBuffer());
    if (audio.length === 0) {
      return json(502, { error: 'tts_empty_audio', message: 'DeepSeek TTS 没有返回音频。' });
    }
    return new Response(audio, {
      headers: {
        'content-type': 'audio/wav',
        'content-length': String(audio.length),
        'cache-control': 'no-store',
      },
    });
  };
}
