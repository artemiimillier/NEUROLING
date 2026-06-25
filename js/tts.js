// js/tts.js
// Text-to-speech with a 3-tier strategy, never throwing outward:
//   1) kie.ai ElevenLabs via the local /api/tts proxy  (premium voice, key stays server-side)
//   2) direct ElevenLabs                                (only if a key was pasted on the start screen)
//   3) browser speechSynthesis                          (always-available fallback)
//
// Extras:
//   prewarm(texts[])  — generate + cache audio ahead of time so word-by-word playback is instant.
//   setApiKey(key)    — set the optional direct-ElevenLabs key on the fly.

export function createTTS(config) {
  const cfg = config || {};
  cfg.elevenLabs = cfg.elevenLabs || { apiKey: '', voiceId: '21m00Tcm4TlvDq8ikWAM', model: 'eleven_turbo_v2_5' };
  cfg.tts = cfg.tts || { rate: 0.9, pitch: 1.0, preferLang: 'en-US' };
  cfg.kie = cfg.kie || { endpoint: '/api/tts', enabled: true, voice: 'EkK5I93UQWFDigLMpZcX', speed: 0.95 };

  // kie disables itself if the local proxy is absent (e.g. served by plain http.server).
  let kieDisabled = !(cfg.kie && cfg.kie.enabled);
  const kieCache = new Map(); // text -> Promise<objectURL>

  let cachedVoices = [];

  // ============================================================ browser voices
  function loadVoices() {
    try {
      if (typeof speechSynthesis === 'undefined') return [];
      const v = speechSynthesis.getVoices();
      if (v && v.length) cachedVoices = v;
      return cachedVoices;
    } catch (e) { return cachedVoices; }
  }
  try {
    if (typeof speechSynthesis !== 'undefined') {
      loadVoices();
      if ('onvoiceschanged' in speechSynthesis) speechSynthesis.onvoiceschanged = () => { loadVoices(); };
    }
  } catch (e) { /* ignore */ }

  function ensureVoices() {
    return new Promise((resolve) => {
      const voices = loadVoices();
      if (voices && voices.length) { resolve(voices); return; }
      let settled = false;
      const finish = () => { if (settled) return; settled = true; resolve(loadVoices()); };
      try {
        if (typeof speechSynthesis !== 'undefined' && 'onvoiceschanged' in speechSynthesis) {
          const prev = speechSynthesis.onvoiceschanged;
          speechSynthesis.onvoiceschanged = () => {
            if (typeof prev === 'function') { try { prev(); } catch (e) { /* ignore */ } }
            finish();
          };
        }
      } catch (e) { /* ignore */ }
      setTimeout(finish, 600);
    });
  }

  function pickEnglishVoice(voices) {
    if (!voices || !voices.length) return null;
    const preferLang = (cfg.tts && cfg.tts.preferLang) || 'en-US';
    return (
      voices.find((v) => v && v.lang && v.lang.toLowerCase() === preferLang.toLowerCase()) ||
      voices.find((v) => v && v.lang && v.lang.toLowerCase().startsWith('en-us')) ||
      voices.find((v) => v && v.lang && v.lang.toLowerCase().startsWith('en')) ||
      null
    );
  }

  function speakBrowser(text) {
    return new Promise((resolve) => {
      try {
        if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') { resolve(); return; }
        ensureVoices().then((voices) => {
          try {
            const utter = new SpeechSynthesisUtterance(String(text == null ? '' : text));
            const voice = pickEnglishVoice(voices);
            if (voice) { utter.voice = voice; utter.lang = voice.lang; }
            else { utter.lang = (cfg.tts && cfg.tts.preferLang) || 'en-US'; }
            utter.rate = (cfg.tts && typeof cfg.tts.rate === 'number') ? cfg.tts.rate : 0.9;
            utter.pitch = (cfg.tts && typeof cfg.tts.pitch === 'number') ? cfg.tts.pitch : 1.0;
            let done = false;
            const finish = () => { if (done) return; done = true; resolve(); };
            utter.onend = finish; utter.onerror = finish;
            setTimeout(finish, 8000 + String(text || '').length * 90);
            speechSynthesis.cancel();
            speechSynthesis.speak(utter);
          } catch (e) { resolve(); }
        });
      } catch (e) { resolve(); }
    });
  }

  // ============================================================ audio playback
  function playUrl(url) {
    return new Promise((resolve, reject) => {
      try {
        const audio = new Audio(url);
        let done = false;
        const finish = () => { if (done) return; done = true; resolve(); };
        audio.onended = finish;
        audio.onerror = () => { if (done) return; done = true; reject(new Error('audio playback error')); };
        const pp = audio.play();
        if (pp && typeof pp.catch === 'function') pp.catch((err) => { if (done) return; done = true; reject(err); });
      } catch (e) { reject(e); }
    });
  }

  // ============================================================ kie.ai bridge
  function kieRequest(text) {
    const endpoint = (cfg.kie && cfg.kie.endpoint) || '/api/tts';
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: String(text == null ? '' : text),
        voice: cfg.kie.voice,
        speed: cfg.kie.speed,
      }),
    }).then(async (res) => {
      if (res && res.status === 404) { kieDisabled = true; throw new Error('kie proxy not available'); }
      if (!res || !res.ok) throw new Error('kie tts ' + (res ? res.status : 'no-response'));
      const ct = (res.headers && res.headers.get('content-type')) || '';
      if (ct.indexOf('audio') === -1) throw new Error('kie tts returned non-audio');
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    }).catch((e) => {
      // A network failure means the proxy isn't there — stop trying kie this session.
      if (e && e.name === 'TypeError') kieDisabled = true;
      throw e;
    });
  }

  function ensureKie(text) {
    const key = String(text == null ? '' : text);
    if (kieCache.has(key)) return kieCache.get(key);
    const p = kieRequest(key);
    kieCache.set(key, p);
    p.catch(() => { kieCache.delete(key); }); // allow retry later (unless kieDisabled)
    return p;
  }

  // Generate audio ahead of time so word-by-word reveals play instantly.
  function prewarm(texts) {
    if (kieDisabled || !Array.isArray(texts)) return;
    for (const t of texts) {
      if (!t) continue;
      try { ensureKie(t).catch(() => {}); } catch (e) { /* ignore */ }
    }
  }

  // ============================================================ direct ElevenLabs
  async function speakElevenLabs(text) {
    const el = cfg.elevenLabs;
    const voiceId = el.voiceId || '21m00Tcm4TlvDq8ikWAM';
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?optimize_streaming_latency=0`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'xi-api-key': el.apiKey, accept: 'audio/mpeg', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: String(text == null ? '' : text),
        model_id: el.model || 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.4, similarity_boost: 0.8 },
      }),
    });
    if (!res || !res.ok) throw new Error('ElevenLabs request failed: ' + (res ? res.status : 'no response'));
    const objectUrl = URL.createObjectURL(await res.blob());
    try { await playUrl(objectUrl); } finally { try { URL.revokeObjectURL(objectUrl); } catch (e) { /* ignore */ } }
  }

  // ============================================================ public speak
  async function speak(text) {
    try {
      // 1) kie.ai premium voice via local proxy
      if (!kieDisabled) {
        try { const url = await ensureKie(text); await playUrl(url); return; }
        catch (e) { /* fall through */ }
      }
      // 2) direct ElevenLabs if a key was provided
      const apiKey = cfg.elevenLabs && cfg.elevenLabs.apiKey ? String(cfg.elevenLabs.apiKey).trim() : '';
      if (apiKey) {
        try { await speakElevenLabs(text); return; }
        catch (e) { await speakBrowser(text); return; }
      }
      // 3) browser voice
      await speakBrowser(text);
    } catch (e) {
      try { await speakBrowser(text); } catch (e2) { /* ignore */ }
    }
  }

  function setApiKey(key) {
    try { cfg.elevenLabs.apiKey = key == null ? '' : String(key); } catch (e) { /* ignore */ }
  }

  return { speak, setApiKey, prewarm };
}
