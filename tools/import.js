#!/usr/bin/env node
'use strict';

/*
 * Pocket Suitcase data importer (zero dependency).
 *
 * Sources:
 *  A. Roster  - https://www.reverse1999-simulator.com/_next/static/chunks/5671-*.js
 *                module 68512 export `Vp` -> { "6":[...], "5":[...], ... }
 *                fields: id, name(ko), rarity, inspiration(afflatus), dmgType,
 *                        engName(slug), version
 *  B. Detail  - https://www.reverse1999-simulator.com/en/character/{id}
 *                RSC payload object with characterId/slug/skills/inheritance/
 *                portraits/euphorias/effects/imageSourceUrl (EN translations)
 *  C. Fandom  - https://reverse1999.fandom.com/api.php (ArcanistInfo wikitext)
 *                release (CN/Global dates), tags, attribute, damage
 *  D. Assets  - character icons from the Fandom wiki:
 *                File:{Name}_Icon_Large.png (228x524) or File:{Name}_Icon.png (168x168)
 *                stored as a remote wiki CDN URL in `image` (see --wikicons)
 *  E. Growth  - https://www.reverse1999-simulator.com growth-cost webpack modules:
 *                insight / resonance / resonance-pattern / euphoria materials
 *                and Dust + Sharpodonty totals (see --materials)
 *
 * Merge policy: never overwrite a non-empty existing value in data.json;
 * append new characters; fill empty fields only.
 * Exceptions: --wikicons rewrites every `image` to the wiki URL;
 *             --materials rewrites materialPlan + euphoria path materials.
 *
 * Usage:
 *   node tools/import.js --scrape      # fetch roster+details+fandom -> tools/raw.json
 *   node tools/import.js --merge       # merge tools/raw.json into data.json
 *   node tools/import.js --wikicons    # set image = Fandom wiki icon URL
 *   node tools/import.js --materials   # fill growth materials from the simulator
 *   node tools/import.js --images      # download simulator portraits into images/chars
 *   node tools/import.js --all         # scrape -> merge -> wikicons -> materials
 *   node tools/import.js --only beryl  # restrict scrape to a slug (debug)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'data.json');
const RAW_PATH = path.join(__dirname, 'raw.json');
const IMG_DIR = path.join(ROOT, 'images', 'chars');

const SITE = 'https://www.reverse1999-simulator.com';
const CHUNK_5671 = `${SITE}/_next/static/chunks/5671-b72bcde99eb6bd4b.js`;
const CHUNK_2249 = `${SITE}/_next/static/chunks/2249-1b4540f8ec577d31.js`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const AFFLATUS_MAP = {
  star: 'Star', plant: 'Plant', mineral: 'Mineral',
  beast: 'Beast', spirit: 'Spirit', intellect: 'Intellect',
};
const DMG_MAP = { mental: 'Mental', reality: 'Reality' };
const SUFFIX_SET = new Set(['DPS', 'Support', 'Sustain', 'Sub-DPS']);

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function fetchBuffer(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: '*/*' } }, res => {
      const { statusCode, headers } = res;
      if (statusCode >= 300 && statusCode < 400 && headers.location && redirects > 0) {
        res.resume();
        return resolve(fetchBuffer(new URL(headers.location, url).href, redirects - 1));
      }
      if (statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout ' + url)));
  });
}

async function fetchText(url) {
  return (await fetchBuffer(url)).toString('utf8');
}

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

// ---------------------------------------------------------------------------
// RSC decoding (Next.js App Router self.__next_f.push payloads)
// ---------------------------------------------------------------------------

function decodeRSC(html) {
  const marker = 'self.__next_f.push(';
  let out = '';
  let i = 0;
  while ((i = html.indexOf(marker, i)) !== -1) {
    const start = i + marker.length;
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let j = start; j < html.length; j++) {
      const c = html[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end === -1) break;
    const arg = html.slice(start, end + 1);
    try {
      const parsed = JSON.parse(arg);
      if (Array.isArray(parsed) && typeof parsed[1] === 'string') out += parsed[1];
    } catch (e) { /* skip non-JSON chunks */ }
    i = end;
  }
  return out;
}

