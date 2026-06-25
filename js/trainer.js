// js/trainer.js
// Конечный автомат тренажёра NEUROLING.
// Поддерживает точный state-объект из контракта, эмитит onState при каждом изменении.
// Жест засчитывается только при удержании holdMs выше порога (по performance.now()).

import { expectedFor } from './config.js';

function clamp(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

function now() {
  // Только performance.now() — без Date.now()/Math.random.
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
  } catch (_) {
    // fall through
  }
  return 0;
}

export function createTrainer({ phrases, config, onState, onReveal, onPhraseComplete, onAllComplete } = {}) {
  const list = Array.isArray(phrases) ? phrases : [];
  const cfg = config || {};
  const gestureCfg = cfg.gesture || {};
  const holdMs = typeof gestureCfg.holdMs === 'number' && gestureCfg.holdMs > 0 ? gestureCfg.holdMs : 320;
  const confThreshold = typeof gestureCfg.confidenceThreshold === 'number' ? gestureCfg.confidenceThreshold : 0.55;

  // Точный state-объект из контракта.
  const state = {
    phraseIndex: 0,
    totalPhrases: list.length,
    words: [],
    revealedCount: 0,
    step: 0,
    expected: { gesture: '', hand: '', label: '' },
    gestureProgress: 0,
    spokenMask: [],
    status: 'idle',
    lastDetected: null,
  };

  // Внутреннее состояние удержания жеста.
  let heldSince = null;
  let advanceTimer = null;

  function safe(fn, ...args) {
    if (typeof fn !== 'function') return;
    try {
      fn(...args);
    } catch (_) {
      // Никогда не бросаем наружу.
    }
  }

  function emitState() {
    safe(onState, state);
  }

  function clearAdvanceTimer() {
    if (advanceTimer !== null) {
      try {
        clearTimeout(advanceTimer);
      } catch (_) {
        // ignore
      }
      advanceTimer = null;
    }
  }

  function resetHold() {
    heldSince = null;
    state.gestureProgress = 0;
  }

  function loadPhrase() {
    try {
      clearAdvanceTimer();
      const raw = list[state.phraseIndex];
      const phrase = typeof raw === 'string' ? raw : '';
      const words = phrase.split(' ').filter((w) => w.length > 0);
      state.words = words;
      state.revealedCount = words.length > 0 ? 1 : 0;
      state.step = state.revealedCount;
      state.spokenMask = words.map(() => false);
      state.expected = expectedFor(state.step || 1);
      state.status = 'awaiting';
      state.lastDetected = null;
      resetHold();
      emitState();
      if (words.length > 0) {
        safe(onReveal, words[0], 0);
      }
    } catch (_) {
      // Грейсфул: не бросаем.
    }
  }

  function start() {
    try {
      clearAdvanceTimer();
      state.phraseIndex = 0;
      state.totalPhrases = list.length;
      loadPhrase();
    } catch (_) {
      // ignore
    }
  }

  function nextPhrase() {
    try {
      if (state.phraseIndex < list.length - 1) {
        state.phraseIndex++;
        loadPhrase();
      } else {
        state.status = 'all-complete';
        safe(onAllComplete);
        emitState();
      }
    } catch (_) {
      // ignore
    }
  }

  function advance() {
    try {
      if (state.revealedCount < state.words.length) {
        state.revealedCount++;
        state.step++;
        state.expected = expectedFor(state.step);
        resetHold();
        const idx = state.step - 1;
        safe(onReveal, state.words[idx], idx);
        emitState();
      } else {
        // Фраза завершена.
        state.status = 'phrase-complete';
        resetHold();
        emitState();
        safe(onPhraseComplete, state.phraseIndex);
        // Через паузу — следующая фраза или общее завершение.
        clearAdvanceTimer();
        if (state.phraseIndex < list.length - 1) {
          advanceTimer = setTimeout(() => {
            advanceTimer = null;
            nextPhrase();
          }, 1800);
        } else {
          state.status = 'all-complete';
          safe(onAllComplete);
          emitState();
        }
      }
    } catch (_) {
      // ignore
    }
  }

  function handleDetection(detection) {
    try {
      const d = detection || {};
      const gesture = d.gesture;
      const score = typeof d.score === 'number' ? d.score : 0;
      const hand = d.hand;

      state.lastDetected = { gesture: gesture, score: score, hand: hand };

      // Если не в режиме ожидания — не копим прогресс, но всё равно эмитим.
      if (state.status !== 'awaiting') {
        resetHold();
        emitState();
        return;
      }

      const exp = state.expected || {};
      const strict = !!cfg.strictHand;
      const gestureOk = gesture === exp.gesture;
      const scoreOk = score >= confThreshold;
      const handOk = !strict || hand === exp.hand;
      const matched = gestureOk && scoreOk && handOk;

      if (matched) {
        const t = now();
        if (heldSince === null) {
          heldSince = t;
        }
        const elapsed = t - heldSince;
        state.gestureProgress = clamp(elapsed / holdMs, 0, 1);
        if (state.gestureProgress >= 1) {
          // Достигли удержания — продвигаемся.
          advance();
          return;
        }
      } else {
        resetHold();
      }

      emitState();
    } catch (_) {
      // Никогда не бросаем.
    }
  }

  function notifyWordSpoken(index) {
    try {
      const i = index | 0;
      if (i >= 0 && i < state.spokenMask.length && state.spokenMask[i] === false) {
        state.spokenMask[i] = true;
        emitState();
      }
    } catch (_) {
      // ignore
    }
  }

  function setStrictHand(bool) {
    try {
      cfg.strictHand = !!bool;
      // Сброс удержания, чтобы смена правила не зачла «висящий» жест.
      resetHold();
      emitState();
    } catch (_) {
      // ignore
    }
  }

  function next() {
    // Ручной скип на следующую фразу.
    try {
      clearAdvanceTimer();
      if (state.phraseIndex < list.length - 1) {
        state.phraseIndex++;
        loadPhrase();
      } else {
        state.status = 'all-complete';
        safe(onAllComplete);
        emitState();
      }
    } catch (_) {
      // ignore
    }
  }

  function reset() {
    try {
      clearAdvanceTimer();
      start();
    } catch (_) {
      // ignore
    }
  }

  function getState() {
    return state;
  }

  return {
    start,
    handleDetection,
    notifyWordSpoken,
    setStrictHand,
    next,
    reset,
    getState,
  };
}
