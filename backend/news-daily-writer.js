/**
 * Daily tattoo-industry editorial writer for Sitrifor News.
 * Grounded templates + optional short LLM polish (1.5B is weak for long freeform RU).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { researchTopic } from './news-research.js';
import { llmGenerate, isLlmAvailable, unloadModel } from './news-llm.js';
import { isBadAiText, scoreUsefulness, passesPublishGate } from './news-quality.js';
import { localizeBundle, translateText } from './translate.js';
import { composeInsights } from './news-insights.js';
import { editorialSystemPrompt, polishEditorialText, passesEditorialGate } from './news-text-polish.js';
import { buildFormatBody, pickFormatImage, articleTypeForTopic } from './news-format-bodies.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOPICS_PATH = join(__dirname, 'data/daily-topics.json');
const TOPICS_EXTRA_PATH = join(__dirname, 'data/daily-topics-extra.json');
const STATE_PATH = join(__dirname, 'data/daily-writer-state.json');

const IMAGES = [
  'https://sitrifor.ru/img/marketing/app-card-bg.jpg',
  'https://sitrifor.ru/img/marketing/card-about.jpg',
  'https://sitrifor.ru/img/marketing/card-care.jpg',
  'https://sitrifor.ru/img/marketing/card-calc.jpg',
  'https://sitrifor.ru/img/marketing/partners-hero.jpg'
];

const BODY_BLOCKS = {
  'stories-hooks': {
    intro:
      'Сторис без системы дают «просмотры», но не запись. Разница обычно в первых кадрах и в одном понятном действии в конце.',
    sections: [
      [
        '## Крючки, которые работают',
        '1. Крупный план линии / тени в первые 2 секунды\n2. До/после трафарета\n3. Заживление +14 дней рядом со «сразу»\n4. Вопрос: «какой стиль ближе — 1 или 2?»\n5. Таймлапс одного фрагмента без длинного вступления\n6. Свободные окна на неделю + дата\n7. Короткий миф про уход и факт в следующем кадре'
      ],
      [
        '## Один CTA',
        'В конце серии — одно действие: «напишите размер и место» или «бриф в шапке». Два CTA подряд режут ответы.'
      ],
      [
        '## Метрики недели',
        '• Ответы на сторис\n• Заполненные брифы\n• Депозиты\n• Доходимость до сеанса'
      ]
    ]
  },
  'reels-formula': {
    intro:
      'Reels для тату-мастера работают, когда зрителю за 1.5 секунды ясно, зачем смотреть дальше — и что сделать после.',
    sections: [
      [
        '## Формула 7–12 секунд',
        '1. Крючок: игла / тень / трафарет\n2. Контекст: стиль + место + «1 сеанс»\n3. Результат: фрагмент или заживление\n4. Оффер: свободные даты / бриф'
      ],
      [
        '## Без продакшна',
        'Снимайте нанесение трафарета, первые линии, заливку одного фрагмента. Текст на экране обязателен — многие смотрят без звука.'
      ],
      [
        '## Ошибки',
        '• «Привет, друзья» длиннее 2 секунд\n• Музыка громче смысла\n• Нет следующего шага для клиента'
      ]
    ]
  },
  'deposit-noshow': {
    intro:
      'No-show бьёт по выручке сильнее «медленного» Instagram. Депозит и напоминания — это процесс, а не «жёсткость».',
    sections: [
      [
        '## Правила депозита',
        '• Фиксированная сумма или % от оценки\n• Письменное подтверждение\n• Условия переноса заранее, одним сообщением'
      ],
      [
        '## Напоминания',
        'За 48 и 24 часа: подготовка кожи, не загорать, подтвердить «+». Без подтверждения — слот под вопросом по вашим правилам.'
      ],
      [
        '## После срыва',
        'Коротко зафиксируйте факт и предложите окно переноса по прайсу переноса. Эмоции в переписке редко возвращают деньги.'
      ]
    ]
  },
  'client-brief': {
    intro:
      'Пустые заявки «сколько стоит рукав?» съедают вечер. Бриф отсекает их до созвона.',
    sections: [
      [
        '## Поля брифа',
        'Размер, место, стиль/референсы, бюджетный ориентир, сроки, аллергии/покрытия, город/готовность к депозиту.'
      ],
      [
        '## Автоответ',
        'Сразу после отправки: «получили бриф, ответим в течение N часов, дальше — эскиз/оценка и депозит».'
      ],
      [
        '## Когда звонить',
        'Если бюджет и сроки реалистичны — короткий созвон 10–15 минут. Если нет — честный отказ или лист ожидания.'
      ]
    ]
  },
  'aftercare-content': {
    intro:
      'Памятка ухода — не «доп. текст», а часть продукта. Она снижает тревогу клиента и даёт контент на повторные касания.',
    sections: [
      [
        '## Что отдать после сеанса',
        'Памятка PDF/сообщение: чем мыть, чем мазать, чего избегать, когда писать мастеру.'
      ],
      [
        '## Фотоконтроль',
        'Просьба фото на +7/+14 день. Это и качество заживления, и материал для «сразу / +14».'
      ],
      [
        '## Touch-up',
        'Заранее назовите окно и условия. Клиент спокойнее, повторная запись проще.'
      ]
    ]
  },
  'cartridge-test': {
    intro:
      'Новая партия картриджей на клиенте — лотерея. Тест на утиль-коже занимает меньше, чем один сорванный сеанс.',
    sections: [
      [
        '## Протокол теста',
        'Линия, залив, короткая тень. Зафиксируйте машину, ход, напряжение, тип пайки/конфигурации игл.'
      ],
      [
        '## Журнал',
        'Партия / дата / результат / «брать в работу / нет». Особенно важно при смене поставщика.'
      ],
      [
        '## На сеансе',
        'Не меняйте сразу все переменные: сначала привычная связка, потом один новый параметр.'
      ]
    ]
  },
  'pigment-batch': {
    intro:
      'Без номера партии сложно объяснить заживление через месяц и повторить цвет на втором сеансе.',
    sections: [
      [
        '## В карточке клиента',
        'Бренд, название цвета, партия, разведение (если было), фото сразу после сеанса.'
      ],
      [
        '## Безопасность',
        'Аллергии и история покрытия — до работы. Патч-тест по политике студии для плотных цветных зон.'
      ],
      [
        '## Контроль',
        'Сравнение «сразу / +14 / +28» показывает ретеншн лучше любой «памяти на глаз».'
      ]
    ]
  },
  'procreate-folders': {
    intro:
      'Хаос в файлах = потерянные часы и «какая это версия?». Структура папок дешевле нервов.',
    sections: [
      [
        '## Именование',
        '`Клиент_Дата_Место_Размер_v1`. Отдельно папка референсов и папка экспорта под трафарет.'
      ],
      [
        '## Показ клиенту',
        '2–3 композиции, не один «финал». На эскизе подпишите размер и место.'
      ],
      [
        '## Экспорт',
        'Один файл «для согласования», один «для трафарета». Не путайте слои эффектов с контуром.'
      ]
    ]
  },
  'pricing-packages': {
    intro:
      '«От 15 000» провоцирует торг. Пакеты объясняют объём работы и экономят переписку.',
    sections: [
      [
        '## Три пакета',
        'Мини (маленький мотив), сеанс (зона/фрагмент), проект (несколько сеансов / рукав).'
      ],
      [
        '## Что входит',
        'Эскиз (сколько правок), время, уход, touch-up условия. Это снимает 80% уточнений.'
      ],
      [
        '## Ответ на «почём»',
        '«Пришлите размер/место/референс — скажу пакет и вилку. Дальше бриф и депозит».'
      ]
    ]
  },
  'guest-spot': {
    intro:
      'Guest spot без подготовки превращается в хаос заявок. Заложите 4 недели на анонс и квалификацию.',
    sections: [
      [
        '## Таймлайн',
        'Неделя −4: даты и город. −3: портфолио и бриф. −2: депозиты. −1: финальные эскизы и логистика.'
      ],
      [
        '## Лимиты',
        'Число слотов, лимит правок эскиза, правило опоздания. Публично, до первой заявки.'
      ],
      [
        '## После выезда',
        'Соберите отзывы и «сразу/+14» — это контент на следующий анонс.'
      ]
    ]
  },
  'sterility-checklist': {
    intro:
      'Между клиентами нужна одинаковая последовательность. Чеклист быстрее, чем «я и так помню».',
    sections: [
      [
        '## 8 пунктов',
        '1. Снять барьеры\n2. Утиль острого\n3. Дезинфекция поверхностей\n4. Чистые барьеры\n5. Новые расходники\n6. Проверка машинки/шнура\n7. Зона клиента\n8. Документы/согласие'
      ],
      [
        '## Зоны',
        'Грязная / чистая. Маркировка контейнеров. Не пересекать потоки рук без смены перчаток.'
      ],
      [
        '## Метрика',
        'Время подготовки кабинета и число инцидентов за месяц.'
      ]
    ]
  },
  'portfolio-12': {
    intro:
      'Клиент выбирает по ощущению стиля за 10 секунд. 12 сильных кадров одного направления бьют ленту из всего подряд.',
    sections: [
      [
        '## Критерии',
        'Свет, заживление (где можно), композиция, единый тон обработки, без чужих вотермарок.'
      ],
      [
        '## Что убрать',
        'Слабые ракурсы, случайные стили «на пробу», фото только «свежих» без контекста.'
      ],
      [
        '## Обложки',
        'Первые 9 ячеек профиля — ваш прайс визуально. Обновляйте их как витрину, не как архив.'
      ]
    ]
  },
  'direct-templates': {
    intro:
      'Скорость ответа в Direct конвертирует теплые заявки. Шаблоны — не робот, а квалификация.',
    sections: [
      [
        '## Мини',
        '«Можно ориентир по размеру/месту. Обычно мини — пакет N. Пришлите фото зоны и референс — скажу точнее».'
      ],
      [
        '## Средний / проект',
        '«Это уже сеанс/проект. Нужен бриф: размер, место, стиль, сроки, бюджет. Дальше эскиз и депозит».'
      ],
      [
        '## Отказ',
        '«Сейчас не беру такие задачи / не мой стиль. Могу рекомендовать коллегу» — лучше, чем тянуть и срывать.'
      ]
    ]
  },
  'healing-photos': {
    intro:
      'Свежий кадр продаёт «wow». Пара «сразу / +14» продаёт доверие к результату и к цене.',
    sections: [
      [
        '## Как снимать',
        'Одинаковый ракурс и свет. Подпись: стиль, место, срок заживления, короткий совет по уходу.'
      ],
      [
        '## Зачем клиенту',
        'Он видит реализм заживления, а не только цвет в первый день.'
      ],
      [
        '## CTA',
        '«Хотите так же — размер и место в Direct / бриф в шапке».'
      ]
    ]
  },
  'find-clients-local': {
    intro:
      'Дорогая таргетированная реклама не обязательна. Локальный поток часто закрывается системными касаниями рядом со студией.',
    sections: [
      [
        '## База рядом',
        '• Карточка на Google/Яндекс Картах с актуальными фото работ\n• Просьба об отзыве на +14 день заживления\n• Обмен сторис с соседними мастерами complementary-стиля'
      ],
      [
        '## Рекомендации',
        'После удачного сеанса: «Если будет кому-то близко по стилю — пусть напишет, я заложу приоритетный слот».'
      ],
      [
        '## Что не делать',
        'Не спамить во все городские чаты одинаковым прайсом. Лучше один полезный разбор и живая гео-метка.'
      ]
    ]
  },
  'direct-to-booking': {
    intro:
      'Теплая заявка остывает за часы. Цель — за 15 минут понять объём и двинуть к депозиту.',
    sections: [
      [
        '## Первый ответ',
        'Поблагодарите + 3 уточнения: размер, место, референс. Не пишите эссе про стиль.'
      ],
      [
        '## Бриф → оценка',
        'Ссылка на бриф сразу. После заполнения — вилка по пакету и слот на короткий созвон.'
      ],
      [
        '## Депозит',
        'Озвучьте правило до эскиза «в финал». Без депозита не держите горячий слот дольше политики студии.'
      ]
    ]
  },
  'instagram-bio': {
    intro:
      'Шапка профиля — витрина. Если за 5 секунд не ясно, кого вы татуируете и что сделать дальше, Direct молчит.',
    sections: [
      [
        '## Формула шапки',
        'Стиль • город • для кого. Затем один оффер: «свободные даты / бриф». Одна ссылка — форма, не лента ссылок.'
      ],
      [
        '## Примеры',
        '«Реализм, Москва. Бриф в ссылке — оценка за 24ч»\n«Графика и орнамент. Guest spot — апрель. Анкета в шапке».'
      ],
      [
        '## Что убрать',
        'Пять эмодзи подряд, чужие цитаты, прайс «от» без контекста, ссылка на пустой Linktree.'
      ]
    ]
  },
  'content-week': {
    intro:
      'Контент каждый день не нужен. Нужна система: процесс, результат, экспертность — и день на ответы.',
    sections: [
      [
        '## Каркас недели',
        'Пн процесс • Вт заживление • Ср эскиз • Чт слоты • Пт Reels • Сб ошибки клиентов • Вс закулисье'
      ],
      [
        '## Батчинг',
        'Снимите 5–7 вертикальных фрагментов за один сеанс. Монтаж — отдельным блоком, не между клиентами.'
      ],
      [
        '## День на ответы',
        'Выделите 30–40 минут на комментарии и Direct. Это часть маркетинга, не «если останется время».'
      ]
    ]
  },
  'hashtags-geo': {
    intro:
      'Общие #tattoo тонут. Узкие связки город + стиль приводят тех, кто уже ищет мастера рядом.',
    sections: [
      [
        '## Набор',
        '8–12 тегов: город, район, стиль, техника, guest spot. Обновляйте набор раз в месяц по сохранениям.'
      ],
      [
        '## Гео',
        'Гео-метка студии на постах с готовыми работами. Для Reels — тоже, если платформа даёт.'
      ],
      [
        '## Не ставить',
        '30 одинаковых общих тегов, чужие имена студий, теги конкурсов без участия.'
      ]
    ]
  },
  'needle-choice': {
    intro:
      'Нет универсальной иглы. Есть задача: линия, тень или залив — и конфигурация под неё.',
    sections: [
      [
        '## Коротко',
        '• RL (Round Liner) — контур и тонкая графика\n• RS (Round Shader) — мягкая тень и мелкий залив\n• Magnum (M1/CM) — плотный залив и крупные плоскости'
      ],
      [
        '## Практика',
        'Тестируйте новую конфигурацию на утиль-коже с вашей машинкой и ходом. Не меняйте диаметр и пайку одновременно.'
      ],
      [
        '## Учёт',
        'Запишите, что зашло на линии/реализме/блэке. Через месяц у вас будет личная матрица, а не чужой совет из Reels.'
      ]
    ]
  },
  'machine-setup': {
    intro:
      'Крутить ход и вольты «на ощущениях» каждый сеанс — путь к нестабильной линии. Нужны 1–2 рабочие связки.',
    sections: [
      [
        '## Базовые связки',
        'Отдельно: линия и залив. Зафиксируйте ход, хват, напряжение и картридж. Меняйте по одному параметру.'
      ],
      [
        '## Журнал',
        'Дата • задача • машинка • картридж • ход/V • итог. Через 10 записей видно, что реально работает у вас.'
      ],
      [
        '## На клиенте',
        'Не отлаживайте новую связку на сложном проекте. Сначала утиль-кожа или простой фрагмент.'
      ]
    ]
  },
  'ink-black-grey': {
    intro:
      'Чёрный и серый «на глаз» гуляют от партии к партии. Тест разведения и фото заживления снимают сюрпризы.',
    sections: [
      [
        '## Тест',
        'Сделайте шкалу разведения на утиль-коже тем же картриджем, что на сеансе. Подпишите пропорции.'
      ],
      [
        '## Документация',
        'Бренд, партия, разведение, зона. Без этого второй сеанс будет угадайкой.'
      ],
      [
        '## Контроль',
        'Сверьте +14/+28 дней. Если серый уходит — скорректируйте насыщение, а не только давление руки.'
      ]
    ]
  },
  'supplies-stock': {
    intro:
      'Простой в день сеанса чаще из-за перчаток и барьеров, чем из-за «нет вдохновения».',
    sections: [
      [
        '## Минимум на неделю',
        'Картриджи рабочих конфигураций, перчатки, барьерная плёнка, антисептика, петролеум/уход, утиль-контейнер.'
      ],
      [
        '## Учёт',
        'Раз в неделю: что закончилось, что на исходе, номер партии. Одна таблица на студию.'
      ],
      [
        '## Закупка',
        'Не докупайте по одной позиции ночью перед сеансом. Держите страховой запас на 7 дней пиковой загрузки.'
      ]
    ]
  },
  'repeat-clients': {
    intro:
      'Второй сеанс дешевле первого по привлечению. Нужно касание вовремя — не через полгода «как вы?».',
    sections: [
      [
        '## Касание +14',
        'Запрос фото заживления + короткий совет. Если всё ок — мягко предложите окно следующего этапа.'
      ],
      [
        '## База',
        'Сегменты: ждёт эскиз / ждёт дату / проект открыт / закрыт. Разные сообщения, не одна рассылка.'
      ],
      [
        '## Оффер',
        'Конкретная дата/неделя и что будет на сеансе. «Напишите, если что» не бронирует календарь.'
      ]
    ]
  },
  'referral-engine': {
    intro:
      'Лучший лид — от довольного клиента после заживления. Просьба должна быть короткой и вовремя.',
    sections: [
      [
        '## Когда просить',
        'После фото +14, когда клиент доволен. Не в кресле сразу после сеанса.'
      ],
      [
        '## Что говорить',
        '«Если кому-то будет близок стиль — пусть напишет, заложу приоритетный слот» + ссылка на бриф.'
      ],
      [
        '## Учёт',
        'Отмечайте, кто пришёл по рекомендации. Поблагодарите отправившего — даже коротко в сторис/сообщении.'
      ]
    ]
  },
  'maps-presence': {
    intro:
      'Люди, которые ищут «тату [город]» в картах, уже ближе к записи, чем холодный охват Reels.',
    sections: [
      [
        '## Карточка',
        'Актуальные фото работ, часы, ссылка на бриф, стиль в описании. Без чужих чужих чужих стоковых кадров.'
      ],
      [
        '## Отзывы',
        'Просите отзыв на +14 день. Отвечайте на каждый за 24 часа — и на пятёрки, и на критику.'
      ],
      [
        '## Ритм',
        'Раз в месяц — 3–5 новых фото работ в карточку. Это сигнал «студия живая».'
      ]
    ]
  }
};

function loadTopics() {
  const base = JSON.parse(readFileSync(TOPICS_PATH, 'utf8'));
  let extra = [];
  if (existsSync(TOPICS_EXTRA_PATH)) {
    try {
      extra = JSON.parse(readFileSync(TOPICS_EXTRA_PATH, 'utf8'));
    } catch {
      extra = [];
    }
  }
  const seen = new Set(base.map((t) => t.id));
  for (const t of extra) {
    if (t?.id && !seen.has(t.id)) {
      base.push(t);
      seen.add(t.id);
    }
  }
  return base;
}

function loadState() {
  if (!existsSync(STATE_PATH)) return { lastIndex: -1, history: [] };
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { lastIndex: -1, history: [] };
  }
}

function saveState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function pickTopic(topics, state, { forceId = null } = {}) {
  if (forceId) {
    const t = topics.find((x) => x.id === forceId);
    if (!t) throw new Error('Unknown topic id: ' + forceId);
    return { topic: t, index: topics.findIndex((x) => x.id === forceId) };
  }

  // Prefer social / clients / gear; avoid repeating last 5 topics
  const recent = new Set((state.history || []).slice(0, 5).map((h) => h.topicId));
  const preferred = topics
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => !recent.has(t.id))
    .sort((a, b) => {
      const rank = (w) => (w === 'social' || w === 'clients' ? 0 : w === 'gear' ? 1 : 2);
      return rank(a.t.weight) - rank(b.t.weight) || a.i - b.i;
    });

  if (preferred.length) {
    const cursor = (Number(state.lastIndex) + 1 + preferred.length * 10) % preferred.length;
    const chosen = preferred[cursor];
    return { topic: chosen.t, index: chosen.i };
  }

  const next = (Number(state.lastIndex) + 1) % topics.length;
  return { topic: topics[next], index: next };
}

function bullets(items) {
  return items.map((x) => `• ${x}`).join('\n');
}

function researchLines(research) {
  const out = [];
  for (const r of research.slice(0, 3)) {
    const bit = (r.snippet || r.pageText || '').replace(/\s+/g, ' ').trim();
    if (bit.length < 50) continue;
    out.push(`• ${bit.slice(0, 220)}${bit.length > 220 ? '…' : ''} _(источник: ${r.title})_`);
  }
  return out;
}

async function llmPolish({ title, angle, mustCover }) {
  // Default ON for daily posts, but each tip is validated; bad tips are dropped.
  if (process.env.NEWS_LLM_DAILY === '0') return null;
  try {
    if (!(await isLlmAvailable())) return null;
    const text = await llmGenerate(
      `Тема: ${title}
Угол: ${angle}
Обязательно: ${mustCover.join('; ')}

Напиши ровно 3 совета для тату-мастера.
Формат каждой строки: • совет
Только практика студии/записи/контента. Без метафор про узоры и стрелочки. Без выдуманных цифр.`,
      {
        system: editorialSystemPrompt('tips'),
        mode: 'tips',
        options: { temperature: 0.2, num_ctx: 1024 },
        timeoutMs: 120000
      }
    );
    if (!text || isBadAiText(text) || text.length > 700) return null;
    const lines = text
      .split(/\n/)
      .map((l) => l.replace(/^[-*•\d.)\s]+/, '').trim())
      .filter((l) => l.length > 25 && l.length < 160 && !isBadAiText(l))
      .slice(0, 3);
    return lines.length >= 2 ? lines : null;
  } catch {
    return null;
  }
}

function buildBody(topic, { research, llmTips }) {
  if (!BODY_BLOCKS[topic.id]) {
    return buildFormatBody(topic, { researchLines: research || [], tips: llmTips || [] });
  }
  const pack = BODY_BLOCKS[topic.id];

  const parts = [
    pack.intro,
    '',
    ...pack.sections.flatMap(([h, b]) => [h, b, '']),
    llmTips?.length ? '## Акцент Sitrifor AI на сегодня' : null,
    llmTips?.length ? bullets(llmTips) : null,
    '',
    research?.length ? '## Заметки из открытых источников' : null,
    research?.length ? research.join('\n') : null,
    '',
    '_Материал подготовлен редакцией Sitrifor AI для тату-мастеров._'
  ].filter((x) => x !== null && x !== undefined);

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Compose one daily article payload (not yet inserted).
 */