// Extract a balanced JSON literal starting at `start` ('{' or '[').
function extractJSON(text, start) {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      depth--;
      if (depth === 0) return c === close ? text.slice(start, i + 1) : null;
    }
  }
  return null;
}

function detailObject(html, id) {
  const s = decodeRSC(html);
  const idx = s.indexOf('"characterId":' + id);
  if (idx === -1) return null;
  for (let b = idx; b >= 0 && idx - b < 4000; b--) {
    if (s[b] !== '{') continue;
    const cand = extractJSON(s, b);
    if (!cand) continue;
    try {
      const o = JSON.parse(cand);
      if (o && o.characterId === Number(id)) return o;
    } catch (e) {}
  }
  return null;
}

// ---------------------------------------------------------------------------
// Roster extraction from the Next chunk
// ---------------------------------------------------------------------------

function balancedLiteral(js, start) {
  let depth = 0, inStr = false, esc = false, q = '';
  for (let i = start; i < js.length; i++) {
    const c = js[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === q) inStr = false;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { inStr = true; q = c; }
    else if (c === '[' || c === '{' || c === '(') depth++;
    else if (c === ']' || c === '}' || c === ')') { depth--; if (depth === 0) return js.slice(start, i + 1); }
  }
  return null;
}

function moduleLiteral(js, modId, prop) {
  const mi = js.indexOf(modId + ':(');
  if (mi === -1) return null;
  const head = js.slice(mi, mi + 500);
  const pm = head.match(new RegExp(prop + ':\\(\\)=>([A-Za-z_$][\\w$]*)'));
  if (!pm) return null;
  const local = pm[1];
  const mapEnd = js.indexOf('});let', mi);
  let di = -1;
  if (mapEnd !== -1 && mapEnd - mi < 600) {
    di = js.indexOf('let ' + local + '=', mapEnd);
    if (di !== -1 && di - mapEnd > 3000) di = -1;
  }
  if (di === -1) {
    const re2 = new RegExp('(^|[^\\w$])' + local + '=([\\[{])', 'g');
    const searchFrom = mapEnd !== -1 ? mapEnd : mi;
    re2.lastIndex = searchFrom;
    const mm = re2.exec(js);
    if (mm && mm.index - searchFrom < 3000) di = mm.index + mm[1].length;
  }
  if (di === -1) return null;
  const arrStart = js.indexOf('[', di);
  const objStart = js.indexOf('{', di);
  const start = Math.min(
    arrStart === -1 ? Infinity : arrStart,
    objStart === -1 ? Infinity : objStart);
  if (!isFinite(start)) return null;
  return balancedLiteral(js, start);
}

async function scrapeRoster() {
  const js = await fetchText(CHUNK_5671);
  const lit = moduleLiteral(js, '68512', 'Vp');
  if (!lit) throw new Error('roster literal not found');
  const buckets = eval('(' + lit + ')');            // eslint-disable-line no-eval
  const list = [];
  for (const key of Object.keys(buckets)) {
    for (const c of buckets[key]) list.push(c);
  }
  return list;
}

// ---------------------------------------------------------------------------
// Fandom extraction
// ---------------------------------------------------------------------------

function parseFandomDate(release) {
  // e.g. "October 30th, 2025 (CN) <br> January 20th, 2026 (Global)"
  if (!release) return '';
  const cn = release.split('<br')[0];
  const m = cn.match(/([A-Za-z]+)\s+(\d+)(?:st|nd|rd|th)?,?\s*(\d{4})/);
  if (!m) return '';
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const mi = months.indexOf(m[1]);
  if (mi === -1) return '';
  const mm = String(mi + 1).padStart(2, '0');
  const dd = String(m[2]).padStart(2, '0');
  return `${m[3]}-${mm}-${dd}`;
}

