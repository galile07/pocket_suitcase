// Scrape the full psychube catalog from the Reverse:1999 Fandom wiki.
//   node tools/scrape-psychubes.js          -> tools/psychubes.raw.json
//   node tools/scrape-psychubes.js --merge  -> also writes data.json psychubes[]
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

const API = 'https://reverse1999.fandom.com/api.php';
const ICON = name => 'https://reverse1999.fandom.com/wiki/Special:FilePath/' + encodeURIComponent(name) + '.png';

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'PocketSuitcase/1.0 (psychube catalog)', 'Accept': '*/*' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(res.headers.location));
      }
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', reject);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(params) {
  const url = API + '?' + Object.entries(params)
    .map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  const r = await get(url);
  return JSON.parse(r.body);
}

function cleanText(v) {
  if (!v) return '';
  return v
    .replace(/\{\{Color\|[^|]*\|([^}]*)\}\}/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/'''?/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim();
}

function parsePsychube(wikitext) {
  // {{Psychube2}} is the upgrade-material template — skip it
  let m = wikitext.match(/\{\{Psychube(?:\s|\|)[\s\S]*?\n\}\}/);
  if (!m) {
    // single-line variant: template runs to the last }} before the category links
    const start = wikitext.search(/\{\{Psychube(?:\s|\|)/);
    if (start === -1) return null;
    let end = wikitext.indexOf('[[Category', start);
    if (end === -1) end = wikitext.length;
    const chunk = wikitext.slice(start, end);
    const close = chunk.lastIndexOf('}}');
    if (close === -1) return null;
    // normalize "|Key=" separators onto new lines so the field parser works
    m = [chunk.slice(0, close + 2).replace(/\|(\w[\w ]*)\s*=/g, '\n| $1 =')];
  }
  const body = m[0];
  const field = name => {
    const f = body.match(new RegExp('\\|\\s*' + name + '\\s*=([^\\n]*)'));
    return f ? f[1].trim() : '';
  };
  const name = field('Name');
  if (!name) return null;
  return {
    name,
    rarity: parseInt(field('Rarity'), 10) || '',
    label: field('Label'),
    image: ICON(name),
    atk1: field('ATK1'), atkMax: field('ATK Max'),
    hp1: field('HP1'), hpMax: field('HP Max'),
    rdef1: field('RDEF1'), rdefMax: field('RDEF Max'),
    mdef1: field('MDEF1'), mdefMax: field('MDEF Max'),
    statName: field('Stat Name') || field('Stat'),
    stat1: field('Stat1'), statMax: field('Stat Max'),
    amp1: cleanText(field('Amp1')),
    amp2: cleanText(field('Amp2')),
    amp3: cleanText(field('Amp3')),
    amp4: cleanText(field('Amp4')),
    amp5: cleanText(field('Amp5'))
  };
}

async function main() {
  console.log('fetching Category:Psychubes ...');
  const cat = await api({ action: 'query', list: 'categorymembers', cmtitle: 'Category:Psychubes', cmlimit: '500', format: 'json', origin: '*' });
  const titles = (cat.query && cat.query.categorymembers || []).map(x => x.title);
  console.log(titles.length + ' pages');

  const out = [];
  for (let i = 0; i < titles.length; i++) {
    const t = titles[i];
    try {
      const j = await api({ action: 'parse', page: t, prop: 'wikitext', format: 'json', origin: '*' });
      const p = parsePsychube(j.parse && j.parse.wikitext && j.parse.wikitext['*'] || '');
      // skip upgrade-material entries that carry no stats and no amp effect
      if (p && !p.amp1 && !p.atkMax && !p.hpMax) { console.error('  ~ material, skipped: ' + p.name); continue; }
      if (p) { out.push(p); if (out.length % 20 === 0) console.log('  parsed ' + out.length + '/' + titles.length); }
      else console.error('  ! no {{Psychube}} template: ' + t);
    } catch (e) {
      console.error('  ! ' + t + ': ' + e.message);
    }
    await sleep(250);
  }

  out.sort((a, b) => (b.rarity - a.rarity) || a.name.localeCompare(b.name));
  const rawPath = path.join(__dirname, 'psychubes.raw.json');
  fs.writeFileSync(rawPath, JSON.stringify(out, null, 2));
  console.log('wrote ' + rawPath + ' (' + out.length + ' psychubes)');

  if (process.argv.includes('--merge')) {
    const dataPath = path.join(__dirname, '..', 'data.json');
    const d = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    d.psychubes = out;
    fs.writeFileSync(dataPath, JSON.stringify(d, null, 2));
    console.log('merged into data.json (psychubes: ' + out.length + ')');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
