/* ============================================================
   STATE
   ============================================================ */
const VARS = ['materialNodes','mythManifests','characters','materialsList','psychubes','teamTierData','pullBanners','walkthroughData','homePatchNewCharIds','homePatchEuphoriaIds','homeManesBulletinBosses'];
const API_ENDPOINTS = ['/api/data', 'http://localhost:3000/api/data'];
const CLOUD_READY = !!(window.PSStore && PSStore.isConfigured());

let RAW = null;           // original file text (baseline) — file mode only
let PRESENT = [];         // vars actually found/loaded
let DOC = {};             // editable data
let PAGE = { title:'', heroHeading:'', heroQuote:'', patchVersion:'' };
let PT = {};              // captured page-text segments (file mode)
let HANDLE = null;        // FileSystemFileHandle (when available)
let FILENAME = '';
let DIRTY = false, CHANGES = 0;
let SECTION = 'characters';
let Q = '';
let API_MODE = false;     // true = loaded from server API; false = opened local HTML file
const sel = { characters:0, teams:0, banners:0, manifests:0, nodes:0, bosses:0, wfboss:0, materials:0, psychubes:0 };
let wfMode = 'reveries';

const AFFLATUS = ['Star','Plant','Mineral','Beast','Spirit','Intellect'];
const TIERS = ['T0','T0.5','T1','T2','T3','T4','T5','F'];
const ARCHETYPES = ['Lingering Glow','Dynamo','Conduit','Bloodtithe','Impromptu','Ultimate/Bullet','Extra Action / Universal']; // team tierlist section only
const SUFFIXES = ['DPS','Support','Sustain','Sub-DPS'];
const DMG_TYPES = ['Mental','Reality'];
const EUPH_TYPES = ['E1','E2'];
const TAGS = ['General','Dynamo','Ritual','Follow Up','Poison','Lingering Glow','Bloodtithe','Rank Up','Inspiration','Conduit','Bullet','Shift','Full Pursuit','Counter Assassination','Negative Status','Burn','Halo','Counter','Eureka','HP Sacrifice','All Rounder'];
const TAG_REL = {
    'burn': ['Lingering Glow'],
    'halo': ['Lingering Glow'],
    'counter': ['Follow Up'],
    'eureka': ['Inspiration'],
    'dynamo': ['Ritual'],
    'hp sacrifice': ['Bloodtithe'],
    'poison': ['Negative Status']
};
function relativeTags(tags){
    const manual = new Set((tags || []).map(t => String(t.name || '').toLowerCase()));
    const out = [];
    const add = n => { if (!manual.has(n.toLowerCase()) && !out.includes(n)) out.push(n); };
    for (const t of (tags || [])){
        const k = String(t.name || '').toLowerCase();
        if (k === 'all rounder'){ TAGS.forEach(add); continue; }
        (TAG_REL[k] || []).forEach(add);
    }
    return out;
}
const BANNER_COLORS = ['bg-amber-800 text-parchment-50','bg-parchment-800 text-amber-300','bg-amber-700 text-parchment-50','bg-parchment-700 text-parchment-50','bg-parchment-800 text-parchment-50'];

/* ============================================================
   UTIL
   ============================================================ */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function matName(m){ return typeof m === 'string' ? m : (m && m.name) || ''; }

function getPath(p){ const parts = p.split('.'); let o = DOC; for (const k of parts){ if (o == null) return undefined; o = o[k]; } return o; }
function setPath(p, v){
    const parts = p.split('.');
    let o = DOC;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts[parts.length - 1]] = v;
}
// Bound pairs are symmetric: whenever A lists B as a bound partner, B gets a
// reverse entry with the same tagAmp (and stale reverse entries are removed).
function mirrorBounds(charId){
    const chars = DOC && DOC.characters;
    if (!chars) return;
    const me = chars.find(c => c && c.id === charId);
    if (!me) return;
    if (!Array.isArray(me.bound)) me.bound = [];
    const want = new Map();
    me.bound.forEach(b => { if (b && b.id && b.id !== charId) want.set(b.id, b.tagAmp || ''); });
    chars.forEach(other => {
        if (!other || other.id === charId || !Array.isArray(other.bound)) return;
        for (let i = other.bound.length - 1; i >= 0; i--){
            const b = other.bound[i];
            if (b && b.id === charId && !want.has(other.id)) other.bound.splice(i, 1);
        }
        if (!want.has(other.id)) return;
        const tagAmp = want.get(other.id);
        const rev = other.bound.find(b => b && b.id === charId);
        if (rev){
            rev.tagAmp = tagAmp;
        } else if (other.bound.length < 3){
            other.bound.push({ id: charId, tagAmp: tagAmp });
        } else {
            toast('Bound link to ' + (other.name || other.id) + ' not mirrored — that unit already has 3 partners');
        }
    });
}
function clampSel(){
    const lens = { characters:'characters', teams:'teamTierData', banners:'pullBanners', manifests:'mythManifests', nodes:'materialNodes', bosses:'homeManesBulletinBosses', materials:'materialsList', psychubes:'psychubes' };
    for (const k in lens){
        const len = (DOC[lens[k]] || []).length;
        if (len === 0) sel[k] = 0;
        else if (sel[k] >= len) sel[k] = len - 1;
    }
    const wb = ((DOC.walkthroughData || {})[wfMode] || {}).bosses || [];
    if (wb.length === 0) sel.wfboss = 0; else if (sel.wfboss >= wb.length) sel.wfboss = wb.length - 1;
}
function toast(msg){
    $('#toast-msg').textContent = msg;
    const t = $('#toast');
    t.classList.remove('opacity-0','translate-y-2');
    lucide.createIcons();
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.add('opacity-0','translate-y-2'), 2600);
}
function markDirty(){
    DIRTY = true; CHANGES++;
    const b = $('#dirty-badge');
    b.textContent = CHANGES + ' unsaved';
    b.classList.remove('hidden');
    clearTimeout(markDirty._t);
    markDirty._t = setTimeout(persist, 600);
    scheduleAutoSave();
}
function persist(){
    try { localStorage.setItem('ps-editor-session', JSON.stringify({ raw:RAW, doc:DOC, page:PAGE, pt:PT, present:PRESENT, file:FILENAME, api:API_MODE, dirty:DIRTY, changes:CHANGES })); }
    catch(e){ /* storage full */ }
}

/* ============================================================
   AUTO-SAVE — edits are written back to the cloud + local
   server 1.5s after you stop typing, and flushed again when
   the tab is hidden or closed, so data never resets on refresh.
   ============================================================ */