function parseInfobox(wikitext) {
  const m = wikitext.match(/\{\{ArcanistInfo[\s\S]*?\n\}\}/);
  if (!m) return null;
  const body = m[0];
  const field = name => {
    const re = new RegExp('\\|\\s*' + name + '\\s*=\\s*([^\\n|]*(?:\\n(?!\\s*\\|)[^\\n|]*)*)');
    const fm = body.match(re);
    return fm ? fm[1].trim() : '';
  };
  return {
    release: field('release'),
    tags: field('tags'),
    attribute: field('attribute'),
    damage: field('damage'),
    rarity: field('rarity'),
  };
}

async function scrapeFandom(pageName) {
  const url = 'https://reverse1999.fandom.com/api.php?action=parse&page=' +
    encodeURIComponent(pageName) + '&prop=wikitext&format=json&origin=*';
  try {
    const j = await fetchJson(url);
    if (!j || !j.parse || !j.parse.wikitext) return null;
    return parseInfobox(j.parse.wikitext['*']);
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Scrape orchestration
// ---------------------------------------------------------------------------

function emptyChar(slug, name) {
  return {
    id: slug,
    name: name,
    tags: [],
    tier: '',
    bound: [],
    image: '',
    rarity: 0,
    suffix: [],
    dmgType: '',
    afflatus: '',
    euphoria: { tag: '', image: '', rank1: '', rank2: '', rank3: '', rank4: '', suffix: '' },
    psychube: '',
    altPsychube: '',
    hasEuphoria: false,
    materialPlan: emptyMaterialPlan(),
    releaseDate: '',
    euphoriaPaths: [],
  };
}

function emptyMaterialPlan() {
  return {
    currency: { dust: '', sharpodonty: '' },
    insights: [],
    resL5: { mats: [], sharpodonty: '' },
    resL10: { mats: [], sharpodonty: '' },
    resL15: { mats: [], sharpodonty: '' },
    resPattern: { mats: [], sharpodonty: '' },
  };
}

function ogImage(html) {
  const m = html.match(/og:image\\?"[^}]*?content\\?":\\?"([^"\\]+)/);
  if (m) return m[1];
  const m2 = html.match(/og:image[^"]*content="([^"]+)"/);
  return m2 ? m2[1] : '';
}

async function scrapeAll(onlySlug) {
  console.error('scraping roster...');
  const roster = await scrapeRoster();
  console.error(`  -> ${roster.length} characters`);

  const chars = [];
  for (const rc of roster) {
    const slug = rc.engName;
    if (onlySlug && slug !== onlySlug) continue;

    const enName = (rc.translations && rc.translations.en && rc.translations.en.name) || rc.name;
    const out = emptyChar(slug, enName);
    out.rarity = rc.rarity;
    out.afflatus = AFFLATUS_MAP[rc.inspiration] || '';
    out.dmgType = DMG_MAP[rc.dmgType] || '';
    out.simulatorId = rc.id;
    out.version = rc.version;

    // detail page
    try {
      const html = await fetchText(`${SITE}/en/character/${rc.id}`);
      const detail = detailObject(html, rc.id);
      out.imageUrl = ogImage(html);
      if (detail) {
        out.slug = detail.slug || slug;
        if (Array.isArray(detail.euphorias) && detail.euphorias.length) {
          out.hasEuphoria = true;
          out.euphoriaPaths = detail.euphorias.map((e, idx) => {
            const levels = Array.isArray(e.levels) ? e.levels : [];
            const desc = n => {
              const lv = levels[n] && levels[n].description;
              return lv ? (lv.en || lv.ko || '') : '';
            };
            return {
              type: 'E' + (idx + 1),
              tag: 'E' + (idx + 1),
              name: (e.name && (e.name.en || e.name.ko)) || '',
              suffix: '',
              releaseDate: '',
              image: e.image ? SITE + e.image : '',
              rank1: desc(0),
              rank2: desc(1),
              rank3: desc(2),
              rank4: desc(3),
              materials: [],
            };
          });
        }
      }
    } catch (e) {
      console.error(`  ! detail ${slug}: ${e.message}`);
    }

    // fandom
    try {
      const fb = await scrapeFandom(enName);
      if (fb) {
        out.releaseDate = parseFandomDate(fb.release);
        if (fb.tags) {
          const parts = fb.tags.split(/<br\s*\/?>/i).map(s => s.trim()).filter(Boolean);
          out._fandomTags = parts;
        }
        if (fb.attribute && !out.afflatus) out.afflatus = AFFLATUS_MAP[fb.attribute.toLowerCase()] || fb.attribute;
        if (fb.damage && !out.dmgType) out.dmgType = DMG_MAP[fb.damage.toLowerCase()] || fb.damage;
      }
    } catch (e) {
      console.error(`  ! fandom ${slug}: ${e.message}`);
    }

    chars.push(out);
    console.error(`  + ${slug} (${enName}) rarity=${out.rarity} eup=${out.euphoriaPaths.length}`);
    await sleep(120);
  }

  fs.writeFileSync(RAW_PATH, JSON.stringify(chars, null, 2));
  console.error(`wrote ${RAW_PATH} (${chars.length} characters)`);
  return chars;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// Merge into data.json
// ---------------------------------------------------------------------------

function isBlank(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).every(k => isBlank(v[k]));
  return false;
}

function mergeChar(existing, raw) {
  // never overwrite non-empty; fill empties
  const out = existing;
  const setIfBlank = (key, val) => {
    if (val === undefined || val === null || val === '') return;
    if (isBlank(out[key])) out[key] = val;
  };
  setIfBlank('name', raw.name);
  setIfBlank('rarity', raw.rarity || '');
  setIfBlank('afflatus', raw.afflatus);
  setIfBlank('dmgType', raw.dmgType);
  setIfBlank('image', raw.image);
  setIfBlank('releaseDate', raw.releaseDate);

  // tags from fandom: first token may be a suffix (DPS/Support/...)
  const { suffix, tags } = splitFandomTags(raw);
  if (isBlank(out.suffix) && suffix.length) out.suffix = suffix;
  if (isBlank(out.tags) && tags.length) out.tags = tags;

  // euphoria paths (only if existing empty)
  if (isBlank(out.euphoriaPaths) && Array.isArray(raw.euphoriaPaths) && raw.euphoriaPaths.length) {
    out.euphoriaPaths = raw.euphoriaPaths;
    out.hasEuphoria = true;
  }
  if (raw.hasEuphoria && !out.hasEuphoria && Array.isArray(out.euphoriaPaths) && out.euphoriaPaths.length) {
    out.hasEuphoria = true;
  }
  return out;
}

function splitFandomTags(raw) {
  const parts = Array.isArray(raw._fandomTags) ? raw._fandomTags : [];
  const suffix = parts.filter(t => SUFFIX_SET.has(t));
  const tags = parts.filter(t => !SUFFIX_SET.has(t)).map(n => ({ name: n }));
  return { suffix, tags };
}

function buildNewChar(raw) {
  const c = emptyChar(raw.id, raw.name);
  c.rarity = raw.rarity || 0;
  c.afflatus = raw.afflatus || '';
  c.dmgType = raw.dmgType || '';
  c.releaseDate = raw.releaseDate || '';
  const { suffix, tags } = splitFandomTags(raw);
  c.suffix = suffix;
  c.tags = tags;
  if (Array.isArray(raw.euphoriaPaths) && raw.euphoriaPaths.length) {
    c.euphoriaPaths = raw.euphoriaPaths;
    c.hasEuphoria = true;
  }
  return c;
}

function doMerge() {
  if (!fs.existsSync(RAW_PATH)) throw new Error('raw.json missing; run --scrape first');
  const raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  if (!Array.isArray(data.characters)) throw new Error('data.characters missing');

  const byId = new Map(data.characters.map(c => [c.id, c]));
  const byName = new Map(data.characters.map(c => [c.name.toLowerCase(), c]));
  let added = 0, updated = 0;

  for (const r of raw) {
    const slug = r.id;
    // Match existing character by id, then by english name (slugs differ for
    // some chars, e.g. data.json "flutterpage" vs simulator "flutter-page").
    // Keep the existing id so bound links / team data stay valid.
    let existing = byId.get(slug) || byName.get(r.name.toLowerCase()) || null;
    if (existing) {
      const before = JSON.stringify(existing);
      mergeChar(existing, r);
      if (JSON.stringify(existing) !== before) updated++;
    } else {
      const fresh = buildNewChar(r);
      data.characters.push(fresh);
      byId.set(slug, fresh);
      byName.set(fresh.name.toLowerCase(), fresh);
      added++;
    }
  }

  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`merge complete: +${added} new, ${updated} updated, total ${data.characters.length}`);
}

// ---------------------------------------------------------------------------
// Image download
// ---------------------------------------------------------------------------

async function doImages() {
  if (!fs.existsSync(RAW_PATH)) throw new Error('raw.json missing; run --scrape first');
  const raw = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));
  if (!fs.existsSync(IMG_DIR)) fs.mkdirSync(IMG_DIR, { recursive: true });

  // resolve destination filenames from data.json so characters whose data id
  // differs from the simulator slug (e.g. anjonala vs anjo-nala) land in the
  // right place without leaving duplicate files behind.
  const destBySlug = new Map();
  try {
    const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    const byName = new Map((data.characters || []).map(c => [c.name.toLowerCase(), c]));
    for (const r of raw) {
      const c = byName.get(r.name.toLowerCase());
      if (c && c.image) destBySlug.set(r.id, path.basename(c.image));
    }
  } catch (e) { /* data.json optional */ }

  // Euphoria images stay as remote simulator URLs (project convention), so only
  // character portraits are downloaded into images/chars/.
  let port = 0, miss = 0;
  for (const r of raw) {
    const slug = r.id;
    const destName = destBySlug.get(slug) || (slug + '.webp');
    const dest = path.join(IMG_DIR, destName);
    if (!fs.existsSync(dest)) {
      // The simulator stores low-rarity portraits at /characters/{r}stars/...,
      // while 5-6* live at /characters/{r}stars_list/... . og:image is not
      // always reachable, so try a rarity-aware candidate list.
      const candidates = [
        r.imageUrl,
        `${SITE}/characters/${r.rarity}stars_list/${slug}.webp`,
        `${SITE}/characters/${r.rarity}stars/${slug}.webp`,
        `${SITE}/characters/${r.rarity}stars_small/${slug}.webp`,
      ].filter(Boolean);
      let saved = false;
      for (const url of candidates) {
        try {
          const buf = await fetchBuffer(url);
          if (buf.length > 100) { fs.writeFileSync(dest, buf); port++; saved = true; break; }
        } catch (e) { /* try next */ }
      }
      if (!saved) { miss++; console.error(`  ! portrait ${slug} (${r.rarity}*)`); }
    }
    await sleep(80);
  }
  console.log(`images: ${port} portraits, ${miss} missing`);
}

