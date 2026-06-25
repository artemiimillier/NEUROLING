// js/ui.js
// Рендер футуристического HUD по state. Никакой бизнес-логики — только отображение.
// createUI({ root, config }) → { renderState, setMeter, setStatus, showError,
//   celebrate, allDone, bindControls, drawLandmarks, els }
//
// Контракт:
//   renderState(state): фраза по словам (.word[data-i] с классами hidden/revealed/current/spoken),
//     прогресс x/10, ожидаемый жест/рука, статус.
//   setMeter({gesture,score,hand,expected,progress}): бар уверенности + % + детект руки.
//   setStatus(msg), showError(msg), celebrate(), allDone(),
//   bindControls({onStart,onReplay,onNext,onToggleStrict,onSwapHands,onApiKey})
//   drawLandmarks(landmarks, videoEl): оверлей лендмарков руки на #overlay-canvas.

import { PHRASE_TRANSLATIONS } from './phrases.js';

export function createUI({ root, config } = {}) {
  const doc = (root && root.ownerDocument) || (typeof document !== 'undefined' ? document : null);

  const byId = (id) => (doc ? doc.getElementById(id) : null);

  // Собираем все элементы из index.html по точным id из контракта.
  const els = {
    app: root || byId('app'),
    startOverlay: byId('start-overlay'),
    startBtn: byId('start-btn'),
    elevenKey: byId('eleven-key'),
    stage: byId('stage'),
    camWrap: byId('cam-wrap'),
    video: byId('video'),
    overlayCanvas: byId('overlay-canvas'),
    hudTop: byId('hud-top'),
    progress: byId('progress'),
    phrasePanel: byId('phrase-panel'),
    phraseWords: byId('phrase-words'),
    phraseTranslation: byId('phrase-translation'),
    gestureHud: byId('gesture-hud'),
    expectedCue: byId('expected-cue'),
    gestureName: byId('gesture-name'),
    gestureMeter: byId('gesture-meter'),
    meterFill: byId('gesture-meter') ? byId('gesture-meter').querySelector('.meter-fill') : null,
    gesturePercent: byId('gesture-percent'),
    handDetected: byId('hand-detected'),
    statusLine: byId('status-line'),
    controls: byId('controls'),
    replayBtn: byId('replay-btn'),
    nextBtn: byId('next-btn'),
    strictToggle: byId('strict-toggle'),
    swapBtn: byId('swap-btn'),
    celebrate: byId('celebrate'),
    errorToast: byId('error-toast'),
  };

  const cfg = config || {};
  let ctx = els.overlayCanvas && els.overlayCanvas.getContext
    ? els.overlayCanvas.getContext('2d')
    : null;

  // Локальный strict-флаг для подписи кнопки (бизнес-логика живёт в trainer).
  let strict = cfg.strictHand !== undefined ? !!cfg.strictHand : true;

  let errorTimer = null;
  let celebrateTimer = null;

  const setText = (el, text) => {
    if (el) el.textContent = text == null ? '' : String(text);
  };

  // ---------------------------------------------------------------- renderState
  function renderState(state) {
    if (!state) return;

    // Прогресс "Фраза x / N".
    if (els.progress) {
      const idx = (typeof state.phraseIndex === 'number' ? state.phraseIndex : 0) + 1;
      const total = typeof state.totalPhrases === 'number' ? state.totalPhrases : 0;
      const pad = (n) => String(n).padStart(2, '0');
      setText(els.progress, `PHRASE ${pad(idx)} / ${pad(total)}`);
    }

    // Слова фразы.
    renderWords(state);

    // Ожидаемый жест/рука.
    if (els.expectedCue) {
      const exp = state.expected || {};
      setText(els.expectedCue, exp.label || 'Ожидаю жест…');
    }

    // Статус-строка по машинному статусу (мягкий человекочитаемый текст).
    if (els.statusLine) {
      const map = {
        idle: 'Готов к запуску',
        awaiting: 'Проговаривай слова и показывай жест',
        'phrase-complete': 'Фраза собрана! Готовим следующую…',
        'all-complete': 'Все фразы пройдены. Великолепно!',
      };
      const msg = map[state.status];
      if (msg) setText(els.statusLine, msg);
    }
  }

  function renderWords(state) {
    const container = els.phraseWords;
    if (!container) return;

    const words = Array.isArray(state.words) ? state.words : [];
    const revealed = typeof state.revealedCount === 'number' ? state.revealedCount : 0;
    const step = typeof state.step === 'number' ? state.step : revealed;
    const spokenMask = Array.isArray(state.spokenMask) ? state.spokenMask : [];
    const phraseIndex = typeof state.phraseIndex === 'number' ? state.phraseIndex : 0;
    const tr = (PHRASE_TRANSLATIONS && PHRASE_TRANSLATIONS[phraseIndex]) || null;
    const glosses = tr && Array.isArray(tr.words) ? tr.words : [];

    // Перестраиваем только если изменился набор слов (по количеству + тексту).
    const needRebuild =
      container.childElementCount !== words.length ||
      Array.from(container.children).some((node, i) => node.dataset.text !== words[i]);

    if (needRebuild) {
      container.innerHTML = '';
      words.forEach((w, i) => {
        const span = doc.createElement('span');
        span.className = 'word';
        span.dataset.i = String(i);
        span.dataset.text = w;

        // Всплывающий русский перевод СВЕРХ слова (показывается на hover).
        const gloss = doc.createElement('span');
        gloss.className = 'word-gloss';
        gloss.textContent = glosses[i] || '';
        span.appendChild(gloss);

        // Сам видимый текст слова (отдельный узел, чтобы не стирать gloss).
        const txt = doc.createElement('span');
        txt.className = 'word-text';
        txt.textContent = w;
        span.appendChild(txt);

        container.appendChild(span);
      });
    }

    // Обновляем классы и видимый текст на каждом слове.
    Array.from(container.children).forEach((node, i) => {
      const isRevealed = i < revealed;
      const isCurrent = i === step - 1;
      const isSpoken = !!spokenMask[i];

      node.classList.toggle('hidden', !isRevealed);
      node.classList.toggle('revealed', isRevealed);
      node.classList.toggle('current', isCurrent && isRevealed);
      node.classList.toggle('spoken', isSpoken);

      const txt = node.querySelector('.word-text');
      if (txt) {
        // Скрытые слова показываем плейсхолдером той же длины, раскрытые — текстом.
        if (isRevealed) {
          if (txt.textContent !== node.dataset.text) txt.textContent = node.dataset.text;
        } else {
          const masked = '•'.repeat(Math.max(1, (node.dataset.text || '').length));
          if (txt.textContent !== masked) txt.textContent = masked;
        }
      }
    });

    // Полный перевод фразы — маленьким снизу.
    if (els.phraseTranslation) setText(els.phraseTranslation, tr ? tr.full : '');
  }

  // ------------------------------------------------------------------- setMeter
  function setMeter(meter) {
    const m = meter || {};
    const score = typeof m.score === 'number' ? m.score : 0;
    const progress = typeof m.progress === 'number' ? m.progress : 0;
    const expected = m.expected || {};

    // Процент уверенности — показываем уверенность распознанного жеста.
    const pct = Math.round(clamp01(score) * 100);
    setText(els.gesturePercent, `${pct}%`);

    // Имя распознанного жеста.
    if (els.gestureName) {
      setText(els.gestureName, m.gesture ? prettyGesture(m.gesture) : '—');
    }

    // Бар: ширину ведём по прогрессу удержания (важнее для пользователя),
    // но если удержание не идёт — отражаем уверенность.
    const fillRatio = progress > 0 ? clamp01(progress) : clamp01(score);
    const widthPct = `${Math.round(fillRatio * 100)}%`;
    if (els.gestureMeter) {
      els.gestureMeter.style.setProperty('--p', widthPct);
      els.gestureMeter.classList.toggle('active', progress > 0);
    }
    if (els.meterFill) {
      els.meterFill.style.width = widthPct;
    }

    // Детект руки + соответствие ожидаемой.
    if (els.handDetected) {
      if (!m.hand) {
        setText(els.handDetected, 'Рука не найдена');
        els.handDetected.classList.remove('ok', 'bad');
        els.handDetected.removeAttribute('data-ok');
      } else {
        const handLabel = m.hand === 'Left' ? 'ЛЕВАЯ рука' : m.hand === 'Right' ? 'ПРАВАЯ рука' : String(m.hand);
        setText(els.handDetected, `Рука: ${handLabel}`);
        const ok = !expected.hand || m.hand === expected.hand;
        els.handDetected.classList.toggle('ok', ok);
        els.handDetected.classList.toggle('bad', !ok);
        els.handDetected.setAttribute('data-ok', ok ? 'true' : 'false');
      }
    }
  }

  // ------------------------------------------------------------ drawLandmarks
  // Оверлей точек руки на #overlay-canvas. landmarks: [{x,y}] нормализованные 0..1.
  function drawLandmarks(landmarks, videoEl) {
    const canvas = els.overlayCanvas;
    if (!canvas) return;
    if (!ctx && canvas.getContext) ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Подгоняем буфер канваса под отображаемый размер.
    const w = canvas.clientWidth || canvas.width || 0;
    const h = canvas.clientHeight || canvas.height || 0;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!Array.isArray(landmarks) || !landmarks.length || w === 0 || h === 0) return;

    // Рёбра кисти MediaPipe (21 точка).
    const EDGES = [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [0, 5], [5, 6], [6, 7], [7, 8],
      [5, 9], [9, 10], [10, 11], [11, 12],
      [9, 13], [13, 14], [14, 15], [15, 16],
      [13, 17], [17, 18], [18, 19], [19, 20],
      [0, 17],
    ];

    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(142, 162, 255, 0.75)';
    ctx.beginPath();
    for (const [a, b] of EDGES) {
      const pa = landmarks[a];
      const pb = landmarks[b];
      if (!pa || !pb) continue;
      ctx.moveTo(pa.x * w, pa.y * h);
      ctx.lineTo(pb.x * w, pb.y * h);
    }
    ctx.stroke();

    ctx.fillStyle = 'rgba(179, 155, 255, 0.95)';
    for (const p of landmarks) {
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // -------------------------------------------------------------------- status
  function setStatus(msg) {
    setText(els.statusLine, msg);
  }

  // --------------------------------------------------------------------- error
  function showError(msg) {
    const toast = els.errorToast;
    if (!toast) {
      // Нет тоста — хотя бы в статус.
      setStatus('Ошибка: ' + (msg == null ? '' : msg));
      return;
    }
    setText(toast, msg == null ? '' : String(msg));
    toast.hidden = false;
    toast.removeAttribute('hidden');
    toast.classList.add('show');
    if (errorTimer) {
      try { clearTimeout(errorTimer); } catch (_) { /* ignore */ }
    }
    errorTimer = setTimeout(() => {
      toast.classList.remove('show');
      toast.hidden = true;
    }, 6000);
  }

  // ----------------------------------------------------------------- celebrate
  function celebrate() {
    const node = els.celebrate;
    if (!node) return;
    node.hidden = false;
    node.removeAttribute('hidden');
    node.classList.add('show');
    if (celebrateTimer) {
      try { clearTimeout(celebrateTimer); } catch (_) { /* ignore */ }
    }
    celebrateTimer = setTimeout(() => {
      node.classList.remove('show');
      node.hidden = true;
    }, 1800);
  }

  function allDone() {
    const node = els.celebrate;
    if (node) {
      const sub = node.querySelector('.celebrate-sub');
      const title = node.querySelector('.celebrate-title');
      if (title) setText(title, 'Готово!');
      if (sub) setText(sub, 'Все 10 фраз пройдены');
      node.hidden = false;
      node.removeAttribute('hidden');
      node.classList.add('show');
      if (celebrateTimer) {
        try { clearTimeout(celebrateTimer); } catch (_) { /* ignore */ }
      }
      // allDone остаётся на экране дольше.
      celebrateTimer = setTimeout(() => {
        node.classList.remove('show');
        node.hidden = true;
      }, 4000);
    }
    setStatus('Все фразы пройдены. Великолепно!');
  }

  // -------------------------------------------------------------- bindControls
  function bindControls(handlers) {
    const h = handlers || {};

    if (els.startBtn) {
      els.startBtn.addEventListener('click', () => {
        // Прячем стартовый оверлей и отдаём введённый ключ.
        if (els.elevenKey && typeof h.onApiKey === 'function') {
          const key = els.elevenKey.value ? els.elevenKey.value.trim() : '';
          if (key) safeCall(h.onApiKey, key);
        }
        if (els.startOverlay) {
          els.startOverlay.classList.add('hidden');
          els.startOverlay.hidden = true;
        }
        safeCall(h.onStart);
      });
    }

    if (els.replayBtn) {
      els.replayBtn.addEventListener('click', () => safeCall(h.onReplay));
    }

    if (els.nextBtn) {
      els.nextBtn.addEventListener('click', () => safeCall(h.onNext));
    }

    if (els.strictToggle) {
      // Инициализируем подпись/состояние.
      updateStrictLabel();
      els.strictToggle.addEventListener('click', () => {
        strict = !strict;
        updateStrictLabel();
        safeCall(h.onToggleStrict, strict);
      });
    }

    if (els.swapBtn) {
      els.swapBtn.addEventListener('click', () => {
        els.swapBtn.classList.toggle('active');
        safeCall(h.onSwapHands);
      });
    }

    if (els.elevenKey) {
      // Применяем ключ на лету при изменении.
      els.elevenKey.addEventListener('change', () => {
        if (typeof h.onApiKey === 'function') {
          safeCall(h.onApiKey, els.elevenKey.value ? els.elevenKey.value.trim() : '');
        }
      });
    }
  }

  function updateStrictLabel() {
    if (!els.strictToggle) return;
    els.strictToggle.textContent = strict ? 'Strict hand · ON' : 'Strict hand · OFF';
    els.strictToggle.setAttribute('aria-pressed', strict ? 'true' : 'false');
    els.strictToggle.classList.toggle('active', strict);
  }

  // ------------------------------------------------------------------ helpers
  function clamp01(v) {
    if (typeof v !== 'number' || Number.isNaN(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }

  function prettyGesture(g) {
    if (g === 'Thumb_Up') return '👍 Thumb Up';
    if (g === 'Closed_Fist') return '✊ Closed Fist';
    if (g === 'None' || g === 'none') return '—';
    return String(g).replace(/_/g, ' ');
  }

  function safeCall(fn, ...args) {
    if (typeof fn !== 'function') return;
    try {
      fn(...args);
    } catch (e) {
      // Ошибку обработчика отражаем в тосте, наружу не бросаем.
      try { showError(e && e.message ? e.message : String(e)); } catch (_) { /* ignore */ }
    }
  }

  return {
    renderState,
    setMeter,
    setStatus,
    showError,
    celebrate,
    allDone,
    bindControls,
    drawLandmarks,
    els,
  };
}