function scheduleAutoSave(){
    clearTimeout(scheduleAutoSave._t);
    scheduleAutoSave._t = setTimeout(autoSave, 1500);
}
async function autoSave(){
    if (!API_MODE || !DIRTY) return;
    await saveToApi({ silent:true });
}
function flushSave(){
    if (!API_MODE || !DIRTY) return;
    clearTimeout(scheduleAutoSave._t);
    clearTimeout(markDirty._t);
    persist();
    const payload = Object.assign({}, DOC, { pageText: PAGE });
    const body = JSON.stringify(payload);
    if (navigator.sendBeacon){
        for (const ep of API_ENDPOINTS){
            try { if (navigator.sendBeacon(ep, new Blob([body], { type:'application/json' }))) break; } catch(e){}
        }
    }
    if (CLOUD_READY){
        try { PSStore.save(payload, { keepalive:true }); } catch(e){}
    }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
window.addEventListener('pagehide', flushSave);
function saveToast(msg, silent){
    if (!silent){ toast(msg); return; }
    const now = Date.now();
    if (!saveToast._last || now - saveToast._last > 8000){ saveToast._last = now; toast(msg); }
}

/* ============================================================
   PARSING (locate `const name = <literal>;` and evaluate it)
   ============================================================ */
function extractVar(src, name){
    const re = new RegExp('\\b(?:const|let|var)\\s+' + name + '\\s*=');
    const m = re.exec(src);
    if (!m) return null;
    const prefixEnd = m.index + m[0].length;
    let depth = 0, mode = null;
    for (let i = prefixEnd; i < src.length; i++){
        const c = src[i], n = src[i + 1];
        if (mode === 'sq' || mode === 'dq' || mode === 'tpl'){
            if (c === '\\'){ i++; continue; }
            if ((mode === 'sq' && c === "'") || (mode === 'dq' && c === '"') || (mode === 'tpl' && c === '`')) mode = null;
            continue;
        }
        if (mode === 'line'){ if (c === '\n') mode = null; continue; }
        if (mode === 'block'){ if (c === '*' && n === '/'){ mode = null; i++; } continue; }
        if (c === '/' && n === '/'){ mode = 'line'; i++; continue; }
        if (c === '/' && n === '*'){ mode = 'block'; i++; continue; }
        if (c === "'"){ mode = 'sq'; continue; }
        if (c === '"'){ mode = 'dq'; continue; }
        if (c === '`'){ mode = 'tpl'; continue; }
        if (c === '{' || c === '[') depth++;
        else if (c === '}' || c === ']') depth--;
        else if (c === ';' && depth === 0){
            // end = index of the terminating ';' so it is preserved on write-back
            return { prefixEnd, end: i, literal: src.slice(prefixEnd, i) };
        }
    }
    return null;
}
function replaceVar(src, name, value){
    const info = extractVar(src, name);
    if (!info){ console.warn('variable not found:', name); return src; }
    const json = JSON.stringify(value, null, 4).replace(/<\//g, '<\\/');
    const indented = json.split('\n').map((l, i) => i === 0 ? l : '        ' + l).join('\n');
    return src.slice(0, info.prefixEnd) + ' ' + indented + src.slice(info.end);
}
function grab(re, src){
    const m = re.exec(src);
    if (!m) return { ok:false };
    const full = m[0], inner = m[1];
    const pos = full.indexOf(inner);
    const before = full.slice(0, pos);          // markup before the editable text
    const after = full.slice(pos + inner.length); // markup after the editable text
    const trimmed = inner.trim();
    let padB = '', padA = '';
    if (trimmed){
        const s = inner.indexOf(trimmed);
        padB = inner.slice(0, s);
        padA = inner.slice(s + trimmed.length);
    }
    return { ok:true, full, before, after, padB, padA, value: trimmed };
}
function capturePageText(src){
    PT.title      = grab(/<title>([\s\S]*?)<\/title>/, src);
    PT.heroHeading= grab(/<h2 class="font-serif text-2xl sm:text-4xl[^"]*">([\s\S]*?)<\/h2>/, src);
    PT.heroQuote  = grab(/<p class="text-parchment-100 text-base sm:text-xl[^"]*">([\s\S]*?)<\/p>/, src);
    PAGE.title      = PT.title.ok ? PT.title.value : '';
    PAGE.heroHeading= PT.heroHeading.ok ? PT.heroHeading.value : '';
    PAGE.heroQuote  = PT.heroQuote.ok ? PT.heroQuote.value : '';
    PT.patchVersion = { ok:true, value: PAGE.patchVersion || '' };
}

/* ============================================================
   LOAD / SAVE
   ============================================================ */
async function loadFromApi(){
    // 1. Cloud database from config.js (works on GitHub Pages)
    // 2. Local server endpoints (works during local development)
    // ?prefer=local forces the local server first — use it to publish a
    // data.json merge (e.g. the importer) that is newer than the cloud row.
    const preferLocal = new URLSearchParams(location.search).get('prefer') === 'local';
    const sources = [];
    if (CLOUD_READY && !preferLocal){
        sources.push({ cloud:true, id:PSStore.label(), load:() => PSStore.load() });
    }
    for (const endpoint of API_ENDPOINTS){
        sources.push({ cloud:false, id:endpoint, load:async () => {
            const res = await fetch(endpoint, { cache:'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
        }});
    }
    if (CLOUD_READY && preferLocal){
        sources.push({ cloud:true, id:PSStore.label(), load:() => PSStore.load() });
    }
    for (const src of sources){
        try {
            let data = await src.load();
            if (data !== null && (typeof data !== 'object' || Array.isArray(data))) continue;
            const empty = !data || Object.keys(data).length === 0;
            DOC = {};
            PRESENT = [];
            if (!empty){
                for (const k of VARS){
                    if (data[k] !== undefined){ DOC[k] = data[k]; PRESENT.push(k); }
                    else DOC[k] = (k === 'walkthroughData' ? {} : []);
                }
                PAGE = Object.assign({ title:'', heroHeading:'', heroQuote:'', patchVersion:'' }, data.pageText || {});
            } else {
                for (const k of VARS) DOC[k] = (k === 'walkthroughData' ? {} : []);
                PAGE = { title:'', heroHeading:'', heroQuote:'', patchVersion:'' };
            }
            PT = { title:{ok:true,value:PAGE.title}, heroHeading:{ok:true,value:PAGE.heroHeading}, heroQuote:{ok:true,value:PAGE.heroQuote}, patchVersion:{ok:true,value:PAGE.patchVersion||''} };
            RAW = null;
            HANDLE = null;
            FILENAME = src.cloud ? src.id : 'data.json (server)';
            API_MODE = true;
            DIRTY = false; CHANGES = 0;
            $('#dirty-badge').classList.add('hidden');
            $('#restore-banner').classList.add('hidden');
            $('#file-status').textContent = FILENAME + ' · ' + (empty ? 'empty — first save creates it' : PRESENT.length + '/' + VARS.length + ' data blocks') + ' · live';
            $('#btn-reload').classList.remove('hidden');
            $('#save-label').textContent = src.cloud ? 'Save to Cloud' : 'Save to Server';
            $('#btn-logout').classList.toggle('hidden', !(window.PSAuth && PSAuth.isEnabled()));
            persist();
            render();
            toast(empty ? src.id + ' is empty — saving will create the data' : 'Loaded live data from ' + src.id);
            return true;
        } catch (e){
            console.warn('loadFromApi: source failed (' + src.id + ')', e);
        }
    }
    return false;
}
function saveToApi(opts){
    // Serialize saves so a manual save and an auto-save can't race each other.
    const run = () => doSaveToApi(opts);
    const p = (saveToApi._p || Promise.resolve()).then(run, run);
    saveToApi._p = p.catch(function(){});
    return saveToApi._p;
}
async function doSaveToApi(opts){
    const silent = !!(opts && opts.silent);
    const stamp = CHANGES;
    const payload = Object.assign({}, DOC, { pageText: PAGE });
    const problems = [];
    let cloudSaved = false, localSaved = false;

    if (CLOUD_READY){
        try {
            await PSStore.save(payload);
            cloudSaved = true;
        } catch (e){
            problems.push(PSStore.label() + ': ' + e.message);
            console.warn('Cloud save failed', e);
        }
    }
    for (const endpoint of API_ENDPOINTS){
        try {
            const res = await fetch(endpoint, {
                method:'POST',
                headers:{ 'Content-Type':'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) continue;
            const out = await res.json();
            if (!out.ok) continue;
            localSaved = true;
            break;
        } catch (e){ /* try next endpoint */ }
    }

    if (CLOUD_READY && !cloudSaved){
        saveToast('Cloud save FAILED — ' + (problems[0] || 'unknown error') + (localSaved ? ' (local data.json saved)' : ''), silent);
        return false;
    }
    if (CHANGES !== stamp){
        // Edits arrived while the save was in flight — keep the badge and
        // schedule another auto-save so nothing typed in between is lost.
        scheduleAutoSave();
    } else {
        DIRTY = false; CHANGES = 0;
        $('#dirty-badge').classList.add('hidden');
    }
    persist();
    if (!silent){
        if (cloudSaved){
            toast('Saved to ' + PSStore.label() + (localSaved ? ' + local data.json' : '') + ' — refresh the guide to see changes');
        } else if (localSaved){
            toast('Saved to data.json — refresh the guide to see changes');
        }
    }
    if (cloudSaved) return true;
    if (localSaved) return true;
    saveToast('Could not reach any data source — check config.js or start "node server.js"', silent);
    return false;
}
async function openFile(){
    if (window.showOpenFilePicker){
        try {
            const [h] = await showOpenFilePicker({
                multiple: false,
                types: [{ description: 'HTML', accept: { 'text/html': ['.html', '.htm'] } }]
            });
            const f = await h.getFile();
            HANDLE = h;
            loadText(await f.text(), f.name);
            return;
        } catch (e){
            if (e && e.name === 'AbortError') return;
            console.warn('showOpenFilePicker failed, falling back', e);
        }
    }
    $('#file-input').click();
}
function loadText(text, name){
    RAW = text;
    FILENAME = name;
    PRESENT = [];
    DOC = {};
    const missing = [];
    for (const k of VARS){
        const info = extractVar(text, k);
        if (!info){ missing.push(k); continue; }
        try {
            DOC[k] = (0, eval)('(' + info.literal + ')');
            PRESENT.push(k);
        } catch (e){ missing.push(k + ' (parse error)'); }
    }
    capturePageText(text);
    DIRTY = false; CHANGES = 0;
    $('#dirty-badge').classList.add('hidden');
    $('#restore-banner').classList.add('hidden');
    $('#file-status').textContent = name + ' · ' + PRESENT.length + '/' + VARS.length + ' data blocks' + (missing.length ? ' · missing: ' + missing.join(', ') : '');
    persist();
    render();
    toast('Loaded ' + name);
}
function buildOutput(){
    let out = RAW;
    const fields = [['title','title'], ['heroHeading','heroHeading'], ['heroQuote','heroQuote']];
    for (const [key, pageKey] of fields){
        const seg = PT[key];
        if (!seg || !seg.ok) continue;
        if (PAGE[pageKey] === seg.value) continue;
        const oldFull = seg.before + seg.padB + seg.value + seg.padA + seg.after;
        const newFull = seg.before + seg.padB + PAGE[pageKey] + seg.padA + seg.after;
        out = out.replace(oldFull, () => newFull);
        seg.full = newFull; seg.value = PAGE[pageKey];
    }
    for (const k of PRESENT){
        if (DOC[k] === undefined) continue;
        out = replaceVar(out, k, DOC[k]);
    }
    return out;
}
async function saveFile(){
    if (API_MODE){
        // Explicit Save always publishes (even when nothing was edited this
        // session) — this is how ?prefer=local pushes data.json to the cloud.
        await saveToApi();
        return;
    }
    if (!RAW){ toast('Open the site file first'); return; }
    const out = buildOutput();
    if (HANDLE){
        try {
            let perm = await HANDLE.queryPermission({ mode:'readwrite' });
            if (perm !== 'granted') perm = await HANDLE.requestPermission({ mode:'readwrite' });
            if (perm !== 'granted') throw new Error('write permission denied');
            const w = await HANDLE.createWritable();
            await w.write(out);
            await w.close();
        } catch (e){
            console.warn(e);
            download(out);
            toast('Direct save blocked — downloaded instead');
            return;
        }
    } else {
        download(out);
        toast('Downloaded edited file');
    }
    RAW = out;
    capturePageText(out);
    DIRTY = false; CHANGES = 0;
    $('#dirty-badge').classList.add('hidden');
    persist();
}
function download(text){
    const blob = new Blob([text], { type:'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = FILENAME || 'pocket_suitcase_timekeeper_s_guide.html';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ============================================================
   VALIDATION
   ============================================================ */
function validate(){
    const errs = [], warns = [];
    const chars = DOC.characters || [];
    const ids = new Set(), names = new Set();
    chars.forEach((c, i) => {
        if (!c.id) errs.push(`Character #${i + 1} has no id.`);
        if (!c.name) errs.push(`Character #${i + 1} has no name.`);
        if (c.id){ if (ids.has(c.id)) errs.push(`Duplicate character id: "${c.id}".`); ids.add(c.id); }
        if (c.name) names.add(c.name);
        if (!TIERS.includes(c.tier)) warns.push(`${c.name || c.id}: tier "${c.tier}" is not one of T0/T0.5/T1/T2.`);
        if (!AFFLATUS.includes(c.afflatus)) warns.push(`${c.name || c.id}: afflatus "${c.afflatus}" is not a standard value.`);
        if (c.dmgType && !DMG_TYPES.includes(c.dmgType)) warns.push(`${c.name || c.id}: damage type "${c.dmgType}" is not Mental/Reality.`);
        (c.suffix || []).forEach(s => { if (!SUFFIXES.includes(s)) warns.push(`${c.name || c.id}: suffix "${s}" is not one of ${SUFFIXES.join('/')}.`); });
        if (c.hasEuphoria && ((c.euphoriaPaths && c.euphoriaPaths.length) ? false : true)){
            // check legacy
            if (!((c.euphoria && c.euphoria.tag) || '')) warns.push(`${c.name || c.id}: Euphoria on but euphoria tag is empty.`);
        }
        if (c.hasEuphoria && Array.isArray(c.euphoriaPaths)){
            if (!c.euphoriaPaths.length) warns.push(`${c.name || c.id}: Euphoria on but no euphoria paths added.`);
            c.euphoriaPaths.forEach((ep, ei) => {
                if (!ep.type && !ep.tag) warns.push(`${c.name || c.id}: Euphoria path ${ei+1} missing type/tag (E1/E2).`);
                if (!EUPH_TYPES.includes(ep.type || ep.tag)) warns.push(`${c.name || c.id}: Euphoria path ${ei+1} should be E1 or E2.`);
            });
        }
        if (!c.tier) warns.push(`${c.name || c.id}: no tier.`);
    });
    chars.forEach(c => {
        (c.bound || []).forEach(b => {
            if (b.id && b.id !== c.id && !ids.has(b.id)) warns.push(`${c.name || c.id}: bound unit "${b.id}" references an unknown character id.`);
        });
    });
    (DOC.homePatchNewCharIds || []).forEach(id => { if (!ids.has(id)) errs.push(`Home "New Debut" references unknown character id "${id}".`); });
    (DOC.homePatchEuphoriaIds || []).forEach(id => { if (!ids.has(id)) errs.push(`Home "Euphoria" references unknown character id "${id}".`); });
    (DOC.homeManesBulletinBosses || []).forEach((b, i) => {
        (b.recommendedIds || []).forEach(id => { if (!ids.has(id)) errs.push(`Mane's boss #${i + 1} (${b.name}) references unknown id "${id}".`); });
    });
    const manifests = new Set((DOC.mythManifests || []).map(m => m.name));
    const matSeen = new Set();
    (DOC.materialsList || []).forEach((m, i) => {
        const nm = matName(m).trim();
        if (!nm) warns.push(`Material #${i + 1} has no name.`);
        else if (matSeen.has(nm)) warns.push(`Duplicate material name: "${nm}".`);
        else matSeen.add(nm);
    });
    const manifestIds = new Set((DOC.mythManifests || []).map(m => m.id));
    (DOC.teamTierData || []).forEach(t => {
        (t.members || []).forEach(m => { if (!names.has(m)) warns.push(`Team "${t.name}": member "${m}" not found in character roster (check spelling).`); });
        if (t.manifest && !manifests.has(t.manifest)) warns.push(`Team "${t.name}": manifest "${t.manifest}" not found in Myth Manifests.`);
    });
    const bm = ((DOC.walkthroughData || {})['manes'] || {}).bosses || [];
    if (bm.length === 0) warns.push('Walkthrough has no Mane\'s bosses defined.');
    Object.keys(DOC.walkthroughData || {}).forEach(k => {
        const w = DOC.walkthroughData[k];
        if (!w.title) errs.push(`Walkthrough "${k}" has no title.`);
        if (!Array.isArray(w.tips) || !w.tips.length) warns.push(`Walkthrough "${k}" has no tips.`);
    });
    (DOC.pullBanners || []).forEach((b, i) => { if (!b.title) errs.push(`Pull banner #${i + 1} has no title.`); });
    if (!PAGE.title.trim()) warns.push('Page <title> is empty.');
    return { errs, warns };
}
function showValidation(){
    const { errs, warns } = validate();
    const body = $('#val-body');
    let html = '';
    if (!errs.length && !warns.length){
        html = '<p class="text-parchment-700 italic">No problems found. Everything looks consistent.</p>';
    } else {
        if (errs.length){
            html += `<div class="rounded-xl border border-red-300 bg-red-50 p-3"><p class="font-bold text-red-800 mb-1">${errs.length} error(s)</p>` +
                errs.map(e => `<p class="text-red-800 text-xs mb-0.5">• ${esc(e)}</p>`).join('') + '</div>';
        }
        if (warns.length){
            html += `<div class="rounded-xl border border-amber-300 bg-amber-50 p-3"><p class="font-bold text-amber-800 mb-1">${warns.length} warning(s)</p>` +
                warns.map(w => `<p class="text-amber-800 text-xs mb-0.5">• ${esc(w)}</p>`).join('') + '</div>';
        }
    }
    body.innerHTML = html;
    $('#val-modal').classList.remove('hidden');
    $('#val-modal').classList.add('flex');
    lucide.createIcons();
}

/* ============================================================
   FIELD BUILDERS
   ============================================================ */
function fInput(label, path, o = {}){
    const v = getPath(path);
    const cls = o.wide ? 'sm:col-span-2' : '';
    return `<div class="${cls}"><label class="lbl">${esc(label)}</label>
        <input type="${o.type || 'text'}" data-path="${path}" ${o.num ? 'data-num="1"' : ''} value="${esc(v ?? '')}" class="inp" placeholder="${esc(o.ph || '')}"></div>`;
}
function fArea(label, path, o = {}){
    const v = getPath(path);
    const text = o.kind === 'lines' && Array.isArray(v) ? v.join('\n') : (v ?? '');
    return `<div class="${o.wide === false ? '' : 'sm:col-span-2'}"><label class="lbl">${esc(label)}</label>
        <textarea data-path="${path}" ${o.kind ? `data-kind="${o.kind}"` : ''} rows="${o.rows || 3}" class="inp" placeholder="${esc(o.ph || '')}">${esc(text)}</textarea></div>`;
}
function fSelect(label, path, options, o = {}){
    let v = getPath(path);
    v = v == null ? '' : String(v);
    const list = options.includes(v) ? options : (v ? [v, ...options] : options);
    return `<div class="${o.wide ? 'sm:col-span-2' : ''}"><label class="lbl">${esc(label)}</label>
        <select data-path="${path}" ${o.num ? 'data-num="1"' : ''} class="inp">
            ${o.blank ? `<option value="" ${v === '' ? 'selected' : ''}>${esc(o.blank)}</option>` : ''}
            ${list.map(x => `<option value="${esc(x)}" ${x === v ? 'selected' : ''}>${esc(x)}</option>`).join('')}
        </select></div>`;
}
function fCheck(label, path){
    const v = !!getPath(path);
    return `<label class="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-parchment-100 border border-parchment-300 cursor-pointer select-none h-fit">
        <input type="checkbox" data-path="${path}" ${v ? 'checked' : ''} class="w-4 h-4 accent-parchment-800 rounded">
        <span class="text-xs font-bold text-parchment-900">${esc(label)}</span></label>`;
}
function grid(inner, cols){ return `<div class="grid ${cols || 'sm:grid-cols-2'} gap-4">${inner}</div>`; }
function sectionHead(title, sub, controls){
    return `<div class="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div><p class="text-[11px] font-mono font-bold uppercase tracking-widest text-parchment-600">${esc(sub)}</p>
        <h2 class="text-2xl font-bold mt-0.5">${esc(title)}</h2></div>
        <div class="flex flex-wrap items-center gap-2">${controls || ''}</div></div>`;
}

/* ============================================================
   SECTIONS
   ============================================================ */
function badgeTier(t){
    const c = t === 'T0' ? 'bg-amber-800 text-parchment-50 border-amber-500'
        : t === 'T0.5' ? 'bg-parchment-700 text-parchment-50 border-parchment-500'
        : t === 'T1' ? 'bg-parchment-200 text-parchment-800 border-parchment-400'
        : 'bg-parchment-100 text-parchment-700 border-parchment-300';
    return `<span class="badge ${c}">${esc(t || '—')}</span>`;
}

const SECTIONS = {
    characters: {
        label:'Characters', icon:'users',     get sub(){ return 'Ver ' + (PAGE.patchVersion || '—') + ' Arcanist Registry'; }, title:'Character Database',
        controls(){
            return `<input data-search="1" value="${esc(Q)}" placeholder="Search name / tag / suffix…" class="inp !w-52">
                <button class="btn btn-dark" data-act="add-char"><i data-lucide="plus" class="w-4 h-4"></i> New</button>
                <button class="btn btn-ghost" data-act="dup-char"><i data-lucide="copy" class="w-4 h-4"></i> Duplicate</button>
                <button class="btn btn-red" data-act="del-char"><i data-lucide="trash-2" class="w-4 h-4"></i></button>`;
        },
        list(){
            const arr = DOC.characters || [];
            const q = Q.trim().toLowerCase();
            return arr.map((c, i) => ({ c, i }))
                .filter(({ c }) => !q || ((c.name || '') + ' ' + (c.id || '') + ' ' + (c.suffix || []).join(' ') + ' ' + (c.tags || []).map(t => t.name).join(' ')).toLowerCase().includes(q))
                .map(({ c, i }) => `<button class="list-item ${i === sel.characters ? 'on' : ''}" data-act="sel-char" data-idx="${i}">
                    <div class="flex items-center justify-between gap-2"><span class="font-bold">${esc(c.name)}</span>${badgeTier(c.tier)}</div>
                    <div class="sub text-[11px] opacity-80 mt-0.5">${esc(c.afflatus)} · ${esc((c.suffix || []).join(' / ') || '—')}${c.hasEuphoria ? ' · ' + esc((c.euphoria && c.euphoria.tag) || 'Euphoria') : ''}</div>
                </button>`).join('') || '<p class="text-xs text-parchment-500 italic p-2">No matches.</p>';
        },
        form(){
            clampSel();
            const arr = DOC.characters || [];
            if (!arr.length) return '<div class="card p-6 text-sm text-parchment-600">No characters yet — click <b>New</b> to add one.</div>';
            const c = ensureCharShape(arr[sel.characters]);
            const p = 'characters.' + sel.characters;
            const sub = t => `<p class="text-[11px] font-mono font-bold uppercase tracking-widest text-parchment-600 mb-2.5">${t}</p>`;

            const imgVal = getPath(p + '.image') || '';
            const infoCard = `<div class="card p-5 space-y-4">${sub('Character Info')}
                ${grid(
                    fInput('Display Name', p + '.name') +
                    fInput('ID (slug)', p + '.id', { ph:'beryl' }) +
                    fSelect('Damage Type', p + '.dmgType', DMG_TYPES, { blank:'— not set —' }) +
                    fSelect('Afflatus', p + '.afflatus', AFFLATUS) +
                    fSelect('Rarity', p + '.rarity', ['6','5','4','3'], { num:true, blank:'—' }) +
                    fSelect('Tier', p + '.tier', TIERS) +
                    fInput('Release Date (CN)', p + '.releaseDate', { ph:'YYYY-MM-DD' }) +
                    fInput('Image Portray (URL)', p + '.image', { wide:true, ph:'https://…' }) +
                    (imgVal ? `<div class="sm:col-span-2"><img src="${esc(imgVal)}" alt="" class="h-24 rounded-xl border border-parchment-300 bg-parchment-100 object-contain" onerror="this.style.display='none'"></div>` : '') +
                    fSelect('Psychube (main)', p + '.psychube', (DOC.psychubes || []).map(y => y.name), { blank:'— none —' }) +
                    fSelect('Psychube (alt)', p + '.altPsychube', (DOC.psychubes || []).map(y => y.name), { blank:'— none —' })
                )}
                <div><label class="lbl">Suffix (pick one or more)</label>
                    <div class="flex flex-wrap gap-2">${SUFFIXES.map(s => `<button type="button" class="chip ${(getPath(p + '.suffix') || []).includes(s) ? 'on' : ''}" data-chip="${s}" data-chippath="${p}.suffix">${s}</button>`).join('')}</div></div>
            </div>`;

            const tags = getPath(p + '.tags') || [];
            const tagRows = tags.map((t, i) => `
                <div class="flex items-center gap-3 px-3 py-1.5 rounded-xl bg-parchment-100 border border-parchment-300">
                    <span class="text-xs font-bold text-parchment-900">${esc(t.name)}</span>
                    <span class="flex gap-0.5 text-sm leading-none">${[1,2,3,4,5].map(n =>
                        `<button type="button" data-act="tag-star" data-idx="${i}" data-star="${n}" class="cursor-pointer leading-none ${(t.rating || 0) >= n ? 'text-amber-500' : 'text-parchment-300 hover:text-amber-400'}">${(t.rating || 0) >= n ? '★' : '☆'}</button>`).join('')}</span>
                    <button type="button" data-act="tag-del" data-idx="${i}" class="ml-auto text-parchment-500 hover:text-red-600 cursor-pointer text-xs">✕</button>
                </div>`).join('') || '<p class="text-xs text-parchment-500 italic">No tags yet — pick them below.</p>';
            const rel = relativeTags(tags);
            const tagsCard = `<div class="card p-5 space-y-3.5">${sub('Tags')}
                <div class="flex flex-wrap gap-2">${tagRows}</div>
                <div class="flex flex-wrap gap-2 items-center">
                    <select id="tag-picker" class="inp !w-auto min-w-[11rem]">${TAGS.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}</select>
                    <button type="button" class="btn btn-dark" data-act="tag-add"><i data-lucide="plus" class="w-4 h-4"></i> Add tag</button>
                </div>
                <div><label class="lbl">Relative tags (auto)</label>
                    <div class="flex flex-wrap gap-2">${rel.map(n => `<span class="chip !cursor-default !bg-amber-50 !border-amber-300 !text-amber-800">${esc(n)}</span>`).join('') || '<span class="text-xs text-parchment-500 italic">Derived from your picks — e.g. Burn adds Lingering Glow, Counter adds Follow Up, All Rounder adds everything.</span>'}</div></div>
            </div>`;

            const euphOn = !!getPath(p + '.hasEuphoria');
            const paths = getPath(p + '.euphoriaPaths') || [];
            const mp = p + '.materialPlan';
            const planRows = (base, list, target, kind) => (list || []).map((r, i) => `
                <div class="flex gap-2 items-center">
                    <input data-path="${base}.${i}.mat" list="mat-list" value="${esc(r.mat || '')}" class="inp flex-1" placeholder="Material">
                    <input data-path="${base}.${i}.qty" value="${esc(r.qty || '')}" class="inp !w-24" placeholder="Qty">
                    <button type="button" class="btn btn-red" data-act="plan-del" data-target="${target}" data-kind="${kind}" data-idx="${i}"><i data-lucide="x" class="w-4 h-4"></i></button>
                </div>`).join('') || '<p class="text-xs text-parchment-500 italic">No materials listed.</p>';
            const euphPathCard = (epath, i) => {
                const ep = p + '.euphoriaPaths.' + i;
                return `<div class="border border-parchment-300 rounded-xl p-4 space-y-3 bg-parchment-100/60">
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-[11px] font-mono font-bold uppercase tracking-widest text-parchment-600">Euphoria Path ${i + 1}</span>
                        <button type="button" class="btn btn-red !py-1 !px-2" data-act="euph-del" data-idx="${i}"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                    </div>
                    ${grid(
                        fSelect('Type (E1/E2)', ep + '.type', EUPH_TYPES) +
                        fSelect('Tier', ep + '.tier', TIERS, { blank: '— inherit base tier —' }) +
                        fSelect('Suffix', ep + '.suffix', ['', ...SUFFIXES]) +
                        fSelect('Euphoria Tag', ep + '.tag', TAGS, { blank:'— choose a tag —' }) +
                        fInput('Euphoria Name', ep + '.name', { ph:'e.g. Verdant Reverie' }) +
                        fInput('Release Date (CN)', ep + '.releaseDate', { ph:'YYYY-MM-DD' }) +
                        fInput('Image (URL)', ep + '.image', { wide:true, ph:'https://…' }) +
                        (epath.image ? `<div class="sm:col-span-2"><img src="${esc(epath.image)}" alt="" class="h-16 rounded-lg border border-parchment-300 bg-parchment-100 object-contain" onerror="this.style.display='none'"></div>` : '')
                    )}
                    ${grid(fArea('Rank 1', ep + '.rank1', { rows:2 }) + fArea('Rank 2', ep + '.rank2', { rows:2 }) + fArea('Rank 3', ep + '.rank3', { rows:2 }) + fArea('Rank 4', ep + '.rank4', { rows:2 }))}
                    <div class="space-y-2">
                        <span class="lbl !mb-0">Euphoria Materials</span>
                        ${planRows(ep + '.materials', getPath(ep + '.materials') || [], 'euphoria:' + i, 'list')}
                        <button type="button" class="btn btn-ghost" data-act="plan-add" data-target="euphoria:${i}" data-kind="list"><i data-lucide="plus" class="w-4 h-4"></i> Add material</button>
                    </div>
                </div>`;
            };
            const euphCard = `<div class="card p-5 space-y-3.5">${sub('Euphoria')}
                ${fCheck('Euphoria available', p + '.hasEuphoria')}
                ${euphOn ? `<div class="space-y-3">
                    ${paths.length ? paths.map(euphPathCard).join('') : '<p class="text-xs text-parchment-500 italic">No euphoria paths yet — add E1 or E2.</p>'}
                    <button type="button" class="btn btn-ghost" data-act="euph-add"><i data-lucide="plus" class="w-4 h-4"></i> Add Euphoria Path (E1/E2)</button>
                    <p class="text-[11px] text-parchment-600">Some characters have both E1 and E2 with different roles/suffixes. The public guide shows all added paths.</p>
                </div>` : `<div class="p-3.5 rounded-xl bg-parchment-100 border border-parchment-300 text-xs text-parchment-600">Euphoria is <b>off</b> — the public site shows <span class="font-mono text-parchment-800">"no euphoria. stay tuned."</span> for this character.</div>`}
            </div>`;

            const bound = getPath(p + '.bound') || [];
            const boundRows = bound.map((b, i) => {
                const bp = p + '.bound.' + i;
                const ampOpts = (TAGS.includes(b.tagAmp) || !b.tagAmp ? TAGS : [b.tagAmp, ...TAGS])
                    .map(t => `<option value="${esc(t)}" ${b.tagAmp === t ? 'selected' : ''}>${esc(t)}</option>`).join('');
                return `<div class="flex gap-2 items-end">
                    <div class="flex-1 min-w-0"><label class="lbl">Character</label>
                        <select data-path="${bp}.id" class="inp"><option value="">— choose —</option>
                            ${arr.map((cc, ci) => ci === sel.characters ? '' : `<option value="${esc(cc.id)}" ${b.id === cc.id ? 'selected' : ''}>${esc(cc.name)}</option>`).join('')}
                        </select></div>
                    <div class="flex-1 min-w-0"><label class="lbl">Tag Amp</label>
                        <select data-path="${bp}.tagAmp" class="inp"><option value="">— choose —</option>${ampOpts}</select></div>
                    <button type="button" class="btn btn-red" data-act="bound-del" data-idx="${i}"><i data-lucide="x" class="w-4 h-4"></i></button>
                </div>`;
            }).join('') || '<p class="text-xs text-parchment-500 italic">No bound units — add up to 3 partners this unit relies on.</p>';
            const boundCard = `<div class="card p-5 space-y-3.5">${sub('Bound')}
                ${boundRows}
                ${bound.length < 3 ? `<button type="button" class="btn btn-ghost" data-act="bound-add"><i data-lucide="plus" class="w-4 h-4"></i> Add bound unit (${bound.length}/3)</button>` : '<p class="text-[11px] text-parchment-500 italic">Maximum 3 bound units.</p>'}
            </div>`;

            const resBlock = (label, target) => `<div class="p-3.5 rounded-xl bg-parchment-100 border border-parchment-300 space-y-2.5">
                <div class="flex items-center justify-between gap-3">
                    <span class="lbl !mb-0">${label}</span>
                    <label class="flex items-center gap-2 text-[11px] font-semibold text-parchment-700">Sharpodonty
                        <input data-path="${mp}.${target}.sharpodonty" value="${esc(getPath(mp + '.' + target + '.sharpodonty') || '')}" class="inp !w-28" placeholder="0"></label>
                </div>
                ${planRows(mp + '.' + target + '.mats', getPath(mp + '.' + target + '.mats') || [], target, 'group')}
                <button type="button" class="btn btn-ghost" data-act="plan-add" data-target="${target}" data-kind="group"><i data-lucide="plus" class="w-4 h-4"></i> Add material</button>
            </div>`;
            const planCard = `<div class="card p-5 space-y-4">${sub('Material Plan')}
                <div>${sub('Currency')}
                    <div class="grid sm:grid-cols-2 gap-4">
                        ${fInput('Dust', mp + '.currency.dust', { ph:'0' })}
                        ${fInput('Sharpodonty', mp + '.currency.sharpodonty', { ph:'0' })}
                    </div></div>
                <div>${sub('Insight Materials')}
                    ${planRows(mp + '.insights', getPath(mp + '.insights') || [], 'insights', 'list')}
                    <button type="button" class="btn btn-ghost mt-2" data-act="plan-add" data-target="insights" data-kind="list"><i data-lucide="plus" class="w-4 h-4"></i> Add material</button></div>
                ${resBlock('Resonance L5', 'resL5')}
                ${resBlock('Resonance L10', 'resL10')}
                ${resBlock('Resonance L15', 'resL15')}
                ${resBlock('Resonance Pattern', 'resPattern')}
            </div>`;

            return `<div class="space-y-5">${infoCard}${tagsCard}${euphCard}${boundCard}${planCard}</div>`;
        }
    },

    materials: {
        label:'Materials', icon:'package', sub:'Master Material List', title:'Materials Database',
        controls(){
            return `<button class="btn btn-dark" data-act="add-material"><i data-lucide="plus" class="w-4 h-4"></i> New Material</button>
                <button class="btn btn-red" data-act="del-material"><i data-lucide="trash-2" class="w-4 h-4"></i></button>`;
        },
        list(){
            const arr = DOC.materialsList || [];
            const q = Q.trim().toLowerCase();
            return arr.map((m, i) => ({ name: matName(m), i }))
                .filter(({ name }) => !q || name.toLowerCase().includes(q))
                .map(({ name, i }) => `<button class="list-item ${i === sel.materials ? 'on' : ''}" data-act="sel-material" data-idx="${i}">
                    <span class="font-bold">${esc(name || '(unnamed)')}</span></button>`).join('') || '<p class="text-xs text-parchment-500 italic p-2">No materials yet — click New.</p>';
        },
        form(){
            clampSel();
            const arr = DOC.materialsList || [];
            if (!arr.length) return '<div class="card p-6 text-sm text-parchment-600">No materials yet — click <b>New Material</b>. You will be asked for the name, a picture and the area where it drops the most. Every Material dropdown in <b>Characters → Material Plan</b> pulls from this list.</div>';
            let m = arr[sel.materials];
            if (typeof m === 'string'){ arr[sel.materials] = { name: m, image:'', area:'' }; m = arr[sel.materials]; markDirty(); }
            const p = 'materialsList.' + sel.materials;
            const img = m.image || '';
            return `<div class="card p-5 space-y-4">${grid(
                fInput('Material name', p + '.name', { wide:true, ph:'e.g. Fine Fireworks' }) +
                fInput('Picture (image URL)', p + '.image', { wide:true, ph:'https://…' }) +
                (img ? `<div class="sm:col-span-2"><img src="${esc(img)}" alt="" class="h-24 rounded-xl border border-parchment-300 bg-parchment-100 object-contain" onerror="this.style.display='none'"></div>` : '') +
                fArea('Where to get it the most', p + '.area', { rows:2, ph:'e.g. A Heavy Blow — Stage 3 (best drop rate)' }) +
                `<div class="sm:col-span-2 text-[11px] text-parchment-600">Used by the Material Plan inputs in <b>Characters → Material Plan</b> (type-ahead suggests the name). Keep names unique for clean suggestions.</div>`
            )}</div>`;
        }
    },

    psychubes: {
        label:'Psychubes', icon:'disc-3', sub:'Psychube Catalog', title:'Psychube Database',
        controls(){
            return `<button class="btn btn-dark" data-act="add-psy"><i data-lucide="plus" class="w-4 h-4"></i> New Psychube</button>
                <button class="btn btn-ghost" data-act="dup-psy"><i data-lucide="copy" class="w-4 h-4"></i> Duplicate</button>
                <button class="btn btn-red" data-act="del-psy"><i data-lucide="trash-2" class="w-4 h-4"></i></button>`;
        },
        list(){
            const arr = DOC.psychubes || [];
            return arr.map((y, i) => `<button class="list-item ${i === sel.psychubes ? 'on' : ''}" data-act="sel-psy" data-idx="${i}">
                <div class="flex items-center justify-between gap-2"><span class="font-bold truncate">${esc(y.name)}</span><span class="chip !py-0.5 !text-[10px] !cursor-default">${esc(String(y.rarity || ''))}★</span></div>
                <div class="sub text-[11px] opacity-80 mt-0.5 truncate">${esc(y.label || '')}</div>
            </button>`).join('') || '<p class="text-xs text-parchment-500 italic p-2">No psychubes yet.</p>';
        },
        form(){
            clampSel();
            const arr = DOC.psychubes || [];
            if (!arr.length) return '<div class="card p-6 text-sm text-parchment-600">No psychubes yet — click <b>New Psychube</b>. Character <b>Psychube (main/alt)</b> dropdowns pull from this list.</div>';
            const p = 'psychubes.' + sel.psychubes;
            const img = arr[sel.psychubes].image || '';
            return `<div class="card p-5 space-y-4">${grid(
                fInput('Name', p + '.name', { wide:true, ph:'e.g. Refracted Prism' }) +
                fSelect('Rarity', p + '.rarity', ['6','5','4','3','2']) +
                fInput('Label / Role', p + '.label', { ph:'e.g. ATK DPS' }) +
                fInput('Image (URL)', p + '.image', { wide:true, ph:'https://…' }) +
                (img ? `<div class="sm:col-span-2"><img src="${esc(img)}" alt="" class="h-20 rounded-xl border border-parchment-300 bg-parchment-100 object-contain" onerror="this.style.display='none'"></div>` : '')
            )}
            <div class="border-t border-parchment-200 pt-3">
                <span class="lbl !mb-2">Level 1 / Max Stats</span>
                ${grid(
                    fInput('ATK (1)', p + '.atk1', { ph:'54' }) + fInput('ATK (Max)', p + '.atkMax', { ph:'360' }) +
                    fInput('HP (1)', p + '.hp1', { ph:'450' }) + fInput('HP (Max)', p + '.hpMax', { ph:'3000' }) +
                    fInput('Real DEF (1)', p + '.rdef1', { ph:'24' }) + fInput('Real DEF (Max)', p + '.rdefMax', { ph:'160' }) +
                    fInput('Mental DEF (1)', p + '.mdef1', { ph:'24' }) + fInput('Mental DEF (Max)', p + '.mdefMax', { ph:'160' }) +
                    fInput('Sub Stat', p + '.statName', { ph:'e.g. ATK' }) +
                    fInput('Sub Stat (1)', p + '.stat1', { ph:'4%' }) + fInput('Sub Stat (Max)', p + '.statMax', { ph:'10%' })
                )}
            </div>
            <div class="border-t border-parchment-200 pt-3 space-y-3">
                <span class="lbl !mb-0">Amplification (Amp 1–5)</span>
                ${[1,2,3,4,5].map(n => fArea('Amp ' + n, p + '.amp' + n, { rows:2 })).join('')}
            </div>
            </div>`;
        }
    },

    teams: {
        label:'Team Tierlists', icon:'crown', sub:'Meta Team Rankings', title:'Team Tierlist Data',
        controls(){
            return `<button class="btn btn-dark" data-act="add-team"><i data-lucide="plus" class="w-4 h-4"></i> New Team</button>
                <button class="btn btn-ghost" data-act="dup-team"><i data-lucide="copy" class="w-4 h-4"></i> Duplicate</button>
                <button class="btn btn-red" data-act="del-team"><i data-lucide="trash-2" class="w-4 h-4"></i></button>`;
        },
        list(){
            const arr = DOC.teamTierData || [];
            return arr.map((t, i) => `<button class="list-item ${i === sel.teams ? 'on' : ''}" data-act="sel-team" data-idx="${i}">
                <div class="flex items-center justify-between gap-2"><span class="font-bold truncate">${esc(t.name)}</span>${badgeTier(t.tier)}</div>
                <div class="sub text-[11px] opacity-80 mt-0.5">${esc(t.archetype)} · ${(t.members || []).length} units</div>
            </button>`).join('') || '<p class="text-xs text-parchment-500 italic p-2">No teams yet.</p>';
        },
        form(){
            clampSel();
            const arr = DOC.teamTierData || [];
            if (!arr.length) return '<div class="card p-6 text-sm text-parchment-600">No teams yet.</div>';
            const p = 'teamTierData.' + sel.teams;
            const manifests = (DOC.mythManifests || []).map(m => m.name);
            return `<div class="card p-5 space-y-4">${grid(
                fInput('Team Name', p + '.name', { wide:true }) +
                fSelect('Tier', p + '.tier', TIERS) +
                fSelect('Archetype', p + '.archetype', ARCHETYPES) +
                fSelect('Myth Manifest', p + '.manifest', manifests, { blank:'— none —' }) +
                fInput('Mode Rating Line', p + '.modeRating', { wide:true, ph:"Hadal Reveries: 10/10 • Mane's SSS+: 10/10" }) +
                fArea('Members (one per line, in slot order)', p + '.members', { kind:'lines', rows:4 }) +
                fArea('Rotation Explanation', p + '.rotation', { rows:5 })
            )}</div>`;
        }
    },

    banners: {
        label:'Pull Banners', icon:'sparkles', sub:'Banner Verdicts', title:'Pull Guide Banners',
        controls(){
            return `<button class="btn btn-dark" data-act="add-banner"><i data-lucide="plus" class="w-4 h-4"></i> New Banner</button>
                <button class="btn btn-ghost" data-act="dup-banner"><i data-lucide="copy" class="w-4 h-4"></i> Duplicate</button>
                <button class="btn btn-red" data-act="del-banner"><i data-lucide="trash-2" class="w-4 h-4"></i></button>`;
        },
        list(){
            const arr = DOC.pullBanners || [];
            return arr.map((b, i) => `<button class="list-item ${i === sel.banners ? 'on' : ''}" data-act="sel-banner" data-idx="${i}">
                <div class="font-bold truncate">${esc(b.patch)}</div>
                <div class="sub text-[11px] opacity-80 mt-0.5 truncate">${esc(b.title)}</div></button>`).join('') || '<p class="text-xs text-parchment-500 italic p-2">No banners yet.</p>';
        },
        form(){
            clampSel();
            const arr = DOC.pullBanners || [];
            if (!arr.length) return '<div class="card p-6 text-sm text-parchment-600">No banners yet.</div>';
            const p = 'pullBanners.' + sel.banners;
            return `<div class="card p-5 space-y-4">${grid(
                fInput('Patch / Banner Group', p + '.patch', { wide:true }) +
                fInput('Title (units shown)', p + '.title', { wide:true }) +
                fInput('Rating Line', p + '.rating', { wide:true }) +
                fSelect('Rating Colour Class', p + '.ratingColor', BANNER_COLORS) +
                fInput('Unit Focus', p + '.unitFocus', { wide:true }) +
                fArea('Verdict', p + '.verdict', { rows:4 })
            )}</div>`;
        }
    },

    walkthrough: {
        label:'Walkthroughs', icon:'map', sub:'Gamemode Guides', title:'Gamemode Walkthrough',
        controls(){
            const modes = [['reveries','Reveries'],["manes","Mane's Bulletin"],['dusk','A Series of Dusks'],['limbo','Lucidscape']];
            return modes.map(([k, l]) => `<button class="chip mode-tab ${wfMode === k ? 'on' : ''}" data-act="wf-mode" data-mode="${k}">${l}</button>`).join('') +
                `<button class="btn btn-dark" data-act="add-wfboss"><i data-lucide="plus" class="w-4 h-4"></i> Boss</button>
                 <button class="btn btn-red" data-act="del-wfboss"><i data-lucide="trash-2" class="w-4 h-4"></i></button>`;
        },
        list(){
            const w = (DOC.walkthroughData || {})[wfMode];
            const bosses = (w && w.bosses) || [];
            return bosses.map((b, i) => `<button class="list-item ${i === sel.wfboss ? 'on' : ''}" data-act="sel-wfboss" data-idx="${i}">
                <div class="font-bold truncate">${esc(b.boss)}</div>
                <div class="sub text-[11px] opacity-80 mt-0.5 truncate">${esc(b.stage)}</div></button>`).join('')
                || '<p class="text-xs text-parchment-500 italic p-2">No bosses for this mode.</p>';
        },
        form(){
            clampSel();
            const w = (DOC.walkthroughData || {})[wfMode];
            if (!w) return '<div class="card p-6 text-sm text-parchment-600">Walkthrough data missing from file.</div>';
            const base = 'walkthroughData.' + wfMode;
            const bosses = w.bosses || [];
            const bp = base + '.bosses.' + sel.wfboss;
            const bossForm = bosses.length ? `<div class="card p-5 space-y-4 mt-5">
                <p class="text-[11px] font-mono font-bold uppercase tracking-widest text-parchment-600">Boss Entry ${sel.wfboss + 1} of ${bosses.length}</p>
                ${grid(
                    fInput('Stage / Node', bp + '.stage') +
                    fInput('Boss Name', bp + '.boss') +
                    fInput('Recommended Team', bp + '.recommended', { wide:true }) +
                    fArea('Mechanic / Strategy', bp + '.mechanic', { rows:4 })
                )}</div>` : '';
            return `<div class="card p-5 space-y-4">${grid(
                fInput('Mode Title', base + '.title', { wide:true }) +
                fInput('Reward Line', base + '.reward', { wide:true }) +
                fArea('Tips (one per line)', base + '.tips', { kind:'lines', rows:5 })
            )}</div>${bossForm}`;
        }
    },

    home: {
        label:'Home Spotlight', icon:'house', sub:'Patch Spotlight Cards', title:'Home Section Curation',
        controls(){ return ''; },
        list(){ return null; },
        form(){
            const chars = DOC.characters || [];
            const chips = (path) => {
                const arr = getPath(path) || [];
                return chars.map(c => `<button class="chip ${arr.includes(c.id) ? 'on' : ''}" data-chip="${esc(c.id)}" data-chippath="${path}">${esc(c.name)}</button>`).join('');
            };
            const bossArr = DOC.homeManesBulletinBosses || [];
            const bossIdx = Math.min(sel.bosses, Math.max(0, bossArr.length - 1));
            sel.bosses = bossIdx;
            const boss = bossArr[bossIdx];
            const bossForm = boss ? `<div class="card p-5 space-y-4 mt-5">
                <div class="flex items-center justify-between gap-2 border-b border-parchment-200 pb-3">
                    <p class="text-[11px] font-mono font-bold uppercase tracking-widest text-parchment-600">Mane's Bulletin Boss ${bossIdx + 1} of ${bossArr.length}</p>
                    <div class="flex gap-2">
                        <button class="btn btn-dark" data-act="add-boss"><i data-lucide="plus" class="w-3.5 h-3.5"></i> New</button>
                        <button class="btn btn-ghost" data-act="sel-boss" data-idx="${bossIdx - 1}" ${bossIdx === 0 ? 'disabled' : ''}><i data-lucide="chevron-left" class="w-4 h-4"></i></button>
                        <button class="btn btn-ghost" data-act="sel-boss" data-idx="${bossIdx + 1}" ${bossIdx === bossArr.length - 1 ? 'disabled' : ''}><i data-lucide="chevron-right" class="w-4 h-4"></i></button>
                        <button class="btn btn-red" data-act="del-boss"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
                    </div>
                </div>
                ${grid(
                    fInput('Raid Code Line', 'homeManesBulletinBosses.' + bossIdx + '.code') +
                    fInput('Boss Name', 'homeManesBulletinBosses.' + bossIdx + '.name') +
                    fInput('Favoured Engine', 'homeManesBulletinBosses.' + bossIdx + '.favoredEngine', { wide:true }) +
                    fArea('Weakness', 'homeManesBulletinBosses.' + bossIdx + '.weakness', { rows:2 }) +
                    fArea('Danger Mechanic', 'homeManesBulletinBosses.' + bossIdx + '.dangerMechanic', { rows:2 }) +
                    `<div class="sm:col-span-2 border-t border-parchment-200 pt-3">
                        <label class="lbl">Recommended Units (click to toggle)</label>
                        <div class="flex flex-wrap gap-1.5">${chips('homeManesBulletinBosses.' + bossIdx + '.recommendedIds')}</div></div>`
                )}</div>` : `<div class="card p-5 mt-5 text-sm text-parchment-600">No Mane's Bulletin bosses defined. <button class="btn btn-dark mt-2" data-act="add-boss"><i data-lucide="plus" class="w-4 h-4"></i> Create one</button></div>`;

            return `<div class="card p-5 space-y-4">
                <div class="border-b border-parchment-200 pb-3">
                    <p class="text-[11px] font-mono font-bold uppercase tracking-widest text-parchment-600">Newly Added Arcanists</p>
                    <p class="text-xs text-parchment-700 mt-1 mb-2">Cards shown in the "Newly Added Arcanists" grid.</p>
                    <div class="flex flex-wrap gap-1.5">${chips('homePatchNewCharIds')}</div>
                </div>
                <div>
                    <p class="text-[11px] font-mono font-bold uppercase tracking-widest text-amber-800">New Euphoria (Epiphany) Awakenings</p>
                    <p class="text-xs text-parchment-700 mt-1 mb-2">Units shown in the Euphoria spotlight grid.</p>
                    <div class="flex flex-wrap gap-1.5">${chips('homePatchEuphoriaIds')}</div>
                </div>
            </div>${bossForm}`;
        }
    },

    manifests: {
        label:'Myth Manifests', icon:'orbit', sub:'Reveries Companions', title:'Myth Manifests',
        controls(){
            return `<button class="btn btn-dark" data-act="add-manifest"><i data-lucide="plus" class="w-4 h-4"></i> New</button>
                <button class="btn btn-ghost" data-act="dup-manifest"><i data-lucide="copy" class="w-4 h-4"></i> Duplicate</button>
                <button class="btn btn-red" data-act="del-manifest"><i data-lucide="trash-2" class="w-4 h-4"></i></button>`;
        },
        list(){
            const arr = DOC.mythManifests || [];
            return arr.map((m, i) => `<button class="list-item ${i === sel.manifests ? 'on' : ''}" data-act="sel-manifest" data-idx="${i}">
                <div class="font-bold">${esc(m.name)}</div>
                <div class="sub text-[11px] opacity-80 mt-0.5">${esc(m.element)}</div></button>`).join('') || '<p class="text-xs text-parchment-500 italic p-2">None yet.</p>';
        },
        form(){
            clampSel();
            const arr = DOC.mythManifests || [];
            if (!arr.length) return '<div class="card p-6 text-sm text-parchment-600">No manifests yet.</div>';
            const p = 'mythManifests.' + sel.manifests;
            return `<div class="card p-5 space-y-4">${grid(
                fInput('Name', p + '.name') +
                fInput('ID', p + '.id') +
                fInput('Element / Tags', p + '.element', { wide:true, ph:'Beast / Burn / Glow' }) +
                fArea('Bonus Description', p + '.bonus', { rows:4 })
            )}</div>`;
        }
    },

    nodes: {
        label:'Farming Nodes', icon:'package', sub:'Material Farming', title:'Farming Nodes',
        controls(){
            return `<button class="btn btn-dark" data-act="add-node"><i data-lucide="plus" class="w-4 h-4"></i> New</button>
                <button class="btn btn-ghost" data-act="dup-node"><i data-lucide="copy" class="w-4 h-4"></i> Duplicate</button>
                <button class="btn btn-red" data-act="del-node"><i data-lucide="trash-2" class="w-4 h-4"></i></button>`;
        },
        list(){
            const arr = DOC.materialNodes || [];
            return arr.map((n, i) => `<button class="list-item ${i === sel.nodes ? 'on' : ''}" data-act="sel-node" data-idx="${i}">
                <div class="font-bold">${esc(n.name)}</div>
                <div class="sub text-[11px] opacity-80 mt-0.5">${esc(n.stage)}</div></button>`).join('') || '<p class="text-xs text-parchment-500 italic p-2">None yet.</p>';
        },
        form(){
            clampSel();
            const arr = DOC.materialNodes || [];
            if (!arr.length) return '<div class="card p-6 text-sm text-parchment-600">No nodes yet.</div>';
            const p = 'materialNodes.' + sel.nodes;
            return `<div class="card p-5 space-y-4">${grid(
                fInput('Material Name', p + '.name') +
                fInput('Tier', p + '.tier', { ph:'Purple (T4)' }) +
                fInput('Stage', p + '.stage', { ph:'Ch. 4-21 Hard' }) +
                fInput('Rate / Yield', p + '.rate') +
                fInput('Usage', p + '.usage', { wide:true })
            )}</div>`;
        }
    },

    text: {
        label:'Page Text', icon:'type', sub:'Static Headlines', title:'Editable Page Text',
        controls(){ return ''; },
        list(){ return null; },
        form(){
            const block = (label, key, ph) => {
                const seg = PT[key];
                if (!seg || !seg.ok) return `<div class="sm:col-span-2"><label class="lbl">${esc(label)}</label>
                    <textarea class="inp" rows="3" disabled placeholder="Element not found in file"></textarea></div>`;
                if (key === 'title' || key === 'patchVersion') return `<div class="sm:col-span-2"><label class="lbl">${esc(label)}</label>
                    <input data-page="${key}" value="${esc(PAGE[key] || '')}" class="inp" placeholder="${esc(ph || '')}"></div>`;
                const rows = key === 'heroQuote' ? 4 : 3;
                return `<div class="sm:col-span-2"><label class="lbl">${esc(label)} ${key === 'heroHeading' ? '(HTML allowed)' : ''}</label>
                    <textarea data-page="${key}" rows="${rows}" class="inp">${esc(PAGE[key] || '')}</textarea></div>`;
            };
            return `<div class="card p-5 space-y-4">${grid(
                block('Document <title>', 'title') +
                block('Hero Heading (HTML)', 'heroHeading') +
                block('Hero Welcome Quote', 'heroQuote') +
                block('Tierlist Patch Version', 'patchVersion', 'e.g. 4.0')
            )}
            <p class="text-xs text-parchment-600 italic border-t border-parchment-200 pt-3">Changes to these fields are written back into the HTML markup on save. Other headings and labels are also plain HTML — use the Raw JSON / a text editor for those.</p>
            </div>`;
        }
    },

    raw: {
        label:'Raw JSON', icon:'code-2', sub:'Advanced', title:'Raw Data Blocks',
        controls(){ return ''; },
        list(){ return null; },
        form(){
            const opts = VARS.filter(k => DOC[k] !== undefined);
            const cur = window._rawKey && opts.includes(window._rawKey) ? window._rawKey : opts[0];
            window._rawKey = cur;
            if (!cur) return '<div class="card p-6 text-sm text-parchment-600">No data blocks loaded.</div>';
            let text = '', err = '';
            try { text = JSON.stringify(DOC[cur], null, 2); } catch (e){ err = String(e); }
            return `<div class="card p-5 space-y-4">
                <div class="flex flex-wrap items-end gap-3">
                    <div><label class="lbl">Data block</label>
                        <select class="inp !w-64" data-act="raw-select">
                            ${opts.map(o => `<option value="${o}" ${o === cur ? 'selected' : ''}>const ${o}</option>`).join('')}
                        </select></div>
                    <button class="btn btn-dark" data-act="raw-apply"><i data-lucide="check" class="w-4 h-4"></i> Apply JSON</button>
                    <button class="btn btn-ghost" data-act="raw-reset"><i data-lucide="rotate-ccw" class="w-4 h-4"></i> Reset Text</button>
                </div>
                ${err ? `<p class="text-xs text-red-700">${esc(err)}</p>` : ''}
                <textarea id="raw-text" class="inp font-mono !text-[12px]" rows="26">${esc(text)}</textarea>
            </div>`;
        }
    }
};

/* ============================================================
   RENDER
   ============================================================ */
const ORDER = ['characters','psychubes','materials','teams','banners','walkthrough','home','manifests','nodes','text','raw'];

function renderNav(){
    $('#nav').innerHTML = ORDER.map(k => {
        const S = SECTIONS[k];
        return `<button class="nav-btn ${SECTION === k ? 'on' : ''}" data-sec="${k}">
            <i data-lucide="${S.icon}" class="w-4 h-4 shrink-0"></i><span>${S.label}</span></button>`;
    }).join('');
}
function render(){
    clampSel();
    renderNav();
    const S = SECTIONS[SECTION];
    const hasList = !!S.list();
    const scroll = (() => { const el = document.getElementById('list-pane'); return el ? el.scrollTop : 0; })();
    $('#content').innerHTML = `<div class="fade-in">
        ${sectionHead(S.title, S.sub, S.controls())}
        <div class="grid gap-5 ${hasList ? 'lg:grid-cols-[minmax(200px,240px)_1fr]' : ''}">
            ${hasList ? `<div id="list-pane" class="card p-2 space-y-1 self-start max-h-[70vh] overflow-y-auto">${S.list()}</div>` : ''}
            <div id="form-pane">${S.form()}</div>
        </div></div>`;
    const lp = document.getElementById('list-pane');
    if (lp) lp.scrollTop = scroll;
    const dl = document.getElementById('mat-list');
    if (dl) dl.innerHTML = ((DOC && DOC.materialsList) || []).map(m => `<option value="${esc(matName(m))}">`).join('');
    lucide.createIcons();
}
function refreshList(){
    const S = SECTIONS[SECTION];
    if (!S.list) return;
    const lp = document.getElementById('list-pane');
    if (!lp) return;
    const st = lp.scrollTop;
    lp.innerHTML = S.list();
    lp.scrollTop = st;
}

/* ============================================================
   DEFAULT OBJECTS
   ============================================================ */
function slugify(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '').replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '') || 'item'; }
function uniqueId(base, arr, key){
    const used = new Set(arr.map(x => x[key]));
    let id = base, n = 2;
    while (used.has(id)) id = base + n++;
    return id;
}
function newCharacter(){
    const arr = DOC.characters || [];
    const name = 'New Arcanist';
    return {
        id: uniqueId(slugify(name), arr, 'id'),
        name, rarity: 6, afflatus: 'Star', dmgType: 'Mental',
        image: '', tier: 'T1', releaseDate: '',
        suffix: [], psychube: '', altPsychube: '',
        tags: [], hasEuphoria: false,
        euphoria: { image:'', name:'', tag:'', suffix:'', releaseDate:'', rank1:'', rank2:'', rank3:'', rank4:'' },
        bound: [],
        materialPlan: {
            currency: { dust:'', sharpodonty:'' },
            insights: [],
            resL5: { sharpodonty:'', mats:[] },
            resL10: { sharpodonty:'', mats:[] },
            resL15: { sharpodonty:'', mats:[] },
            resPattern: { sharpodonty:'', mats:[] }
        }
    };
}
function ensureCharShape(c){
    const d = {
        dmgType:'', image:'', releaseDate:'', suffix:[], tags:[], bound:[], hasEuphoria:false,
        euphoriaPaths:[], psychube:'', altPsychube:'',
        materialPlan:{
            currency:{ dust:'', sharpodonty:'' }, insights:[],
            resL5:{ sharpodonty:'', mats:[] }, resL10:{ sharpodonty:'', mats:[] },
            resL15:{ sharpodonty:'', mats:[] }, resPattern:{ sharpodonty:'', mats:[] }
        }
    };
    for (const k in d){
        if (c[k] === undefined || c[k] === null) c[k] = d[k];
        else if (d[k] && typeof d[k] === 'object' && !Array.isArray(d[k]) && typeof c[k] === 'object' && !Array.isArray(c[k])){
            for (const kk in d[k]) if (c[k][kk] === undefined || c[k][kk] === null) c[k][kk] = d[k][kk];
        }
    }
    ['suffix','tags','bound'].forEach(k => { if (!Array.isArray(c[k])) c[k] = []; });
    if (!Array.isArray(c.euphoriaPaths)) c.euphoriaPaths = [];
    // migrate legacy materialPlan.euphoriaMats onto the first euphoria path
    if (c.materialPlan && Array.isArray(c.materialPlan.euphoriaMats)) {
        if (c.materialPlan.euphoriaMats.length) {
            if (!c.euphoriaPaths.length) c.euphoriaPaths = [{ type:'E1', tag:'E1', materials: c.materialPlan.euphoriaMats }];
            else if (!Array.isArray(c.euphoriaPaths[0].materials)) c.euphoriaPaths[0].materials = c.materialPlan.euphoriaMats;
        }
        delete c.materialPlan.euphoriaMats;
    }
    if (c.euphoriaPaths.length === 0 && c.euphoria && typeof c.euphoria === 'object') {
        if (c.euphoria.tag || c.euphoria.name || c.euphoria.rank1 || c.euphoria.rank2 || c.euphoria.rank3 || c.euphoria.rank4 || c.euphoria.releaseDate || c.euphoria.image || c.euphoria.suffix) {
            c.euphoriaPaths = [{
                type: c.euphoria.tag || 'E1',
                tag: c.euphoria.tag || 'E1',
                name: c.euphoria.name || '',
                suffix: c.euphoria.suffix || '',
                releaseDate: c.euphoria.releaseDate || '',
                image: c.euphoria.image || '',
                rank1: c.euphoria.rank1 || '',
                rank2: c.euphoria.rank2 || '',
                rank3: c.euphoria.rank3 || '',
                rank4: c.euphoria.rank4 || '',
                materials: []
            }];
        }
    }
    if (!Array.isArray(c.euphoriaPaths)) c.euphoriaPaths = [];
    var paths = c.euphoriaPaths.map(function(p){
        var np = { type:'E1', tag:'E1', tier:'', name:'', suffix:'', releaseDate:'', image:'', rank1:'', rank2:'', rank3:'', rank4:'', materials:[] };
        if(p && typeof p === 'object'){
            for(var k in p){ if(Object.prototype.hasOwnProperty.call(p,k)) np[k] = p[k]; }
        }
        if(!np.type) np.type = 'E1';
        if (np.tag == null) np.tag = '';
        if (np.tag === np.type && ['E1','E2'].indexOf(np.tag) !== -1) np.tag = '';
        if (np.tier == null) np.tier = '';
        if (!Array.isArray(np.materials)) np.materials = [];
        return np;
    });
    c.euphoriaPaths = paths;
    if(c.hasEuphoria == null) c.hasEuphoria = c.euphoriaPaths.length > 0;
    return c;
}
function clone(o){ return JSON.parse(JSON.stringify(o)); }

/* ============================================================
   EVENTS
   ============================================================ */
document.addEventListener('input', e => {
    const el = e.target;
    if (!DOC || !el.dataset) return;
    if (el.dataset.search !== undefined){ Q = el.value; refreshList(); return; }
    if (el.dataset.page){
        PAGE[el.dataset.page] = el.value;
        markDirty();
        return;
    }
    if (el.dataset.path){
        let v = el.value;
        if (el.dataset.num !== undefined && v !== '') v = isNaN(Number(v)) ? v : Number(v);
        setPath(el.dataset.path, v);
        if (typeof el.dataset.path === 'string' && el.dataset.path.includes('euphoriaPaths') && el.dataset.path.endsWith('.type')){
            const pp = el.dataset.path.replace(/\.type$/, '');
            const path = getPath(pp);
            if (path && !path.tag) setPath(pp + '.tag', v);
        }
        markDirty();
    }
});
document.addEventListener('change', e => {
    let el = e.target;
    if (!DOC || !el.dataset) return;
    if (el.tagName === 'LABEL'){ const inp = el.querySelector('input,select,textarea'); if (inp && inp.dataset && inp.dataset.path){ el = inp; } }
    if (el.closest){ const cand = el.closest('[data-path]'); if (cand && cand !== el && cand.dataset && cand.dataset.path){ el = cand; } }
    if (el.dataset.act === 'raw-select'){ window._rawKey = el.value; render(); return; }
    if (el.dataset.path){
        let v = el.type === 'checkbox' ? el.checked : (el.value === '' ? '' : el.value);
        if (el.dataset.num !== undefined && v !== '') v = isNaN(Number(v)) ? v : Number(v);
        setPath(el.dataset.path, v);
        if (typeof el.dataset.path === 'string' && el.dataset.path.includes('euphoriaPaths') && el.dataset.path.endsWith('.type')){
            const pp = el.dataset.path.replace(/\.type$/, '');
            const path = getPath(pp);
            if (path && !path.tag) setPath(pp + '.tag', v);
            markDirty(); render();
            return;
        }
        const bm = typeof el.dataset.path === 'string' && el.dataset.path.match(/^characters\.([^.]+)\.bound\.(\d+)\.(id|tagAmp)$/);
        if (bm) mirrorBounds(bm[1]);
        markDirty(); render();
    }
});

document.addEventListener('click', async e => {
    const chip = e.target.closest('[data-chip]');
    if (chip && DOC){
        const arr = getPath(chip.dataset.chippath);
        const id = chip.dataset.chip;
        const i = arr.indexOf(id);
        if (i >= 0) arr.splice(i, 1); else arr.push(id);
        chip.classList.toggle('on', i < 0);
        markDirty();
        refreshList();
        return;
    }
    const secBtn = e.target.closest('[data-sec]');
    if (secBtn){ SECTION = secBtn.dataset.sec; Q = ''; render(); return; }

    const b = e.target.closest('[data-act]');
    if (!b || !DOC) return;
    const act = b.dataset.act;
    const idx = b.dataset.idx !== undefined ? Number(b.dataset.idx) : null;
    const arrOf = { 'characters':'characters','teams':'teamTierData','banners':'pullBanners','manifests':'mythManifests','nodes':'materialNodes' };
    const selKeyOf = { 'characters':'characters','teams':'teams','banners':'banners','manifests':'manifests','nodes':'nodes' };

    switch (true){
        case act === 'sel-char': sel.characters = idx; render(); break;
        case act === 'sel-team': sel.teams = idx; render(); break;
        case act === 'sel-banner': sel.banners = idx; render(); break;
        case act === 'sel-manifest': sel.manifests = idx; render(); break;
        case act === 'sel-node': sel.nodes = idx; render(); break;
        case act === 'sel-boss': if (idx >= 0 && idx < (DOC.homeManesBulletinBosses || []).length){ sel.bosses = idx; render(); } break;
        case act === 'sel-wfboss': sel.wfboss = idx; render(); break;
        case act === 'wf-mode': wfMode = b.dataset.mode; sel.wfboss = 0; render(); break;
        case act === 'sel-material': sel.materials = idx; render(); break;

        case act === 'add-material': {
            const arr = DOC.materialsList = DOC.materialsList || [];
            const name = prompt('Material name:');
            if (name === null || !name.trim()) break;
            const image = prompt('Picture URL (leave blank if none):', '') || '';
            const area = prompt('Where to get it the most? (area / stage / boss — leave blank if unknown):', '') || '';
            arr.push({ name: name.trim(), image: image.trim(), area: area.trim() });
            sel.materials = arr.length - 1;
            markDirty(); render(); break;
        }
        case act === 'del-material': {
            const arr = DOC.materialsList || [];
            if (!arr.length) break;
            if (!confirm(`Delete "${matName(arr[sel.materials])}"?`)) break;
            arr.splice(sel.materials, 1); markDirty(); render(); break;
        }

        case act === 'tag-add': {
            const pick = document.getElementById('tag-picker');
            const name = pick && pick.value;
            const tags = getPath('characters.' + sel.characters + '.tags');
            if (!name || !tags) break;
            if (tags.some(t => String(t.name || '').toLowerCase() === name.toLowerCase())){ toast('Tag already added'); break; }
            tags.push({ name });
            markDirty(); render(); break;
        }
        case act === 'tag-del': {
            const tags = getPath('characters.' + sel.characters + '.tags');
            if (tags && idx !== null){ tags.splice(idx, 1); markDirty(); render(); }
            break;
        }
        case act === 'tag-star': {
            const tags = getPath('characters.' + sel.characters + '.tags');
            const t = tags && tags[idx];
            if (t){
                const n = Number(b.dataset.star);
                t.rating = (t.rating === n ? 0 : n);
                markDirty(); render();
            }
            break;
        }

        case act === 'bound-add': {
            const arr = getPath('characters.' + sel.characters + '.bound');
            if (!arr) break;
            if (arr.length >= 3){ toast('Up to 3 bound characters'); break; }
            arr.push({ id:'', tagAmp:'' });
            markDirty(); render(); break;
        }
        case act === 'bound-del': {
            const c = getPath('characters.' + sel.characters);
            const arr = c && c.bound;
            if (arr && idx !== null && idx !== undefined && idx >= 0 && idx < arr.length){
                arr.splice(idx, 1);
                if (c.id) mirrorBounds(c.id);
                markDirty(); render();
            }
            break;
        }

        case act === 'euph-add': {
            const c = getPath('characters.' + sel.characters);
            if (!c) break;
            if (!Array.isArray(c.euphoriaPaths)) c.euphoriaPaths = [];
            const nextType = c.euphoriaPaths.length ? (c.euphoriaPaths.some(x => x.type === 'E1') ? 'E2' : 'E1') : 'E1';
            const name = prompt('Euphoria name (optional):', 'Name of this Euphoria');
            if (name === null) break;
            c.euphoriaPaths.push({ type: nextType, tag: nextType, tier:'', name: name.trim(), suffix: '', releaseDate: '', image: '', rank1:'', rank2:'', rank3:'', rank4:'' });            c.hasEuphoria = true;
            markDirty(); render(); break;
        }
        case act === 'euph-del': {
            const c = getPath('characters.' + sel.characters);
            const arr = c && c.euphoriaPaths;
            if (arr && idx !== null){ arr.splice(idx, 1); if (c) c.hasEuphoria = arr.length > 0; markDirty(); render(); }
            break;
        }

        case act === 'plan-add': {
            const target = b.dataset.target, kind = b.dataset.kind;
            const base = (target && target.startsWith('euphoria:')
                ? 'characters.' + sel.characters + '.euphoriaPaths.' + target.slice('euphoria:'.length) + '.materials'
                : 'characters.' + sel.characters + '.materialPlan.' + target + (kind === 'group' ? '.mats' : ''));
            let arr = getPath(base);
            if (!Array.isArray(arr)){ setPath(base, []); arr = getPath(base); }
            arr.push({ mat:'', qty:'' });
            markDirty(); render(); break;
        }
        case act === 'plan-del': {
            const target = b.dataset.target, kind = b.dataset.kind;
            const base = (target && target.startsWith('euphoria:')
                ? 'characters.' + sel.characters + '.euphoriaPaths.' + target.slice('euphoria:'.length) + '.materials'
                : 'characters.' + sel.characters + '.materialPlan.' + target + (kind === 'group' ? '.mats' : ''));
            const arr = getPath(base);
            if (arr && idx !== null){ arr.splice(idx, 1); markDirty(); render(); }
            break;
        }

        case act === 'add-char': (DOC.characters = DOC.characters || []).push(newCharacter()); sel.characters = DOC.characters.length - 1; markDirty(); render(); break;
        case act === 'dup-char': {
            const arr = DOC.characters;
            if (!arr.length) break;
            const c = clone(arr[sel.characters]);
            c.id = uniqueId(c.id || slugify(c.name), arr, 'id');
            c.name = c.name + ' (copy)';
            arr.splice(sel.characters + 1, 0, c);
            sel.characters++;
            markDirty(); render(); break;
        }
        case act === 'del-char': {
            const arr = DOC.characters;
            if (!arr.length) break;
            if (!confirm(`Delete "${arr[sel.characters].name}"?`)) break;
            arr.splice(sel.characters, 1); markDirty(); render(); break;
        }

        case act === 'sel-psy': sel.psychubes = idx; render(); break;
        case act === 'add-psy': (DOC.psychubes = DOC.psychubes || []).push({ name:'New Psychube', rarity:'6', label:'', image:'', atk1:'', atkMax:'', hp1:'', hpMax:'', rdef1:'', rdefMax:'', mdef1:'', mdefMax:'', statName:'', stat1:'', statMax:'', amp1:'', amp2:'', amp3:'', amp4:'', amp5:'' }); sel.psychubes = DOC.psychubes.length - 1; markDirty(); render(); break;
        case act === 'dup-psy': { const arr = DOC.psychubes; if (!arr.length) break; const y = clone(arr[sel.psychubes]); y.name += ' (copy)'; arr.splice(sel.psychubes + 1, 0, y); sel.psychubes++; markDirty(); render(); break; }
        case act === 'del-psy': { const arr = DOC.psychubes; if (!arr.length) break; if (!confirm(`Delete "${arr[sel.psychubes].name}"?`)) break; arr.splice(sel.psychubes, 1); markDirty(); render(); break; }

        case act === 'add-team': (DOC.teamTierData = DOC.teamTierData || []).push({ tier:'T1', name:'New Team', archetype:'Lingering Glow', manifest:'', members:['','','',''], modeRating:'', rotation:'' }); sel.teams = DOC.teamTierData.length - 1; markDirty(); render(); break;
        case act === 'dup-team': { const arr = DOC.teamTierData; if (!arr.length) break; const t = clone(arr[sel.teams]); t.name += ' (copy)'; arr.splice(sel.teams + 1, 0, t); sel.teams++; markDirty(); render(); break; }
        case act === 'del-team': { const arr = DOC.teamTierData; if (!arr.length) break; if (!confirm(`Delete "${arr[sel.teams].name}"?`)) break; arr.splice(sel.teams, 1); markDirty(); render(); break; }

        case act === 'add-banner': (DOC.pullBanners = DOC.pullBanners || []).push({ patch:'New Banner', title:'', rating:'', ratingColor:BANNER_COLORS[0], unitFocus:'', verdict:'' }); sel.banners = DOC.pullBanners.length - 1; markDirty(); render(); break;
        case act === 'dup-banner': { const arr = DOC.pullBanners; if (!arr.length) break; const t = clone(arr[sel.banners]); arr.splice(sel.banners + 1, 0, t); sel.banners++; markDirty(); render(); break; }
        case act === 'del-banner': { const arr = DOC.pullBanners; if (!arr.length) break; if (!confirm('Delete this banner?')) break; arr.splice(sel.banners, 1); markDirty(); render(); break; }

        case act === 'add-manifest': (DOC.mythManifests = DOC.mythManifests || []).push({ id: uniqueId('new_manifest', DOC.mythManifests || [], 'id'), name:'New Manifest', element:'', bonus:'' }); sel.manifests = DOC.mythManifests.length - 1; markDirty(); render(); break;
        case act === 'dup-manifest': { const arr = DOC.mythManifests; if (!arr.length) break; const m = clone(arr[sel.manifests]); m.id = uniqueId(m.id, arr, 'id'); m.name += ' (copy)'; arr.splice(sel.manifests + 1, 0, m); sel.manifests++; markDirty(); render(); break; }
        case act === 'del-manifest': { const arr = DOC.mythManifests; if (!arr.length) break; if (!confirm(`Delete "${arr[sel.manifests].name}"?`)) break; arr.splice(sel.manifests, 1); markDirty(); render(); break; }

        case act === 'add-node': (DOC.materialNodes = DOC.materialNodes || []).push({ name:'New Material', tier:'', stage:'', rate:'', usage:'' }); sel.nodes = DOC.materialNodes.length - 1; markDirty(); render(); break;
        case act === 'dup-node': { const arr = DOC.materialNodes; if (!arr.length) break; const n = clone(arr[sel.nodes]); arr.splice(sel.nodes + 1, 0, n); sel.nodes++; markDirty(); render(); break; }
        case act === 'del-node': { const arr = DOC.materialNodes; if (!arr.length) break; if (!confirm(`Delete "${arr[sel.nodes].name}"?`)) break; arr.splice(sel.nodes, 1); markDirty(); render(); break; }

        case act === 'add-wfboss': {
            const w = DOC.walkthroughData[wfMode];
            if (!w) break;
            w.bosses = w.bosses || [];
            w.bosses.push({ stage:'New Stage', boss:'New Boss', recommended:'', mechanic:'' });
            sel.wfboss = w.bosses.length - 1;
            markDirty(); render(); break;
        }
        case act === 'del-wfboss': {
            const w = DOC.walkthroughData[wfMode];
            if (!w || !w.bosses || !w.bosses.length) break;
            if (!confirm(`Delete "${w.bosses[sel.wfboss].boss}"?`)) break;
            w.bosses.splice(sel.wfboss, 1); markDirty(); render(); break;
        }

        case act === 'add-boss':
            (DOC.homeManesBulletinBosses = DOC.homeManesBulletinBosses || []).push({ code:'RAID • NEW', name:'New Boss', favoredEngine:'', weakness:'', dangerMechanic:'', recommendedIds:[] });
            sel.bosses = DOC.homeManesBulletinBosses.length - 1;
            markDirty(); render(); break;
        case act === 'del-boss': {
            const arr = DOC.homeManesBulletinBosses;
            if (!arr.length) break;
            if (!confirm(`Delete "${arr[sel.bosses].name}"?`)) break;
            arr.splice(sel.bosses, 1); markDirty(); render(); break;
        }

        case act === 'raw-apply': {
            const ta = document.getElementById('raw-text');
            try {
                const val = JSON.parse(ta.value);
                DOC[window._rawKey] = val;
                markDirty();
                toast('Applied JSON to ' + window._rawKey);
                render();
            } catch (err){ alert('Invalid JSON:\n' + err.message); }
            break;
        }
        case act === 'raw-reset': render(); toast('Reverted text box'); break;
    }
});

$('#btn-open').addEventListener('click', openFile);
$('#btn-save').addEventListener('click', saveFile);
$('#btn-reload').addEventListener('click', async () => {
    if (DIRTY && !confirm('You have unsaved changes. Reload from the server and discard them?')) return;
    const ok = await loadFromApi();
    if (!ok) toast('Could not reach the database or server');
});
$('#btn-validate').addEventListener('click', showValidation);
$('#btn-download').addEventListener('click', () => {
    if (API_MODE){
        const blob = new Blob([JSON.stringify(Object.assign({}, DOC, { pageText: PAGE }), null, 2)], { type:'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'data.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        toast('Downloaded data.json');
        return;
    }
    if (!RAW){ toast('Open the site file first'); return; }
    download(buildOutput());
    toast('Downloaded edited file');
});
$('#val-close').addEventListener('click', () => { $('#val-modal').classList.add('hidden'); $('#val-modal').classList.remove('flex'); });
$('#val-modal').addEventListener('click', e => { if (e.target.id === 'val-modal'){ $('#val-modal').classList.add('hidden'); $('#val-modal').classList.remove('flex'); } });
$('#btn-discard').addEventListener('click', () => {
    if (!confirm('Discard the restored session and start fresh?')) return;
    localStorage.removeItem('ps-editor-session');
    location.reload();
});
$('#file-input').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    HANDLE = null;
    loadText(await file.text(), file.name);
    e.target.value = '';
});
document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's'){ e.preventDefault(); saveFile(); }
    if (e.key === 'Escape'){ $('#val-modal').classList.add('hidden'); $('#val-modal').classList.remove('flex'); }
});

/* ============================================================
   LOGIN (Supabase Auth — active when provider === 'supabase')
   ============================================================ */
function showLogin(errMsg){
    $('#login-modal').classList.remove('hidden');
    $('#login-modal').classList.add('flex');
    if (errMsg){ const b = $('#login-error'); b.textContent = errMsg; b.classList.remove('hidden'); }
    lucide.createIcons();
    setTimeout(() => { const el = $('#login-email'); if (el) el.focus(); }, 60);
}
function hideLogin(){
    $('#login-modal').classList.add('hidden');
    $('#login-modal').classList.remove('flex');
    $('#login-error').classList.add('hidden');
}
async function doLogin(){
    const email = $('#login-email').value.trim();
    const pass = $('#login-pass').value;
    const errBox = $('#login-error');
    errBox.classList.add('hidden');
    if (!email || !pass){ showLogin('Enter your email and password.'); return; }
    const btn = $('#btn-login');
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
        await PSAuth.login(email, pass);
        hideLogin();
        const ok = await loadFromApi();
        if (!ok) toast('Signed in, but data could not be loaded');
    } catch (err){
        showLogin('Sign-in failed: ' + ((err && err.message) || 'unknown error'));
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="log-in" class="w-4 h-4"></i> Sign in';
        lucide.createIcons();
    }
}
$('#btn-login').addEventListener('click', doLogin);
$('#login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
$('#login-email').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
$('#btn-logout').addEventListener('click', () => {
    PSAuth.logout();
    location.reload();
});

/* ============================================================
   BOOT
   ============================================================ */
(async function boot(){
    // 0. Cloud login gate — only when Supabase is the data source
    if (window.PSAuth && PSAuth.isEnabled()){
        let authed = false;
        try { authed = await PSAuth.restore(); } catch (e){ authed = false; }
        if (!authed){ showLogin(); return; }
    }
    // Capture the previous session BEFORE loadFromApi() overwrites it.
    let prior = null;
    try { prior = JSON.parse(localStorage.getItem('ps-editor-session') || 'null'); } catch (e){}
    // 1. Prefer live data (cloud database from config.js, then local server)
    const apiOk = await loadFromApi();
    if (apiOk){
        // 1b. Recover edits that never reached a data source (save failed or
        //     the tab closed before the auto-save fired).
        if (prior && prior.doc && prior.dirty === true){
            const restore = confirm('You have unsaved changes from your last visit that were not saved to the database. Restore them?');
            if (restore){
                DOC = prior.doc;
                PAGE = prior.page || PAGE;
                PRESENT = prior.present || PRESENT;
                PT = { title:{ok:true,value:PAGE.title}, heroHeading:{ok:true,value:PAGE.heroHeading}, heroQuote:{ok:true,value:PAGE.heroQuote}, patchVersion:{ok:true,value:PAGE.patchVersion||''} };
                DIRTY = true; CHANGES = prior.changes || 1;
                const b = $('#dirty-badge');
                b.textContent = CHANGES + ' unsaved';
                b.classList.remove('hidden');
                $('#restore-banner').classList.remove('hidden');
                persist();
                render();
                scheduleAutoSave();
            }
        }
        renderNav();
        lucide.createIcons();
        return;
    }
    // 2. Fall back to a restored browser session (offline editing)
    let restored = false;
    if (prior && (prior.raw || prior.doc)){
        RAW = prior.raw || null;
        DOC = prior.doc || {};
        PAGE = prior.page || PAGE; PT = prior.pt || {}; PRESENT = prior.present || [];
        FILENAME = prior.file || '';
        API_MODE = prior.raw ? false : (prior.api !== false);
        DIRTY = prior.dirty === true; CHANGES = DIRTY ? (prior.changes || 1) : 0;
        restored = true;
        if (DIRTY){
            const b = $('#dirty-badge');
            b.textContent = CHANGES + ' unsaved';
            b.classList.remove('hidden');
            $('#file-status').textContent = (FILENAME || 'session') + ' · restored (unsaved changes pending — auto-save will retry)';
        } else {
            $('#file-status').textContent = (FILENAME || 'session') + ' · restored (unsaved)';
        }
        $('#restore-banner').classList.remove('hidden');
        if (DIRTY) scheduleAutoSave();
    }
    if (!restored){
        // keep section renderers safe to explore before a file is loaded
        for (const k of VARS) if (DOC[k] === undefined) DOC[k] = (k === 'walkthroughData' ? {} : []);
        $('#content').innerHTML = `<div class="card p-8 sm:p-12 text-center max-w-2xl mx-auto mt-6">
            <div class="w-14 h-14 rounded-2xl bg-parchment-800 text-parchment-50 flex items-center justify-center mx-auto mb-4"><i data-lucide="folder-open" class="w-7 h-7"></i></div>
            <h2 class="text-2xl font-bold">No data source available</h2>
            <p class="text-sm text-parchment-700 mt-3 leading-relaxed">This editor loads and saves game data through your cloud database or the local Pocket Suitcase server.</p>
            <ol class="text-xs text-parchment-700 text-left max-w-md mx-auto mt-5 space-y-2 list-decimal list-inside">
                <li><span class="font-medium">Cloud:</span> open <span class="font-mono bg-parchment-100 px-1.5 py-0.5 rounded border border-parchment-300">config.js</span>, set <span class="font-mono">provider</span> and paste your database keys.</li>
                <li><span class="font-medium">Local:</span> start <span class="font-mono bg-parchment-100 px-1.5 py-0.5 rounded border border-parchment-300">node server.js</span> and open this page at <span class="font-mono">http://localhost:3000/suitcase-editor.html</span></li>
                <li>Or open a guide HTML file to edit it offline (files exported before the data was moved out still contain their data).</li>
            </ol>
            <div class="flex flex-wrap gap-3 justify-center mt-6">
                <button class="btn btn-gold" onclick="loadFromApi().then(ok => ok ? null : toast('Still unreachable — check config.js or start node server.js'))"><i data-lucide="refresh-cw" class="w-4 h-4"></i> Retry connection</button>
                <button class="btn btn-ghost" onclick="document.getElementById('btn-open').click()"><i data-lucide="folder-open" class="w-4 h-4"></i> Open HTML file instead</button>
            </div>
            <p class="text-[11px] text-parchment-500 mt-4 italic">The guide HTML no longer contains game data — it fetches everything from the database at runtime.</p>
        </div>`;
    } else {
        render();
    }
    renderNav();
    lucide.createIcons();
})();