// ---------------------------------------------------------------------------
// Fandom wiki character icons  (-> image field, remote URL)
// ---------------------------------------------------------------------------

// Some display names differ from the wiki page/file base name.
const WIKI_NAME_OVERRIDES = {
  'Glyndŵr': 'Glyndŵr',
};

async function fandomImageInfo(title) {
  const url = 'https://reverse1999.fandom.com/api.php?action=query&titles=' +
    encodeURIComponent(title) + '&prop=imageinfo&iiprop=url|size|mime&format=json&origin=*';
  const j = await fetchJson(url);
  const pages = j && j.query && j.query.pages;
  if (!pages) return null;
  const key = Object.keys(pages)[0];
  const ii = pages[key] && pages[key].imageinfo;
  return ii && ii[0] ? ii[0] : null;
}

async function wikiIcon(name) {
  const base = WIKI_NAME_OVERRIDES[name] || name;
  const candidates = [`File:${base}_Icon_Large.png`, `File:${base}_Icon.png`];
  for (const title of candidates) {
    try {
      const ii = await fandomImageInfo(title);
      if (ii && ii.url) return { url: ii.url, width: ii.width, height: ii.height, kind: title.includes('Large') ? 'large' : 'small' };
    } catch (e) { /* try next */ }
    await sleep(50);
  }
  return null;
}

