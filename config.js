/* ============================================================
   POCKET SUITCASE — DATA SOURCE CONFIG
   ------------------------------------------------------------
   Paste your database credentials below and set a provider.
   Both the guide site and the editor will then load/save data
   from the internet (no terminal / server needed).

   ⚠ This file is PUBLIC — it is served on your website.
   Only paste keys that are safe to share (see notes below).

   provider: 'supabase'  → cloud database (recommended)
   provider: 'jsonbin'   → simple online JSON file (easier, less safe)
   provider: ''          → disabled; only the local server (node server.js) works
   ============================================================ */
window.PS_CONFIG = {

    provider: 'supabase',

    /* ---- Option A: Supabase (recommended) ----
       1. Sign up free at https://supabase.com → New project
       2. Open SQL Editor, paste the CREATE TABLE + policies SQL
          (given in the setup instructions) and run it once
       3. Project Settings → API → copy "Project URL" and
          the "anon public" key into the two fields below
       The anon key is meant to be public: the Row Level Security
       policies in the SQL block allow reading and saving the data
       but block deleting the table. */
    supabase: {
        url: 'https://ickfxboibxaxkkusmlem.supabase.co',
        anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlja2Z4Ym9pYnhheGtrdXNtbGVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0MDEwMTksImV4cCI6MjEwNzk3NzAxOX0.Fl7H4Y7JpGc0ulrstt_pwHJ3eL3-ndjCC0SlwZnX4BQ',
        table: 'site_data',
        rowId: 1
    },

    /* ---- Option B: JSONBin.io (fewer setup steps) ----
       1. Sign up free at https://jsonbin.io → Create Bin
       2. Paste any JSON (a single {} is fine) → save
       3. Copy the Bin ID and your Secret Key (API Keys page)
       ⚠ WARNING: a JSONBin secret key gives full read/write
       access to your account, and anyone who opens this website
       can read this file. Only use for a private/personal site. */
    jsonbin: {
        binId: '',   // e.g. '70f2a1b9c8e4f5a012345678'
        apiKey: ''   // your Secret Key (X-Master-Key)
    }
};
