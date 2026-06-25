// js/speech.js
// Web Speech matcher. Matches spoken words against a target word sequence in order.
// startForTarget(words): stores lowercase target words and (re)starts recognition.
// On result: normalize transcript, walk a pointer through target words; when the next
// expected target word appears in the spoken tokens, fire onWordMatch(pointerIndex) once
// and advance the pointer. onTranscript(latestText) for live text.
// Graceful fallback if API absent: { supported:false, startForTarget(){}, stop(){}, reset(){} }.

export function createSpeechMatcher({ onWordMatch, onTranscript, onStatus } = {}) {
  const safe = (fn, ...args) => {
    try { if (typeof fn === 'function') fn(...args); } catch (_) { /* swallow callback errors */ }
  };

  const SpeechRecognitionImpl =
    (typeof window !== 'undefined') &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  if (!SpeechRecognitionImpl) {
    safe(onStatus, 'Распознавание речи не поддерживается этим браузером');
    return {
      supported: false,
      startForTarget() {},
      stop() {},
      reset() {},
    };
  }

  // --- internal state -------------------------------------------------------
  let recognition = null;
  let active = false;          // are we (re)started for a target right now
  let restarting = false;      // guard against double restart races
  let targetWords = [];        // lowercase normalized target word list
  let pointer = 0;             // index of next expected target word
  const matched = new Set();   // indices already fired (each index once)

  // Normalize a piece of text → array of lowercase tokens, punctuation stripped.
  function normalize(text) {
    if (!text) return [];
    return String(text)
      .toLowerCase()
      .replace(/[^a-z0-9'\s]/g, ' ') // strip punctuation, keep apostrophes for contractions
      .replace(/'/g, '')             // collapse apostrophes (don't -> dont) for forgiving match
      .split(/\s+/)
      .filter(Boolean);
  }

  function buildRecognition() {
    const rec = new SpeechRecognitionImpl();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    if ('maxAlternatives' in rec) rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      try {
        let latest = '';
        // Collect all tokens across results so we can advance the pointer in order.
        const tokens = [];
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          const transcript = result[0] && result[0].transcript ? result[0].transcript : '';
          latest += transcript + ' ';
          for (const tok of normalize(transcript)) tokens.push(tok);
        }

        // Walk the pointer: when the next expected target word appears among the
        // spoken tokens, fire onWordMatch(pointer) and advance. Each index fires once.
        if (targetWords.length) {
          let progressed = true;
          while (progressed && pointer < targetWords.length) {
            progressed = false;
            const expected = targetWords[pointer];
            if (expected && tokens.includes(expected)) {
              if (!matched.has(pointer)) {
                matched.add(pointer);
                safe(onWordMatch, pointer);
              }
              pointer++;
              progressed = true;
            }
          }
        }

        safe(onTranscript, latest.trim());
      } catch (err) {
        safe(onStatus, 'Ошибка обработки речи: ' + (err && err.message ? err.message : err));
      }
    };

    rec.onerror = (event) => {
      const code = event && event.error ? event.error : 'unknown';
      // 'no-speech' / 'aborted' are benign; report quietly and let onend restart.
      safe(onStatus, 'Речь: ' + code);
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        // Permission denied — stop trying to restart.
        active = false;
      }
    };

    rec.onend = () => {
      // Auto-restart while active so recognition stays continuous across browser timeouts.
      if (active && !restarting) {
        restarting = true;
        try {
          rec.start();
        } catch (err) {
          // Some engines throw if start() called too soon after end; retry shortly.
          try {
            setTimeout(() => {
              if (active) {
                try { rec.start(); } catch (_) { /* give up silently */ }
              }
              restarting = false;
            }, 250);
            return;
          } catch (_) { /* ignore */ }
        }
        restarting = false;
      }
    };

    return rec;
  }

  function ensureRecognition() {
    if (!recognition) recognition = buildRecognition();
    return recognition;
  }

  function reset() {
    pointer = 0;
    matched.clear();
  }

  function startForTarget(words) {
    // Store the lowercase target words and (re)start recognition.
    targetWords = Array.isArray(words)
      ? words.flatMap((w) => normalize(w))
      : normalize(words);
    reset();

    active = true;
    const rec = ensureRecognition();

    // Restart cleanly: stop any running session, then start (onend will not fire
    // a restart loop because we explicitly start again here).
    try {
      rec.start();
    } catch (err) {
      // start() throws "InvalidStateError" if already started — abort then restart.
      try {
        rec.abort();
      } catch (_) { /* ignore */ }
      try {
        setTimeout(() => {
          if (active) {
            try { rec.start(); } catch (_) { /* ignore */ }
          }
        }, 200);
      } catch (_) { /* ignore */ }
    }
  }

  function stop() {
    active = false;
    if (recognition) {
      try { recognition.stop(); } catch (_) { /* ignore */ }
      try { recognition.abort(); } catch (_) { /* ignore */ }
    }
  }

  return {
    supported: true,
    startForTarget,
    stop,
    reset,
  };
}