async function doWikicons(onlySlug) {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const chars = data.characters || [];
  let large = 0, small = 0, miss = 0;
  for (const c of chars) {
    if (onlySlug && c.id !== onlySlug) continue;
    const icon = await wikiIcon(c.name);
    if (icon) {
      c.image = icon.url;
      if (icon.kind === 'large') large++; else small++;
      console.error(`  + ${c.id} (${c.name}) <- ${icon.kind} ${icon.width}x${icon.height}`);
    } else {
      miss++;
      console.error(`  ! ${c.id} (${c.name}): no wiki icon`);
    }
    await sleep(60);
  }
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`wikicons: ${large} large, ${small} small, ${miss} missing (total ${chars.length})`);
}

// ---------------------------------------------------------------------------
// Growth materials (insight / resonance / resonance pattern / euphoria)
// ---------------------------------------------------------------------------
//
// The simulator exposes growth costs as webpack modules on its chunks:
//   15021 (chunk 5021) export `A`  -> material master list
//   4216  (chunk 1226) export `Q`  -> insight materials per character
//   28628 (chunk 1226) export `u`  -> resonance materials per character
//   3971  (chunk 1226) export `M`  -> resonance-pattern materials per character
//   72631 (chunk 2631) export `T`  -> euphoria unlock/upgrade materials
// Material references use numeric ids ({ "<materialId>": <qty> }).
// 1001 = Dust, 1002 = Sharpodonty (base currencies).

