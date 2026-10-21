// Scrape per-character psychube recommendations (main + alt) from Prydwen.
//   node tools/scrape-prydwen-psychubes.js           -> tools/psy_recs.raw.json
//   node tools/scrape-prydwen-psychubes.js --merge   -> also fills data.json characters[].psychube / altPsychube
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

function get(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } }, res => {
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

const norm = s => (s || '').toLowerCase().replace(/['',.]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function main() {
  console.log('fetching character list ...');
  const list = await get('https://www.prydwen.gg/re1999/characters');
  if (list.status !== 200) throw new Error('characters index HTTP ' + list.status);
  const slugs = [...new Set(list.body.match(/\/re1999\/characters\/([a-z0-9-]+)/g) || [])]
    .map(x => x.replace('/re1999/characters/', ''))
    .filter(s => s && s !== 'characters');
  console.log(slugs.length + ' prydwen character pages');

  // psychube slug -> catalog name (from our Fandom catalog)
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8')).psychubes || [];
  const psyBySlug = {};
  catalog.forEach(y => { psyBySlug[norm(y.name)] = y.name; });

  const out = [];
  for (const slug of slugs) {
    try {
      const r = await get('https://www.prydwen.gg/re1999/characters/' + slug);
      if (r.status !== 200) { console.error('  ! ' + slug + ' HTTP ' + r.status); continue; }
      // the field lives inside an escaped JSON string: \"psychubeSuggested\":[\"slug\",...]
      const m = r.body.match(/psychubeSuggested\\?"?:(\[(?:\\.|[^\]\\])*\]|null)/);
      let rec = { slug, main: '', alt: '', unknown: [] };
      if (m && m[1] !== 'null') {
        let psySlugs;
        try { psySlugs = JSON.parse(m[1].replace(/\\(.)/g, '$1')); } catch (e) { psySlugs = []; }
        const names = psySlugs.map(s => psyBySlug[norm(s)] || null);
        rec.unknown = psySlugs.filter((s, i) => !names[i]);
        rec.main = names[0] || '';
        rec.alt = names[1] || '';
      }
      out.push(rec);
      if (out.length % 20 === 0) console.log('  scraped ' + out.length + '/' + slugs.length);
    } catch (e) {
      console.error('  ! ' + slug + ': ' + e.message);
    }
    await sleep(300);
  }

  const rawPath = path.join(__dirname, 'psy_recs.raw.json');
  fs.writeFileSync(rawPath, JSON.stringify(out, null, 2));
  const filled = out.filter(x => x.main).length;
  console.log('wrote ' + rawPath + ' (' + out.length + ' characters, ' + filled + ' with recommendations)');

  const unknownAll = [...new Set(out.flatMap(x => x.unknown))];
  if (unknownAll.length) console.log('unmatched psychube slugs: ' + unknownAll.join(', '));

  if (process.argv.includes('--merge')) {
    const dataPath = path.join(__dirname, '..', 'data.json');
    const d = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    const bySlug = {}; out.forEach(r => (bySlug[r.slug] = r));
    const byName = {}; out.forEach(r => (byName[norm(r.slug)] = r));
    let hit = 0, miss = 0;
    (d.characters || []).forEach(c => {
      const r = bySlug[c.id] || byName[norm(c.id)] || byName[norm(c.name)];
      if (r && r.main) { c.psychube = r.main; c.altPsychube = r.alt || ''; hit++; }
      else { miss++; console.log('  ~ no rec for ' + c.id + ' (' + c.name + ')'); }
    });
    fs.writeFileSync(dataPath, JSON.stringify(d, null, 2));
    console.log('merged: ' + hit + ' characters filled, ' + miss + ' left empty');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
