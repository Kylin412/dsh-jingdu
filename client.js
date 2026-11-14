window.__ModuleLoader__.load({
  id: 'dsh-jingdu',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const MAX_CHARACTERS = 4000;
    // 存储键与缓存库沿用旧名前缀，保证从 dsh-deepseek-tts 升级时不丢 Key、设置与缓存。
    const KEY_STORAGE = 'dsh-deepseek-tts/apiKey';
    const SETTINGS_STORAGE = 'dsh-deepseek-tts/settings';
    const PANEL_ID = 'dsh-jingdu';
    const VOICES = [
      { id: 'stella', label: 'stella（女声）' },
      { id: 'tide', label: 'tide（男声）' },
    ];

    const DEFAULT_SETTINGS = Object.freeze({
      voice: 'stella',
      mode: 'summary',
      autoPlay: false,
      playChime: true,
      useSoul: true,
      persona: '',
    });

    // One reply may speak at a time; starting another stops the previous one.
    let activeStop = null;
    let playToken = 0;
    const playedTurns = new Set();

    const CACHE_DB_NAME = 'dsh-deepseek-tts-cache';
    const CACHE_DB_VERSION = 2;
    const CACHE_MAX_ENTRIES = 120;
    const CACHE_MAX_BYTES = 200 * 1024 * 1024;
    const SUMMARY_CACHE_STORAGE = 'dsh-deepseek-tts/summaries';
    const SUMMARY_CACHE_VERSION = 3;
    const ACTION_CSS = `
.dsh-tts-action{width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;justify-content:center;align-items:center;padding:6px;display:inline-flex}
.dsh-tts-action svg{width:calc(15px + var(--dsh-content-font-delta,0px));height:calc(15px + var(--dsh-content-font-delta,0px));display:block}
@media (hover:hover){.dsh-tts-action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}
.dsh-tts-action:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.dsh-tts-action:disabled{cursor:default;opacity:.4}
.dsh-tts-action[data-dsh-tts-state="playing"]{color:var(--dsw-alias-label-secondary)}
.dsh-tts-action[data-dsh-tts-state="error"]{color:#d9534f}
`;
    let cacheDbPromise = null;

    function openCacheDb() {
      if (cacheDbPromise !== null) return cacheDbPromise;
      cacheDbPromise = new Promise((resolve) => {
        if (typeof indexedDB === 'undefined') {
          resolve(null);
          return;
        }
        let request;
        try {
          request = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
        } catch {
          resolve(null);
          return;
        }
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio');
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      });
      return cacheDbPromise;
    }

    async function hashText(value) {
      const bytes = new TextEncoder().encode(String(value));
      const subtle = window.crypto?.subtle;
      if (subtle !== undefined) {
        try {
          const digest = await subtle.digest('SHA-256', bytes);
          return Array.from(new Uint8Array(digest), (byte) =>
            byte.toString(16).padStart(2, '0'),
          ).join('');
        } catch {
          // Fall through to the small non-cryptographic hash.
        }
      }
      let hash = 0x811c9dc5;
      for (const byte of bytes) {
        hash ^= byte;
        hash = Math.imul(hash, 0x01000193);
      }
      return `fnv1a-${(hash >>> 0).toString(16)}`;
    }

    async function makeCacheKey(text, voice) {
      return `${voice}:${await hashText(text)}`;
    }

    function getCachedAudio(key) {
      return openCacheDb().then((db) => {
        if (db === null) return null;
        return new Promise((resolve) => {
          try {
            const request = db
              .transaction('audio', 'readonly')
              .objectStore('audio')
              .get(key);
            request.onsuccess = () => {
              const blob = request.result instanceof Blob ? request.result : null;
              if (blob !== null) touchCacheEntry(db, key);
              resolve(blob);
            };
            request.onerror = () => resolve(null);
          } catch {
            resolve(null);
          }
        });
      });
    }

    function touchCacheEntry(db, key) {
      try {
        const store = db.transaction('meta', 'readwrite').objectStore('meta');
        const request = store.get(key);
        request.onsuccess = () => {
          const meta = request.result;
          if (meta !== null && typeof meta === 'object') {
            try {
              store.put({ ...meta, lastUsedAt: Date.now() }, key);
            } catch {
              // Best-effort recency update.
            }
          }
        };
        request.onerror = () => {};
      } catch {
        // Best-effort recency update.
      }
    }

    async function pruneCache(db) {
      const entries = await new Promise((resolve) => {
        const out = [];
        try {
          const request = db
            .transaction('meta', 'readonly')
            .objectStore('meta')
            .openCursor();
          request.onsuccess = () => {
            const cursor = request.result;
            if (cursor === null) {
              resolve(out);
              return;
            }
            out.push({ key: cursor.key, ...(cursor.value ?? {}) });
            cursor.continue();
          };
          request.onerror = () => resolve(out);
        } catch {
          resolve(out);
        }
      });
      entries.sort(
        (a, b) => (a.lastUsedAt ?? a.createdAt ?? 0) - (b.lastUsedAt ?? b.createdAt ?? 0),
      );
      let total = entries.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
      let index = 0;
      while (
        index < entries.length &&
        (entries.length - index > CACHE_MAX_ENTRIES || total > CACHE_MAX_BYTES)
      ) {
        total -= entries[index].size ?? 0;
        index += 1;
      }
      if (index === 0) return;
      await new Promise((resolve) => {
        try {
          const tx = db.transaction(['audio', 'meta'], 'readwrite');
          const audioStore = tx.objectStore('audio');
          const metaStore = tx.objectStore('meta');
          for (const entry of entries.slice(0, index)) {
            audioStore.delete(entry.key);
            metaStore.delete(entry.key);
          }
          tx.oncomplete = resolve;
          tx.onerror = resolve;
          tx.onabort = resolve;
        } catch {
          resolve();
        }
      });
    }

    async function putCachedAudio(key, blob, info) {
      const db = await openCacheDb();
      if (db === null) return;
      await new Promise((resolve) => {
        try {
          const tx = db.transaction(['audio', 'meta'], 'readwrite');
          tx.objectStore('audio').put(blob, key);
          tx.objectStore('meta').put(
            {
              createdAt: Date.now(),
              lastUsedAt: Date.now(),
              size: blob.size,
              voice: info.voice,
              preview: String(info.text ?? '').slice(0, 80),
            },
            key,
          );
          tx.oncomplete = resolve;
          tx.onerror = resolve;
          tx.onabort = resolve;
        } catch {
          resolve();
        }
      });
      await pruneCache(db);
    }

    async function clearAudioCache() {
      const db = await openCacheDb();
      if (db === null) return;
      await new Promise((resolve) => {
        try {
          const tx = db.transaction(['audio', 'meta'], 'readwrite');
          tx.objectStore('audio').clear();
          tx.objectStore('meta').clear();
          tx.oncomplete = resolve;
          tx.onerror = resolve;
        } catch {
          resolve();
        }
      });
    }

    async function readCacheStats() {
      const db = await openCacheDb();
      if (db === null) return { count: 0, bytes: 0 };
      return new Promise((resolve) => {
        let count = 0;
        let bytes = 0;
        try {
          const request = db
            .transaction('meta', 'readonly')
            .objectStore('meta')
            .openCursor();
          request.onsuccess = () => {
            const cursor = request.result;
            if (cursor === null) {
              resolve({ count, bytes });
              return;
            }
            count += 1;
            bytes += cursor.value?.size ?? 0;
            cursor.continue();
          };
          request.onerror = () => resolve({ count, bytes });
        } catch {
          resolve({ count, bytes });
        }
      });
    }

    function readSummaryCache() {
      try {
        const raw = window.localStorage.getItem(SUMMARY_CACHE_STORAGE);
        const value = raw === null ? null : JSON.parse(raw);
        return value !== null && typeof value === 'object' ? value : {};
      } catch {
        return {};
      }
    }

    function writeSummaryCache(cache) {
      try {
        window.localStorage.setItem(SUMMARY_CACHE_STORAGE, JSON.stringify(cache));
      } catch {
        // The summary cache is an optimization only.
      }
    }

    function rememberSummary(key, summary) {
      const cache = readSummaryCache();
      cache[key] = { summary, at: Date.now() };
      const keys = Object.keys(cache);
      if (keys.length > 50) {
        keys.sort((a, b) => (cache[a]?.at ?? 0) - (cache[b]?.at ?? 0));
        for (const stale of keys.slice(0, keys.length - 50)) delete cache[stale];
      }
      writeSummaryCache(cache);
    }

    function readStoredKey() {
      try {
        const value = window.localStorage.getItem(KEY_STORAGE);
        return typeof value === 'string' ? value.trim() : '';
      } catch {
        return '';
      }
    }

    function storeKey(key) {
      try {
        window.localStorage.setItem(KEY_STORAGE, key);
      } catch {
        // A blocked localStorage still leaves the in-memory key usable.
      }
    }

    function forgetKey() {
      try {
        window.localStorage.removeItem(KEY_STORAGE);
      } catch {
        // Nothing to clean up.
      }
    }

    async function persistKey(key) {
      try {
        await fetch('/api/dsh-tts/key', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ apiKey: key }),
        });
      } catch {
        // The browser copy is enough for this session.
      }
    }

    let soulInfo = { path: '', exists: false, content: '', body: '', updatedAt: 0 };
    let soulPromise = null;

    async function loadSoul(force) {
      if (soulPromise !== null && force !== true) return soulPromise;
      soulPromise = fetch('/api/dsh-tts/soul', { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((info) => {
          if (info !== null && typeof info.content === 'string') {
            soulInfo = {
              path: typeof info.path === 'string' ? info.path : '',
              exists: info.exists === true,
              content: info.content,
              body: typeof info.body === 'string' ? info.body : '',
              updatedAt: Number(info.updatedAt ?? 0),
            };
          }
          return soulInfo;
        })
        .catch(() => soulInfo);
      return soulPromise;
    }

    async function ensureSoul() {
      if (soulInfo.content.length > 0) return soulInfo;
      return loadSoul(false);
    }

    function clearSummaryCache() {
      try {
        window.localStorage.removeItem(SUMMARY_CACHE_STORAGE);
      } catch {
        // The cache is an optimization only.
      }
    }

    function sanitizeSettings(value) {
      const source = value !== null && typeof value === 'object' ? value : {};
      return {
        voice: source.voice === 'tide' ? 'tide' : 'stella',
        mode: source.mode === 'full' ? 'full' : 'summary',
        autoPlay: source.autoPlay === true,
        playChime: source.playChime !== false,
        useSoul: source.useSoul !== false,
        persona: typeof source.persona === 'string' ? source.persona.slice(0, 160) : '',
      };
    }

    function loadSettings() {
      try {
        const raw = window.localStorage.getItem(SETTINGS_STORAGE);
        return sanitizeSettings(raw === null ? null : JSON.parse(raw));
      } catch {
        return { ...DEFAULT_SETTINGS };
      }
    }

    let settings = loadSettings();
    const settingsListeners = new Set();

    function subscribeSettings(listener) {
      settingsListeners.add(listener);
      return () => settingsListeners.delete(listener);
    }

    function getSettings() {
      return settings;
    }

    function updateSettings(patch) {
      settings = sanitizeSettings({ ...settings, ...patch });
      try {
        window.localStorage.setItem(SETTINGS_STORAGE, JSON.stringify(settings));
      } catch {
        // Keep the in-memory copy.
      }
      for (const listener of settingsListeners) listener();
    }

    function useSettings() {
      if (typeof React.useSyncExternalStore === 'function') {
        return React.useSyncExternalStore(subscribeSettings, getSettings, getSettings);
      }
      const [value, setValue] = React.useState(getSettings);
      React.useEffect(() => {
        const unsubscribe = subscribeSettings(() => setValue(getSettings()));
        return unsubscribe;
      }, []);
      return value;
    }

    function collectText(snapshot, messageId) {
      const nodes = snapshot?.nodes;
      if (nodes === undefined || typeof nodes.values !== 'function') return '';
      for (const node of nodes.values()) {
        if (node?.kind !== 'assistant-step') continue;
        const data = node.data;
        const finalNode = data?.finalNode;
        if (finalNode?.messageId !== messageId) continue;
        const blocks = Array.isArray(finalNode.blocks)
          ? finalNode.blocks
          : Array.isArray(data?.blocks)
            ? data.blocks
            : [];
        return blocks
          .filter((block) => block?.kind === 'text' && typeof block.text === 'string')
          .map((block) => block.text)
          .join('\n')
          .trim();
      }
      return '';
    }

    function findClosing(snapshot, turn, seq) {
      const nodes = snapshot?.nodes;
      if (nodes === undefined || typeof nodes.values !== 'function') return null;
      for (const node of nodes.values()) {
        if (node?.kind !== 'turn-tail') continue;
        if (node.data?.turn !== turn) continue;
        const closing = node.data.closing ?? null;
        if (closing === null) continue;
        if (seq !== undefined && closing.finalNode?.seq !== seq) continue;
        return closing;
      }
      return null;
    }

    function closingText(closing) {
      const finalNode = closing?.finalNode;
      if (finalNode === undefined || finalNode === null) return '';
      const blocks = Array.isArray(finalNode.blocks) ? finalNode.blocks : [];
      return blocks
        .filter((block) => block?.kind === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n')
        .trim();
    }

    function stripMarkdown(text) {
      return String(text)
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^[ \t]*#{1,6}[ \t]*/gm, '')
        .replace(/^[ \t]*[-*+][ \t]+/gm, '')
        .replace(/^[ \t]*>[ \t]?/gm, '')
        .replace(/[*_~]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function localSummary(text) {
      const clean = stripMarkdown(text);
      if (clean.length <= 140) return clean;
      const sentences = clean.match(/[^。！？!?]+[。！？!?]?/gu) ?? [];
      let out = '';
      for (const sentence of sentences) {
        if (out.length > 0 && out.length + sentence.length > 120) break;
        out += sentence;
        if (out.length >= 100) break;
      }
      return (out.length > 0 ? out : clean.slice(0, 120)).trim();
    }

    async function summarizeText(text, persona, useSoul, signal) {
      const clean = stripMarkdown(text);
      if (clean.length <= 160) return clean;
      const soul = useSoul ? await ensureSoul() : { body: '' };
      const summaryKey = await hashText(`v${SUMMARY_CACHE_VERSION}\n${useSoul ? soul.body : ''}\n${useSoul ? persona : ''}\n${clean}`);
      const cached = readSummaryCache()[summaryKey];
      if (
        cached !== undefined &&
        typeof cached.summary === 'string' &&
        Date.now() - (cached.at ?? 0) < 7 * 24 * 60 * 60 * 1000
      ) {
        return cached.summary;
      }
      try {
        const headers = { 'content-type': 'application/json' };
        const storedKey = readStoredKey();
        if (typeof storedKey === 'string' && storedKey.length > 0) headers['x-dsh-tts-key'] = storedKey;
        let response = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          response = await fetch('/api/dsh-tts/summarize', {
            method: 'POST',
            headers,
            body: JSON.stringify({ text: clean.slice(0, 12000), persona: useSoul ? persona : '', useSoul }),
            signal,
          });
          if (response.status !== 429 && response.status !== 503) break;
          if (attempt === 0) await new Promise((resolve) => window.setTimeout(resolve, 700));
        }
        if (response !== null && response.ok) {
          const body = await response.json();
          if (typeof body?.summary === 'string' && body.summary.trim().length > 0) {
            const summary = body.summary.trim();
            rememberSummary(summaryKey, summary);
            return summary;
          }
        }
      } catch (cause) {
        if (cause?.name === 'AbortError') throw cause;
        // Fall back to a local extractive summary.
      }
      const fallback = localSummary(clean);
      rememberSummary(summaryKey, fallback);
      return fallback;
    }

    async function requestSpeech(text, voice, signal, key) {
      const headers = { 'content-type': 'application/json' };
      if (typeof key === 'string' && key.length > 0) headers['x-dsh-tts-key'] = key;
      for (let attempt = 0; ; attempt += 1) {
        const response = await fetch('/api/dsh-tts/speak', {
          method: 'POST',
          headers,
          body: JSON.stringify({ text, voice }),
          signal,
        });
        const retryable = response.status === 429 || response.status === 503 || response.status === 504;
        if (!retryable || attempt >= 1) return response;
        await new Promise((resolve) => window.setTimeout(resolve, 700));
      }
    }

    function wavBlobFromPcm(parts, sampleRate) {
      let total = 0;
      for (const part of parts) total += part.byteLength;
      const buffer = new ArrayBuffer(44 + total);
      const view = new DataView(buffer);
      const writeAscii = (offset, value) => {
        for (let index = 0; index < value.length; index += 1) {
          view.setUint8(offset + index, value.charCodeAt(index));
        }
      };
      writeAscii(0, 'RIFF');
      view.setUint32(4, 36 + total, true);
      writeAscii(8, 'WAVE');
      writeAscii(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeAscii(36, 'data');
      view.setUint32(40, total, true);
      let offset = 44;
      for (const part of parts) {
        new Uint8Array(buffer, offset).set(new Uint8Array(part));
        offset += part.byteLength;
      }
      return new Blob([buffer], { type: 'audio/wav' });
    }

    /**
     * Stream PCM straight from DeepSeek TTS over WebSocket and schedule it with
     * WebAudio. First audible frame arrives much sooner than waiting for a full
     * WAV download; the finished stream is written back to the same cache.
     */
    function startStreamingSpeech(text, voice, key, cacheId) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (
        typeof AudioCtor !== 'function' ||
        typeof WebSocket !== 'function' ||
        typeof key !== 'string' ||
        key.length === 0
      ) {
        return null;
      }

      const context = new AudioCtor();
      const sources = new Set();
      const parts = [];
      let carry = new Uint8Array(0);
      let nextTime = context.currentTime + 0.15;
      let started = false;
      let finished = false;
      let closed = false;
      let socket = null;
      let endTimer = null;
      let resolveStarted;
      let rejectStarted;
      let resolveDone;
      const startedPromise = new Promise((resolve, reject) => {
        resolveStarted = resolve;
        rejectStarted = reject;
      });
      startedPromise.catch(() => {});
      const donePromise = new Promise((resolve) => {
        resolveDone = resolve;
      });

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (endTimer !== null) {
          window.clearTimeout(endTimer);
          endTimer = null;
        }
        if (socket !== null) {
          try {
            socket.close();
          } catch {
            // Ignore.
          }
          socket = null;
        }
        for (const source of sources) {
          try {
            source.stop();
          } catch {
            // Already stopped.
          }
        }
        sources.clear();
        try {
          void context.close().catch(() => {});
        } catch {
          // Ignore.
        }
        resolveDone();
      };

      const fail = (error) => {
        if (!started) {
          rejectStarted(error instanceof Error ? error : new Error(String(error)));
        }
        cleanup();
      };

      const enqueue = (pcm) => {
        if (closed || pcm.byteLength < 2) return;
        const samples = Math.floor(pcm.byteLength / 2);
        const audio = context.createBuffer(1, samples, 24000);
        const channel = audio.getChannelData(0);
        const data = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
        for (let index = 0; index < samples; index += 1) {
          channel[index] = data.getInt16(index * 2, true) / 32768;
        }
        const source = context.createBufferSource();
        source.buffer = audio;
        source.connect(context.destination);
        const at = Math.max(nextTime, context.currentTime + 0.05);
        source.start(at);
        nextTime = at + audio.duration;
        sources.add(source);
        source.onended = () => sources.delete(source);
        if (!started) {
          started = true;
          resolveStarted();
        }
      };

      const handleBinary = (payload) => {
        const chunk = new Uint8Array(payload);
        const merged = new Uint8Array(carry.length + chunk.length);
        merged.set(carry, 0);
        merged.set(chunk, carry.length);
        const evenLength = merged.length - (merged.length % 2);
        if (evenLength > 0) {
          const pcm = merged.slice(0, evenLength);
          parts.push(pcm.buffer);
          enqueue(pcm);
        }
        carry = merged.slice(evenLength);
      };

      void (async () => {
        try {
          await context.resume();
        } catch (error) {
          fail(error);
          return;
        }
        let nextSocket;
        try {
          nextSocket = new WebSocket(
            `wss://api.deepseek.com/v1/tools/tts?voice_id=${encodeURIComponent(voice)}&format=pcm&filter_markdown=false`,
            ['tts', `bearer.${key}`],
          );
        } catch (error) {
          fail(error);
          return;
        }
        socket = nextSocket;
        nextSocket.binaryType = 'arraybuffer';
        nextSocket.onopen = () => {
          if (closed) return;
          try {
            nextSocket.send(JSON.stringify({ event: 'text', text }));
            nextSocket.send(JSON.stringify({ event: 'finish_text' }));
          } catch (error) {
            fail(error);
          }
        };
        nextSocket.onmessage = (event) => {
          if (closed) return;
          if (typeof event.data === 'string') {
            let payload;
            try {
              payload = JSON.parse(event.data);
            } catch {
              return;
            }
            if (payload?.event === 'finish') {
              if (payload.code !== 'success') {
                fail(new Error(payload.message ?? '流式 TTS 合成失败'));
                return;
              }
              finished = true;
              const delay = Math.max(0, (nextTime - context.currentTime) * 1000) + 120;
              endTimer = window.setTimeout(() => {
                if (parts.length > 0 && cacheId) {
                  try {
                    void putCachedAudio(cacheId, wavBlobFromPcm(parts, 24000), { voice, text });
                  } catch {
                    // Caching is best-effort.
                  }
                }
                cleanup();
              }, delay);
            }
            return;
          }
          handleBinary(event.data);
        };
        nextSocket.onerror = () => {
          if (!started) fail(new Error('无法连接 DeepSeek 流式 TTS'));
        };
        nextSocket.onclose = (event) => {
          if (closed) return;
          if (!finished && !started) {
            fail(new Error(`流式 TTS 连接关闭（${event.code}）`));
          } else if (!finished) {
            cleanup();
          }
        };
      })();

      return { started: startedPromise, done: donePromise, stop: cleanup };
    }

    async function responseError(response) {
      const body = await response.json().catch(() => ({}));
      return typeof body?.message === 'string'
        ? body.message
        : `朗读失败（HTTP ${response.status}）。`;
    }

    function claimPlay() {
      playToken += 1;
      return playToken;
    }

    function isCurrent(token) {
      return playToken === token;
    }

    function stopActive() {
      const stop = activeStop;
      activeStop = null;
      if (stop !== null) stop();
    }

    function playEndChime() {
      try {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (typeof Ctor !== 'function') return;
        const context = new Ctor();
        if (context.state === 'suspended') void context.resume();
        const start = context.currentTime + 0.02;
        const notes = [880, 660];
        notes.forEach((freq, index) => {
          const at = start + index * 0.11;
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.type = 'sine';
          oscillator.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, at);
          gain.gain.exponentialRampToValueAtTime(0.12, at + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
          oscillator.connect(gain).connect(context.destination);
          oscillator.start(at);
          oscillator.stop(at + 0.18);
        });
        window.setTimeout(() => {
          void context.close().catch(() => {});
        }, 650);
      } catch {
        // Sound is optional; the summary still speaks.
      }
    }

    let previewStop = null;
    async function previewVoice(voice) {
      if (previewStop !== null) {
        const stop = previewStop;
        previewStop = null;
        stop();
      }
      const controller = new AbortController();
      const response = await requestSpeech(
        '你好，我是鲸读，用 DeepSeek 语音为你朗读。',
        voice,
        controller.signal,
        readStoredKey(),
      );
      if (!response.ok) throw new Error(await responseError(response));
      const url = URL.createObjectURL(await response.blob());
      const audio = new Audio(url);
      const stop = () => {
        try {
          audio.pause();
        } catch {
          // Ignore.
        }
        URL.revokeObjectURL(url);
        if (previewStop === stop) previewStop = null;
      };
      previewStop = stop;
      audio.addEventListener('ended', stop, { once: true });
      await audio.play();
    }

    function SpeakerGlyph() {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M11 5 6 9H3v6h3l5 4V5Z' }),
        h('path', { d: 'M15.5 8.5a5 5 0 0 1 0 7' }),
        h('path', { d: 'M18.5 5.5a9 9 0 0 1 0 13' }),
      );
    }

    function StopGlyph() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': 'true' },
        h('rect', { x: 7, y: 7, width: 10, height: 10, rx: 2 }),
      );
    }

    function LoadingGlyph() {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          'aria-hidden': 'true',
        },
        h(
          'circle',
          { cx: 12, cy: 12, r: 8, strokeDasharray: '13 38' },
          h('animateTransform', {
            attributeName: 'transform',
            type: 'rotate',
            from: '0 12 12',
            to: '360 12 12',
            dur: '0.9s',
            repeatCount: 'indefinite',
          }),
        ),
      );
    }

    function WarningGlyph() {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M12 4 3.5 19h17L12 4Z' }),
        h('path', { d: 'M12 9v5' }),
        h('path', { d: 'M12 17h.01' }),
      );
    }

    function SpeakButton(props) {
      const { messageId, useChat } = props;
      const settings = useSettings();
      const text = useChat((snapshot) => collectText(snapshot, messageId));
      const [status, setStatus] = React.useState('idle');
      const [error, setError] = React.useState('');
      const audioRef = React.useRef(null);
      const urlRef = React.useRef(null);
      const abortRef = React.useRef(null);
      const streamRef = React.useRef(null);
      const tokenRef = React.useRef(0);

      const stop = React.useCallback(() => {
        playToken += 1;
        tokenRef.current = 0;
        const stream = streamRef.current;
        streamRef.current = null;
        if (stream !== null) stream.stop();
        const abort = abortRef.current;
        abortRef.current = null;
        if (abort !== null) abort.abort();
        const audio = audioRef.current;
        if (audio !== null) {
          try {
            audio.pause();
          } catch {
            // Ignore.
          }
          audio.currentTime = 0;
          audioRef.current = null;
        }
        if (urlRef.current !== null) {
          URL.revokeObjectURL(urlRef.current);
          urlRef.current = null;
        }
        if (activeStop === stop) activeStop = null;
        setStatus('idle');
      }, []);

      React.useEffect(() => stop, [stop]);

      const toggle = async () => {
        if (status === 'playing' || status === 'loading') {
          stop();
          return;
        }
        setError('');
        if (text.length === 0) {
          const message = '这条回复没有可朗读的文字。';
          setError(message);
          window.alert(message);
          return;
        }

        stopActive();
        const token = claimPlay();
        tokenRef.current = token;
        const stale = () => !isCurrent(token) || tokenRef.current !== token;
        const abort = new AbortController();
        abortRef.current = abort;
        activeStop = stop;
        setStatus('loading');

        try {
          let spoken = text;
          if (settings.mode === 'summary') {
            spoken = await summarizeText(text, settings.persona, settings.useSoul, abort.signal);
            if (stale()) return;
          }
          spoken = spoken.slice(0, MAX_CHARACTERS);
          const cacheId = await makeCacheKey(spoken, settings.voice);
          let blob = await getCachedAudio(cacheId);
          if (stale()) return;

          if (blob === null) {
            const streamKey = readStoredKey();
            const stream = startStreamingSpeech(spoken, settings.voice, streamKey, cacheId);
            if (stream !== null) {
              streamRef.current = stream;
              try {
                await stream.started;
                if (stale()) {
                  stream.stop();
                  return;
                }
                setStatus('playing');
                await stream.done;
                if (streamRef.current === stream) streamRef.current = null;
                stop();
                return;
              } catch {
                stream.stop();
                if (streamRef.current === stream) streamRef.current = null;
                if (stale()) return;
              }
            }

            let key = readStoredKey();
            let response;
            for (let attempt = 0; attempt < 2; attempt += 1) {
              response = await requestSpeech(spoken, settings.voice, abort.signal, key);
              if (stale()) return;
              if (response.status !== 409) break;
              const missing = await response.clone().json().catch(() => ({}));
              if (missing?.error !== 'missing_api_key') break;
              const entered = window.prompt(
                '请填写 DeepSeek API Key（sk- 开头，只保存在本机浏览器与插件的 DSH 凭据记录中）：',
                '',
              );
              if (entered === null) break;
              key = entered.trim();
              if (key.length === 0) break;
              storeKey(key);
              void persistKey(key);
            }
            if (stale()) return;
            if (!response.ok) {
              const message = await responseError(response);
              stop();
              setError(message);
              window.alert(message);
              return;
            }
            blob = await response.blob();
            if (stale()) return;
            void putCachedAudio(cacheId, blob, { voice: settings.voice, text: spoken });
          }

          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          urlRef.current = url;
          audioRef.current = audio;
          audio.addEventListener('ended', () => {
            if (audioRef.current === audio) stop();
          });
          audio.addEventListener('error', () => {
            if (audioRef.current === audio) {
              stop();
              setError('音频播放失败。');
            }
          });
          await audio.play();
          if (stale()) {
            try {
              audio.pause();
            } catch {
              // Ignore.
            }
            if (urlRef.current === url) {
              URL.revokeObjectURL(url);
              urlRef.current = null;
            }
            if (audioRef.current === audio) audioRef.current = null;
            return;
          }
          setStatus('playing');
        } catch (cause) {
          if (stale() || cause?.name === 'AbortError') return;
          stop();
          const message = cause instanceof Error ? cause.message : String(cause);
          setError(message);
          window.alert(message);
        }
      };

      const label =
        status === 'loading'
          ? '正在生成语音…'
          : status === 'playing'
            ? '停止朗读'
            : settings.mode === 'summary'
              ? '朗读这条回复的总结'
              : '朗读这条回复全文';
      const state = error.length > 0 ? 'error' : status;
      const icon =
        status === 'loading'
          ? h(LoadingGlyph)
          : status === 'playing'
            ? h(StopGlyph)
            : error.length > 0
              ? h(WarningGlyph)
              : h(SpeakerGlyph);

      return h(
        'button',
        {
          type: 'button',
          className: 'dsh-tts-action',
          onClick: toggle,
          title: error.length > 0 ? `${label}：${error}` : label,
          'aria-label': label,
          'aria-pressed': status === 'playing',
          'data-dsh-tts-state': state,
        },
        icon,
      );
    }

    async function autoSpeak(text, voice, token) {
      stopActive();
      const cacheId = await makeCacheKey(text, voice);
      let blob = await getCachedAudio(cacheId);
      if (!isCurrent(token)) return { ended: false };
      if (blob === null) {
        const stream = startStreamingSpeech(
          text.slice(0, MAX_CHARACTERS),
          voice,
          readStoredKey(),
          cacheId,
        );
        if (stream !== null) {
          let streamStopped = false;
          const stopStream = () => {
            if (streamStopped) return;
            streamStopped = true;
            stream.stop();
            if (activeStop === stopStream) activeStop = null;
          };
          activeStop = stopStream;
          try {
            await stream.started;
            if (!isCurrent(token)) {
              stopStream();
              return { ended: false };
            }
            await stream.done;
            if (activeStop === stopStream) activeStop = null;
            return { ended: !streamStopped };
          } catch {
            stream.stop();
            if (activeStop === stopStream) activeStop = null;
          }
        }

        const controller = new AbortController();
        const response = await requestSpeech(
          text.slice(0, MAX_CHARACTERS),
          voice,
          controller.signal,
          '',
        );
        if (!isCurrent(token)) return { ended: false };
        if (!response.ok) throw new Error(await responseError(response));
        blob = await response.blob();
        if (!isCurrent(token)) return { ended: false };
        void putCachedAudio(cacheId, blob, { voice, text });
      }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      let stopped = false;
      let ended = false;
      let resolveEnded;
      const endedPromise = new Promise((resolveEndedPromise) => {
        resolveEnded = resolveEndedPromise;
      });
      const stop = () => {
        if (stopped) return;
        stopped = true;
        try {
          audio.pause();
        } catch {
          // Ignore.
        }
        URL.revokeObjectURL(url);
        if (activeStop === stop) activeStop = null;
        resolveEnded();
      };
      activeStop = stop;
      audio.addEventListener(
        'ended',
        () => {
          ended = true;
          stop();
        },
        { once: true },
      );
      try {
        await audio.play();
      } catch (error) {
        stop();
        throw error;
      }
      if (!isCurrent(token)) {
        stop();
        return { ended: false };
      }
      await endedPromise;
      return { ended };
    }

    function AutoPlayTail(props) {
      const { turn, seq, useChat } = props;
      const settings = useSettings();
      const closing = useChat((snapshot) => findClosing(snapshot, turn.turn, seq));
      const messageId = closing?.finalNode?.messageId ?? '';
      const closingTime = closing?.time ?? 0;
      const closingStatus = closing?.status ?? '';

      React.useEffect(() => {
        if (!settings.autoPlay || closing === null) return;
        if (closingStatus !== 'settled') return;
        if (Date.now() - Number(closingTime) > 30_000) return;
        const text = closingText(closing);
        if (text.length === 0) return;
        const marker = `${props.sessionId ?? ''}:${messageId || `${turn.turn}:${seq}`}`;
        if (playedTurns.has(marker)) return;
        playedTurns.add(marker);
        if (playedTurns.size > 200) playedTurns.clear();

        let cancelled = false;
        void (async () => {
          try {
            const token = claimPlay();
            const summary = await summarizeText(text, settings.persona, settings.useSoul, undefined);
            if (!isCurrent(token)) return;
            const played = await autoSpeak(summary, settings.voice, token);
            if (!isCurrent(token)) return;
            if (played?.ended && settings.playChime) playEndChime();
          } catch (cause) {
            if (cancelled) return;
            console.warn('[dsh-jingdu] 自动播报失败：', cause);
          }
        })();

        return () => {
          cancelled = true;
        };
      }, [
        settings.autoPlay,
        settings.playChime,
        settings.useSoul,
        settings.persona,
        settings.voice,
        closingStatus,
        closingTime,
        messageId,
        props.sessionId,
        turn.turn,
        seq,
      ]);

      return null;
    }

    function SpeakerIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 18;
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('path', { d: 'M11 5 6 9H3v6h3l5 4V5Z' }),
        h('path', { d: 'M15.5 8.5a5 5 0 0 1 0 7' }),
        h('path', { d: 'M18.5 5.5a9 9 0 0 1 0 13' }),
      );
    }

    function FieldLabel({ children }) {
      return h(
        'label',
        { style: { display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' } },
        children,
      );
    }

    function Switch({ checked, disabled, onChange, children }) {
      return h(
        'label',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.55 : 1,
            fontSize: '13px',
            userSelect: 'none',
          },
        },
        h('input', {
          type: 'checkbox',
          role: 'switch',
          checked,
          disabled,
          onChange: (event) => onChange(event.target.checked),
          style: {
            position: 'absolute',
            width: '1px',
            height: '1px',
            margin: 0,
            padding: 0,
            opacity: 0,
            pointerEvents: 'none',
          },
        }),
        h(
          'span',
          {
            'aria-hidden': 'true',
            style: {
              position: 'relative',
              display: 'inline-flex',
              flex: '0 0 auto',
              width: '36px',
              height: '20px',
              borderRadius: '999px',
              background: checked ? '#4d6bfe' : 'rgba(127,127,127,.45)',
              transition: 'background .18s ease',
            },
          },
          h('span', {
            style: {
              position: 'absolute',
              top: '2px',
              left: checked ? '18px' : '2px',
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              background: '#fff',
              boxShadow: '0 1px 2px rgba(0,0,0,.35)',
              transition: 'left .18s ease',
            },
          }),
        ),
        h('span', { style: { fontWeight: 500 } }, children),
      );
    }

    function Card({ title, description, children }) {
      return h(
        'section',
        {
          style: {
            border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.25))',
            borderRadius: '12px',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            background: 'var(--dsw-alias-bg-module-platform, transparent)',
          },
        },
        h(
          'div',
          null,
          h('div', { style: { fontSize: '15px', fontWeight: 600 } }, title),
          description
            ? h(
                'div',
                {
                  style: {
                    marginTop: '4px',
                    fontSize: '12.5px',
                    lineHeight: 1.55,
                    color: 'var(--dsw-alias-label-secondary, #777)',
                  },
                },
                description,
              )
            : null,
        ),
        children,
      );
    }

    const inputStyle = {
      width: '100%',
      boxSizing: 'border-box',
      padding: '8px 10px',
      borderRadius: '8px',
      border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35))',
      background: 'var(--dsw-alias-bg-base, transparent)',
      color: 'inherit',
      font: 'inherit',
    };

    const buttonStyle = {
      minHeight: '34px',
      padding: '6px 14px',
      borderRadius: '8px',
      border: '1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.35))',
      background: 'var(--dsw-alias-bg-module-platform, transparent)',
      color: 'inherit',
      cursor: 'pointer',
      font: 'inherit',
    };

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }

    function KeyStatusDot({ configured }) {
      const color = configured === true ? '#22c55e' : configured === false ? '#ef4444' : '#f59e0b';
      const label = configured === true ? 'Key 已配置' : configured === false ? 'Key 未配置' : '正在检查 Key';
      return h('span', {
        title: label,
        'aria-label': label,
        style: {
          display: 'inline-block',
          width: '9px',
          height: '9px',
          borderRadius: '50%',
          background: color,
          boxShadow: `0 0 0 3px ${configured === true ? 'rgba(34,197,94,.18)' : configured === false ? 'rgba(239,68,68,.18)' : 'rgba(245,158,11,.18)'}`,
          flex: '0 0 auto',
        },
      });
    }

    function SettingsBody() {
      const settings = useSettings();
      const [key, setKey] = React.useState('');
      const [keyConfigured, setKeyConfigured] = React.useState(null);
      const [busy, setBusy] = React.useState(false);
      const [status, setStatus] = React.useState('');
      const [error, setError] = React.useState('');
      const [previewing, setPreviewing] = React.useState(false);
      const [cacheInfo, setCacheInfo] = React.useState({ count: 0, bytes: 0 });
      const [soul, setSoul] = React.useState(null);
      const [soulDraft, setSoulDraft] = React.useState('');
      const [soulBusy, setSoulBusy] = React.useState(false);

      React.useEffect(() => {
        const stored = readStoredKey();
        setKey(stored);
        setKeyConfigured(stored.length > 0 ? true : null);
        void readCacheStats().then(setCacheInfo);
        void loadSoul(true).then((info) => {
          setSoul(info);
          setSoulDraft(info.content);
        });
        fetch('/api/dsh-tts/key')
          .then((response) => (response.ok ? response.json() : null))
          .then((info) => {
            setKeyConfigured(info?.configured === true || readStoredKey().length > 0);
          })
          .catch(() => {
            setKeyConfigured(readStoredKey().length > 0);
          });
      }, []);

      const save = async () => {
        const value = key.trim();
        if (!/^sk-[A-Za-z0-9_-]{8,}$/u.test(value)) {
          setError('Key 应以 sk- 开头，请检查后重试。');
          return;
        }
        setBusy(true);
        setError('');
        storeKey(value);
        setKeyConfigured(true);
        try {
          const response = await fetch('/api/dsh-tts/key', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ apiKey: value }),
          });
          const body = await response.json().catch(() => ({}));
          if (response.ok) {
            setStatus('Key 已保存。');
          } else {
            setStatus('已保存到本机浏览器。');
          }
        } catch {
          setStatus('已保存在本机浏览器。');
        } finally {
          setBusy(false);
        }
      };

      const clear = async () => {
        forgetKey();
        setKey('');
        setKeyConfigured(false);
        setBusy(true);
        setError('');
        try {
          await fetch('/api/dsh-tts/key', { method: 'DELETE' });
          setStatus('Key 已清除。');
        } catch {
          setStatus('已清除本机 Key。');
        } finally {
          setBusy(false);
        }
      };

      const saveSoul = async () => {
        if (soulDraft.trim().length === 0) {
          setError('soul.md 不能为空。');
          return;
        }
        setSoulBusy(true);
        setError('');
        try {
          const response = await fetch('/api/dsh-tts/soul', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ content: soulDraft }),
          });
          const info = await response.json().catch(() => ({}));
          if (!response.ok) {
            setError(typeof info.message === 'string' ? info.message : `保存 soul.md 失败（HTTP ${response.status}）。`);
            return;
          }
          setSoul(info);
          setSoulDraft(info.content ?? soulDraft);
          clearSummaryCache();
          setStatus('soul.md 已保存。');
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setSoulBusy(false);
        }
      };

      const reloadSoul = async () => {
        setSoulBusy(true);
        setError('');
        try {
          const info = await loadSoul(true);
          setSoul(info);
          setSoulDraft(info.content);
          setStatus('已重新读取。');
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setSoulBusy(false);
        }
      };

      const clearCache = async () => {
        setBusy(true);
        setError('');
        try {
          await clearAudioCache();
          setCacheInfo({ count: 0, bytes: 0 });
          setStatus('缓存已清空。');
        } catch {
          setError('清空缓存失败，请稍后重试。');
        } finally {
          setBusy(false);
        }
      };

      const preview = async () => {
        setPreviewing(true);
        setError('');
        try {
          await previewVoice(settings.voice);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
          setPreviewing(false);
        }
      };

      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            padding: '20px 24px',
            width: '100%',
            maxWidth: '820px',
            boxSizing: 'border-box',
          },
        },
        h(
          'div',
          null,
          h('h2', { style: { margin: 0, fontSize: '19px', fontWeight: 650 } }, '鲸读'),
        ),
        h(
          Card,
          {
            title: h(
              'span',
              {
                title: '插件专用 Key；只存入插件自己的凭据，不影响 DSH 本体。',
                style: { display: 'inline-flex', alignItems: 'center', gap: '8px' },
              },
              h(KeyStatusDot, { configured: keyConfigured }),
              'API Key',
            ),
          },
          h('input', {
            type: 'password',
            value: key,
            placeholder: 'sk-...',
            autocomplete: 'off',
            spellcheck: false,
            style: inputStyle,
            onChange: (event) => setKey(event.target.value),
          }),
          h(
            'div',
            { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
            h('button', { type: 'button', style: buttonStyle, disabled: busy, onClick: save }, '保存'),
            h('button', { type: 'button', style: buttonStyle, disabled: busy, onClick: clear }, '清除'),
            h(
              'button',
              { type: 'button', style: buttonStyle, disabled: busy || previewing, onClick: preview },
              previewing ? '试听中…' : '试听',
            ),
          ),
        ),
        h(
          Card,
          {
            title: '播报方式',
          },
          h(FieldLabel, null, '朗读内容'),
          h(
            'select',
            {
              value: settings.mode,
              style: inputStyle,
              onChange: (event) => updateSettings({ mode: event.target.value }),
            },
            h('option', { value: 'summary' }, '总结（推荐）'),
            h('option', { value: 'full' }, '全文'),
          ),
          h(FieldLabel, null, '回复声线'),
          h(
            'select',
            {
              value: settings.voice,
              style: inputStyle,
              onChange: (event) => updateSettings({ voice: event.target.value }),
            },
            ...VOICES.map((voice) => h('option', { key: voice.id, value: voice.id }, voice.label)),
          ),
          h(FieldLabel, null, h('span', { title: '补充口吻；soul.md 优先。' }, '人设 / 语气')),
          h('input', {
            type: 'text',
            value: settings.persona,
            maxLength: 160,
            disabled: !settings.useSoul,
            placeholder: settings.useSoul ? '如：语气温和、不啰嗦' : '人设已关闭',
            style: { ...inputStyle, opacity: settings.useSoul ? 1 : 0.55 },
            onChange: (event) => updateSettings({ persona: event.target.value }),
          }),
        ),
        h(
          Card,
          {
            title: '人设 soul.md',
          },
          h(
            Switch,
            {
              checked: settings.useSoul,
              onChange: (value) => {
                updateSettings({ useSoul: value });
                clearSummaryCache();
                setStatus(value ? '已启用' : '已关闭');
              },
            },
            h('span', { title: 'soul.md 与「人设 / 语气」会一起进入总结 prompt；soul.md 优先。' }, '启用人设'),
          ),
          soul === null
            ? h('div', { style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary, #777)' } }, '读取中…')
            : h(
                'div',
                {
                  title: soul.path || 'soul.md',
                  style: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #777)' },
                },
                'soul.md',
                soul.exists ? '' : '（未创建）',
              ),
          h('textarea', {
            value: soulDraft,
            rows: 10,
            spellCheck: false,
            placeholder: '# 人设',
            style: {
              ...inputStyle,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: '12.5px',
              lineHeight: 1.55,
              resize: 'vertical',
            },
            onChange: (event) => setSoulDraft(event.target.value),
          }),
          h(
            'div',
            { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
            h(
              'button',
              { type: 'button', style: buttonStyle, disabled: soulBusy, onClick: saveSoul },
              soulBusy ? '保存中…' : '保存',
            ),
            h(
              'button',
              { type: 'button', style: buttonStyle, disabled: soulBusy, onClick: reloadSoul },
              '重载',
            ),
          ),
        ),
        h(
          Card,
          {
            title: '自动播报',
          },
          h(
            Switch,
            {
              checked: settings.autoPlay,
              onChange: (value) => updateSettings({ autoPlay: value }),
            },
            '任务完成后自动播报',
          ),
          h(
            Switch,
            {
              checked: settings.playChime,
              disabled: !settings.autoPlay,
              onChange: (value) => updateSettings({ playChime: value }),
            },
            '播报结束后播放提示音',
          ),
        ),
        h(
          Card,
          {
            title: '语音缓存',
          },
          h(
            'div',
            { style: { fontSize: '13px', color: 'var(--dsw-alias-label-secondary, #777)' } },
            `${cacheInfo.count} 条 · ${formatBytes(cacheInfo.bytes)}`,
          ),
          h(
            'div',
            null,
            h(
              'button',
              { type: 'button', style: buttonStyle, disabled: busy, onClick: clearCache },
              '清理',
            ),
          ),
        ),
        error.length > 0
          ? h('div', { style: { color: '#d9534f', fontSize: '13px' } }, error)
          : status.length > 0
            ? h(
                'div',
                { style: { color: 'var(--dsw-alias-label-secondary, #777)', fontSize: '13px' } },
                status,
              )
            : null,
      );
    }

    function SettingsPanel() {
      return h(
        'div',
        {
          style: {
            height: '100%',
            overflowY: 'auto',
            display: 'flex',
            justifyContent: 'center',
            background: 'var(--dsw-alias-bg-base, transparent)',
          },
        },
        h(SettingsBody),
      );
    }

    function SettingsSection() {
      return h(SettingsBody);
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        try {
          if (document.getElementById('dsh-jingdu-action-style') === null) {
            const style = document.createElement('style');
            style.id = 'dsh-jingdu-action-style';
            style.textContent = ACTION_CSS;
            document.head.appendChild(style);
          }
        } catch {
          // Inline fallbacks keep the button usable without a style element.
        }
        ctx.slots.inject('conversation.chat.assistant-actions', () =>
          ctx.slots.register(
            {
              name: 'conversation.chat.assistant-actions',
              id: 'dsh-jingdu-speak',
              order: 40,
            },
            SpeakButton,
          ),
        );
        ctx.slots.inject('conversation.chat.turnTail', () =>
          ctx.slots.register(
            {
              name: 'conversation.chat.turnTail',
              id: 'dsh-jingdu-autoplay',
              order: 500,
            },
            AutoPlayTail,
          ),
        );
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'dsh-jingdu',
              order: 80,
              label: () => '鲸读',
            },
            SettingsSection,
          ),
        );
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, SettingsPanel),
        );
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: PANEL_ID,
              order: 60,
              label: () => '鲸读',
            },
            SpeakerIcon,
          ),
        );
      },
    };
  },
});