const MATERIAL_CHUNKS = {
  meta: '5021-9db59e6bf8c93aaf',
  growthA: '1226-c3057d517612f69a', // insight (4216) + resonance (28628) + pattern (3971)
  euphoria: '2631-3615f14a07a5e968', // euphoria (72631)
};

// Extract a webpack module body `modId:(e,t,a)=>{...}` with balanced braces.
function webpackModule(js, modId) {
  const i = js.indexOf(modId + ':(');
  if (i === -1) return null;
  const start = js.indexOf('{', js.indexOf('=>', i));
  let depth = 0, inStr = false, esc = false, q = '';
  for (let k = start; k < js.length; k++) {
    const c = js[k];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === q) inStr = false; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = true; q = c; }
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return js.slice(start, k + 1); }
  }
  return null;
}

// Largest JS array literal in a module body, evaluated safely.
function moduleArray(body) {
  if (!body) return null;
  let best = null;
  for (let s = 0; s < body.length; s++) {
    if (body[s] !== '[') continue;
    let depth = 0, inStr = false, esc = false, q = '';
    for (let k = s; k < body.length; k++) {
      const c = body[k];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === q) inStr = false; continue; }
      if (c === '"' || c === "'" || c === '`') { inStr = true; q = c; }
      else if (c === '[') depth++;
      else if (c === ']') {
        depth--;
        if (depth === 0) {
          try {
            const a = vm.runInNewContext('(' + body.slice(s, k + 1) + ')', {}, { timeout: 2000 });
            if (Array.isArray(a) && (!best || a.length > best.length)) best = a;
          } catch (e) { /* not this one */ }
          break;
        }
      }
    }
  }
  return best;
}

