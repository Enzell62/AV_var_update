const https = require('https');
const fs = require('fs');
const path = require('path');

// ─── НАСТРОЙКИ ────────────────────────────────────────────────────────────────

const TEST_MODE = false; // true = парсим только один знак (Рыбы), false = все 12

const LAT = 56.6977;
const LON = 60.8369;
const TIMEZONE = 'Asia%2FYekaterinburg';

const COUNTER_FILE = path.join(__dirname, 'counter.json');
const OUTPUT_FILE  = path.join(__dirname, 'av.xml');

// ─── СПРАВОЧНИКИ ──────────────────────────────────────────────────────────────

const MONTHS_GEN = [ // родительный падеж
  'января','февраля','марта','апреля','мая','июня',
  'июля','августа','сентября','октября','ноября','декабря'
];

const MONTHS_NUM = [ // цифровой формат — просто для pad
  '01','02','03','04','05','06','07','08','09','10','11','12'
];

const WEEKDAY_NAMES = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];

// Теги погоды по дням недели (начало с четверга — дня выхода)
// Порядок: thur, fri, satur, sun, mon, tue, wen
const WEATHER_TAGS = ['thur','fri','satur','sun','mon','tue','wen'];

const SIGNS = [
  { slug: 'aries',       tag: 'Horo_aries'       },
  { slug: 'taurus',      tag: 'Horo_taurus'      },
  { slug: 'gemini',      tag: 'Horo_gemini'      },
  { slug: 'cancer',      tag: 'Horo_cancer'      },
  { slug: 'leo',         tag: 'Horo_leo'         },
  { slug: 'virgo',       tag: 'Horo_virgo'       },
  { slug: 'libra',       tag: 'Horo_libra'       },
  { slug: 'scorpio',     tag: 'Horo_scorpio'     },
  { slug: 'sagittarius', tag: 'Horo_sagittarius' },
  { slug: 'capricorn',   tag: 'Horo_capricorn'   },
  { slug: 'aquarius',    tag: 'Horo_aquarius'    },
  { slug: 'pisces',      tag: 'Horo_pisces'      },
];

// WMO код → иконка
function wmoToIcon(code) {
  if (code === 0)                          return 'clear-day';
  if (code <= 2)                           return 'partly-cloudy';
  if (code === 3)                          return 'cloudy';
  if (code >= 45 && code <= 49)            return 'cloudy';       // туман
  if (code >= 51 && code <= 57)            return 'drizzle';      // морось
  if (code >= 61 && code <= 65)            return 'rain';         // дождь
  if (code >= 66 && code <= 67)            return 'freezing-rain';// ледяной дождь
  if (code >= 71 && code <= 77)            return 'snow';         // снег
  if (code >= 80 && code <= 82)            return 'rain';         // ливень
  if (code >= 83 && code <= 86)            return 'drizzle';      // дождь со снегом
  if (code >= 95 && code <= 99)            return 'thunderstorm'; // гроза
  return 'cloudy';
}

const WMO_HREF_BASE = 'file:///F:/%d0%9d%d0%b0%20%d1%84%d0%bb%d0%b5%d1%88%d0%ba%d0%b5/%d0%90%d1%80%d0%92%d0%b5/Links%20master/var/';

// ─── УТИЛИТЫ ──────────────────────────────────────────────────────────────────

function pad2(n) { return String(n).padStart(2, '0'); }

function sign(n) { return n >= 0 ? '+' : ''; }