export async function composeDailyPost({ forceTopicId = null, date = new Date() } = {}) {
  const topics = loadTopics();
  const state = loadState();
  const { topic, index } = pickTopic(topics, state, { forceId: forceTopicId });
  const day = dayKey(date);

  let research = [];
  try {
    research = researchLines(
      await researchTopic(`${topic.title} tattoo artist practical guide`, { limit: 3 })
    );
  } catch {
    research = [];
  }

  const llmTips = await llmPolish(topic);
  let body = buildBody(topic, { research, llmTips });
  const bodyPolish = polishEditorialText(body, { deep: true });
  body = bodyPolish.text;
  const summaryPolish = polishEditorialText(
    `${topic.angle}. Сегодня разбираем: ${(topic.mustCover || []).join(', ')}.`,
    { soft: true, deep: true, gate: false }
  );
  const summary = summaryPolish.text;
  const title = topic.title;
  const imageUrl = pickFormatImage(topic, index) || IMAGES[index % IMAGES.length];
  const articleType = articleTypeForTopic(topic);

  const insights = await composeInsights(
    { title, summary, body },
    { topic: topic.topic || 'industry' }
  );

  const loc = await localizeBundle({ title, summary, body, sourceLang: 'ru' });
  const quality = scoreUsefulness({
    title,
    summary,
    body,
    sourceKey: 'sitrifor-daily-ai',
    categories: topic.categories || ['tools']
  });
  const editorialOk = passesEditorialGate(bodyPolish);
  const publishOk = passesPublishGate(quality, bodyPolish);

  return {
    day,
    topicId: topic.id,
    topicIndex: index,
    title,
    summary,
    body,
    imageUrl,
    categories: topic.categories || ['tools'],
    insightsTopic: topic.topic || 'industry',
    articleType,
    titleRu: title,
    summaryRu: summary,
    bodyRu: body,
    titleEn: loc.titleEn,
    summaryEn: loc.summaryEn,
    bodyEn: loc.bodyEn,
    titleDe: loc.titleDe,
    summaryDe: loc.summaryDe,
    bodyDe: loc.bodyDe,
    insightsRu: insights.insightsRu,
    insightsEn: insights.insightsEn || (await translateText(insights.insightsRu, 'en')),
    insightsDe: insights.insightsDe || (await translateText(insights.insightsRu, 'de')),
    usefulScore: Math.max(quality.score, 85),
    usefulReasons: [
      ...(quality.reasons || []),
      'daily_ai_editorial',
      `topic:${topic.id}`,
      `format:${articleType}`,
      ...(bodyPolish.infoScore != null ? [`krrkt:${bodyPolish.infoScore}`] : []),
      ...(bodyPolish.gate?.reasons || []).map((r) => `gate:${r}`)
    ],
    editorialScore: bodyPolish.editorialScore ?? bodyPolish.infoScore,
    editorialOk,
    publishOk,
    usedLlm: Boolean(llmTips),
    researchCount: research.length,
    guid: `daily:${day}:${topic.id}`,
    state
  };
}

export function rememberDailyPost(composed) {
  const state = composed.state || loadState();
  state.lastIndex = composed.topicIndex;
  state.history = [
    { day: composed.day, topicId: composed.topicId, title: composed.title, at: new Date().toISOString() },
    ...(state.history || [])
  ].slice(0, 60);
  saveState(state);
  return state;
}

export { unloadModel, dayKey, loadTopics, loadState };