// Any JS object literal in a module body (used for the shared insight cost table).
function moduleObject(body) {
  if (!body) return null;
  const s = body.indexOf('{', body.indexOf('=>'));
  const start = body.indexOf('{', s + 1);
  if (start === -1) return null;
  let depth = 0, inStr = false, esc = false, q = '';
  for (let k = start; k < body.length; k++) {
    const c = body[k];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === q) inStr = false; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = true; q = c; }
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try { return vm.runInNewContext('(' + body.slice(start, k + 1) + ')', {}, { timeout: 2000 }); }
        catch (e) { return null; }
      }
    }
  }
  return null;
}

async function loadMaterialTables() {
  const base = 'https://www.reverse1999-simulator.com/_next/static/chunks/';
  const [jsMeta, jsGrowth, jsEuph] = await Promise.all([
    fetchText(base + MATERIAL_CHUNKS.meta + '.js'),
    fetchText(base + MATERIAL_CHUNKS.growthA + '.js'),
    fetchText(base + MATERIAL_CHUNKS.euphoria + '.js'),
  ]);
  const metaList = moduleArray(webpackModule(jsMeta, 15021)) || [];
  const metaById = {};
  for (const x of metaList) metaById[x.id] = x;

  const insightArr = moduleArray(webpackModule(jsGrowth, 4216)) || [];
  const resonanceArr = moduleArray(webpackModule(jsGrowth, 28628)) || [];
  const patternArr = moduleArray(webpackModule(jsGrowth, 3971)) || [];
  const euphoriaArr = moduleArray(webpackModule(jsEuph, 72631)) || [];

  const byChar = arr => {
    const m = {};
    for (const x of arr) m[x.character_id] = x;
    return m;
  };
  console.error(`materials: meta=${metaList.length} insight=${insightArr.length} resonance=${resonanceArr.length} pattern=${patternArr.length} euphoria=${euphoriaArr.length}`);
  return {
    metaById,
    insight: byChar(insightArr),
    resonance: byChar(resonanceArr),
    pattern: byChar(patternArr),
    euphoria: byChar(euphoriaArr),
  };
}

// Sum {id:qty} maps into a single {id:qty} map.
function sumMatMaps(...maps) {
  const out = {};
  for (const m of maps) {
    if (!m) continue;
    for (const [k, v] of Object.entries(m)) out[k] = (out[k] || 0) + v;
  }
  return out;
}

// Convert a {id:qty} map into the project's [ {mat, qty} ] list,
// pulling human-readable names from the material master list.
function matList(matMap, metaById, skipIds = [1001, 1002]) {
  return Object.entries(matMap || {})
    .filter(([id]) => !skipIds.includes(Number(id)))
    .map(([id, qty]) => {
      const meta = metaById[Number(id)];
      return { mat: meta ? (meta.engName || meta.name) : ('#' + id), qty: String(qty) };
    });
}

// Cumulative insight cost: levels 1..3 (chains removed, matches in-game totals).
function insightTotals(tbl) {
  const c = tbl && tbl.insight;
  if (!Array.isArray(c)) return {};
  return sumMatMaps(...c.map(l => l.materials));
}

// Cumulative resonance cost up to and including `level`.
function resonanceTotals(tbl, level) {
  const c = tbl && tbl.resonance;
  if (!Array.isArray(c)) return {};
  return sumMatMaps(...c.filter(r => r.level <= level).map(r => r.materials));
}

// Combined cost of every resonance pattern for this character.
function patternTotals(tbl) {
  const c = tbl && tbl.pattern;
  if (!Array.isArray(c)) return {};
  return sumMatMaps(...c.map(p => p.materials));
}

