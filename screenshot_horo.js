const puppeteer = require('puppeteer');
const archiver  = require('archiver');
const path = require('path');
const fs   = require('fs');

// 4 группы по 3 знака
const GROUPS = [
  { id: 'group-1', slug: 'aries-taurus-gemini'         },
  { id: 'group-2', slug: 'cancer-leo-virgo'            },
  { id: 'group-3', slug: 'libra-scorpio-sagittarius'   },
  { id: 'group-4', slug: 'capricorn-aquarius-pisces'   },
];

const SIGNS = [
  { tag: 'Horo_aries',       ru: 'Овен'     },
  { tag: 'Horo_taurus',      ru: 'Телец'    },
  { tag: 'Horo_gemini',      ru: 'Близнецы' },
  { tag: 'Horo_cancer',      ru: 'Рак'      },
  { tag: 'Horo_leo',         ru: 'Лев'      },
  { tag: 'Horo_virgo',       ru: 'Дева'     },
  { tag: 'Horo_libra',       ru: 'Весы'     },
  { tag: 'Horo_scorpio',     ru: 'Скорпион' },
  { tag: 'Horo_sagittarius', ru: 'Стрелец'  },
  { tag: 'Horo_capricorn',   ru: 'Козерог'  },
  { tag: 'Horo_aquarius',    ru: 'Водолей'  },
  { tag: 'Horo_pisces',      ru: 'Рыбы'     },
];

const OUT_DIR  = path.join(__dirname, 'horo_img');
const ZIP_FILE = path.join(__dirname, 'horoscope.zip');
const XML_FILE = path.join(__dirname, 'av.xml');
const HTML_SRC = path.join(__dirname, 'horo2.html');
const HTML_TMP = path.join(__dirname, '_horo_tmp.html');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR);

// Парсим нужные теги из XML
function parseXml(xmlStr) {
  const get = (tag) => {
    const m = xmlStr.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
    return m ? m[1].trim() : '';
  };
  const result = { period: get('Horo_date') };
  for (const s of SIGNS) result[s.tag] = get(s.tag);
  return result;
}

// Заменяем fetch в HTML на вшитые данные
function buildHtml(data) {
  let html = fs.readFileSync(HTML_SRC, 'utf-8');

  const dataJson = JSON.stringify(data);

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

const GROUPS = [
  { id: 'group-1', signs: SIGNS.slice(0, 3)  },
  { id: 'group-2', signs: SIGNS.slice(3, 6)  },
  { id: 'group-3', signs: SIGNS.slice(6, 9)  },
  { id: 'group-4', signs: SIGNS.slice(9, 12) },
];

const DATA = ${dataJson};

function buildCard(sign, text, period) {
  return \`
    <div class="sign-slide" id="slide-\${sign.tag}">
      <div class="row-top">
        <img class="sign-icon" src="\${sign.icon}" alt="\${sign.ru}">
        <div class="sign-meta">
          <div class="sign-name">\${sign.ru}</div>
          <div class="sign-period">\${period}</div>
        </div>
      </div>
      <div class="sign-text-wrap">
        <div class="sign-text">\${text || 'Нет данных'}</div>
      </div>
    </div>\`;
}

function run() {
  const period = DATA.period || '';
  let html = '';
  for (const group of GROUPS) {
    html += \`<div class="sign-group" id="\${group.id}">\`;
    for (const sign of group.signs) {
      html += buildCard(sign, DATA[sign.tag] || '', period);
    }
    html += \`</div>\`;
  }
  document.getElementById('app').innerHTML = html;
}

run();
</script>`;

  html = html.replace(/<script>[\s\S]*<\/script>/, inlineScript);
  return html;
}

// Упаковываем в zip
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

(async () => {
  // 1. Читаем XML
  if (!fs.existsSync(XML_FILE)) {
    console.error('Файл av.xml не найден!');
    process.exit(1);
  }
  const data = parseXml(fs.readFileSync(XML_FILE, 'utf-8'));
  console.log(`Период: ${data.period}`);

  // 2. Собираем временный HTML
  fs.writeFileSync(HTML_TMP, buildHtml(data), 'utf-8');

  // 3. Puppeteer
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none']
  });

  const page = await browser.newPage();
  // Ширина = ширина карточки + padding body с двух сторон
  await page.setViewport({ width: 414, height: 900, deviceScaleFactor: 2 });

  await page.goto('file://' + HTML_TMP, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.sign-group', { timeout: 15000 });
  await new Promise(r => setTimeout(r, 800));

  // 4. Скринимем каждую группу
  for (const group of GROUPS) {
    const el = await page.$('#' + group.id);
    if (!el) { console.warn(`  ⚠ Не найдена группа: ${group.id}`); continue; }

    const outPath = path.join(OUT_DIR, `horo_${group.slug}.jpg`);
    await el.screenshot({ path: outPath, type: 'jpeg', quality: 92 });
    console.log(`✓ ${group.slug}`);
  }

  await browser.close();
  fs.unlinkSync(HTML_TMP);

  // 5. Архив
  console.log('\nСоздаём архив...');
  await makeZip();

  console.log('\nГотово. 4 файла в horo_img/ + horoscope.zip');
})();
