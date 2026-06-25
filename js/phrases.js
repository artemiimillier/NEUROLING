// js/phrases.js
// 10 базовых фраз (прошедшее время, ≥7 слов) + русские переводы (полный и пословный).
// PHRASES остаётся массивом строк — trainer делает phrases[i].split(' ').
// PHRASE_TRANSLATIONS выровнен по индексу: words[] по длине совпадает с PHRASES[i].split(' ').

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

export const PHRASE_TRANSLATIONS = [
  {
    full: 'Я был очень рад встретить тебя сегодня утром',
    words: ['я', 'был', 'очень', 'рад', 'инф.', 'встретить', 'тебя', 'этим', 'утром'],
  },
  {
    full: 'Мы ждали автобус возле станции',
    words: ['мы', 'были', 'ждали', 'для', 'арт.', 'автобус', 'возле', 'арт.', 'станции'],
  },
  {
    full: 'Она читала книгу об океане вчера',
    words: ['она', 'была', 'читала', 'арт.', 'книгу', 'о', 'арт.', 'океане', 'вчера'],
  },
  {
    full: 'Они играли музыку в парке прошлой ночью',
    words: ['они', 'были', 'играли', 'музыку', 'в', 'арт.', 'парке', 'прошлой', 'ночью'],
  },
  {
    full: 'Он готовил тёплый ужин для своей семьи',
    words: ['он', 'был', 'готовил', 'арт.', 'тёплый', 'ужин', 'для', 'своей', 'семьи'],
  },
  {
    full: 'Ты всегда был добр ко всем вокруг тебя здесь',
    words: ['ты', 'был', 'всегда', 'добрым', 'к', 'всем', 'вокруг', 'тебя', 'здесь'],
  },
  {
    full: 'Это был прекрасный день, чтобы прогуляться на улице сегодня',
    words: ['это', 'был', 'арт.', 'прекрасный', 'день', 'чтобы', 'гулять', 'снаружи', 'сегодня'],
  },
  {
    full: 'Мы учили английский вместе каждый тихий вечер',
    words: ['мы', 'были', 'учили', 'английский', 'вместе', 'каждый', 'один', 'тихий', 'вечер'],
  },
  {
    full: 'Я думал о своих старых друзьях на прошлой неделе',
    words: ['я', 'был', 'думал', 'о', 'моих', 'старых', 'друзьях', 'прошлой', 'неделе'],
  },
  {
    full: 'Дети смеялись на протяжении всего смешного шоу',
    words: ['арт.', 'дети', 'были', 'смеялись', 'во время', 'арт.', 'всего', 'смешного', 'шоу'],
  },
];
