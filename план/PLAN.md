# NEUROLING — Gesture · Voice · English Trainer

> Локальное веб-приложение. Открывается → сразу запрос камеры+микрофона → видит тебя →
> через **MediaPipe Gesture Recognizer** (Google, бесплатно, без ключей) распознаёт жесты рук →
> ты проговариваешь английскую фразу по словам, после каждого слова показываешь жест
> (нечётное слово = **палец вверх левой рукой**, чётное = **кулак правой рукой**),
> система открывает следующее слово. Параллельно Web Speech распознаёт твою речь и
> подсвечивает сказанные слова зелёным. Дизайн — футуристический HUD.

---

## Цель (Definition of Done)

1. `index.html` открывается через локальный http-сервер, без шага сборки.
2. Сразу показывается start-overlay; по клику запрашиваются камера **и** микрофон одним `getUserMedia({video,audio})`.
3. Видео с тебя в зеркальном HUD-окне, поверх — оверлей лендмарков руки.
4. MediaPipe распознаёт `Thumb_Up` и `Closed_Fist`, показывает **процент уверенности** в реальном времени.
5. Фраза раскрывается по словам. Шаг k: проговорил слова 1..k → показал нужный жест нужной рукой → раскрывается слово k+1. Последний жест завершает фразу.
6. Нечётный шаг (1,3,5…) → палец вверх, **левая** рука. Чётный (2,4,6…) → кулак, **правая** рука.
7. Web Speech подсвечивает сказанные слова зелёным (доп. сигнал, не блокирует прогресс).
8. TTS озвучивает каждое новое слово (браузерный по умолчанию; ElevenLabs если введён ключ).
9. 10 базовых фраз, каждая ≥7 слов, прошедшее время (was/were).
10. Дизайн — невероятный футуристический неон-glassmorphism HUD.

---

## Фазы

- **Фаза 1 — Implement (параллельно, 1 агент = 1 файл):** все модули по контракту ниже.
- **Фаза 2 — Integrate & Verify:** один агент сверяет все файлы с контрактом, чинит рассинхрон,
  прогоняет `node --check` по чистым модулям, гарантирует, что index.html подключает всё верно.
- **Фаза 3 — Оркестратор (я):** запускаю статик-сервер, гружу страницу через Playwright,
  ловлю ошибки консоли/импортов, фикшу, отдаю инструкции по запуску.

---

## Стек / запуск

- Чистые ES-модули (`<script type="module">`), без бандлера.
- MediaPipe `@mediapipe/tasks-vision@0.10.18` через CDN (jsdelivr ESM import), модель `gesture_recognizer.task` из Google Storage, wasm с CDN.
- TTS: `speechSynthesis` (по умолчанию) / ElevenLabs REST (если ключ).
- Речь: `webkitSpeechRecognition`.
- Запуск: `python3 -m http.server 8000` → http://localhost:8000 (камера разрешена на localhost).

---

## КОНТРАКТ ИНТЕРФЕЙСОВ (единый источник правды — все файлы обязаны ему соответствовать)

Все JS — ES-модули в `js/`. Браузерные глобали (`window`, `document`, `navigator`, `speechSynthesis`, `fetch`, `requestAnimationFrame`) доступны. Никаких node-only API.

### js/config.js
```js
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
```

### js/phrases.js
```js
// Ровно 10 фраз, каждая ≥7 слов, прошедшее время (was/were). Только буквы/пробелы.
export const PHRASES = [
  'I was very glad to meet you this morning',
  'We were waiting for the bus near the station',
  'She was reading a book about the ocean yesterday',
  'They were playing music at the park last night',
  'He was cooking a warm dinner for his family',
  'You were always kind to everyone around you here',
  'It was a beautiful day to walk outside today',
  'We were learning English together every single quiet evening',
  'I was thinking about my old friends last week',
  'The children were laughing during the whole funny show',
];
```

### js/camera.js
```js
// Запрашивает камеру И микрофон (оба промпта). Привязывает видео к videoEl, проигрывает.
// Аудио-треки останавливает (микрофоном владеет SpeechRecognition), право доступа сохраняется.
// Возвращает { stream }. Бросает Error с понятным .message при отказе/отсутствии устройства.
export async function startCamera(videoEl) { /* getUserMedia({video:{facingMode:'user',width:1280,height:720}, audio:true}) */ }
```

### js/gestures.js
```js
// Обёртка MediaPipe GestureRecognizer (VIDEO mode). Грузит модель из CONFIG.
// onResult вызывается каждый кадр с { gesture, score, hand, landmarks } | null если рук нет.
//   gesture: строка категории (напр. 'Thumb_Up','Closed_Fist','None')
//   score: 0..1 уверенность
//   hand: рука ПОЛЬЗОВАТЕЛЯ 'Left'|'Right' (с учётом зеркала: userHand = mirror? flip(raw): raw)
//   landmarks: массив точек {x,y} нормализованных (для оверлея)
// Берётся рука с лучшим жестом из распознанных. onStatus(msg) для прогресса загрузки.
export async function createGestureEngine({ videoEl, onResult, onStatus }) {
  // return { start(), stop(), setMirror(bool) }
}
```

### js/speech.js
```js
// webkitSpeechRecognition. Матчит произнесённые слова против целевой последовательности.
// startForTarget(words: string[]) — слова текущей раскрытой части фразы (lowercase, без пунктуации).
// При обнаружении ожидаемого следующего слова → onWordMatch(index). onTranscript(text) — живой текст.
// Грейсфул, если API нет: возвращает заглушку, supported=false.
export function createSpeechMatcher({ onWordMatch, onTranscript, onStatus }) {
  // return { supported, startForTarget(words), stop(), reset() }
}
```

