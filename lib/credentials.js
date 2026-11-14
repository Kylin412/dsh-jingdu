/**
 * Host-side API key resolution and validation.
 *
 * The key belongs to this plugin only: it is stored as the credential record
 * `dsh-deepseek-tts/api-key`, never as the shared `DEEPSEEK_API_KEY` reference.
 * Writing that shared reference would make DSH's own model provider pick up the
 * plugin's key, so this module also removes a legacy copy written by older
 * versions when it can prove the value is the plugin's own.
 */
export const API_KEY_RECORD = 'dsh-deepseek-tts/api-key';
const LEGACY_REF = 'DEEPSEEK_API_KEY';
const OWN_ENV = 'DSH_TTS_API_KEY';

export function isPlausibleKey(key) {
  return /^sk-[A-Za-z0-9_-]{8,}$/u.test(key);
}

export function credentialsService(ctx) {
  const credentials = ctx.get('credentials');
  return credentials === undefined ? undefined : credentials;
}

async function readRecordKey(credentials) {
  const record = await credentials.readRecord(API_KEY_RECORD);
  if (record?.kind === 'api-key' && typeof record.key === 'string' && record.key.length > 0) {
    return record.key;
  }
  return undefined;
}

async function removeLegacyIfMatching(credentials, apiKey) {
  try {
    const legacy = await credentials.resolve(LEGACY_REF);
    if (legacy?.value === apiKey) await credentials.unset(LEGACY_REF);
  } catch {
    // Legacy cleanup is best effort; it must not break a working key.
  }
}

/**
 * Move a key the user just supplied out of the shared DSH reference when it is
 * demonstrably the same value. This is safe: the caller is actively using the
 * value for TTS, and the shared reference would otherwise leak it into DSH.
 */
async function adoptLegacyKey(credentials, apiKey) {
  try {
    const legacy = await credentials.resolve(LEGACY_REF);
    if (legacy?.value !== apiKey) return;
    await credentials.modifyRecord(API_KEY_RECORD, async () => ({ kind: 'api-key', key: apiKey }));
    await credentials.unset(LEGACY_REF);
  } catch {
    // If migration fails, the supplied key still works for this request.
  }
}

export async function resolveApiKey(ctx, request, input) {
  const headerKey = request.headers.get('x-dsh-tts-key');
  const bodyKey = typeof input?.apiKey === 'string' ? input.apiKey.trim() : '';
  const supplied = typeof headerKey === 'string' && headerKey.trim().length > 0
    ? headerKey.trim()
    : bodyKey.length > 0
      ? bodyKey
      : undefined;

  const credentials = credentialsService(ctx);
  if (supplied !== undefined && credentials !== undefined) {
    await adoptLegacyKey(credentials, supplied);
    return supplied;
  }
  if (supplied !== undefined) return supplied;

  if (credentials !== undefined) {
    try {
      const stored = await readRecordKey(credentials);
      if (stored !== undefined) return stored;
    } catch {
      // Fall through to the plugin-specific environment variable.
    }
  }
  const ambient = globalThis.process?.env?.[OWN_ENV];
  return typeof ambient === 'string' && ambient.length > 0 ? ambient : undefined;
}

export async function describeApiKey(ctx) {
  const credentials = credentialsService(ctx);
  if (credentials === undefined) return { available: false, configured: false, writable: false };
  try {
    const info = await credentials.describeRecord(API_KEY_RECORD);
    return {
      available: true,
      configured: info.configured === true,
      writable: info.writable === true,
    };
  } catch {
    return { available: true, configured: false, writable: false };
  }
}

export async function saveApiKey(ctx, apiKey) {
  const credentials = credentialsService(ctx);
  if (credentials === undefined) throw new Error('DSH 凭据服务不可用');
  await credentials.modifyRecord(API_KEY_RECORD, async () => ({ kind: 'api-key', key: apiKey }));
  await removeLegacyIfMatching(credentials, apiKey);
}

export async function clearApiKey(ctx) {
  const credentials = credentialsService(ctx);
  if (credentials === undefined) throw new Error('DSH 凭据服务不可用');
  let existing;
  try {
    existing = await readRecordKey(credentials);
  } catch {
    // Deleting the record is still worth attempting.
  }
  await credentials.deleteRecord(API_KEY_RECORD);
  if (existing !== undefined) await removeLegacyIfMatching(credentials, existing);
}
