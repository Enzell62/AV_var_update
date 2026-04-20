const https = require('https');
const fs = require('fs');

// Тестовый режим: если true — парсим только одну страницу
const TEST_MODE = true;

const SIGNS = [
  { slug: 'aries',       tag: 'Horo_aries'        },
  { slug: 'taurus',      tag: 'Horo_taurus'       },
  { slug: 'gemini',      tag: 'Horo_gemini'       },
  { slug: 'cancer',      tag: 'Horo_cancer'       },
  { slug: 'leo',         tag: 'Horo_leo'          },
  { slug: 'virgo',       tag: 'Horo_virgo'        },
  { slug: 'libra',       tag: 'Horo_libra'        },
  { slug: 'scorpio',     tag: 'Horo_scorpio'      },
  { slug: 'sagittarius', tag: 'Horo_sagittarius'  },
  { slug: 'capricorn',   tag: 'Horo_capricorn'    },
  { slug: 'aquarius',    tag: 'Horo_aquarius'     },
  { slug: 'pisces',      tag: 'Horo_pisces'       },
];

// Загрузить страницу по URL, вернуть строку
function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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

// Извлечь чистый текст гороскопа из HTML страницы
function extractText(html) {
  // Текст лежит в JSON внутри страницы: "prediction":{"text":[{"type":"html","html":"..."},...]}
  const predMatch = html.match(/"prediction":\{.*?"sign_id":\d+/s);
  if (!predMatch) throw new Error('Блок prediction не найден');

  const textMatch = predMatch[0].match(/"text":\[(.*?)\],"sign_id"/s);
  if (!textMatch) throw new Error('Блок text не найден');

  const items = JSON.parse('[' + textMatch[1] + ']');

  let fullText = '';
  for (const item of items) {
    if (item.type === 'html') {
      // Декодируем HTML-сущности (&gt; → > и т.д.)
      const decoded = item.html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
      // Убираем HTML теги
      const clean = decoded.replace(/<[^>]+>/g, '').trim();
      if (clean) fullText += clean + ' ';
    }
  }

  return fullText.trim();
}

// Обрезать текст по правилам:
// - минимум 162 символа
// - идеально до 230, но только на границе предложения
// - если в 162–230 нет конца предложения — идём дальше до первой точки
function trimText(text) {
  const MIN = 162;
  const MAX = 230;

  if (text.length <= MAX) return text;

  // Ищем конец предложения в диапазоне MIN..MAX
  // Конец предложения: . ! ? после которых пробел или конец строки
  const slice = text.slice(0, MAX);
  // Ищем последний знак конца предложения в диапазоне MIN..MAX
  let cutPos = -1;
  for (let i = MAX - 1; i >= MIN; i--) {
    if ('.!?'.includes(text[i]) && (i + 1 >= text.length || text[i + 1] === ' ' || text[i + 1] === '\n')) {
      cutPos = i + 1;
      break;
    }
  }

  if (cutPos !== -1) {
    // Нашли конец предложения в нужном диапазоне
    return text.slice(0, cutPos).trim();
  }

  // Не нашли — ищем первый конец предложения после MAX
  for (let i = MAX; i < text.length; i++) {
    if ('.!?'.includes(text[i]) && (i + 1 >= text.length || text[i + 1] === ' ' || text[i + 1] === '\n')) {
      return text.slice(0, i + 1).trim();
    }
  }

  // Совсем нет точек — возвращаем как есть
  return text;
}

// Экранировать спецсимволы для XML
function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Пауза между запросами (мс)
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const signsToProcess = TEST_MODE ? [SIGNS[11]] : SIGNS; // в тесте только Рыбы
  console.log(TEST_MODE ? '=== ТЕСТОВЫЙ РЕЖИМ (только Рыбы) ===' : '=== ПОЛНЫЙ РЕЖИМ (все знаки) ===');

  const results = {};

  for (const sign of signsToProcess) {
    const url = `https://horo.mail.ru/prediction/${sign.slug}/week/`;
    console.log(`Парсим: ${url}`);

    try {
      const html = await fetchPage(url);
      const fullText = extractText(html);
      const trimmed = trimText(fullText);

      results[sign.tag] = trimmed;

      console.log(`  ✓ ${sign.slug}: ${trimmed.length} символов`);
      console.log(`  → ${trimmed.slice(0, 80)}...`);
    } catch (e) {
      console.error(`  ✗ Ошибка для ${sign.slug}: ${e.message}`);
      results[sign.tag] = '';
    }

    // Пауза 2 секунды между запросами чтобы не улететь в бан
    if (signsToProcess.indexOf(sign) < signsToProcess.length - 1) {
      await sleep(2000);
    }
  }

  // Формируем XML
  // В тестовом режиме заполняем остальные знаки пустышками
  let xmlBody = '';
  for (const sign of SIGNS) {
    const text = results[sign.tag] !== undefined ? escapeXml(results[sign.tag]) : '';
    xmlBody += `  <${sign.tag}>${text}</${sign.tag}>\n`;
  }

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Root>\n${xmlBody}</Root>`;

  const outFile = 'horoscope.xml';
  fs.writeFileSync(outFile, xml, 'utf-8');
  console.log(`\nФайл сохранён: ${outFile}`);

  if (TEST_MODE) {
    console.log('\n--- Содержимое XML ---');
    console.log(xml);
  }
}

main().catch(console.error);
