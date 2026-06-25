// js/tts.js
// Text-to-speech with ElevenLabs (when API key present) and graceful browser fallback.
// speak(text) -> Promise<void>. Never throws outward: on ANY error it falls back to the browser voice.
// setApiKey(key) mutates config.elevenLabs.apiKey on the fly.

export function createTTS(config) {
  // Defensive defaults so we never explode on a partial config.
  const cfg = config || {};
  cfg.elevenLabs = cfg.elevenLabs || { apiKey: '', voiceId: '21m00Tcm4TlvDq8ikWAM', model: 'eleven_turbo_v2_5' };
  cfg.tts = cfg.tts || { rate: 0.9, pitch: 1.0, preferLang: 'en-US' };

  let cachedVoices = [];

  // ---- Browser voice selection ------------------------------------------------
  function loadVoices() {
    try {
      if (typeof speechSynthesis === 'undefined') return [];
      const v = speechSynthesis.getVoices();
      if (v && v.length) cachedVoices = v;
      return cachedVoices;
    } catch (e) {
      return cachedVoices;
    }
  }

  // Voices often load asynchronously; subscribe once to keep our cache warm.
  try {
    if (typeof speechSynthesis !== 'undefined') {
      loadVoices();
      if ('onvoiceschanged' in speechSynthesis) {
        speechSynthesis.onvoiceschanged = () => { loadVoices(); };
      }
    }
  } catch (e) { /* ignore */ }

  // Wait (briefly) for voices to populate if the list is still empty.
  function ensureVoices() {
    return new Promise((resolve) => {
      let voices = loadVoices();
      if (voices && voices.length) { resolve(voices); return; }
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve(loadVoices());
      };
      try {
        if (typeof speechSynthesis !== 'undefined' && 'onvoiceschanged' in speechSynthesis) {
          const prev = speechSynthesis.onvoiceschanged;
          speechSynthesis.onvoiceschanged = () => {
            if (typeof prev === 'function') { try { prev(); } catch (e) { /* ignore */ } }
            finish();
          };
        }
      } catch (e) { /* ignore */ }
      // Fallback timeout so we never hang waiting on voices.
      setTimeout(finish, 600);
    });
  }

  function pickEnglishVoice(voices) {
    if (!voices || !voices.length) return null;
    const preferLang = (cfg.tts && cfg.tts.preferLang) || 'en-US';
    // Prefer exact preferred lang (e.g. en-US), then any en-* voice.
    return (
      voices.find((v) => v && v.lang && v.lang.toLowerCase() === preferLang.toLowerCase()) ||
      voices.find((v) => v && v.lang && v.lang.toLowerCase().startsWith('en-us')) ||
      voices.find((v) => v && v.lang && v.lang.toLowerCase().startsWith('en')) ||
      null
    );
  }

  // ---- Browser fallback -------------------------------------------------------
  function speakBrowser(text) {
    return new Promise((resolve) => {
      try {
        if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') {
          resolve();
          return;
        }
        ensureVoices().then((voices) => {
          try {
            const utter = new SpeechSynthesisUtterance(String(text == null ? '' : text));
            const voice = pickEnglishVoice(voices);
            if (voice) {
              utter.voice = voice;
              utter.lang = voice.lang;
            } else {
              utter.lang = (cfg.tts && cfg.tts.preferLang) || 'en-US';
            }
            utter.rate = (cfg.tts && typeof cfg.tts.rate === 'number') ? cfg.tts.rate : 0.9;
            utter.pitch = (cfg.tts && typeof cfg.tts.pitch === 'number') ? cfg.tts.pitch : 1.0;

            let done = false;
            const finish = () => { if (done) return; done = true; resolve(); };
            utter.onend = finish;
            utter.onerror = finish;
            // Safety net: resolve even if the engine never fires onend.
            const guardMs = 8000 + String(text || '').length * 90;
            setTimeout(finish, guardMs);

            speechSynthesis.cancel(); // clear any stuck queue
            speechSynthesis.speak(utter);
          } catch (e) {
            resolve();
          }
        });
      } catch (e) {
        resolve();
      }
    });
  }

  // ---- ElevenLabs -------------------------------------------------------------
  async function speakElevenLabs(text) {
    const el = cfg.elevenLabs;
    const voiceId = el.voiceId || '21m00Tcm4TlvDq8ikWAM';
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?optimize_streaming_latency=0`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': el.apiKey,
        'accept': 'audio/mpeg',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: String(text == null ? '' : text),
        model_id: el.model || 'eleven_turbo_v2_5',
        voice_settings: { stability: 0.4, similarity_boost: 0.8 },
      }),
    });

    if (!res || !res.ok) {
      throw new Error('ElevenLabs request failed: ' + (res ? res.status : 'no response'));
    }

    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);

    await new Promise((resolve, reject) => {
      let done = false;
      const cleanup = () => {
        try { URL.revokeObjectURL(objectUrl); } catch (e) { /* ignore */ }
      };
      try {
        const audio = new Audio(objectUrl);
        const finish = () => { if (done) return; done = true; cleanup(); resolve(); };
        const fail = (err) => { if (done) return; done = true; cleanup(); reject(err || new Error('audio error')); };
        audio.onended = finish;
        audio.onerror = () => fail(new Error('audio playback error'));
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch((err) => fail(err));
        }
      } catch (e) {
        cleanup();
        reject(e);
      }
    });
  }

  // ---- Public speak -----------------------------------------------------------
  async function speak(text) {
    try {
      const apiKey = cfg.elevenLabs && cfg.elevenLabs.apiKey ? String(cfg.elevenLabs.apiKey).trim() : '';
      if (apiKey) {
        try {
          await speakElevenLabs(text);
          return;
        } catch (e) {
          // ElevenLabs failed for any reason -> fall back to the browser voice.
          await speakBrowser(text);
          return;
        }
      }
      await speakBrowser(text);
    } catch (e) {
      // Last-resort guard: never throw outward.
      try { await speakBrowser(text); } catch (e2) { /* ignore */ }
    }
  }

  function setApiKey(key) {
    try {
      cfg.elevenLabs.apiKey = key == null ? '' : String(key);
    } catch (e) { /* ignore */ }
  }

  return { speak, setApiKey };
}
