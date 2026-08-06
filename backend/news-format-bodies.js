/**
 * Format-aware editorial bodies for expanded Sitrifor news topics.
 * Used when a topic has no dedicated BODY_BLOCKS entry in news-daily-writer.
 */
export const FORMAT_RULES = {
  social: {
    label: 'Соцсети и контент',
    mustEndWith: '## Конкретные советы на эту неделю',
    articleType: 'social_playbook',
    imagePool: [
      '/img/news/formats/social-01.jpg',
      '/img/news/formats/social-02.jpg',
      '/img/news/formats/social-03.jpg',
      '/img/news/formats/social-04.jpg'
    ]
  },
  soft: {
    label: 'Софт для мастеров',
    articleType: 'soft_review',
    imagePool: ['/img/news/formats/soft-01.jpg', '/img/marketing/app-card-bg.jpg']
  },
  studio_review: {
    label: 'Обзор студии',
    articleType: 'studio_review',
    imagePool: ['/img/news/formats/studio-01.jpg']
  },
  events: {
    label: 'Мероприятия',
    articleType: 'event',
    imagePool: ['/img/news/formats/events-01.jpg']
  },
  trends: {
    label: 'Тренды для флэша',
    articleType: 'trend_flash',
    imagePool: ['/img/news/formats/trends-01.jpg']
  },
  care: {
    label: 'Уход и подготовка',
    articleType: 'care',
    imagePool: ['/img/marketing/card-care.jpg']
  },
  pricing: {
    label: 'Ценообразование',
    articleType: 'pricing',
    imagePool: ['/img/marketing/card-calc.jpg']
  },
  legal: {
    label: 'Юридическое',
    articleType: 'legal',
    imagePool: ['/img/news/formats/legal-01.jpg']
  },
  business: {
    label: 'Бизнес студии',
    articleType: 'business',
    imagePool: ['/img/news/formats/business-01.jpg']
  },
  career: {
    label: 'Карьера мастера',
    articleType: 'career',
    imagePool: ['/img/news/formats/career-01.jpg']
  },
  health: {
    label: 'Здоровье мастера',
    articleType: 'health',
    imagePool: ['/img/news/formats/health-01.jpg']
  },
  merch: {
    label: 'Мерч и продажи',
    articleType: 'merch',
    imagePool: ['/img/news/formats/merch-01.jpg']
  },
  client_guide: {
    label: 'Гид клиенту',
    articleType: 'client_guide',
    imagePool: ['/img/news/formats/client-01.jpg']
  },
  removal: {
    label: 'Сведение',
    articleType: 'removal',
    imagePool: ['/img/news/formats/removal-01.jpg']
  },
  birthday: {
    label: 'Тату по дате рождения',
    articleType: 'birthday_tattoo',
    imagePool: ['/img/news/formats/birthday-01.jpg']
  },
  styles: {
    label: 'Стили',
    articleType: 'styles',
    imagePool: ['/img/news/formats/styles-01.jpg']
  },
  sketch_process: {
    label: 'Эскиз и бриф',
    articleType: 'sketch_process',
    imagePool: ['/img/news/formats/sketch-01.jpg']
  },
  red_flags: {
    label: 'Проблемные клиенты',
    articleType: 'red_flags',
    imagePool: ['/img/news/formats/redflags-01.jpg']
  },
  gear: {
    label: 'Расходники',
    articleType: 'review',
    imagePool: ['/img/marketing/card-about.jpg']
  }
};

function bullets(items) {
  return items.map((x) => `• ${x}`).join('\n');
}

/**
 * Build a grounded template body for a topic object.
 */
