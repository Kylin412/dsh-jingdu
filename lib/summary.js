/** Prompt construction and output cleanup for spoken summaries. */
import { SUMMARY_MAX_CHARS } from './config.js';

/**
 * soul.md is authoritative. The per-broadcast persona only fills in tone where
 * it does not conflict with soul.md.
 */
export function summarySystemPrompt({ soul = '', persona = '' } = {}) {
  const soulStyle =
    typeof soul === 'string' && soul.trim().length > 0
      ? `基础人设（soul.md，优先级最高；与其他设定冲突时，以这里为准）：\n${soul.trim()}`
      : '';
  const personaStyle =
    typeof persona === 'string' && persona.trim().length > 0
      ? `补充人设/语气（优先级低于 soul.md；只在不与 soul.md 冲突时补充，不得覆盖 soul.md 的身份与规则）：${persona.trim()}`
      : '';
  return [
    '你是语音播报助手，把用户给出的任务结果改写成适合朗读的口语总结。',
    '要求：只输出播报正文；用中文；2-3 句，最多 120 个汉字；',
    '保留关键结论、数字和下一步；省略过程、代码、链接和格式；',
    '不要 Markdown、列表、引号，也不要“好的 / 以下是 / 总结如下”等开场。',
    soulStyle,
    personaStyle,
  ]
    .filter((part) => part.length > 0)
    .join('\n');
}

export function sanitizeSummary(value) {
  let text = String(value)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[`*_#>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  text = text.replace(/^(好的|当然|以下是|总结如下)[，,：:\s]*/u, '');
  text = text.replace(/^["“”']+/u, '').replace(/["“”']+$/u, '').trim();
  if (text.length > SUMMARY_MAX_CHARS) {
    const cut = text.slice(0, SUMMARY_MAX_CHARS);
    const sentence = cut.match(/^[\s\S]*[。！？!?]/u);
    text = (sentence === null ? cut : sentence[0]).trim();
  }
  return text;
}