// Форматы дат
function fmtDot(d)     { return `${pad2(d.getDate())}.${pad2(d.getMonth()+1)}.${d.getFullYear()}`; }
function fmtShort(d)   { return `${pad2(d.getDate())}.${pad2(d.getMonth()+1)}`; }
function fmtRu(d)      { return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`; }
function fmtIso(d)     { return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }

// Добавить N дней к дате (не мутирует)
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// Ближайший четверг: если сегодня четверг — следующий четверг
function nextThursday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = today.getDay(); // 0=вс,1=пн,...,4=чт
  const daysUntil = dow === 4 ? 7 : (4 - dow + 7) % 7;
  return addDays(today, daysUntil || 7);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ─── СЧЁТЧИК ──────────────────────────────────────────────────────────────────

function getCounter(issueDate) {
  const dateStr = fmtDot(issueDate); // DD.MM.YYYY
  let data = { records: [] };

  if (fs.existsSync(COUNTER_FILE)) {
    data = JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf-8'));
  }

  // Ищем запись с этой датой (может быть несколько — берём с максимальным global_num)
  const existing = data.records
    .filter(r => r.date === dateStr)
    .sort((a, b) => b.global_num - a.global_num);

  if (existing.length > 0) {
    console.log(`Счётчик: найдена запись для ${dateStr} → №${existing[0].year_num} (${existing[0].global_num})`);
    return existing[0];
  }

  // Новая запись: берём последнюю и прибавляем 1
  const last = data.records.sort((a, b) => b.global_num - a.global_num)[0];
  const newRecord = {
    date: dateStr,
    year_num:    last ? last.year_num + 1    : 1,
    global_num:  last ? last.global_num + 1  : 1,
  };

  data.records.push(newRecord);
  fs.writeFileSync(COUNTER_FILE, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`Счётчик: создана новая запись для ${dateStr} → №${newRecord.year_num} (${newRecord.global_num})`);
  return newRecord;
}

// ─── ПАРСИНГ ГОРОСКОПА ────────────────────────────────────────────────────────

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9',
      }
    };
    https.get(url, options, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchPage(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function extractHoroText(html) {
  const predMatch = html.match(/"prediction":\{.*?"sign_id":\d+/s);
  if (!predMatch) throw new Error('Блок prediction не найден');
  const textMatch = predMatch[0].match(/"text":\[(.*?)\],"sign_id"/s);
  if (!textMatch) throw new Error('Блок text не найден');

  const items = JSON.parse('[' + textMatch[1] + ']');
  let fullText = '';
  for (const item of items) {
    if (item.type === 'html') {
      const decoded = item.html
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
      const clean = decoded.replace(/<[^>]+>/g, '').trim();
      if (clean) fullText += clean + ' ';
    }
  }
  return fullText.trim();
}

function trimHoroText(text) {
  const MIN = 162, MAX = 230;
  if (text.length <= MAX) return text;

  for (let i = MAX - 1; i >= MIN; i--) {
    if ('.!?'.includes(text[i]) && (i + 1 >= text.length || text[i+1] === ' ' || text[i+1] === '\n')) {
      return text.slice(0, i + 1).trim();
    }
  }
  for (let i = MAX; i < text.length; i++) {
    if ('.!?'.includes(text[i]) && (i + 1 >= text.length || text[i+1] === ' ' || text[i+1] === '\n')) {
      return text.slice(0, i + 1).trim();
    }
  }
  return text;
}

async function parseHoroscope() {
  const signsToProcess = TEST_MODE ? [SIGNS[11]] : SIGNS;
  const results = {};

  for (let i = 0; i < signsToProcess.length; i++) {
    const sign = signsToProcess[i];
    const url = `https://horo.mail.ru/prediction/${sign.slug}/week/`;
    console.log(`Гороскоп: парсим ${sign.slug}...`);
    try {
      const html = await fetchPage(url);
      const full = extractHoroText(html);
      results[sign.tag] = trimHoroText(full);
      console.log(`  ✓ ${results[sign.tag].length} символов`);
    } catch(e) {
      console.error(`  ✗ ${sign.slug}: ${e.message}`);
      results[sign.tag] = '';
    }
    if (i < signsToProcess.length - 1) await sleep(2000);
  }
  return results;
}

// ─── ПОГОДА ───────────────────────────────────────────────────────────────────

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

async function fetchWeather(startDate, days) {
  // Запрашиваем с запасом +2 дня
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    `&daily=temperature_2m_max,temperature_2m_min,weathercode` +
    `&timezone=${TIMEZONE}&forecast_days=16`;

  console.log('Погода: запрос к open-meteo...');
  const data = await fetchJson(url);

  const startIso = fmtIso(startDate);
  const startIdx = data.daily.time.findIndex(t => t === startIso);

  if (startIdx === -1) {
    throw new Error(`Погода: дата ${startIso} не найдена в ответе API`);
  }

  const result = [];
  for (let i = 0; i < days; i++) {
    const idx = startIdx + i;
    if (idx >= data.daily.time.length) break;
    result.push({
      date:    data.daily.time[idx],
      hi:      Math.round(data.daily.temperature_2m_max[idx]),
      lo:      Math.round(data.daily.temperature_2m_min[idx]),
      wmo:     data.daily.weathercode[idx],
    });
  }

  console.log(`  ✓ Получено ${result.length} дней`);
  return result;
}

// ─── СБОРКА XML ───────────────────────────────────────────────────────────────

