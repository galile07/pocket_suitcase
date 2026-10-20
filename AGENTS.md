# Pocket Suitcase — Project Instructions

Static web app (Reverse: 1999 game companion) with a zero-dependency local dev server. No build step, no framework — plain HTML/CSS/JS with Tailwind CDN and Lucide icons.

## Files

| File | Role |
|---|---|
| `pocket_suitcase_timekeeper_s_guide.html` | Guide site (default page at `/`). Markup only; logic in `guide.js`, styles in `guide.css`. |
| `suitcase-editor.html` | Editor site (at `/suitcase-editor.html`). Markup only; logic in `editor.js`, styles in `editor.css`. |
| `guide.js` / `editor.js` | All page logic. Keep each file's JS syntax valid — one error kills the whole page. |
| `guide.css` / `editor.css` | Extracted page styles (small). |
| `data.json` | Source of truth: `{ characters: [...], pageText: {...}, ... }`. |
| `data.backup.json` | Rolling backup written by the server on every save. |
| `server.js` | Zero-dep HTTP server (port 3000). Serves static files + `GET/POST /api/data`. |
| `config.js` | Cloud provider config (`supabase` provider, URL/anon key). |
| `cloud-store.js` | `PSStore` (load/save) and `PSAuth` (login gate) abstractions over Supabase. |
| `reseed-supabase.sql` | Supabase table seed (gitignored). |

## Data flow

- Editor loads: cloud (`PSStore.load()`) first, then `GET /api/data` endpoints as fallback.
- Editor saves: cloud save then `POST /api/data` (server keeps `data.backup.json`).
- Guide reads `GET /api/data` on every page load (served with `Cache-Control: no-store`).
- Editor also writes a localStorage session (`ps-editor-session`) as offline restore.

## Commands

```powershell
node server.js                      # start local server → http://localhost:3000/
node --check editor.js              # JS syntax check (also guide.js, config.js, cloud-store.js)
```

Smoke test without a browser (headless Edge):

```powershell
& "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu `
  --virtual-time-budget=8000 --dump-dom "http://localhost:3000/"
# editor: expect login modal (no auth session in headless) — data load is gated by PSAuth
# guide: expect character names from data.json present in the dumped DOM
```

## Conventions & warnings

- **Always commit and push after making changes** — run `node --check` on edited `.js` files first, then commit everything (including new files) and push to `origin`.
- Never commit a change without running `node --check` on every edited `.js` file — a stray brace was once committed and silently disabled the whole editor (see commit `c1520fe`).
- Character shape is normalized in `ensureCharShape()` (editor.js); euphoria is a list `euphoriaPaths` (`E1`/`E2`), legacy single `euphoria` object is migrated on load.
- Keep `editor.js`/`guide.js` and the HTML files' shared field names in sync (e.g., `releaseDate`, `name` on euphoria) — the guide renders what the editor writes.
- Files are large (`editor.js` ~1,450 lines, `guide.js` ~1,000 lines, guide markup ~760 lines): locate code with search before reading whole files.
- The folder lives inside OneDrive; avoid holding file locks on the HTML/JS files.
