// js/main.js — NEUROLING entry module. Bootstrap & wiring.
// Pure browser ES module. Loaded via <script type="module" src="js/main.js"> at end of <body>.

import { CONFIG } from './config.js';
import { PHRASES } from './phrases.js';
import { startCamera } from './camera.js';
import { createGestureEngine } from './gestures.js';
import { createSpeechMatcher } from './speech.js';
import { createTTS } from './tts.js';
import { createTrainer } from './trainer.js';
import { createUI } from './ui.js';

// ---- Module-scoped handles (filled in during boot) ----
let ui = null;
let trainer = null;
let gestures = null;
let speech = null;
let tts = null;
let booted = false;

// Internal mirror flag used for hand mapping; initialised from config, flipped by Swap.
let mirror = !!(CONFIG && CONFIG.mirror);

// Build UI immediately so controls exist before any camera prompt.
document.addEventListener('DOMContentLoaded', () => {
  try {
    ui = createUI({ root: document.getElementById('app'), config: CONFIG });

    ui.bindControls({
      onStart: boot,
      onReplay,
      onNext,
      onToggleStrict,
      onSwapHands,
      onApiKey,
    });
  } catch (e) {
    // No UI to show errors with if createUI itself failed — log defensively.
    console.error('[NEUROLING] init failed:', e);
    try {
      if (ui && typeof ui.showError === 'function') ui.showError(e && e.message ? e.message : String(e));
    } catch (_) { /* ignore */ }
  }
});

// ---- Boot: requested on Start click ----
async function boot() {
  if (booted) return; // guard against double-start
  try {
    const video = document.getElementById('video');

    // 1) Camera + mic permission, bind video.
    ui.setStatus('Запрашиваю камеру и микрофон…');
    await startCamera(video);
    ui.setStatus('Камера готова. Загружаю модель жестов…');

    // 2) TTS (kie.ai ElevenLabs via local proxy → ElevenLabs key → browser).
    tts = createTTS(CONFIG);
    // Head-start: pre-generate the first phrase's words while the gesture model loads.
    try { if (tts.prewarm && PHRASES[0]) tts.prewarm(PHRASES[0].split(' ')); } catch (_) { /* ignore */ }

    // 3) Speech matcher — highlights spoken words, drives notifyWordSpoken.
    speech = createSpeechMatcher({
      onWordMatch: (i) => {
        try { if (trainer) trainer.notifyWordSpoken(i); } catch (e) { console.warn('[NEUROLING] notifyWordSpoken:', e); }
      },
      onTranscript: (text) => {
        try { if (ui && typeof ui.setStatus === 'function' && text) { /* live transcript optional */ } } catch (_) { /* ignore */ }
      },
      onStatus: (msg) => { try { ui.setStatus(msg); } catch (_) { /* ignore */ } },
    });

    // 4) Trainer state machine.
    trainer = createTrainer({
      phrases: PHRASES,
      config: CONFIG,
      onState: (state) => {
        try { ui.renderState(state); } catch (e) { console.warn('[NEUROLING] renderState:', e); }
      },
      onReveal: (word, i) => {
        try {
          // When a new phrase opens (first word), pre-generate all its words so playback stays instant.
          if (tts && tts.prewarm && i === 0 && trainer) {
            const st = trainer.getState();
            if (Array.isArray(st.words)) tts.prewarm(st.words);
          }
        } catch (e) { console.warn('[NEUROLING] tts.prewarm:', e); }
        try {
          if (tts) tts.speak(word);
        } catch (e) { console.warn('[NEUROLING] tts.speak:', e); }
        try {
          if (speech && trainer) {
            const st = trainer.getState();
            speech.startForTarget(st.words.slice(0, st.revealedCount));
          }
        } catch (e) { console.warn('[NEUROLING] speech.startForTarget:', e); }
      },
      onPhraseComplete: () => {
        try { ui.celebrate(); } catch (e) { console.warn('[NEUROLING] celebrate:', e); }
      },
      onAllComplete: () => {
        try { ui.allDone(); } catch (e) { console.warn('[NEUROLING] allDone:', e); }
      },
    });

    // 5) Gesture engine — per-frame detection → meter + trainer.
    gestures = await createGestureEngine({
      videoEl: video,
      onResult: (r) => {
        try {
          if (r) {
            const st = trainer.getState();
            ui.setMeter({
              gesture: r.gesture,
              score: r.score,
              hand: r.hand,
              expected: st.expected,
              progress: st.gestureProgress,
            });
            ui.drawLandmarks(r.landmarks, video);
            trainer.handleDetection(r);
          } else {
            const st = trainer.getState();
            ui.setMeter({
              gesture: null,
              score: 0,
              hand: null,
              expected: st.expected,
              progress: 0,
            });
          }
        } catch (e) {
          console.warn('[NEUROLING] onResult:', e);
        }
      },
      onStatus: (msg) => { try { ui.setStatus(msg); } catch (_) { /* ignore */ } },
    });

    // Apply the current mirror mapping to the freshly created engine.
    try { if (gestures && typeof gestures.setMirror === 'function') gestures.setMirror(mirror); } catch (_) { /* ignore */ }

    // 6) Go.
    gestures.start();
    trainer.start();
    booted = true;
    ui.setStatus('Поехали! Проговаривай слова и показывай жесты.');
  } catch (e) {
    booted = false;
    const msg = e && e.message ? e.message : String(e);
    try { ui.showError(msg); } catch (_) { console.error('[NEUROLING] boot failed:', msg); }
  }
}

// ---- Control handlers ----
function onReplay() {
  try {
    if (trainer && typeof trainer.reset === 'function') trainer.reset();
  } catch (e) {
    safeError(e);
  }
}

function onNext() {
  try {
    if (trainer && typeof trainer.next === 'function') trainer.next();
  } catch (e) {
    safeError(e);
  }
}

function onToggleStrict(b) {
  try {
    if (trainer) trainer.setStrictHand(!!b);
  } catch (e) {
    safeError(e);
  }
}

function onSwapHands() {
  // Flip internal mirror used for hand mapping and push the new value to the engine.
  try {
    mirror = !mirror;
    if (gestures && typeof gestures.setMirror === 'function') gestures.setMirror(mirror);
  } catch (e) {
    safeError(e);
  }
}

function onApiKey(k) {
  try {
    if (tts && typeof tts.setApiKey === 'function') tts.setApiKey(k);
  } catch (e) {
    safeError(e);
  }
}

function safeError(e) {
  const msg = e && e.message ? e.message : String(e);
  try {
    if (ui && typeof ui.showError === 'function') ui.showError(msg);
    else console.error('[NEUROLING]', msg);
  } catch (_) {
    console.error('[NEUROLING]', msg);
  }
}
