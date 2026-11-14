/** POST /api/dsh-tts/summarize: full answer -> short spoken summary. */
import { CHAT_URL, MAX_SUMMARY_INPUT } from '../config.js';
import { isPlausibleKey, resolveApiKey } from '../credentials.js';
import { json } from '../http.js';
import { readSoul } from '../soul.js';
import { sanitizeSummary, summarySystemPrompt } from '../summary.js';

export function summarizeHandler(ctx) {
  return async (request) => {
    let input;
    try {
      input = await request.json();
    } catch {
      return json(400, { error: 'invalid_json', message: '请求体必须是 JSON。' });
    }

    const text = typeof input?.text === 'string' ? input.text.trim() : '';
    if (text.length === 0) {
      return json(400, { error: 'empty_text', message: '没有可总结的正文。' });
    }
    if (text.length > MAX_SUMMARY_INPUT) {
      return json(413, { error: 'text_too_long', message: `正文超过 ${MAX_SUMMARY_INPUT} 字，无法生成总结。` });
    }

    const useSoul = input?.useSoul !== false;
    const persona = typeof input?.persona === 'string' ? input.persona.trim().slice(0, 160) : '';
    const soul = useSoul ? readSoul() : null;
    const soulBody = useSoul ? soul.body.slice(0, 1600) : '';
    const extraPersona = useSoul ? persona : '';

    const apiKey = await resolveApiKey(ctx, request, input);
    if (apiKey === undefined) {
      return json(409, {
        error: 'missing_api_key',
        message:
          '未配置 DeepSeek API Key，无法生成语音总结。请在「左侧栏 → DeepSeek 朗读」或「设置 → DeepSeek 朗读」里保存。',
      });
    }
    if (!isPlausibleKey(apiKey)) {
      return json(400, {
        error: 'invalid_api_key',
        message: 'DeepSeek API Key 应以 sk- 开头，请检查后重试。',
      });
    }

    // Short answers are already ideal for listening; skip the extra model call.
    if (text.length <= 140) {
      return json(200, { summary: text, source: 'original' });
    }

    let upstream;
    try {
      upstream = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: summarySystemPrompt({ soul: soulBody, persona: extraPersona }) },
            { role: 'user', content: `任务结果：\n${text}` },
          ],
          temperature: 0.2,
          max_tokens: 300,
          stream: false,
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json(504, { error: 'summary_unreachable', message: `无法连接 DeepSeek 总结服务：${message}` });
    }

    if (!upstream.ok) {
      let detail = '';
      try {
        detail = (await upstream.text()).slice(0, 800);
      } catch {
        // Ignore an unreadable error body.
      }
      return json(upstream.status === 401 || upstream.status === 402 ? upstream.status : 502, {
        error: 'summary_failed',
        status: upstream.status,
        message: `DeepSeek 总结服务返回 ${upstream.status}。${detail}`,
      });
    }

    let payload;
    try {
      payload = await upstream.json();
    } catch {
      return json(502, { error: 'summary_invalid', message: 'DeepSeek 总结服务返回了无法解析的响应。' });
    }

    const content = payload?.choices?.[0]?.message?.content;
    const summary = typeof content === 'string' ? sanitizeSummary(content) : '';
    if (summary.length === 0) {
      return json(502, { error: 'summary_empty', message: 'DeepSeek 没有返回可播报的总结。' });
    }
    return json(200, { summary, source: 'model' });
  };
}