export function buildFormatBody(topic, { researchLines = [], tips = [] } = {}) {
  const format = topic.format || topic.topic || 'social';
  const rules = FORMAT_RULES[format] || FORMAT_RULES.social;
  const must = topic.mustCover || [];
  const title = topic.title;
  const angle = topic.angle || '';

  const sections = [
    `${angle || title}`,
    '',
    '## Суть',
    `Тема выпуска: ${title}. Разбираем практично для тату-мастера и студии – без воды.`,
    '',
    '## Разбор',
    bullets(
      must.length
        ? must.map((m) => `${m}`)
        : ['Сформулируйте цель', 'Сделайте один тест на неделе', 'Зафиксируйте метрику']
    ),
    '',
    '## Как внедрить',
    bullets([
      'Выберите один шаг на 7 дней',
      'Назначьте ответственного (вы или ассистент)',
      'Проверьте результат в конце недели'
    ])
  ];

  if (format === 'social') {
    sections.push(
      '',
      '## Контент-механика',
      bullets([
        'Как фоткать: свет сбоку, чистый фон, крупный план работы + 1 кадр контекста студии',
        'Как размещать: сначала Stories/Reels с крючком, пост в ленту – с оффером и гео',
        'Теги: город + стиль + 6–10 узких; без мусорного #tattoo на 30 штук',
        'Видео: 7–12 сек, текст на экране, CTA в конце',
        'Частота: 4–6 касаний/нед. лучше, чем ежедневный шум без системы',
        'Накрутка: не стоит. Ломает охваты и доверие; лучше узкий прогрев локальной аудитории'
      ]),
      '',
      rules.mustEndWith,
      bullets([
        'Снять 1 Reels по формуле крючок → процесс → оффер',
        'Обновить 3 актуальных сторис: прайс/бриф/заживление',
        'Ответить на все Direct за 15 минут в «окне записи»',
        'Убрать 10 широких хештегов, оставить гео + стиль'
      ])
    );
  }

  if (format === 'soft') {
    sections.push(
      '',
      '## Софт недели',
      bullets([
        'Sitrifor 634: проекты, пигменты, склад, клиенты, календарь – https://sitrifor.ru/masters#app',
        'Сверяйте альтернативы только с официального сайта/стора',
        'Критерий выбора: экономит ли время до сеанса / на складе / в ответах клиенту'
      ])
    );
  }

  if (format === 'studio_review') {
    const asOf = new Date().toISOString().slice(0, 10);
    sections.push(
      '',
      '## Актуальность данных',
      `Дата публикации материала: ${asOf}. Данные собраны из открытых источников на эту дату и могут устареть (прайс, состав мастеров, адрес).`,
      '',
      '## Что смотреть в обзоре студии',
      bullets([
        'Фото пространства и стерильность визуально',
        'Мастера: стили, портфолио, гостевые споты',
        'Правила записи и депозита',
        'Отзывы с датой – не старше года без пометки'
      ])
    );
  }

  if (format === 'birthday') {
    // Prefer news-birthday-compose.buildBirthdayBody for full zodiac + gallery articles.
    // This branch remains a thin fallback for generic format tooling.
    sections.push(
      '',
      '## Какие татуировки принесут удачу',
      bullets([
        'Мотив западного знака зодиака – как личный талисман',
        'Символ китайского года рождения – если откликается эмоционально',
        'Дата цифрами или римским начертанием – только с личной историей'
      ]),
      '',
      '## Важно',
      'Материал – идея для свободных эскизов и разговора с клиентом, не гороскоп и не медсовет. Клиентам младше 14 лет темы не предлагаем.',
      '',
      '## Как обсудить с мастером',
      bullets([
        'Назовите дату и знак – как отправную точку, не догму',
        'Выберите 1–2 мотива на удачу и один запасной',
        'Зафиксируйте стиль и размер до отрисовки'
      ])
    );
  }

  if (tips.length) {
    sections.push('', '## Заметки редакции', bullets(tips.slice(0, 3)));
  }
  if (researchLines.length) {
    sections.push('', '## Из открытых источников', researchLines.slice(0, 3).join('\n'));
  }

  sections.push(
    '',
    '_Материал редакции Sitrifor. Не юридическая и не медицинская консультация: сверяйте нормы и клинику у профильных специалистов._'
  );

  return sections.join('\n');
}

export function pickFormatImage(topic, index = 0) {
  const format = topic.format || topic.topic || 'social';
  const pool = (FORMAT_RULES[format] || FORMAT_RULES.social).imagePool || [];
  if (!pool.length) return 'https://sitrifor.ru/img/marketing/app-card-bg.jpg';
  const path = pool[Math.abs(index) % pool.length];
  return path.startsWith('http') ? path : `https://sitrifor.ru${path}`;
}

export function articleTypeForTopic(topic) {
  const format = topic.format || topic.topic || 'social';
  return (FORMAT_RULES[format] || {}).articleType || 'editorial';
}
