        // ============================================================
        // ALL GAME DATA LIVES IN THE DATABASE (data.json).
        // config.js + cloud-store.js decide where it comes from:
        // cloud (Supabase/JSONBin) first, then the local server
        // (GET /api/data). The blocks below are empty placeholders —
        // on page load the site fetches the real data and fills them
        // in. Do not add data back into this file.
        // ============================================================
        let materialNodes = [];

        // 2. MYTH MANIFESTS (REVERIES IN THE RAIN COMPANIONS)
        let mythManifests = [];

        // 3. VER 3.8 / 3.9 CHARACTER DATABASE
        let characters = [];

        // 4. VER 3.x TEAM TIERLIST DATA
        let teamTierData = [];

        // 5. VER 3.7 – 3.9 PULL BANNERS DATA
        let pullBanners = [];

        // 6. GAMEMODE WALKTHROUGHS (3.x UPDATED)
        let walkthroughData = {};

        // ==========================================
        // STATE & INITIALIZATION
        // ==========================================
        let homePatchNewCharIds = [];
        let homePatchEuphoriaIds = [];
        let homeManesBulletinBosses = [];
        let pageText = { title: '', heroHeading: '', heroQuote: '' };

        let currentCharFilters = { afflatus: 'all', role: 'all', tier: 'all' };
        let activeBuilderSlot = 0;
        let builderSlots = ["beryl", "lorentz", "isolde", "marsha"];
        let selectedManifest = "operatic";

        // ==========================================
        // SHARED DATA LOADER (cloud database → local server)
        // ==========================================
        async function loadSharedData() {
            // 1. Cloud database from config.js (works on GitHub Pages)
            // 2. Same-origin API (works when served by server.js)
            // 3. Absolute localhost (works from file:// or another port)
            const preferLocal = new URLSearchParams(location.search).get('prefer') === 'local';
            const sources = [];
            const cloudSource = (window.PSStore && PSStore.isConfigured())
                ? { name: PSStore.label(), get: () => PSStore.load() }
                : null;
            if (cloudSource && !preferLocal) sources.push(cloudSource);
            const httpGet = endpoint => async () => {
                const res = await fetch(endpoint, { cache: 'no-store' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            };
            sources.push(
                { name: '/api/data', get: httpGet('/api/data') },
                { name: 'http://localhost:3000/api/data', get: httpGet('http://localhost:3000/api/data') }
            );
            if (cloudSource && preferLocal) sources.push(cloudSource);
            for (const source of sources) {
                try {
                    const data = await source.get();
                    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) continue;
                    if (data.materialNodes) materialNodes = data.materialNodes;
                    if (data.mythManifests) mythManifests = data.mythManifests;
                    if (data.characters) characters = data.characters;
                    if (data.teamTierData) teamTierData = data.teamTierData;
                    if (data.pullBanners) pullBanners = data.pullBanners;
                    if (data.walkthroughData) walkthroughData = data.walkthroughData;
                    if (data.homePatchNewCharIds) homePatchNewCharIds = data.homePatchNewCharIds;
                    if (data.homePatchEuphoriaIds) homePatchEuphoriaIds = data.homePatchEuphoriaIds;
                    if (data.homeManesBulletinBosses) homeManesBulletinBosses = data.homeManesBulletinBosses;
                    if (data.pageText) {
                        pageText = data.pageText;
                        applyPageText();
                    }
                    console.log('[Pocket Suitcase] Live data loaded from ' + source.name);
                    return true;
                } catch (err) {
                    // Network/CORS failure — try next source
                }
            }
            return false;
        }

        function applyPageText() {
            if (pageText.title) document.title = pageText.title;
            const h = document.getElementById('hero-heading');
            if (h && pageText.heroHeading) h.innerHTML = pageText.heroHeading;
            const q = document.getElementById('hero-quote');
            if (q && pageText.heroQuote) q.textContent = pageText.heroQuote;
        }

        window.addEventListener('DOMContentLoaded', async () => {
            lucide.createIcons();
            const liveLoaded = await loadSharedData();
            if (!liveLoaded) {
                showToast('No data source reachable — check config.js (cloud) or start "node server.js", then refresh.');
            }
            renderHomeSpotlight();
            renderTeamTierlist('All');
            renderCharacters();
            renderTeamBuilder();
            calculatePullBudget();
            renderPullBanners();
            switchWalkthroughMode('reveries');
            startResetClock();
        });

        // ==========================================
        // NAVIGATION LOGIC
        // ==========================================
        function switchTab(tabId) {
            if (tabId === 'pull-guide') {
                openPullGuideModal();
                return;
            }

            document.querySelectorAll('.tab-content').forEach(sec => sec.classList.add('hidden'));
            const target = document.getElementById('tab-' + tabId);
            if (target) target.classList.remove('hidden');

            document.querySelectorAll('.nav-btn').forEach(btn => {
                if (btn.getAttribute('data-tab') === tabId) {
                    btn.className = "nav-btn w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 bg-parchment-700 text-parchment-50 shadow-xs border border-parchment-500 cursor-pointer";
                } else {
                    btn.className = "nav-btn w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium text-parchment-200 hover:bg-parchment-800 hover:text-parchment-50 transition-all duration-150 cursor-pointer";
                }
            });

            const sidebar = document.getElementById('sidebar');
            if (!sidebar.classList.contains('-translate-x-full') && window.innerWidth < 1024) {
                toggleMobileSidebar();
            }

            window.scrollTo({ top: 0, behavior: 'smooth' });
            lucide.createIcons();
        }

        function toggleMobileSidebar() {
            const sidebar = document.getElementById('sidebar');
            const backdrop = document.getElementById('sidebar-backdrop');
            sidebar.classList.toggle('-translate-x-full');
            backdrop.classList.toggle('hidden');
        }

        // ==========================================
        // HOME: NEW CHARACTERS, NEW EUPHORIA & MANE'S BULLETIN BOSSES
        // ==========================================
        function inspectCharacterFromHome(charId) {
            // Reset filters so the selected character is visible in the Character Tierlist tab
            currentCharFilters = { afflatus: 'all', role: 'all', tier: 'all' };
            const searchEl = document.getElementById('char-search');
            if (searchEl) searchEl.value = '';
            const tierSel = document.getElementById('tier-select');
            if (tierSel) tierSel.value = 'all';
            const roleSel = document.getElementById('role-select');
            if (roleSel) roleSel.value = 'all';

            switchTab('char-tierlist');
            renderCharacters();
            openCharModal(charId);

            setTimeout(() => {
                const cardEl = document.getElementById('char-card-' + charId);
                if (cardEl) {
                    cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 150);
        }

        function openManesWalkthrough() {
            switchTab('walkthrough');
            switchWalkthroughMode('manes');
        }

        function renderHomeSpotlight() {
            // 1. Render New Debut Characters
            const newCharsGrid = document.getElementById('home-new-chars-grid');
            if (newCharsGrid) {
                const newChars = homePatchNewCharIds.map(id => characters.find(c => c.id === id)).filter(Boolean);
                newCharsGrid.innerHTML = newChars.map(c => `
                    <div onclick="inspectCharacterFromHome('${c.id}')" class="bg-parchment-100 hover:bg-parchment-200/80 rounded-2xl p-5 border border-parchment-300 shadow-xs cursor-pointer transition-all flex flex-col justify-between group">
                        <div>
                            <div class="flex items-center justify-between gap-2 mb-3">
                                <span class="px-2.5 py-0.5 rounded-full bg-parchment-800 text-amber-300 font-mono text-[10px] font-bold uppercase tracking-wider">New Debut</span>
                                <span class="px-2 py-0.5 rounded text-[10px] font-bold ${getAfflatusBadge(c.afflatus)}">${c.afflatus}</span>
                            </div>
                            <div class="flex items-baseline justify-between mb-1">
                                <h4 class="font-serif font-bold text-lg text-parchment-900 group-hover:text-parchment-700 transition">${c.name}</h4>
                                <span class="font-serif font-bold text-xs px-2 py-0.5 rounded bg-parchment-300 text-parchment-900">${c.tier}</span>
                            </div>
                            <p class="text-xs font-semibold text-parchment-700 mb-2.5">${c.rarity}★ • ${(c.suffix || []).join(' / ') || '—'}${c.dmgType ? ' • ' + c.dmgType : ''}</p>
                            <div class="flex flex-wrap gap-1.5 mb-4">${charTagNames(c).map(n => `<span class="px-2 py-0.5 rounded bg-parchment-200 border border-parchment-300 text-[10px] font-semibold text-parchment-800">${n}</span>`).join('') || '<span class="text-[11px] text-parchment-600 italic">No tags yet</span>'}</div>
                        </div>
                        <div class="pt-3 border-t border-parchment-300 flex items-center justify-between text-xs font-semibold text-parchment-800 group-hover:text-parchment-900">
                            <span>View Character Info</span>
                            <i data-lucide="arrow-up-right" class="w-4 h-4"></i>
                        </div>
                    </div>
                `).join('');
            }

            // 2. Render New Euphoria Characters Added This Patch
            const euphGrid = document.getElementById('home-euphoria-chars-grid');
            if (euphGrid) {
                const euphChars = homePatchEuphoriaIds.map(id => characters.find(c => c.id === id)).filter(Boolean);
                euphGrid.innerHTML = euphChars.map(c => `
                    <div onclick="inspectCharacterFromHome('${c.id}')" class="bg-parchment-100 hover:bg-parchment-200/80 rounded-2xl p-5 border border-parchment-300 shadow-xs cursor-pointer transition-all flex flex-col justify-between group">
                        <div>
                            <div class="flex items-center justify-between gap-2 mb-2.5">
                                <span class="px-2.5 py-0.5 rounded bg-amber-800 text-parchment-50 font-mono text-[10px] font-bold">EUPHORIA ${charEuphTag(c) || 'Upgrade'}</span>
                                <div class="flex items-center gap-1.5">
                                    <span class="px-2 py-0.5 rounded text-[10px] font-bold ${getAfflatusBadge(c.afflatus)}">${c.afflatus}</span>
                                    <span class="px-2 py-0.5 rounded bg-amber-800 text-parchment-50 font-serif font-bold text-[11px]">${c.tier}</span>
                                </div>
                            </div>
                            <h4 class="font-serif font-bold text-lg text-parchment-900 group-hover:text-parchment-700 transition">${c.name}</h4>
                            <p class="text-xs font-semibold text-parchment-700 mt-0.5 mb-2">${(c.suffix || []).join(' / ') || '—'}${charTagNames(c).length ? ' • ' + charTagNames(c).slice(0, 2).join(' / ') : ''}</p>
                            <p class="text-xs text-parchment-800 leading-relaxed mb-3">${(c.euphoria && c.euphoria.rank1) || 'Euphoria upgrade available — tap to inspect ranks.'}</p>
                        </div>
                        <div class="pt-3 border-t border-parchment-300 flex items-center justify-between text-xs font-semibold text-amber-900 group-hover:text-parchment-900">
                            <span>Inspect Euphoria Kit & Build</span>
                            <i data-lucide="arrow-up-right" class="w-4 h-4"></i>
                        </div>
                    </div>
                `).join('');
            }

            // 3. Render Mane's Bulletin Version Bosses
            const bossesGrid = document.getElementById('home-manes-bosses-grid');
            if (bossesGrid) {
                bossesGrid.innerHTML = homeManesBulletinBosses.map(b => `
                    <div class="bg-parchment-100 rounded-2xl p-5 border border-parchment-300 flex flex-col justify-between space-y-4">
                        <div class="space-y-2.5">
                            <div class="flex items-center justify-between">
                                <span class="text-[10px] font-mono font-bold uppercase tracking-widest px-2.5 py-0.5 rounded bg-parchment-800 text-amber-300">${b.code}</span>
                                <span class="text-[11px] font-mono font-semibold text-parchment-700">SSS+ Raid</span>
                            </div>
                            <h4 class="font-serif font-bold text-lg text-parchment-900">${b.name}</h4>
                            <p class="text-xs font-semibold text-amber-900 bg-parchment-200/80 px-2.5 py-1 rounded-lg border border-parchment-300">
                                Favored Meta: ${b.favoredEngine}
                            </p>
                            <p class="text-xs text-parchment-800 leading-relaxed">
                                <strong>Boss Vulnerability:</strong> ${b.weakness}
                            </p>
                            <p class="text-xs text-parchment-700 leading-relaxed">
                                <strong>Threat Mechanic:</strong> ${b.dangerMechanic}
                            </p>
                        </div>

                        <div class="pt-3 border-t border-parchment-300">
                            <span class="text-[10px] font-mono uppercase tracking-wider text-parchment-600 font-bold block mb-2">Recommended Crew (Click to Inspect):</span>
                            <div class="flex flex-wrap gap-1.5">
                                ${b.recommendedIds.map(cid => {
                                    const charObj = characters.find(x => x.id === cid);
                                    if (!charObj) return '';
                                    return `
                                        <button onclick="inspectCharacterFromHome('${charObj.id}')" class="px-2.5 py-1 rounded-lg bg-parchment-50 hover:bg-parchment-800 text-parchment-900 hover:text-parchment-50 border border-parchment-300 text-xs font-semibold transition cursor-pointer">
                                            ${charObj.name}${charEuphTag(charObj) ? ` [${charEuphTag(charObj)}]` : ''}
                                        </button>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    </div>
                `).join('');
            }
        }

        // ==========================================
        // TEAM TIERLIST RENDERER
        // ==========================================
        function filterTeamArchetype(arch) {
            document.querySelectorAll('.team-arch-btn').forEach(btn => {
                if (btn.getAttribute('data-arch') === arch) {
                    btn.className = "team-arch-btn px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-parchment-800 text-parchment-50 transition cursor-pointer";
                } else {
                    btn.className = "team-arch-btn px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-parchment-200 text-parchment-800 hover:bg-parchment-300 transition cursor-pointer";
                }
            });
            renderTeamTierlist(arch);
        }

        function renderTeamTierlist(filterArch) {
            const container = document.getElementById('team-tier-container');
            const list = filterArch === 'All' ? teamTierData : teamTierData.filter(t => t.archetype === filterArch);

            container.innerHTML = list.map(team => {
                const badgeColor = team.tier === 'T0'   ? 'bg-amber-800 text-parchment-50 border-amber-500' :
                                   team.tier === 'T0.5' ? 'bg-parchment-800 text-parchment-50 border-parchment-500' :
                                                          'bg-parchment-600 text-parchment-50 border-parchment-400';
                return `
                    <div class="bg-parchment-50 rounded-2xl p-5 suitcase-border flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
                        <div class="flex items-start gap-4 max-w-xl">
                            <div class="w-14 h-14 rounded-2xl ${badgeColor} border-2 flex flex-col items-center justify-center shrink-0 shadow-md">
                                <span class="text-[10px] font-mono uppercase tracking-wider opacity-80">Tier</span>
                                <span class="font-serif font-extrabold text-lg leading-none">${team.tier}</span>
                            </div>
                            <div>
                                <div class="flex flex-wrap items-center gap-2">
                                    <h3 class="font-serif font-bold text-lg text-parchment-900">${team.name}</h3>
                                    <span class="px-2.5 py-0.5 rounded-full bg-parchment-200 text-parchment-900 text-xs font-semibold">${team.archetype}</span>
                                    <span class="px-2.5 py-0.5 rounded-full bg-parchment-800 text-amber-300 font-mono text-[11px]">Manifest: ${team.manifest}</span>
                                </div>
                                <p class="text-xs font-mono font-semibold text-parchment-600 mt-1">${team.modeRating}</p>
                                <p class="text-xs text-parchment-700 mt-2 leading-relaxed">${team.rotation}</p>
                            </div>
                        </div>

                        <div class="w-full lg:w-auto grid grid-cols-2 sm:grid-cols-4 gap-2.5 shrink-0">
                            ${team.members.map((mName, idx) => {
                                const charObj = characters.find(c => c.name === mName);
                                const roleLabel = idx === 0 ? 'Main Carry' : idx === 1 ? 'Core Support' : idx === 2 ? 'Sub-Carry' : 'Sustain';
                                return `
                                    <div onclick="${charObj ? `openCharModal('${charObj.id}')` : ''}" class="p-3 rounded-xl bg-parchment-100 hover:bg-parchment-200 border border-parchment-300 text-center cursor-pointer transition">
                                        <span class="text-[10px] font-mono uppercase tracking-wider text-parchment-600 block">${roleLabel}</span>
                                        <span class="font-serif font-bold text-xs text-parchment-900 mt-0.5 block">${mName} ${charObj && charEuphTag(charObj) ? `<span class="text-[10px] px-1 rounded bg-amber-800 text-parchment-50 font-mono">${charEuphTag(charObj)}</span>` : ''}</span>
                                        <span class="text-[10px] text-parchment-700 mt-0.5 block">${charObj ? charObj.afflatus : 'Arcanist'}</span>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `;
            }).join('');
        }

        // ==========================================
        // CHARACTER TIERLIST & EUPHORIA TOGGLE
        // ==========================================
        function setCharFilter(type, value) {
            currentCharFilters[type] = value;
            if (type === 'afflatus') {
                document.querySelectorAll('.aff-btn').forEach(btn => {
                    if (btn.getAttribute('data-aff') === value) {
                        btn.className = "aff-btn px-3 py-1.5 rounded-lg text-xs font-semibold bg-parchment-800 text-parchment-50 cursor-pointer";
                    } else {
                        btn.className = "aff-btn px-3 py-1.5 rounded-lg text-xs font-semibold bg-parchment-200 text-parchment-800 hover:bg-parchment-300 cursor-pointer";
                    }
                });
            }
            renderCharacters();
        }

        function getAfflatusBadge(aff) {
            const map = {
                Star: "bg-[#3d6b88] text-white",
                Plant: "bg-[#4b6e4b] text-white",
                Mineral: "bg-[#8c6239] text-white",
                Beast: "bg-[#983e3e] text-white",
                Spirit: "bg-[#6b4c7e] text-white",
                Intellect: "bg-[#a88025] text-white"
            };
            return map[aff] || "bg-parchment-700 text-white";
        }

        const TAG_REL = {
            'burn': ['Lingering Glow'],
            'halo': ['Lingering Glow'],
            'counter': ['Follow Up'],
            'eureka': ['Inspiration'],
            'dynamo': ['Ritual'],
            'hp sacrifice': ['Bloodtithe'],
            'poison': ['Negative Status']
        };
        const ALL_TAGS = ['General','Dynamo','Ritual','Follow Up','Poison','Lingering Glow','Bloodtithe','Rank Up','Inspiration','Conduit','Bullet','Shift','Full Pursuit','Counter Assassination','Negative Status','Burn','Halo','Counter','Eureka','HP Sacrifice','All Rounder'];
        function charTags(c) { return (c && c.tags) || []; }
        function charTagNames(c) { return charTags(c).map(t => t.name); }
        function relTags(c) {
            const manual = new Set(charTagNames(c).map(n => String(n).toLowerCase()));
            const out = [];
            const add = n => { if (!manual.has(n.toLowerCase()) && !out.includes(n)) out.push(n); };
            for (const t of charTags(c)) {
                const k = String(t.name || '').toLowerCase();
                if (k === 'all rounder') { ALL_TAGS.forEach(add); continue; }
                (TAG_REL[k] || []).forEach(add);
            }
            return out;
        }
        function charEuphTag(c) { 
            if (!c || !c.hasEuphoria) return ''; 
            if (Array.isArray(c.euphoriaPaths) && c.euphoriaPaths.length) {
                const active = activeEuphPath(c);
                if (active) return active.type || active.tag || '';
                return c.euphoriaPaths[0].type || c.euphoriaPaths[0].tag || '';
            }
            if (c.euphoria) return c.euphoria.tag || '';
            return ''; 
        }
        function latestEuphPath(c) {
            const paths = (c && Array.isArray(c.euphoriaPaths)) ? c.euphoriaPaths : [];
            if (!paths.length) return null;
            const ts = p => { const v = Date.parse(p && p.releaseDate); return isNaN(v) ? -Infinity : v; };
            return paths.slice().sort((a, b) => ts(b) - ts(a))[0] || null;
        }
        const euphoriaUserState = {}; // charId -> path object | 'off' ; unset = auto (latest path)
        function activeEuphPath(c) {
            if (!c || !c.hasEuphoria) return null;
            const paths = Array.isArray(c.euphoriaPaths) ? c.euphoriaPaths : [];
            if (!paths.length) return null;
            const st = euphoriaUserState[c.id];
            if (st === 'off') return null;
            if (st && paths.indexOf(st) !== -1) return st;
            return latestEuphPath(c); // auto-activate most recent path
        }
        function cycleEuphoria(id) {
            const c = characters.find(x => x.id === id);
            if (!c || !c.hasEuphoria) return;
            const paths = Array.isArray(c.euphoriaPaths) ? c.euphoriaPaths : [];
            if (!paths.length) return;
            const latest = latestEuphPath(c);
            const order = [latest, ...paths.filter(p => p !== latest), 'off'];
            const cur = (id in euphoriaUserState) ? euphoriaUserState[id] : latest;
            const i = order.indexOf(cur);
            euphoriaUserState[id] = order[(i + 1) % order.length];
            renderCharacters();
        }
        function effectiveTier(c) {
            const path = activeEuphPath(c);
            if (path && path.tier) return path.tier;
            return (c && c.tier) || '';
        }
        function tagStarsHtml(t) {
            const r = t.rating || 0;
            if (!r) return '';
            return ` <span class="text-amber-500 text-[10px] align-top">${'★'.repeat(Math.min(5, r))}</span>`;
        }
        function planRowsHtml(list) {
            if (!list || !list.length) return '<p class="text-[11px] text-parchment-100 opacity-70 italic">—</p>';
            return list.map(r => `<div class="flex justify-between gap-3 py-0.5 border-b border-parchment-700/40 last:border-0"><span>${r.mat || '—'}</span><span class="font-mono font-semibold shrink-0">${r.qty || ''}</span></div>`).join('');
        }

        function renderCharacters() {
            const search = (document.getElementById('char-search')?.value || '').toLowerCase();
            const includeEuphoria = document.getElementById('euphoria-toggle')?.checked ?? true;
            const grid = document.getElementById('char-grid');

            const filtered = characters.filter(c => {
                const activeTier = c.tier;
                const matchAff = currentCharFilters.afflatus === 'all' || c.afflatus === currentCharFilters.afflatus;
                const matchRole = currentCharFilters.role === 'all' || (c.suffix || []).includes(currentCharFilters.role);
                const matchTier = currentCharFilters.tier === 'all' || activeTier === currentCharFilters.tier;
                const haystack = (c.name + ' ' + (c.dmgType || '') + ' ' + (c.suffix || []).join(' ') + ' ' + charTagNames(c).join(' ') + ' ' + (c.psychube || '')).toLowerCase();
                const matchSearch = !search || haystack.includes(search);
                return matchAff && matchRole && matchTier && matchSearch;
            });

            if (filtered.length === 0) {
                grid.innerHTML = `<div class="col-span-full p-8 text-center bg-parchment-50 rounded-2xl suitcase-border text-sm text-parchment-700">No Arcanists match your current filters. Try resetting the Tier, Afflatus, or Role filter.</div>`;
                return;
            }

            grid.innerHTML = filtered.map(c => {
                const activePath = includeEuphoria ? activeEuphPath(c) : null;
                const activeTier = includeEuphoria ? effectiveTier(c) : (c.tier || '');
                const tierColor = activeTier === 'T0' ? 'bg-amber-800 text-parchment-50 border-amber-500' :
                                  activeTier === 'T0.5' ? 'bg-parchment-800 text-parchment-50 border-parchment-500' :
                                  activeTier === 'T1' ? 'bg-parchment-700 text-parchment-50 border-parchment-500' :
                                  activeTier === 'T2' ? 'bg-parchment-600 text-parchment-50 border-parchment-400' :
                                  activeTier === 'F' ? 'bg-red-900 text-parchment-50 border-red-700' :
                                  'bg-parchment-500 text-parchment-50 border-parchment-400';
                return `
                    <div id="char-card-${c.id}" onclick="openCharModal('${c.id}')" class="bg-parchment-50 hover:bg-parchment-100 rounded-2xl p-5 suitcase-border cursor-pointer transition-all flex flex-col justify-between group">
                        <div class="flex gap-4">
                            <div class="w-20 h-24 sm:w-24 sm:h-28 rounded-xl bg-parchment-200 border border-parchment-300 shrink-0 overflow-hidden flex items-center justify-center font-serif font-bold text-2xl text-parchment-400">
                                ${c.image ? `<img src="${c.image}" alt="${c.name}" loading="lazy" class="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300" onerror="this.remove()">` : c.name.charAt(0)}
                            </div>
                            <div class="flex-1 min-w-0">
                                <div class="flex items-start justify-between gap-2 mb-3">
                                    <div>
                                        <div class="flex flex-wrap items-center gap-1.5">
                                            <h3 class="font-serif font-bold text-lg text-parchment-900 group-hover:text-parchment-700 transition">${c.name}</h3>
                                            ${c.hasEuphoria && includeEuphoria ? `<span onclick="event.stopPropagation(); cycleEuphoria('${c.id}')" title="Click to cycle euphoria path" class="px-1.5 py-0.5 rounded font-mono text-[10px] font-bold cursor-pointer ${activePath ? 'bg-amber-800 text-parchment-50' : 'bg-parchment-300 text-parchment-600'}">Euphoria ${activePath ? (activePath.type || activePath.tag || '') : 'Off'}</span>` : ''}
                                        </div>
                                        <div class="flex flex-wrap items-center gap-1.5 mt-1">
                                            <span class="px-2 py-0.5 rounded text-[10px] font-bold ${getAfflatusBadge(c.afflatus)}">${c.afflatus}</span>
                                            ${(c.suffix || []).map(s => `<span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-parchment-200 text-parchment-800">${s}</span>`).join('')}
                                        </div>
                                    </div>
                                    <div class="w-11 h-11 rounded-xl ${tierColor} font-serif font-bold text-xs flex items-center justify-center shrink-0 border shadow-xs">
                                        ${activeTier}
                                    </div>
                                </div>

                                <div class="flex flex-wrap gap-1.5">${charTags(c).map(t => `<span class="px-2 py-0.5 rounded bg-parchment-200 border border-parchment-300 text-[10px] font-semibold text-parchment-800">${t.name}${tagStarsHtml(t)}</span>`).join('') || '<span class="text-[11px] text-parchment-600 italic">No tags yet</span>'}</div>
                            </div>
                        </div>

                        <div class="pt-3 mt-4 border-t border-parchment-200 space-y-1.5 text-xs">
                            <div class="flex items-center justify-between">
                                <span class="text-parchment-600">Damage Type:</span>
                                <span class="font-bold text-parchment-900">${c.dmgType || '—'}</span>
                            </div>
                            <div class="flex items-center justify-between">
                                <span class="text-parchment-600">BiS Psychube:</span>
                                <span class="font-medium text-parchment-800">${c.psychube || '—'}</span>
                            </div>
                            <div class="pt-1.5 flex items-center justify-end text-[11px] font-semibold text-parchment-600 group-hover:text-parchment-900">
                                <span>Inspect Build, Euphoria & Bound →</span>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        function openCharModal(charId) {
            const c = characters.find(item => item.id === charId);
            if (!c) return;
            const modal = document.getElementById('char-modal');
            const body = document.getElementById('char-modal-body');

            const mp = c.materialPlan || {};
            const resKeys = [['resL5','Resonance L5'],['resL10','Resonance L10'],['resL15','Resonance L15'],['resPattern','Resonance Pattern']];
            const hasRes = k => mp[k] && (mp[k].sharpodonty || (mp[k].mats || []).length);
            const hasPlan = !!((mp.currency && (mp.currency.dust || mp.currency.sharpodonty)) ||
                (mp.insights && mp.insights.length) ||
                resKeys.some(([k]) => hasRes(k)));
            const planBlock = hasPlan ? `
                <div class="p-4 rounded-xl bg-parchment-800 text-parchment-50 space-y-3">
                    <span class="text-[10px] font-mono uppercase tracking-widest text-amber-300 block font-bold">Material Plan</span>
                    ${(mp.currency && (mp.currency.dust || mp.currency.sharpodonty)) ? `<div class="flex flex-wrap gap-2 text-[11px] font-mono">
                        ${mp.currency.dust ? `<span class="px-2 py-1 rounded bg-parchment-700">${mp.currency.dust} Dust</span>` : ''}
                        ${mp.currency.sharpodonty ? `<span class="px-2 py-1 rounded bg-parchment-700">${mp.currency.sharpodonty} Sharpodonty</span>` : ''}
                    </div>` : ''}
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        ${(mp.insights && mp.insights.length) ? `<div><span class="text-[10px] font-mono uppercase tracking-wider text-amber-300 font-bold block mb-1">Insight Materials</span>${planRowsHtml(mp.insights)}</div>` : ''}
                        ${resKeys.map(([k, label]) => hasRes(k) ? `<div><span class="text-[10px] font-mono uppercase tracking-wider text-amber-300 font-bold block mb-1">${label}${mp[k].sharpodonty ? ' • ' + mp[k].sharpodonty + ' Sharpodonty' : ''}</span>${planRowsHtml(mp[k].mats)}</div>` : '').join('')}
                    </div>
                </div>` : '';

            let euphHtml;
            const euphPaths = Array.isArray(c.euphoriaPaths) ? c.euphoriaPaths : (c.euphoria ? [{
                type: c.euphoria.tag || '', tag: c.euphoria.tag || '', name: c.euphoria.name || '', suffix: c.euphoria.suffix || '', releaseDate: c.euphoria.releaseDate || '', image: c.euphoria.image || '',
                rank1: c.euphoria.rank1 || '', rank2: c.euphoria.rank2 || '', rank3: c.euphoria.rank3 || '', rank4: c.euphoria.rank4 || ''
            }] : []);
            if (c.hasEuphoria && euphPaths.length) {
                const cards = euphPaths.map(e => {
                    const ranks = [1,2,3,4].map(n => {
                        const v = e['rank' + n];
                        return v ? `<div class="text-xs"><span class="text-amber-300 font-mono font-bold text-[10px] uppercase tracking-wider">Rank ${n}</span><p class="text-parchment-100 leading-relaxed mt-0.5">${v}</p></div>` : '';
                    }).filter(Boolean).join('');
                    const tagLbl = e.type || e.tag || '';
                    const sufLbl = e.suffix || '';
                    const euphMats = Array.isArray(e.materials) ? e.materials.filter(m => m && m.mat) : [];
                    return `<div class="p-4 rounded-xl bg-parchment-800 text-parchment-50 space-y-3">
                        <div class="flex flex-wrap items-center justify-between gap-3">
                            <div class="min-w-0">
                                <span class="text-[10px] font-mono uppercase tracking-widest text-amber-300 font-bold">Euphoria ${tagLbl}${sufLbl ? ' • ' + sufLbl : ''}</span>
                                ${e.name ? `<p class="font-serif font-bold text-base leading-tight mt-0.5">${e.name}</p>` : ''}
                                ${e.releaseDate ? `<p class="text-[10px] font-mono text-parchment-300 mt-0.5">CN release: ${e.releaseDate}</p>` : ''}
                            </div>
                            ${e.image ? `<img src="${e.image}" alt="" class="h-14 rounded-lg object-contain border border-parchment-600" onerror="this.remove()">` : ''}
                        </div>
                        ${ranks || '<p class="text-xs text-parchment-200 italic">Euphoria available — rank details not written yet.</p>'}
                        ${euphMats.length ? `<div><span class="text-[10px] font-mono uppercase tracking-wider text-amber-300 font-bold block mb-1">Materials</span>${planRowsHtml(euphMats)}</div>` : ''}
                    </div>`;
                }).join('');
                euphHtml = `<div class="space-y-3">${cards}</div>`;
            } else {
                euphHtml = `
                <div class="p-4 rounded-xl bg-parchment-100 border border-parchment-300 text-center">
                    <p class="font-mono text-xs text-parchment-600">no euphoria. stay tuned.</p>
                </div>`;
            }

            const rel = relTags(c);
            const boundList = (c.bound || []).map(b => {
                const other = characters.find(x => x.id === b.id);
                if (!other) return '';
                return `<button onclick="closeCharModal(); openCharModal('${other.id}')" class="flex items-center justify-between gap-2 w-full px-3 py-2 rounded-xl bg-parchment-100 hover:bg-parchment-200 border border-parchment-300 text-left cursor-pointer transition">
                    <span class="text-xs font-bold text-parchment-900">${other.name}</span>
                    <span class="text-[10px] font-mono text-parchment-600">${b.tagAmp ? b.tagAmp + ' amp' : ''}</span>
                </button>`;
            }).filter(Boolean).join('') || '<p class="text-xs text-parchment-500 italic">No bound units listed.</p>';

            body.innerHTML = `
                <div class="flex flex-wrap items-center gap-3 border-b border-parchment-300 pb-4 mb-4">
                    <div class="w-14 h-14 rounded-2xl bg-parchment-800 text-parchment-50 flex flex-col items-center justify-center font-serif font-bold border border-parchment-500">
                        <span class="text-[10px] font-mono uppercase opacity-75">Tier</span>
                        <span class="text-lg leading-none">${effectiveTier(c)}</span>
                    </div>
                    ${c.image ? `<img src="${c.image}" alt="" class="w-14 h-14 rounded-2xl object-cover border border-parchment-500 bg-parchment-100 shrink-0" onerror="this.remove()">` : ''}
                    <div class="flex-1 min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                            <h3 class="font-serif text-2xl font-bold text-parchment-900">${c.name}</h3>
                            <span class="px-2.5 py-0.5 rounded text-xs font-bold ${getAfflatusBadge(c.afflatus)}">${c.afflatus}</span>
                            ${(c.suffix || []).map(s => `<span class="px-2 py-0.5 rounded text-[11px] font-semibold bg-parchment-200 text-parchment-800">${s}</span>`).join('')}
                            ${c.hasEuphoria && charEuphTag(c) ? `<span class="px-2 py-0.5 rounded bg-amber-800 text-parchment-50 font-mono text-xs font-bold">Euphoria ${charEuphTag(c)}</span>` : ''}
                        </div>
                        <p class="text-xs text-parchment-700 mt-0.5">${c.rarity}★ Arcanist${c.dmgType ? ' • ' + c.dmgType : ''}${charTagNames(c).length ? ' • ' + charTagNames(c).slice(0, 3).join(' / ') : ''}${c.releaseDate ? ' • CN release: ' + c.releaseDate : ''}</p>
                    </div>
                </div>

                <div class="p-3.5 rounded-xl bg-parchment-100 border border-parchment-300 mb-4">
                    <span class="text-[10px] font-mono uppercase tracking-wider text-parchment-600 font-bold block mb-2">Tags</span>
                    <div class="flex flex-wrap gap-1.5">
                        ${charTags(c).map(t => `<span class="px-2.5 py-1 rounded-lg bg-parchment-200 border border-parchment-300 text-xs font-semibold text-parchment-800">${t.name}${tagStarsHtml(t)}</span>`).join('') || '<span class="text-xs text-parchment-500 italic">No tags yet</span>'}
                    </div>
                    <div class="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-parchment-200">
                        <span class="text-[10px] font-mono uppercase text-parchment-500 font-bold self-center mr-1">Relative:</span>
                        ${rel.map(n => `<span class="px-2 py-1 rounded-lg bg-amber-50 border border-amber-300 text-[11px] font-semibold text-amber-800">${n}</span>`).join('') || '<span class="text-[11px] text-parchment-500 italic">None derived</span>'}
                    </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4 text-xs">
                    <div class="p-3.5 rounded-xl bg-parchment-100 border border-parchment-300">
                        <span class="text-[10px] font-mono uppercase tracking-wider text-parchment-600 font-bold block mb-1">Best-in-Slot Psychube</span>
                        <p class="font-bold text-parchment-900 text-sm">${c.psychube || '—'}</p>
                        <p class="text-parchment-700 mt-1">Alternative: <strong>${c.altPsychube || '—'}</strong></p>
                    </div>
                    <div class="p-3.5 rounded-xl bg-parchment-100 border border-parchment-300">
                        <span class="text-[10px] font-mono uppercase tracking-wider text-parchment-600 font-bold block mb-1.5">Bound</span>
                        <div class="space-y-1.5">${boundList}</div>
                    </div>
                </div>

                ${planBlock}
                ${euphHtml}
            `;

            modal.classList.remove('hidden');
            modal.classList.add('flex');
            lucide.createIcons();
        }

        function closeCharModal() {
            const modal = document.getElementById('char-modal');
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }

        // ==========================================
        // TEAM BUILDER + MYTH MANIFEST WORKBENCH
        // ==========================================
        function selectBuilderSlot(index) {
            activeBuilderSlot = index;
            renderTeamBuilder();
        }

        function assignCharToSlot(charId) {
            const existingIndex = builderSlots.indexOf(charId);
            if (existingIndex !== -1 && existingIndex !== activeBuilderSlot) {
                builderSlots[existingIndex] = null;
            }
            builderSlots[activeBuilderSlot] = charId;
            activeBuilderSlot = (activeBuilderSlot + 1) % 4;
            renderTeamBuilder();
        }

        function selectMythManifest(manifestId) {
            selectedManifest = manifestId;
            renderTeamBuilder();
            showToast("Assigned Myth Manifest companion!");
        }

        function clearTeamBuilder() {
            builderSlots = [null, null, null, null];
            activeBuilderSlot = 0;
            renderTeamBuilder();
        }

        function loadPresetTeam(type) {
            if (type === 'glow') {
                builderSlots = ["beryl", "lorentz", "isolde", "marsha"];
                selectedManifest = "operatic";
            } else if (type === 'dynamo') {
                builderSlots = ["brume", "charon", "ulrich", "enigma"];
                selectedManifest = "ashen_beast";
            } else if (type === 'conduit') {
                builderSlots = ["thetwins", "hedone", "rhiannon", "everecho"];
                selectedManifest = "star_misfortune";
            } else if (type === 'bloodtithe') {
                builderSlots = ["nautika", "semmelweis", "sentinel", "rubuska"];
                selectedManifest = "mountain_ghost";
            } else if (type === 'impromptu') {
                builderSlots = ["barcarola", "paperheron", "matilda", "kiperina"];
                selectedManifest = "star_misfortune";
            }
            renderTeamBuilder();
            showToast("Loaded 3.x Meta Team + Myth Manifest preset!");
        }

        function renderTeamBuilder() {
            const slotTitles = ["Slot 1 • Primary Carry", "Slot 2 • Core Enabler", "Slot 3 • Sub-DPS / Buffer", "Slot 4 • Sustain / Anchor"];
            document.getElementById('active-slot-label').textContent = slotTitles[activeBuilderSlot];

            const slotsContainer = document.getElementById('builder-slots');
            const charCardsHtml = builderSlots.map((cId, idx) => {
                const c = characters.find(item => item.id === cId);
                const isSelected = idx === activeBuilderSlot;
                const borderStyle = isSelected ? 'border-2 border-parchment-800 ring-2 ring-parchment-400' : 'suitcase-border';

                if (!c) {
                    return `
                        <div onclick="selectBuilderSlot(${idx})" class="bg-parchment-100/80 hover:bg-parchment-100 rounded-2xl p-4 ${borderStyle} cursor-pointer transition flex flex-col items-center justify-center min-h-[145px] text-center">
                            <span class="text-[10px] font-mono font-bold uppercase tracking-wider text-parchment-600 mb-2">${slotTitles[idx]}</span>
                            <div class="w-9 h-9 rounded-full bg-parchment-200 text-parchment-700 flex items-center justify-center mb-1">
                                <i data-lucide="plus" class="w-4 h-4"></i>
                            </div>
                            <span class="text-xs text-parchment-600">Assign Arcanist</span>
                        </div>
                    `;
                }

                return `
                    <div onclick="selectBuilderSlot(${idx})" class="bg-parchment-50 rounded-2xl p-4 ${borderStyle} cursor-pointer transition flex flex-col justify-between min-h-[145px]">
                        <div>
                            <div class="flex items-center justify-between text-[10px] font-mono font-bold uppercase tracking-wider text-parchment-600 mb-1.5">
                                <span>${slotTitles[idx]}</span>
                                ${isSelected ? '<span class="px-1.5 py-0.5 rounded bg-parchment-800 text-parchment-50">Active</span>' : ''}
                            </div>
                            <h4 class="font-serif font-bold text-base text-parchment-900">${c.name} ${charEuphTag(c) ? `<span class="text-[10px] font-mono px-1 rounded bg-amber-800 text-parchment-50">${charEuphTag(c)}</span>` : ''}</h4>
                            <div class="flex items-center gap-1.5 mt-1">
                                <span class="px-2 py-0.5 rounded text-[10px] font-bold ${getAfflatusBadge(c.afflatus)}">${c.afflatus}</span>
                                <span class="text-[11px] text-parchment-700">${(c.suffix || []).join(' / ') || '—'}</span>
                            </div>
                        </div>
                        <div class="pt-2.5 mt-2.5 border-t border-parchment-200 flex items-center justify-between text-[11px]">
                            <span class="text-parchment-600">Tags:</span>
                            <span class="text-parchment-900 font-bold text-right">${charTagNames(c).slice(0, 2).join(' / ') || '—'}</span>
                        </div>
                    </div>
                `;
            }).join('');

            // 5th Slot: Myth Manifest Card
            const mObj = mythManifests.find(m => m.id === selectedManifest) || mythManifests[0];
            const manifestCardHtml = mObj ? `
                <div class="bg-parchment-800 text-parchment-50 rounded-2xl p-4 border-2 border-parchment-500 flex flex-col justify-between min-h-[145px] shadow-md">
                    <div>
                        <div class="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-amber-300 mb-1.5">
                            <span>5th Slot • Myth Manifest</span>
                            <span>Lvl 30</span>
                        </div>
                        <h4 class="font-serif font-bold text-base text-parchment-50">${mObj.name}</h4>
                        <span class="inline-block mt-1 px-2 py-0.5 rounded bg-parchment-700 text-parchment-200 text-[10px] font-mono">${mObj.element}</span>
                    </div>
                    <p class="text-[11px] text-parchment-200 leading-snug pt-2 border-t border-parchment-700 mt-2">
                        ${mObj.bonus}
                    </p>
                </div>
            ` : `
                <div class="bg-parchment-100/80 rounded-2xl p-4 suitcase-border flex flex-col items-center justify-center min-h-[145px] text-center">
                    <i data-lucide="orbit" class="w-7 h-7 text-parchment-500 mb-1.5"></i>
                    <span class="text-xs text-parchment-600">No Myth Manifests loaded</span>
                </div>
            `;

            slotsContainer.innerHTML = charCardsHtml + manifestCardHtml;

            // Roster Picker
            const rosterGrid = document.getElementById('builder-roster-grid');
            rosterGrid.innerHTML = characters.map(c => {
                const inTeam = builderSlots.includes(c.id);
                return `
                    <div onclick="assignCharToSlot('${c.id}')" class="p-2.5 rounded-xl border ${inTeam ? 'bg-parchment-200 border-parchment-700' : 'bg-parchment-100/80 hover:bg-parchment-200/70 border-parchment-300'} cursor-pointer transition">
                        <div class="flex items-center justify-between">
                            <span class="font-serif font-bold text-xs text-parchment-900">${c.name} ${charEuphTag(c) ? `[${charEuphTag(c)}]` : ''}</span>
                            <span class="text-[9px] font-bold px-1.5 py-0.5 rounded ${getAfflatusBadge(c.afflatus)}">${c.afflatus}</span>
                        </div>
                        <p class="text-[10px] text-parchment-800 font-semibold mt-1">${charTagNames(c).slice(0, 2).join(' / ') || '—'}</p>
                        <p class="text-[10px] text-parchment-600">${inTeam ? '✓ Assigned' : ((c.suffix || []).join(' / ') || c.dmgType || '—')}</p>
                    </div>
                `;
            }).join('');

            // Manifest Picker
            const manifestGrid = document.getElementById('manifest-picker-grid');
            manifestGrid.innerHTML = mythManifests.map(m => {
                const active = m.id === selectedManifest;
                return `
                    <div onclick="selectMythManifest('${m.id}')" class="p-2.5 rounded-xl border ${active ? 'bg-parchment-800 text-parchment-50 border-parchment-600' : 'bg-parchment-100 hover:bg-parchment-200 text-parchment-900 border-parchment-300'} cursor-pointer transition">
                        <p class="font-serif font-bold text-xs">${m.name}</p>
                        <p class="text-[10px] font-mono ${active ? 'text-amber-300' : 'text-parchment-600'} mt-0.5">${m.element}</p>
                    </div>
                `;
            }).join('');

            evaluateTeamSynergy();
            lucide.createIcons();
        }

        function evaluateTeamSynergy() {
            const picked = builderSlots.map(id => characters.find(c => c.id === id)).filter(Boolean);
            const container = document.getElementById('team-analysis-content');
            const mObj = mythManifests.find(m => m.id === selectedManifest);

            if (picked.length === 0) {
                container.innerHTML = `<p class="text-parchment-700 italic">Assign Arcanists to inspect 3.x archetype synergy.</p>`;
                return;
            }

            const counts = {};
            picked.forEach(c => { charTagNames(c).forEach(n => { counts[n] = (counts[n] || 0) + 1; }); });

            let dominantArch = "Mixed Flex Lineup";
            let archScore = "Standard Synergy";
            for (const [arch, num] of Object.entries(counts)) {
                if (num >= 3) { dominantArch = `${arch} Full Engine (${num}/4)`; archScore = "T0 Apex Synergy"; }
                else if (num === 2 && dominantArch === "Mixed Flex Lineup") { dominantArch = `${arch} Dual Core (2/4)`; archScore = "Strong Hybrid Synergy"; }
            }

            const hasSustain = picked.some(c => (c.suffix || []).includes("Sustain"));
            const hasCarry = picked.some(c => (c.suffix || []).includes("DPS"));

            container.innerHTML = `
                <div class="p-3 rounded-xl bg-parchment-100 border border-parchment-300">
                    <span class="text-[10px] font-mono uppercase tracking-wider text-parchment-600 font-bold block">Detected 3.x Engine</span>
                    <span class="font-serif font-bold text-sm text-parchment-900">${dominantArch}</span>
                    <span class="block text-[11px] text-amber-800 font-semibold mt-0.5">${archScore}</span>
                </div>
                <div class="flex items-center justify-between p-2.5 rounded-lg bg-parchment-100 border border-parchment-200">
                    <span class="text-parchment-700">Primary Carry Check:</span>
                    <span class="font-bold ${hasCarry ? 'text-emerald-800' : 'text-amber-700'}">${hasCarry ? '✓ Main DPS Active' : '⚠ Add a Main Carry'}</span>
                </div>
                <div class="flex items-center justify-between p-2.5 rounded-lg bg-parchment-100 border border-parchment-200">
                    <span class="text-parchment-700">Hadal Sustain Coverage:</span>
                    <span class="font-bold ${hasSustain ? 'text-emerald-800' : 'text-amber-700'}">${hasSustain ? '✓ Sustain Covered' : '⚠ Missing Shielder/Healer'}</span>
                </div>
                <div class="flex items-center justify-between p-2.5 rounded-lg bg-parchment-100 border border-parchment-200">
                    <span class="text-parchment-700">Myth Manifest Pairing:</span>
                    <span class="font-bold text-parchment-900">${mObj ? mObj.name : 'None'}</span>
                </div>
            `;
        }

        // ==========================================
        // PULL GUIDE & PITY CALCULATOR
        // ==========================================
        function calculatePullBudget() {
            const drops = parseInt(document.getElementById('pity-drops')?.value || 0, 10);
            const unilogs = parseInt(document.getElementById('pity-unilogs')?.value || 0, 10);
            const currentPity = parseInt(document.getElementById('pity-current')?.value || 0, 10);
            const isGuaranteed = document.getElementById('pity-guaranteed')?.checked || false;

            const pullsFromDrops = Math.floor(drops / 180);
            const totalPulls = pullsFromDrops + unilogs;
            const pullsToNextSixStar = Math.max(0, 70 - currentPity);
            const pullsToHardGuarantee = isGuaranteed ? pullsToNextSixStar : (70 - currentPity) + 70;

            const bar = document.getElementById('pity-result-bar');
            const canGuarantee = totalPulls >= pullsToHardGuarantee;

            bar.innerHTML = `
                <div class="space-y-0.5">
                    <span class="text-[11px] font-mono uppercase tracking-wider text-parchment-300">Total Available Pulls</span>
                    <p class="font-mono text-lg font-bold text-amber-300">${totalPulls} Pulls <span class="text-xs font-normal text-parchment-200">(${pullsFromDrops} from Drops + ${unilogs} Unilogs)</span></p>
                </div>
                <div class="space-y-0.5">
                    <span class="text-[11px] font-mono uppercase tracking-wider text-parchment-300">Hard Pity Distance</span>
                    <p class="font-mono text-sm font-bold text-parchment-50">Next 6★ in ≤${pullsToNextSixStar} pulls • Featured Guarantee in ≤${pullsToHardGuarantee} pulls</p>
                </div>
                <div class="shrink-0">
                    <span class="px-3 py-1.5 rounded-lg font-mono text-xs font-bold ${canGuarantee ? 'bg-emerald-800 text-parchment-50' : 'bg-amber-700 text-parchment-50'}">
                        ${canGuarantee ? '✓ Featured 6★ Guaranteed!' : `Need ${pullsToHardGuarantee - totalPulls} More Pulls for 100%`}
                    </span>
                </div>
            `;
        }

        function renderPullBanners() {
            const container = document.getElementById('pull-banners-list');
            container.innerHTML = pullBanners.map(b => `
                <div class="bg-parchment-50 rounded-2xl p-6 suitcase-border flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div class="space-y-1.5 max-w-3xl">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="text-xs font-mono font-bold uppercase tracking-wider text-parchment-600">${b.patch}</span>
                            <span class="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold ${b.ratingColor}">${b.rating}</span>
                        </div>
                        <h3 class="font-serif text-lg font-bold text-parchment-900">${b.title}</h3>
                        <p class="text-xs font-semibold text-parchment-700">Focus: ${b.unitFocus}</p>
                        <p class="text-xs text-parchment-800 leading-relaxed pt-1">${b.verdict}</p>
                    </div>
                    <div class="shrink-0">
                        <button onclick="switchTab('char-tierlist')" class="px-4 py-2 rounded-xl bg-parchment-200 hover:bg-parchment-300 text-parchment-900 text-xs font-semibold transition cursor-pointer">
                            Inspect 3.x Builds →
                        </button>
                    </div>
                </div>
            `).join('');
        }

        // ==========================================
        // WALKTHROUGH MODE SWITCHER
        // ==========================================
        function switchWalkthroughMode(modeKey) {
            document.querySelectorAll('.wm-btn').forEach(btn => {
                btn.className = "wm-btn px-3.5 py-2 rounded-xl text-xs font-semibold bg-parchment-200 text-parchment-800 hover:bg-parchment-300 transition cursor-pointer";
            });
            const activeBtn = document.getElementById('wm-btn-' + modeKey);
            if (activeBtn) {
                activeBtn.className = "wm-btn px-3.5 py-2 rounded-xl text-xs font-semibold bg-parchment-800 text-parchment-50 transition cursor-pointer";
            }

            const data = walkthroughData[modeKey];
            const area = document.getElementById('walkthrough-content-area');

            if (!data) {
                area.innerHTML = `
                    <div class="bg-parchment-50 rounded-2xl p-8 suitcase-border text-center fade-in">
                        <i data-lucide="cloud-off" class="w-8 h-8 text-parchment-500 mx-auto mb-3"></i>
                        <p class="font-serif font-bold text-lg text-parchment-900">Walkthrough data unavailable</p>
                        <p class="text-xs text-parchment-600 mt-1.5">Start the local server (<span class="font-mono bg-parchment-100 px-1.5 py-0.5 rounded border border-parchment-300">node server.js</span>) and refresh this page.</p>
                    </div>`;
                lucide.createIcons();
                return;
            }

            area.innerHTML = `
                <div class="bg-parchment-50 rounded-2xl p-6 suitcase-border space-y-6 fade-in">
                    <div class="border-b border-parchment-200 pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <h3 class="font-serif text-xl font-bold text-parchment-900">${data.title}</h3>
                        <span class="px-3 py-1 rounded-lg bg-parchment-200 text-parchment-900 font-mono text-xs font-semibold">Rewards: ${data.reward}</span>
                    </div>

                    <div>
                        <h4 class="font-serif font-bold text-sm uppercase tracking-wider text-parchment-700 mb-3">Key Timekeeper Tactical Notes</h4>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                            ${data.tips.map((tip, i) => `
                                <div class="p-3.5 rounded-xl bg-parchment-100 border border-parchment-300 text-xs text-parchment-800 leading-relaxed">
                                    <span class="font-mono font-bold text-parchment-900 block mb-1">Directive 0${i + 1}</span>
                                    ${tip}
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <div>
                        <h4 class="font-serif font-bold text-sm uppercase tracking-wider text-parchment-700 mb-3">Boss Mechanics & Recommended 3.x Lineups</h4>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            ${data.bosses.map(b => `
                                <div class="p-4 rounded-xl bg-parchment-100 border border-parchment-300 space-y-2">
                                    <span class="text-[11px] font-mono font-bold uppercase tracking-wider text-parchment-600">${b.stage}</span>
                                    <h5 class="font-serif font-bold text-base text-parchment-900">${b.boss}</h5>
                                    <p class="text-xs text-parchment-900"><strong>Recommended Meta Lineup:</strong> ${b.recommended}</p>
                                    <p class="text-xs text-parchment-700 leading-relaxed">${b.mechanic}</p>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            `;
        }

        // ==========================================
        // ACCORDION, MODAL & CLIPBOARD UTILITIES
        // ==========================================
        function toggleAccordion(id) {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('hidden');
        }

        function openSupportModal() {
            const modal = document.getElementById('support-modal');
            modal.classList.remove('hidden');
            modal.classList.add('flex');
        }

        function closeSupportModal() {
            const modal = document.getElementById('support-modal');
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }

        function openPullGuideModal() {
            const modal = document.getElementById('pull-guide-modal');
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            lucide.createIcons();
        }

        function closePullGuideModal() {
            const modal = document.getElementById('pull-guide-modal');
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }

        function triggerSupportToast(tierName) {
            closeSupportModal();
            showToast(`Thank you, Timekeeper! Selected support tier: ${tierName}`);
        }

        function copyShareUrl() {
            copyText("https://pocketsuitcase.timekeeper.guide");
            closeSupportModal();
        }

        function copyText(text) {
            const tempInput = document.createElement("textarea");
            tempInput.value = text;
            document.body.appendChild(tempInput);
            tempInput.select();
            document.execCommand("copy");
            document.body.removeChild(tempInput);
            showToast(`Copied "${text}" to clipboard!`);
        }

        function showToast(message) {
            const toast = document.getElementById('toast');
            const msg = document.getElementById('toast-msg');
            msg.textContent = message;
            toast.classList.remove('opacity-0', 'translate-y-2');
            toast.classList.add('opacity-100', 'translate-y-0');

            setTimeout(() => {
                toast.classList.remove('opacity-100', 'translate-y-0');
                toast.classList.add('opacity-0', 'translate-y-2');
            }, 2800);
        }

        function startResetClock() {
            const timerEl = document.getElementById('reset-timer');
            let secondsLeft = 6 * 3600 + 18 * 60 + 45;
            setInterval(() => {
                secondsLeft = secondsLeft > 0 ? secondsLeft - 1 : 86400;
                const h = String(Math.floor(secondsLeft / 3600)).padStart(2, '0');
                const m = String(Math.floor((secondsLeft % 3600) / 60)).padStart(2, '0');
                const s = String(secondsLeft % 60).padStart(2, '0');
                if (timerEl) timerEl.textContent = `${h}:${m}:${s}`;
            }, 1000);
        }
