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

    /* ---------- Supabase Auth (editor login) ----------
       Password login through Supabase GoTrue. After the RLS policies
       are switched to "authenticated" only, saves are rejected by the
       database itself unless a valid user session token is attached. */
    const AUTH_STORE_KEY = 'ps-editor-auth';
    let currentSession = null;

    function authEnabled() {
        return C.provider === 'supabase' && isConfigured();
    }
    function readStoredSession() {
        try { const raw = localStorage.getItem(AUTH_STORE_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
    }
    function writeStoredSession(s) {
        try { localStorage.setItem(AUTH_STORE_KEY, JSON.stringify(s)); } catch (e) { /* private mode */ }
    }
    function clearStoredSession() {
        try { localStorage.removeItem(AUTH_STORE_KEY); } catch (e) {}
    }
    function sessionExpiryMs(s) {
        try {
            const part = String(s.access_token).split('.')[1] || '';
            const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
            const payload = JSON.parse(atob(b64 + '='.repeat((4 - b64.length % 4) % 4)));
            if (payload.exp) return payload.exp * 1000;
        } catch (e) {}
        return s.expires_at ? s.expires_at * 1000 : 0;
    }
    async function authTokenRequest(params) {
        const base = String(C.supabase.url).replace(/\/+$/, '');
        const path = params.grant_type === 'refresh_token' ? 'grant_type=refresh_token' : 'grant_type=password';
        const body = params.grant_type === 'refresh_token'
            ? { refresh_token: params.refresh_token }
            : { email: params.email, password: params.password };
        const res = await fetch(base + '/auth/v1/token?' + path, {
            method: 'POST',
            headers: { apikey: C.supabase.anonKey, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            let msg = 'HTTP ' + res.status;
            try {
                const j = await res.json();
                msg = j.error_description || j.msg || j.message || msg;
            } catch (e) {}
            throw new Error(msg);
        }
        return res.json();
    }
    function adoptSession(s) {
        if (!s || !s.access_token) throw new Error('Invalid login response');
        if (!s.expires_at && s.expires_in) s.expires_at = Math.floor(Date.now() / 1000) + s.expires_in;
        currentSession = s;
        writeStoredSession(s);
    }
    async function authRefresh() {
        if (!currentSession || !currentSession.refresh_token) return null;
        try {
            const n = await authTokenRequest({ grant_type: 'refresh_token', refresh_token: currentSession.refresh_token });
            adoptSession(n);
            return n.access_token;
        } catch (e) {
            currentSession = null;
            clearStoredSession();
            return null;
        }
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
        // With auth enabled, saves must carry the logged-in user's token —
        // the database's RLS policies reject the plain anon key.
        let authHeader = null;
        if (authEnabled()) {
            const token = await window.PSAuth.accessToken();
            if (!token) throw new Error('Not logged in — sign in to the editor first');
            authHeader = 'Bearer ' + token;
        }
        const doFetch = () => {
            const headers = sbHeaders({ 'Prefer': 'resolution=merge-duplicates,return=representation' });
            if (authHeader) headers.Authorization = authHeader;
            return fetch(sbBase(), { method: 'POST', headers: headers, body: JSON.stringify({ id: C.supabase.rowId, content: data }) });
        };
        let res = await doFetch();
        if (res.status === 401 && authEnabled()) {
            // Token expired mid-session — refresh and retry once
            const fresh = await authRefresh();
            if (fresh) { authHeader = 'Bearer ' + fresh; res = await doFetch(); }
        }
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

    window.PSAuth = {
        isEnabled: function () { return authEnabled(); },
        isAuthenticated: function () { return !!(currentSession && currentSession.access_token); },
        token: function () { return currentSession ? currentSession.access_token : null; },
        restore: async function () {
            const s = currentSession || readStoredSession();
            if (!s || !s.access_token) return false;
            const left = sessionExpiryMs(s) - Date.now();
            if (left > 60000) { currentSession = s; return true; }
            const fresh = await (function () { currentSession = s; return authRefresh(); })();
            return !!fresh;
        },
        accessToken: async function () {
            if (!currentSession) {
                const ok = await this.restore();
                if (!ok) return null;
            }
            if (sessionExpiryMs(currentSession) - Date.now() <= 60000) {
                await authRefresh();
            }
            return currentSession ? currentSession.access_token : null;
        },
        login: async function (email, password) {
            const s = await authTokenRequest({ grant_type: 'password', email: email, password: password });
            adoptSession(s);
            return true;
        },
        refreshNow: function () { return authRefresh(); },
        logout: function () {
            currentSession = null;
            clearStoredSession();
        }
    };
})();
