/* ============================================================
   POCKET SUITCASE — CLOUD DATA STORE
   ------------------------------------------------------------
   window.PSStore.isConfigured() → true when a cloud provider is set
   window.PSStore.label()        → 'Supabase cloud' / 'JSONBin cloud'
   window.PSStore.load()         → Promise<object | null>  (null = no data yet)
   window.PSStore.save(data)     → Promise<true>            (throws on failure)

   Reads settings from window.PS_CONFIG (config.js).
   When no provider is configured, load() resolves null and save()
   throws — callers then fall back to the local server (/api/data).
   ============================================================ */
(function () {
    'use strict';
    const C = window.PS_CONFIG || {};

    function isConfigured() {
        if (C.provider === 'supabase') return !!(C.supabase && C.supabase.url && C.supabase.anonKey);
        if (C.provider === 'jsonbin') return !!(C.jsonbin && C.jsonbin.binId && C.jsonbin.apiKey);
        return false;
    }

    function label() {
        if (C.provider === 'supabase') return 'Supabase cloud';
        if (C.provider === 'jsonbin') return 'JSONBin cloud';
        return '';
    }

    /* ---------- Supabase (PostgREST) ---------- */
    function sbBase() {
        return String(C.supabase.url).replace(/\/+$/, '') + '/rest/v1/' + encodeURIComponent(C.supabase.table);
    }
    function sbHeaders(extra) {
        return Object.assign({
            'apikey': C.supabase.anonKey,
            'Authorization': 'Bearer ' + C.supabase.anonKey,
            'Content-Type': 'application/json'
        }, extra || {});
    }
    async function sbLoad() {
        const url = sbBase() + '?id=eq.' + encodeURIComponent(C.supabase.rowId) + '&select=content';
        const res = await fetch(url, { headers: sbHeaders(), cache: 'no-store' });
        if (!res.ok) throw new Error('Supabase load failed (HTTP ' + res.status + ')');
        const rows = await res.json();
        if (!Array.isArray(rows) || rows.length === 0 || !rows[0].content) return null;
        return rows[0].content;
    }
    async function sbSave(data) {
        const res = await fetch(sbBase(), {
            method: 'POST',
            headers: sbHeaders({ 'Prefer': 'resolution=merge-duplicates,return=representation' }),
            body: JSON.stringify({ id: C.supabase.rowId, content: data })
        });
        if (!res.ok) throw new Error('Supabase save failed (HTTP ' + res.status + ') ' + (await res.text()));
        return true;
    }

    /* ---------- JSONBin v3 ---------- */
    function jbBase() {
        return 'https://api.jsonbin.io/v3/b/' + encodeURIComponent(C.jsonbin.binId);
    }
    function jbHeaders(extra) {
        // Send the key under both header names: JSONBin uses
        // X-Master-Key for secret keys and X-Access-Key for access keys.
        return Object.assign({
            'X-Master-Key': C.jsonbin.apiKey,
            'X-Access-Key': C.jsonbin.apiKey,
            'Content-Type': 'application/json'
        }, extra || {});
    }
    async function jbLoad() {
        const res = await fetch(jbBase() + '/latest', { headers: jbHeaders(), cache: 'no-store' });
        if (!res.ok) throw new Error('JSONBin load failed (HTTP ' + res.status + ')');
        const out = await res.json();
        return out && out.record ? out.record : null;
    }
    async function jbSave(data) {
        const res = await fetch(jbBase(), { method: 'PUT', headers: jbHeaders(), body: JSON.stringify(data) });
        if (!res.ok) throw new Error('JSONBin save failed (HTTP ' + res.status + ') ' + (await res.text()));
        return true;
    }

    /* ---------- Public interface ---------- */
    window.PSStore = {
        isConfigured: isConfigured,
        label: label,
        load: function () {
            if (!isConfigured()) return Promise.resolve(null);
            return C.provider === 'supabase' ? sbLoad() : jbLoad();
        },
        save: function (data) {
            if (!isConfigured()) return Promise.reject(new Error('No cloud database configured in config.js'));
            return C.provider === 'supabase' ? sbSave(data) : jbSave(data);
        }
    };
})();
