const puppeteer = require('puppeteer');
const archiver  = require('archiver');
const path = require('path');
const fs   = require('fs');

const SIGNS = [
  { tag: 'Horo_aries',       slug: 'aries',       ru: 'Овен'     },
  { tag: 'Horo_taurus',      slug: 'taurus',      ru: 'Телец'    },
  { tag: 'Horo_gemini',      slug: 'gemini',      ru: 'Близнецы' },
  { tag: 'Horo_cancer',      slug: 'cancer',      ru: 'Рак'      },
  { tag: 'Horo_leo',         slug: 'leo',         ru: 'Лев'      },
  { tag: 'Horo_virgo',       slug: 'virgo',       ru: 'Дева'     },
  { tag: 'Horo_libra',       slug: 'libra',       ru: 'Весы'     },
  { tag: 'Horo_scorpio',     slug: 'scorpio',     ru: 'Скорпион' },
  { tag: 'Horo_sagittarius', slug: 'sagittarius', ru: 'Стрелец'  },
  { tag: 'Horo_capricorn',   slug: 'capricorn',   ru: 'Козерог'  },
  { tag: 'Horo_aquarius',    slug: 'aquarius',    ru: 'Водолей'  },
  { tag: 'Horo_pisces',      slug: 'pisces',      ru: 'Рыбы'     },
];

const OUT_DIR  = path.join(__dirname, 'horo_img');
const ZIP_FILE = path.join(__dirname, 'horoscope.zip');
const XML_FILE = path.join(__dirname, 'av.xml');
const HTML_SRC = path.join(__dirname, 'horo2.html');
const HTML_TMP = path.join(__dirname, '_horo_tmp.html');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

// ── Парсим XML без сторонних библиотек ───────────────────────────────────────
function parseXml(xmlStr) {
  const get = (tag) => {
    const m = xmlStr.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
    return m ? m[1].trim() : '';
  };
  const result = { period: get('Horo_date') };
  for (const s of SIGNS) result[s.tag] = get(s.tag);
  return result;
}

// ── Вставляем данные прямо в HTML — заменяем fetch на inline JS-объект ────────
function buildHtml(data) {
  let html = fs.readFileSync(HTML_SRC, 'utf-8');

  // Формируем JS-объект с данными
  const dataJson = JSON.stringify(data);

  // Заменяем весь блок <script>...</script> — убираем fetch, вставляем данные
  const inlineScript = `
<script>
const SIGNS = [
  { tag:'Horo_aries',       ru:'Овен',        icon:'icon_aries.png'       },
  { tag:'Horo_taurus',      ru:'Телец',       icon:'icon_taurus.png'      },
  { tag:'Horo_gemini',      ru:'Близнецы',    icon:'icon_gemini.png'      },
  { tag:'Horo_cancer',      ru:'Рак',         icon:'icon_cancer.png'      },
  { tag:'Horo_leo',         ru:'Лев',         icon:'icon_leo.png'         },
  { tag:'Horo_virgo',       ru:'Дева',        icon:'icon_virgo.png'       },
  { tag:'Horo_libra',       ru:'Весы',        icon:'icon_libra.png'       },
  { tag:'Horo_scorpio',     ru:'Скорпион',    icon:'icon_scorpio.png'     },
  { tag:'Horo_sagittarius', ru:'Стрелец',     icon:'icon_sagittarius.png' },
  { tag:'Horo_capricorn',   ru:'Козерог',     icon:'icon_capricorn.png'   },
  { tag:'Horo_aquarius',    ru:'Водолей',     icon:'icon_aquarius.png'    },
  { tag:'Horo_pisces',      ru:'Рыбы',        icon:'icon_pisces.png'      },
];

// Данные вшиты напрямую — fetch не нужен
const DATA = ${dataJson};

function run() {
  const period = DATA.period || '';
  let html = '';
  for (const s of SIGNS) {
    const text = DATA[s.tag] || 'Нет данных';
    html += \`
      <div class="sign-slide" id="slide-\${s.tag}">
        <div class="row-top">
          <img class="sign-icon" src="\${s.icon}" alt="\${s.ru}">
          <div class="sign-meta">
            <div class="sign-name">\${s.ru}</div>
            <div class="sign-period">\${period}</div>
          </div>
        </div>
        <div class="sign-text-wrap"><div class="sign-text">\${text}</div></div>
      </div>\`;
  }
  document.getElementById('app').innerHTML = html;
}

run();
</script>`;

  // Заменяем оригинальный <script>...</script>
  html = html.replace(/<script>[\s\S]*<\/script>/, inlineScript);
  return html;
}

// ── Архив ─────────────────────────────────────────────────────────────────────
function makeZip() {
  return new Promise((resolve, reject) => {
    const output  = fs.createWriteStream(ZIP_FILE);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => {
      console.log(`✓ Архив: horoscope.zip (${(archive.pointer()/1024).toFixed(1)} KB)`);
      resolve();
    });
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(OUT_DIR, 'horo_img');
    archive.finalize();
  });
}

// ── Главное ───────────────────────────────────────────────────────────────────
(async () => {
  // 1. Читаем и парсим XML
  if (!fs.existsSync(XML_FILE)) {
    console.error('Файл av.xml не найден!');
    process.exit(1);
  }
  const xmlStr = fs.readFileSync(XML_FILE, 'utf-8');
  const data   = parseXml(xmlStr);
  console.log(`Период: ${data.period}`);

  // 2. Собираем временный HTML с вшитыми данными
  const tmpHtml = buildHtml(data);
  fs.writeFileSync(HTML_TMP, tmpHtml, 'utf-8');

  // 3. Puppeteer
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 600, deviceScaleFactor: 2 });

  const fileUrl = 'file://' + HTML_TMP;
  await page.goto(fileUrl, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.sign-slide', { timeout: 15000 });
  await new Promise(r => setTimeout(r, 600));

  for (const sign of SIGNS) {
    const el = await page.$('#slide-' + sign.tag);
    if (!el) { console.warn(`  ⚠ Не найден: slide-${sign.tag}`); continue; }

    const outPath = path.join(OUT_DIR, `horo_${sign.slug}.jpg`);
    await el.screenshot({ path: outPath, type: 'jpeg', quality: 92 });
    console.log(`✓ ${sign.slug}`);
  }

  await browser.close();

  // 4. Удаляем временный файл
  fs.unlinkSync(HTML_TMP);

  // 5. Архив
  console.log('\nСоздаём архив...');
  await makeZip();

  console.log('\nГотово.');
})();