function buildXml(params) {
  const {
    counter, issueDate, prevDate, nextWeekDates, weatherDates, weatherData, horoData
  } = params;

  const x = (tag, val) => `<${tag}>${escapeXml(val)}</${tag}>`;

  // 1. Гороскоп
  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Root>';

  for (const s of SIGNS) {
    xml += x(s.tag, horoData[s.tag] || '');
  }

  // 2. Счётчик и даты выпуска
  const issueDateRu  = fmtRu(issueDate);   // 23 апреля 2026
  const issueDateDot = fmtDot(issueDate);   // 23.04.2026

  xml += x('Count_title', `№${counter.year_num} (${counter.global_num}) ${issueDateRu}`);

  // Count_col повторяется 4 раза (как в примере)
  for (let i = 0; i < 4; i++) {
    xml += x('Count_col', `№${counter.year_num}(${counter.global_num}) ${issueDateDot}`);
  }

  // 3. ТВ-программа: дни следующей недели
  const tvTags = ['TV_mon','TV_tue','TV_Wen','TV_thur','TV_fri','TV_sat','TV_sun'];
  const tvNames = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];

  for (let i = 0; i < 7; i++) {
    const d = nextWeekDates[i];
    const label = `${tvNames[i]} [${d.getDate()} ${MONTHS_GEN[d.getMonth()]}]`;
    xml += x(tvTags[i], label);
  }

  // 4. Даты гороскопа (диапазон следующей недели: пн–вс)
  const horoStart = nextWeekDates[0];
  const horoEnd   = nextWeekDates[6];
  xml += x('Horo_date', `${fmtShort(horoStart)} - ${fmtShort(horoEnd)}`);

  // 5. Даты производства
  xml += x('Prod_date_pre',     fmtDot(prevDate));
  xml += x('Prod_date_present', fmtDot(issueDate));

  // 6. Диапазон погоды
  xml += x('Weather_dates', `${fmtShort(weatherDates[0])} - ${fmtShort(weatherDates[6])}`);

  // 7. Данные погоды по дням
  for (let i = 0; i < weatherData.length; i++) {
    const w   = weatherData[i];
    const tag = WEATHER_TAGS[i];
    const d   = new Date(w.date);
    const icon = wmoToIcon(w.wmo);
    const href = `${WMO_HREF_BASE}${icon}.psd`;

    xml += x(`Weather_${tag}_date`, fmtShort(d));
    xml += x(`Weather_${tag}_day`,   `${sign(w.hi)}${w.hi}`);
    xml += x(`Weather_${tag}_night`, `${sign(w.lo)}${w.lo}`);
    xml += `<Weather_${tag}_wmo href="${escapeXml(href)}"></Weather_${tag}_wmo>`;
  }

  xml += '</Root>';
  return xml;
}

// ─── ГЛАВНАЯ ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Генерация выпуска АВ ===');
  console.log(TEST_MODE ? '(тестовый режим — гороскоп только Рыбы)' : '(полный режим)');

  // Даты
  const issueDate    = nextThursday();
  const prevDate     = addDays(issueDate, -1);

  // Следующая неделя: пн–вс после даты выпуска
  const nextMon = addDays(issueDate, 1); // пятница+1=суббота? Нет, четверг+1=пятница...
  // Ищем ближайший пн после даты выпуска (четверг)
  // Четверг(4) → до пн(1) следующей недели: 4 дня
  const daysToMon = (8 - issueDate.getDay()) % 7 || 7;
  const nextWeekMon = addDays(issueDate, daysToMon === 0 ? 7 : daysToMon);
  const nextWeekDates = Array.from({length: 7}, (_, i) => addDays(nextWeekMon, i));

  // Погода: 7 дней начиная с даты выпуска (четверг)
  const weatherDates = Array.from({length: 7}, (_, i) => addDays(issueDate, i));

  console.log(`Дата выпуска:     ${fmtDot(issueDate)}`);
  console.log(`Дата печати:      ${fmtDot(prevDate)}`);
  console.log(`Следующая неделя: ${fmtDot(nextWeekDates[0])} – ${fmtDot(nextWeekDates[6])}`);
  console.log(`Погода:           ${fmtDot(weatherDates[0])} – ${fmtDot(weatherDates[6])}`);

  // Счётчик
  const counter = getCounter(issueDate);

  // Гороскоп
  const horoData = await parseHoroscope();

  // Погода
  const weatherData = await fetchWeather(issueDate, 7);

  // XML
  const xml = buildXml({
    counter, issueDate, prevDate,
    nextWeekDates, weatherDates, weatherData, horoData
  });

  fs.writeFileSync(OUTPUT_FILE, xml, 'utf-8');
  console.log(`\nФайл сохранён: ${OUTPUT_FILE}`);

  // Вывод для проверки
  if (TEST_MODE) {
    console.log('\n--- XML ---');
    console.log(xml.replace(/></g, '>\n<'));
  }
}

main().catch(err => {
  console.error('Ошибка:', err);
  process.exit(1);
});
