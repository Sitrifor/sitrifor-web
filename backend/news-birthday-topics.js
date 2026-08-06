/**
 * Birthday / date-of-birth tattoo idea factory (365 days × eligible years).
 * Years: 1980 .. (currentYear - 14). Not for under-14.
 * Client angle: lucky tattoos by zodiac / Chinese sign.
 */
export function maxBirthYear(now = new Date()) {
  return now.getFullYear() - 14;
}

export function eligibleYears(now = new Date()) {
  const max = maxBirthYear(now);
  const years = [];
  for (let y = 1980; y <= max; y++) years.push(y);
  return years;
}

/** month 1-12, day 1-31 */
export function buildBirthdayTopic(month, day, year) {
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const id = `bday-${mm}-${dd}-${year}`;
  return {
    id,
    format: 'birthday',
    topic: 'for_clients',
    categories: ['for_clients'],
    weight: 'social',
    title: `Какие татуировки принесут удачу родившимся ${dd}.${mm}.${year}`,
    angle: `день ${dd}.${mm}, знак зодиака, китайский год, характер числа рождения и мотивы на удачу для ${dd}.${mm}.${year} – с примерами эскизов`,
    mustCover: [
      `дата ${dd}.${mm}.${year}`,
      'характер дня рождения и число судьбы',
      'западный знак зодиака',
      'китайский знак года',
      'характер и подходящая стилистика',
      'мотивы тату на удачу',
      'примеры изображений для референса'
    ],
    birthday: { month, day, year }
  };
}

/**
 * Pick next birthday topic from cursor state { bdayCursor: number }.
 */
export function nextBirthdayTopic(state = {}, now = new Date()) {
  const years = eligibleYears(now);
  // 366 slots for leap safety: iterate day-of-year then year
  const dayOfYear = ((state.bdayCursor || 0) % 366) + 1;
  const yearIndex = Math.floor((state.bdayCursor || 0) / 366) % years.length;
  const year = years[yearIndex];

  const d = new Date(Date.UTC(year, 0, dayOfYear));
  // Invalid if overflowed month for non-leap – clamp via Date
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const topic = buildBirthdayTopic(month, day, year);
  return {
    topic,
    nextCursor: (state.bdayCursor || 0) + 1
  };
}
