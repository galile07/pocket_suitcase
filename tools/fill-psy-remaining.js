const https = require('https');
const fs = require('fs');
const path = require('path');

// prydwen slug/display-name  ->  our catalog name
const ALIASES = {
  'never-ending-q-and-a': 'Never-Ending Q&A',
  'never-ending-qu0026a': 'Never-Ending Q&A',
  'never-ending-qa': 'Never-Ending Q&A',
  'the-winds-listener': "The Wind's Listener",
  "the wind's listener": "The Wind's Listener",
  'wayfarer-of-the-tao': 'Wayfarer of the Dao'
};
const norm = s => (s || '').toLowerCase().replace(/['',.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function get(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36', 'Accept': 'text/html' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(get(res.headers.location, redirects - 1));
      }
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', reject);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const dataPath = path.join(__dirname, '..', 'data.json');
  const d = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const catalog = d.psychubes || [];
  const psyBySlug = {};
  catalog.forEach(y => { psyBySlug[norm(y.name)] = y.name; });
  Object.entries(ALIASES).forEach(([k, v]) => { psyBySlug[norm(k)] = v; });

  // slugs of characters still missing a main psychube
  const pending = (d.characters || []).filter(c => !c.psychube).map(c => ({ id: c.id, name: c.name }));
  console.log(pending.length + ' characters still missing psychubes');
  if (!pending.length) return;

  const recPath = path.join(__dirname, 'psy_recs.raw.json');
  const recs = fs.existsSync(recPath) ? JSON.parse(fs.readFileSync(recPath, 'utf8')) : [];
  const bySlug = {}; recs.forEach(r => (bySlug[r.slug] = r));

  let filled = 0;
  for (const c of pending) {
    try {
      const r = await get('https://www.prydwen.gg/re1999/characters/' + c.id);
      if (r.status !== 200) { console.log('  ! ' + c.id + ' HTTP ' + r.status); continue; }
      const m = r.body.match(/psychubeSuggested\\?"?:(\[(?:\\.|[^\]\\])*\]|null)/);
      let main = '', alt = '', unknown = [];
      if (m && m[1] !== 'null') {
        let slugs = [];
        try { slugs = JSON.parse(m[1].replace(/\\(.)/g, '$1')); } catch (e) {}
        const names = slugs.map(s => psyBySlug[norm(s)] || null);
        unknown = slugs.filter((s, i) => !names[i]);
        main = names[0] || '';
        alt = names[1] || '';
      }
      bySlug[c.id] = { slug: c.id, main, alt, unknown };
      if (main) {
        const ch = (d.characters || []).find(x => x.id === c.id);
        ch.psychube = main; ch.altPsychube = alt || '';
        filled++;
        console.log('  + ' + c.id + ' -> ' + main + (alt ? ' / ' + alt : ''));
      } else {
        console.log('  ~ ' + c.id + ': ' + (unknown.length ? 'still unmatched: ' + unknown.join(', ') : 'no recommendation on source'));
      }
    } catch (e) {
      console.error('  ! ' + c.id + ': ' + e.message);
    }
    await sleep(300);
  }

  fs.writeFileSync(recPath, JSON.stringify(Object.values(bySlug), null, 2));
  fs.writeFileSync(dataPath, JSON.stringify(d, null, 2));
  console.log('filled ' + filled + '; still missing: ' + (d.characters || []).filter(c => !c.psychube).length);
}

main().catch(e => { console.error(e); process.exit(1); });