async function doMaterials(onlySlug) {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  const rawArr = JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));
  const simIdById = {};
  const simIdByName = {};
  for (const r of rawArr) {
    if (r.simulatorId) {
      simIdById[r.id] = r.simulatorId;
      if (r.name) simIdByName[r.name.toLowerCase()] = r.simulatorId;
    }
  }

  const T = await loadMaterialTables();
  const metaById = T.metaById;

  let filled = 0, noRes = 0, noInsight = 0, noEuph = 0;
  for (const c of data.characters || []) {
    if (onlySlug && c.id !== onlySlug) continue;
    const simId = simIdById[c.id] || simIdByName[(c.name || '').toLowerCase()];
    const mp = c.materialPlan || (c.materialPlan = emptyMaterialPlan());
    // legacy: euphoria materials now live on each euphoria path
    if (mp.euphoriaMats !== undefined) delete mp.euphoriaMats;
    if (!simId) { console.error(`  ! ${c.id}: no simulatorId`); continue; }

    // currency totals (Dust = 1001, Sharpodonty = 1002) from all sources
    const insTot = insightTotals(T.insight[simId]);
    const res5 = resonanceTotals(T.resonance[simId], 5);
    const res10 = resonanceTotals(T.resonance[simId], 10);
    const res15 = resonanceTotals(T.resonance[simId], 15);
    const patTot = patternTotals(T.pattern[simId]);

    mp.insights = matList(insTot, metaById);
    mp.resL5 = { mats: matList(res5, metaById), sharpodonty: (res5[1002] ? String(res5[1002]) : '') };
    mp.resL10 = { mats: matList(res10, metaById), sharpodonty: (res10[1002] ? String(res10[1002]) : '') };
    mp.resL15 = { mats: matList(res15, metaById), sharpodonty: (res15[1002] ? String(res15[1002]) : '') };
    mp.resPattern = { mats: matList(patTot, metaById), sharpodonty: (patTot[1002] ? String(patTot[1002]) : '') };

    // currency: dust/sharpodonty totals across all growth paths
    const dust = sumMatMaps(insTot, res15, patTot);
    mp.currency = {
      dust: dust[1001] ? String(dust[1001]) : '',
      sharpodonty: dust[1002] ? String(dust[1002]) : '',
    };

    // euphoria materials -> per path: that path's unlock cost + shared upgrade cost
    const euph = T.euphoria[simId];
    const paths = Array.isArray(c.euphoriaPaths) ? c.euphoriaPaths : [];
    if (paths.length && euph) {
      const upgrade = sumMatMaps(...(euph.upgrade || []).map(u => u.materials));
      paths.forEach((p, idx) => {
        const unlockRow = (euph.euphoria || []).find(e => e.level === idx + 1);
        const unlock = unlockRow ? unlockRow.materials : {};
        p.materials = matList(sumMatMaps(unlock, upgrade), metaById);
      });
    } else {
      for (const p of paths) if (!p.materials) p.materials = [];
      if (paths.length) noEuph++;
    }

    if (mp.insights.length) filled++; else noInsight++;
    if (!mp.resL15.mats.length) noRes++;
    console.error(`  + ${c.id} insight=${mp.insights.length} res15=${mp.resL15.mats.length} pattern=${mp.resPattern.mats.length} euph=${paths.length ? (paths[0].materials || []).length : 0}`);
    await sleep(10);
  }

  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`materials: ${filled} with insight, ${noInsight} insight-less, ${noRes} resonance-less, ${noEuph} euphoria paths without table`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const has = f => args.includes(f);
  const only = (() => {
    const i = args.indexOf('--only');
    return i !== -1 ? args[i + 1] : null;
  })();

  if (has('--all')) {
    await scrapeAll(only);
    doMerge();
    await doWikicons(only);
    await doMaterials(only);
  } else {
    if (has('--scrape')) await scrapeAll(only);
    if (has('--merge')) doMerge();
    if (has('--wikicons')) await doWikicons(only);
    if (has('--materials')) await doMaterials(only);
    if (has('--images')) await doImages();
    if (!has('--scrape') && !has('--merge') && !has('--wikicons') && !has('--materials') && !has('--images')) {
      console.log('usage: node tools/import.js [--scrape] [--merge] [--wikicons] [--materials] [--images] [--all] [--only slug]');
    }
  }
}

main().catch(e => { console.error('ERR', e); process.exit(1); });
