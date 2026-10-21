// One-off: publish local data.json to the Supabase cloud row.
//   node tools/push-cloud.js           (dry-run: compares only)
//   node tools/push-cloud.js --push    (upserts local data.json into the cloud row)
'use strict';
const fs = require('fs');
const path = require('path');
global.window = {};
require(path.join(__dirname, '..', 'config.js'));
const C = window.PS_CONFIG.supabase;

const base = String(C.url).replace(/\/+$/, '') + '/rest/v1/' + encodeURIComponent(C.table);
const headers = {
  apikey: C.anonKey,
  Authorization: 'Bearer ' + C.anonKey,
  'Content-Type': 'application/json'
};

async function loadCloud() {
  const res = await fetch(base + '?id=eq.' + encodeURIComponent(C.rowId) + '&select=content', { headers });
  if (!res.ok) throw new Error('load HTTP ' + res.status);
  const rows = await res.json();
  return rows && rows.length ? rows[0].content : null;
}

async function main() {
  const local = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data.json'), 'utf8'));
  const cloud = await loadCloud();
  console.log('cloud: ' + (cloud ? Object.keys(cloud).length + ' keys, psychubes=' + (Array.isArray(cloud.psychubes) ? cloud.psychubes.length : 'MISSING') : 'empty'));
  console.log('local: ' + Object.keys(local).length + ' keys, psychubes=' + (local.psychubes || []).length + ', filled=' + (local.characters || []).filter(c => c.psychube).length);

  if (!process.argv.includes('--push')) {
    console.log('dry-run only — run with --push to overwrite the cloud row');
    return;
  }
  const res = await fetch(base, {
    method: 'POST',
    headers: Object.assign({}, headers, { Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify({ id: C.rowId, content: local })
  });
  console.log('push HTTP ' + res.status);
  const body = await res.text();
  if (!res.ok) { console.log('FAILED: ' + body.slice(0, 400)); process.exit(1); }
  const check = await loadCloud();
  const ok = check && Array.isArray(check.psychubes) && check.psychubes.length === local.psychubes.length;
  console.log(ok ? 'verified: cloud now has ' + check.psychubes.length + ' psychubes' : 'WARNING: read-back mismatch — ' + body.slice(0, 200));
}

main().catch(e => { console.error(e); process.exit(1); });
