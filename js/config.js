export const CONFIG = {
  mediapipe: {
    visionUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18',
    wasmUrl:   'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm',
    modelUrl:  'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
    numHands: 2,
  },
  gesture: { confidenceThreshold: 0.55, holdMs: 320 }, // удерживать жест holdMs мс выше порога
  strictHand: true,   // требовать правильную руку (кнопка Swap/Toggle в UI меняет на лету)
  mirror: true,       // зеркалить видео и корректировать руку
  tts: { rate: 0.9, pitch: 1.0, preferLang: 'en-US' },
  // kie.ai bridge — premium ElevenLabs voice via the local /api/tts proxy (key lives server-side).
  kie: { endpoint: '/api/tts', enabled: true, voice: 'EkK5I93UQWFDigLMpZcX', speed: 0.95 },
  // Optional direct ElevenLabs (used only if you paste a key on the start screen).
  elevenLabs: { apiKey: '', voiceId: '21m00Tcm4TlvDq8ikWAM', model: 'eleven_turbo_v2_5' },
};

// Имена жестов из встроенной модели MediaPipe:
export const GESTURE = { THUMB_UP: 'Thumb_Up', FIST: 'Closed_Fist' };

// Какой жест/рука требуется на шаге step (1-based): нечёт → палец вверх+левая, чёт → кулак+правая
export function expectedFor(step) {
  return (step % 2 === 1)
    ? { gesture: GESTURE.THUMB_UP, hand: 'Left',  label: '👍 Палец вверх — ЛЕВАЯ рука' }
    : { gesture: GESTURE.FIST,     hand: 'Right', label: '✊ Кулак — ПРАВАЯ рука' };
}

// Переворачивает сторону руки (для коррекции зеркала): 'Left' ↔ 'Right'
export function flipHand(h) {
  return h === 'Left' ? 'Right' : 'Left';
}
