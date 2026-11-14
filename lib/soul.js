/** Read and write the editable soul.md persona file. */
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SOUL_PATH =
  process.env.DSH_TTS_SOUL ?? fileURLToPath(new URL('../soul.md', import.meta.url));

const DEFAULT_SOUL = [
  '---',
  'name: 小助手',
  'voice: stella',
  '---',
  '你是用户的语音助手，说话自然、清楚、可靠，像熟悉的同事在汇报。',
  '总结任务结果时只讲结论、关键数字和下一步，不寒暄，不啰嗦。',
].join('\n');

/** Strip a leading `--- ... ---` frontmatter block, keeping only the body. */
export function soulBody(raw) {
  const text = String(raw).replace(/\r\n/g, '\n');
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---', 4);
    if (end !== -1) return text.slice(end + 4).trim();
  }
  return text.trim();
}

export function readSoul() {
  try {
    const content = readFileSync(SOUL_PATH, 'utf8');
    return {
      path: SOUL_PATH,
      exists: true,
      content,
      body: soulBody(content),
      updatedAt: statSync(SOUL_PATH).mtimeMs,
    };
  } catch {
    return {
      path: SOUL_PATH,
      exists: false,
      content: DEFAULT_SOUL,
      body: soulBody(DEFAULT_SOUL),
      updatedAt: 0,
    };
  }
}

export function saveSoul(content) {
  writeFileSync(SOUL_PATH, content, 'utf8');
}