### js/tts.js
```js
// speak(text) → Promise<void>. ElevenLabs если CONFIG.elevenLabs.apiKey, иначе speechSynthesis (en голос).
// setApiKey(key) обновляет ключ на лету. Никогда не бросает наружу — при ошибке тихо фолбэк на браузер.
export function createTTS(config) {
  // return { speak(text), setApiKey(key) }
}
```

### js/trainer.js
```js
// Конечный автомат тренажёра. onState(state) при каждом изменении.
// state = {
//   phraseIndex, totalPhrases, words: string[], revealedCount, step,        // step === revealedCount (1-based)
//   expected: { gesture, hand, label }, gestureProgress: 0..1,              // прогресс удержания жеста
//   spokenMask: boolean[],                                                   // какие слова распознаны речью
//   status: 'idle'|'awaiting'|'phrase-complete'|'all-complete',
//   lastDetected: { gesture, score, hand } | null,
// }
export function createTrainer({ phrases, config, onState, onReveal, onPhraseComplete, onAllComplete }) {
  // start(): phraseIndex=0, loadPhrase
  // loadPhrase(): revealedCount=1, step=1, spokenMask=[], expected=expectedFor(1), status='awaiting', onReveal(word0)
  // handleDetection({gesture,score,hand}): если совпадает с expected (gesture && (!strictHand||hand===expected.hand) && score>=threshold)
  //    копит время удержания → gestureProgress; при holdMs → advance()
  // advance(): если revealedCount<words.length → revealedCount++,step++,expected=expectedFor(step),onReveal(newWord)
  //            иначе status='phrase-complete', onPhraseComplete(); через паузу nextPhrase() или 'all-complete'
  // notifyWordSpoken(index): spokenMask[index]=true → onState
  // setStrictHand(bool), reset()
  // return { start, handleDetection, notifyWordSpoken, setStrictHand, next, reset, getState }
}
```

### js/ui.js
```js
// Рендер футуристического HUD по state. Никакой бизнес-логики.
export function createUI({ root, config }) {
  // renderState(state): фраза по словам (.word[data-i] с классами hidden/revealed/current/spoken),
  //   прогресс x/10, ожидаемый жест/рука, статус.
  // setMeter({gesture,score,hand,expected,progress}): кольцо/бар уверенности + % + детект руки.
  // setStatus(msg), showError(msg), celebrate(), allDone(),
  // bindControls({onStart,onReplay,onNext,onToggleStrict,onSwapHands,onApiKey})
  // return { renderState, setMeter, setStatus, showError, celebrate, allDone, bindControls, els }
}
```

### js/main.js
```js
// Бутстрап и проводка. type="module". Точка входа из index.html.
// 1) createUI → bindControls. 2) По Start: startCamera → createGestureEngine/createTTS/createSpeechMatcher/createTrainer.
// 3) gestures.onResult → ui.setMeter + trainer.handleDetection. 4) trainer.onReveal → tts.speak(word) + speech.startForTarget(revealed slice).
// 5) speech.onWordMatch → trainer.notifyWordSpoken. 6) trainer.onState → ui.renderState. 7) complete → ui.celebrate/allDone.
// Все ошибки → ui.showError. Toggle strict / Swap hands / ApiKey проброшены.
```

### index.html  (точные id — UI и main завязаны на них)
```
#app
  #start-overlay  →  #start-btn, #eleven-key (input, placeholder "ElevenLabs API key (опционально)"), подсказки
  #stage
    #cam-wrap → #video (зеркальное), #overlay-canvas
    HUD-кольца/рамки
  #hud-top → #progress ("Фраза 1 / 10")
  #phrase-panel → #phrase-words (внутри .word[data-i])
  #gesture-hud → #expected-cue, #gesture-name, #gesture-meter (бар/кольцо), #gesture-percent, #hand-detected
  #status-line
  #controls → #replay-btn, #next-btn, #strict-toggle, #swap-btn
  #celebrate (скрытый слой)
  #error-toast
Подключения в конце <body>:  <script type="module" src="js/main.js"></script>
styles.css в <head>.
```

### styles.css
```
Тёмный космо-фон, неон cyan(#00f0ff)/magenta(#ff00e5)/violet, glassmorphism панели,
анимированная сетка/частицы, светящиеся кольца вокруг видео, кольцевой/линейный метр
уверенности с неон-glow, .word анимации появления, .word.spoken — зелёный glow (#39ff14),
.word.current — пульс, celebrate — конфетти/вспышка. Адаптив, без внешних шрифтовых блокировок
(system / Google font ок). Перфекционизм: тени, blur, плавные cubic-bezier переходы.
```

---

## Тонкости (учесть всем)
- Зеркало: видео `transform: scaleX(-1)`. `userHand = mirror ? flip(rawHandedness) : rawHandedness`. Кнопка **Swap** меняет маппинг на лету (страховка на демо).
- Так как жесты на чётных/нечётных шагах РАЗНЫЕ (палец/кулак), прогресс надёжен даже если рука определится неточно — `strictHand` можно выключить кнопкой.
- Жест засчитывается только при удержании `holdMs`, чтобы не было ложных срабатываний.
- Микрофон: один `getUserMedia({audio:true})` для промпта, затем аудио-трек stop; SpeechRecognition открывает свой.
- Всё грузится с CDN — нужен интернет на демо.
