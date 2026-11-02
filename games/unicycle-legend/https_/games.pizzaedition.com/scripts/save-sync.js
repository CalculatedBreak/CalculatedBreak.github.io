// PizzaEdition cross-device game-save sync -- v14 (2026-10-05, owner-approved "do all of the account fixes").
//
// v14 IS A POLICY CHANGE, NOT A PATCH. Read this block before touching anything below it.
//
// OWNER POLICY: when a game opens for a signed-in account, THE ACCOUNT'S SERVER COPY OF THAT GAME IS THE
// SOURCE OF TRUTH. This browser's copy is uploaded only when
//   (a) the account has NO save for this game at all, or
//   (b) it is a clean continuation ("fast-forward"): this device's marker is for THIS uid, the marker's
//       server time equals the row's updated_at (nobody else saved since this device last synced), and
//       local changed since -- i.e. offline play, or a final flush whose request never landed.
// Anything else (guest progress made before signing in, another account's marker, a diverged copy)
// RESTORES the server row. A failed / timed-out server check is NEVER read as "the account has no data".
// v13's "no marker -> local wins" rule is GONE: it let a device that had merely opened a game as a guest
// (and so written the game's defaults) overwrite the account's real progress, which then spread to every
// other device (audit 2026-10-04, repro S1/S1b).
//
// MADE REVERSIBLE: before a restore replaces real progress on this device, this device's copy is kept in a
// separate, never-synced IndexedDB database (pzsync-backup, last 3 per game). After the reload a small
// in-game banner says "Loaded your account's progress (saved <date>). This device had different progress.
// [Use this device's instead]"; one tap applies the backup locally and force-uploads it. The account drawer
// can re-arm that banner later (session-bridge.html v6, pzsync:<slug>:undo).
//
// THE REST OF v14, each a reproduced failure from the 2026-10-04 audit:
//   * Nothing is uploaded until the first check-in on THIS page load has succeeded, and never after a
//     failed restore (S3: on a slow network the game's boot defaults used to go up before the first read
//     came back). A check-in that fails is retried with backoff instead of disabling sync for the page.
//   * Uploads are COMPARE-AND-SWAP when the server has public.save_game() (proposals/supabase-save-game-cas.sql):
//     the client sends the row's updated_at it last saw and the server refuses if it moved, so an old tab
//     can no longer overwrite newer progress from another device (audit S3 stale tab). Without the RPC
//     (owner has not applied the SQL yet) the same check is a plain read-before-write. Detection is a
//     PGRST202 probe, cached in localStorage. A refused save pauses uploads and shows "Newer progress for
//     this game was saved on another device. Reload".
//   * A restore REPLACES this game's own keys/records (scoped by pzsync:own) instead of overlaying them,
//     so a device no longer ends up with a mix of two saves. Every restore error is caught: the device's
//     copy is put back, the restoring flag and the cross-tab guard are always cleared, and the game's own
//     writes keep working (S4b: a QuotaExceeded used to drop every game write for the rest of the page).
//     The 2-minute loop guard now pauses UPLOADS only; it never drops game writes. A local database at a
//     higher version than the row's is opened at its existing version (S4: VersionError used to make the
//     restore fail and then upload {stores:{}} over the account's IndexedDB save).
//   * The size cap counts only THIS game's own records, and cache-like records (Unity's UnityCache and
//     analytics dirs, Defold's resources*.zip / *_ext/*.zip / http-cache / liveupdate.mounts) are never
//     read, claimed or synced -- so Monkey Mart / MX2 / Fish Eat Fish / Perfect Peel sync their real saves,
//     and an unrelated game on a device that has played them no longer stops syncing (S2).
//   * Saves over ~48 KB are stored gzip+base64 ({v,at,z:"gzip-b64",d}); a pagehide / tab-hidden upload is
//     a direct keepalive fetch with the cached token (like the play-time RPC), using a payload compressed
//     ahead of time, because nothing asynchronous survives a closing tab (S6: a 200 KB save was lost on
//     close). An upload that fails is re-marked dirty and retried with backoff. An unload upload whose
//     response never arrives leaves pzsync:<slug>:pending, so the next open recognises its own write.
//   * Keys several games write (OvO + OvO Dimensions' localforage DedraOvO, the c3-localstorage-1g7gr0zpzy8
//     MyGameData family) have SEVERAL owners; a key a game has written stays in that game's row.
//   * A game calling localStorage.clear() no longer wipes the account session, the sync bookkeeping or
//     other games' saves: clear() removes only keys that are not owned solely by another game.
//   * Signing in (or out) on the portal while a game is open takes effect at once: the session written to
//     this origin by the bridge fires a `storage` event here, and the portal also posts
//     {type:"pz-account-changed"}; either one re-checks the account and runs the check-in immediately.
//   * "Can't sync" is said out loud: a one-line console warning plus a small in-game notice for a save over
//     the cap, unreadable server data, a failed restore, or (when the portal says you are signed in) a
//     browser that blocks site data. pzsync:<slug>:nosync records it for the drawer.
//   * Device clocks are no longer compared with anything (the v2-v13 conflict tie-break used payload.at vs
//     the device's last-write clock; Chromebook clocks jump). pzsync:<slug>:writtenAt is no longer written.
//
// UNCHANGED FROM v13: guests (no account) are never sent to any server and pay for nothing but the storage
// hooks and pzsync:own bookkeeping; the row key is the PUBLIC slug (SLUG_MAP, generated by
// tools/build-slug-map.js); play time goes to bump_play_time(); the worker-mode IndexedDB poll; the
// cross-tab restore signal on pzsync:<slug>:restoredAt; MUST load as a plain synchronous <script> in <head>
// before any game script.
//
// Debug: ?pzdebug=1 on the game URL turns on verbose console logging.
//        window.PZ_NO_SAVE_SYNC = true (before this script) disables it.
//        window.PZ_SAVE_SYNC.state() reports where the sync is (tests read it).
// History of v1-v13 is in git (the v13 header) and in CLAUDE.md's "Cross-device game-save sync" section.
(function () {
    "use strict";

    var SCRIPT_VERSION = 14;
    var SUPA_URL = "https://nudftayhujlpcnznmwbg.supabase.co";
    var SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51ZGZ0YXlodWpscGNuem5td2JnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2OTA5NDcsImV4cCI6MjEwNTI2Njk0N30.dieVei5-I8oDMPFfLwJoKTM4dtJOYz0cFXP1xibjWbo";
    var SUPA_AUTH_KEY = "sb-nudftayhujlpcnznmwbg-auth-token"; // supabase-js's storage key for this project (persistSession)
    // Self-hosted copy of @supabase/supabase-js@2.116.0 (versioned folder, never a CDN -- school filters).
    var SUPA_LIB = "/scripts/supabase/2.116.0/supabase.js";
    var PAYLOAD_VERSION = 1;
    var MAX_BYTES = 1024 * 1024;         // this game's own save, uncompressed; over this we skip, never truncate
    var DEBOUNCE_MS = 3000;              // quiet period after the last write before an upload
    var MAX_DEBOUNCE_MS = 10000;         // ...but never wait longer than this from the first unsynced write
    var MIN_UPLOAD_GAP_MS = 8000;        // never more than one upload per this window
    var POLL_MS = 10000;                 // catches localStorage["k"] = v writes the patches cannot see
    var IDB_POLL_EVERY = 2;              // worker-mode games only: re-snapshot IndexedDB every Nth poll
    var RESTORE_RELOAD_GUARD_MS = 120000;// never restore the same server row twice within this window
    var FOREIGN_RESTORE_TIMEOUT_MS = 30000; // another tab said "restoring" and then went silent: resume after this
    var KEEPALIVE_MAX = 60000;           // Chrome caps in-flight keepalive bodies at 64 KiB per document
    var COMPRESS_OVER = 48000;           // a payload bigger than this is stored gzip+base64
    var PREPARE_MS = 1500;               // after a write, the unload copy is (re)built this much later
    var RETRY_MS = [2000, 5000, 10000, 20000, 40000, 60000];
    var RPC_CACHE_YES_MS = 7 * 864e5, RPC_CACHE_NO_MS = 6 * 36e5;
    var BACKUP_DB = "pzsync-backup", BACKUP_STORE = "backups", BACKUP_KEEP = 3;
    var PORTAL_ORIGINS = ["https://pizzaedition.com", "https://www.pizzaedition.com"];
    var OWN_PREFIX = "pzsync:";
    var IGNORE_KEY = /^GA::/;            // GameAnalytics SDK state: identifiers/session counters, not progress
    // Whole databases that are caches, never progress (+ our own backup database, which must never travel).
    var IGNORE_DB = /^UnityCache$|cache|^\/idbfs-test$|^pzsync-backup$/i;
    // Individual RECORDS inside a shared Emscripten store that are re-downloadable assets, not saves. Measured on
    // the live games 2026-10-05: Monkey Mart /data/.MonkeyMart/resources.zip 3.4 MB, MX2 /data/.msm2_ext/<sha>.zip
    // 23 MB, Fish Eat Fish /data/.fish_eat_fish/resources_<hash>.zip 16 MB, Perfect Peel
    // /idbfs/<hash>/UnityCache/Shared/.../__data 24 MB. liveupdate.mounts only lists those archives.
    var CACHE_REC = /(^|\/)UnityCache(\/|$)|\/Unity\/[^\/]+\/Analytics(\/|$)|\.zip$|\/http-cache(\/|$)|\/liveupdate\.mounts$/i;
    var PLAY_REPORT_MS = 60000;          // account play time: report the visible seconds banked so far this often
    var PLAY_MAX_PER_CALL = 3600;        // what bump_play_time() accepts per call
    var TAG = "[save-sync]";
    var DEBUG = /[?&]pzdebug=1(?:&|$)/.test(location.search);

    if (window.PZ_NO_SAVE_SYNC) return;
    var slug = "";
    try { slug = decodeURIComponent(location.pathname.split("/")[1] || ""); } catch (e) {}
    slug = slug.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 100);
    if (!slug) return;
    // v12(B): this origin's FOLDER name is not the game's public slug for 73 of 290 games, and the account
    // drawer looks rows up by the public one. Generated block -- edit tools/build-slug-map.js, never here.
    /* PZ-SLUG-MAP:START */
    var SLUG_MAP = {
        "0v0": "OvO",
        "10minutestilldawn": "10minutestildawn",
        "1v1-lol-main": "1v1lol",
        "AwesomeTanks2": "awesometanks2",
        "BasketRandom": "basketrandom",
        "Boxing-Random": "boxingrandom",
        "ClusterRush": "clusterrush",
        "CrazyCars": "crazycars",
        "EggyCar": "eggycar",
        "FunnyShooter2": "funnyshooter2",
        "Gunblood": "gunblood",
        "RagdollArchers": "ragdollarchers",
        "RocketSoccerDerby": "rocketsoccerderby",
        "Sketchbook": "sketchbook",
        "Snow-Rider3D-main": "snowrider3d",
        "StickMerge": "stickmerge",
        "The-Impossible-Quiz-main": "impossiblequiz",
        "TunnelRush2": "tunnelrush2",
        "WebGL-Fluid": "webglfluid",
        "a-dance-of-fire-ice": "adanceoffireandice",
        "arcade-car-drift": "arcadecardrift",
        "archery-world-tour": "archeryworldtour",
        "astrosurvivor": "astrosurvivors",
        "aswc2": "asmallworldcup2",
        "baldis-basics": "baldisbasics",
        "big-tower-tiny-square-2": "bigtowertinysquare2",
        "blacktop-police-chase": "policechase",
        "blumgi-bounce": "blumgibounce",
        "blumgi-splash": "blumgisplash",
        "bowsmasters": "bowmasters",
        "capybara-clicker": "cappybaraclicker",
        "circloonew": "circloo",
        "crazy-bikes": "crazybikes",
        "crossyroadnormal": "crossyroad",
        "deal-or-no-deal": "dealornodeal",
        "doodle-jump-new": "doodlejump",
        "dreadhead-parkour": "dreadheadparkour",
        "drive-mad": "drivemad",
        "fear-response": "fearresponse",
        "fnaf1": "FNAF1",
        "fnaf2": "FNAF2",
        "fnaf3": "FNAF3",
        "fnaf4": "FNAF4",
        "free-rider-jumps": "freeriderjumps",
        "going-balls": "goingballs",
        "googlefued": "googlefeud",
        "gunspin-main": "gunspin",
        "gym-stack": "gymstack",
        "hillcimbracing": "hillclimbracing",
        "hw": "happywheels",
        "idle-breakout": "idlebreakout",
        "idle-dices": "idledices",
        "littlealchemy": "littlealc",
        "madalin-stunt-cars-3": "madalincars3",
        "moto-x3m": "motox3m",
        "neon-swing": "neonswing",
        "racesurvivalv2": "racesurvival",
        "revolutionidle": "idlerevolution",
        "rooftop-snipers": "rooftopsnipers",
        "run-3": "run3",
        "slime-dunk": "slimedunk",
        "stickman-hook": "stickmanhook",
        "stickmanclimb3d2": "stickmanclimb3d",
        "stunt-bike-extreme": "stuntbikeextreme",
        "super-foulist": "superfowlst",
        "super-hot": "superhot",
        "tabletennis-worldtour": "tabletennisworldtour",
        "tanuki-sunset": "TanukiSunset",
        "there-is-no-game": "thereisnog",
        "tiny-fishing": "tinyfishing",
        "tomb-of-the-mask": "tombofthemask",
        "tube-jumpers": "tubejumpers",
        "turbo-moto-racer": "turbomotoracer",
        "unicycle-hero": "unicyclehero",
        "wordle-unlimited-main": "wordle",
    };
    /* PZ-SLUG-MAP:END */
    var folderSlug = slug;
    if (Object.prototype.hasOwnProperty.call(SLUG_MAP, folderSlug)) slug = SLUG_MAP[folderSlug];

    function dlog() { if (DEBUG) { try { console.log.apply(console, [TAG].concat([].slice.call(arguments))); } catch (e) {} } }
    function warn() { try { console.warn.apply(console, [TAG].concat([].slice.call(arguments))); } catch (e) {} }
    function msg(e) { return String((e && e.message) || e); }

    // ---- small in-game notices (shadow DOM, so nothing leaks into or out of the game's own styles) ----
    var noticeHost = null, noticeRoot = null;
    function whenBody(fn) {
        if (document.body) return fn();
        document.addEventListener("DOMContentLoaded", function () { fn(); }, { once: true });
    }
    function notice(id, text, actions, ttlMs) {
        whenBody(function () {
            try {
                if (!noticeHost) {
                    noticeHost = document.createElement("div");
                    noticeHost.setAttribute("data-pz-save-sync", "");
                    noticeHost.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:2147483647;max-width:min(92vw,400px);pointer-events:none;margin:0;padding:0;";
                    noticeRoot = noticeHost.attachShadow ? noticeHost.attachShadow({ mode: "open" }) : noticeHost;
                    var css = document.createElement("style");
                    css.textContent = ".n{pointer-events:auto;display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin-top:6px;padding:9px 34px 9px 12px;position:relative;" +
                        "border-radius:12px;background:rgba(22,22,22,.94);color:#fff;font:500 13px/1.35 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.14)}" +
                        ".n span{flex:1 1 200px}.n button{font:600 12.5px/1 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;border:0;border-radius:999px;padding:7px 12px;cursor:pointer;background:rgba(255,255,255,.12);color:#fff}" +
                        ".n button.p{background:#1f6dff}.n button.x{position:absolute;top:6px;right:6px;width:22px;height:22px;padding:0;background:none;font-size:16px;line-height:22px;color:rgba(255,255,255,.7)}";
                    noticeRoot.appendChild(css);
                    document.body.appendChild(noticeHost);
                }
                dropNotice(id);
                var box = document.createElement("div");
                box.className = "n"; box.setAttribute("data-id", id); box.setAttribute("role", "status");
                var t = document.createElement("span"); t.textContent = text; box.appendChild(t);
                (actions || []).forEach(function (a) {
                    var b = document.createElement("button"); b.type = "button"; b.textContent = a.label; if (a.primary) b.className = "p";
                    b.addEventListener("click", function () { try { a.run(box, b); } catch (e) {} });
                    box.appendChild(b);
                });
                var x = document.createElement("button"); x.type = "button"; x.className = "x"; x.setAttribute("aria-label", "Dismiss"); x.textContent = "\u00d7";
                x.addEventListener("click", function () { dropNotice(id); });
                box.appendChild(x);
                noticeRoot.appendChild(box);
                if (ttlMs) setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, ttlMs);
            } catch (e) {}
        });
    }
    function dropNotice(id) {
        try { var o = noticeRoot && noticeRoot.querySelector('[data-id="' + id + '"]'); if (o) o.parentNode.removeChild(o); } catch (e) {}
    }
    function notices() {
        try { return [].map.call(noticeRoot ? noticeRoot.querySelectorAll(".n") : [], function (n) { return { id: n.getAttribute("data-id"), text: n.querySelector("span").textContent }; }); }
        catch (e) { return []; }
    }

    // ---- storage availability (managed Chromebook profiles can block all of it) ----
    var ls = null;
    try {
        ls = window.localStorage;
        ls.setItem(OWN_PREFIX + "probe", "1");
        ls.removeItem(OWN_PREFIX + "probe");
    } catch (e) {
        // Nothing can be synced and there is nowhere to keep a session. Say so -- but only to someone the portal
        // says is signed in (a guest on a locked-down Chromebook has nothing to be told). The portal answers
        // pz-account-query with pz-account-changed; any later sign-in posts pz-account-changed too.
        try {
            var told = false;
            window.addEventListener("message", function (ev) {
                if (PORTAL_ORIGINS.indexOf(ev.origin) === -1) return;
                var d = ev.data;
                if (!d || typeof d !== "object" || d.type !== "pz-account-changed" || !d.signedIn || told) return;
                told = true;
                warn("this browser blocks site data for games.pizzaedition.com, so progress in this game cannot be saved to your account");
                notice("nosync", "This browser is blocking saved data, so progress in this game can't be saved to your account.", null, 20000);
            });
            PORTAL_ORIGINS.forEach(function (o) { try { window.top.postMessage({ type: "pz-account-query" }, o); } catch (x) {} });
            window.PZ_SAVE_SYNC = { version: PAYLOAD_VERSION, script: SCRIPT_VERSION, slug: slug, folderSlug: folderSlug, blocked: true,
                                    mode: function () { return null; }, localOnly: function () { return true; }, notices: notices,
                                    state: function () { return { storage: false }; } };
        } catch (x) {}
        return;
    }

    // Raw methods, captured BEFORE the prototypes are patched below: our own bookkeeping, restores and backups
    // must never look like a game write.
    var rawSetItem = Storage.prototype.setItem;
    var rawRemoveItem = Storage.prototype.removeItem;
    var rawClear = Storage.prototype.clear;
    var rawGetItem0 = Storage.prototype.getItem;
    function rawGetItem(k) { return rawGetItem0.call(ls, k); }
    var IDBOS = window.IDBObjectStore ? IDBObjectStore.prototype : null;
    var rawIdbPut = IDBOS ? IDBOS.put : null, rawIdbAdd = IDBOS ? IDBOS.add : null;
    var rawIdbDelete = IDBOS ? IDBOS["delete"] : null, rawIdbClear = IDBOS ? IDBOS.clear : null;

    function isOwnKey(k) {
        // supabase-js keeps its session under sb-<ref>-auth-token (+ -code-verifier); those and our own
        // bookkeeping must never travel to another device.
        return typeof k !== "string" || k.indexOf("sb-") === 0 || k.indexOf(OWN_PREFIX) === 0;
    }

    // ---- per-device bookkeeping ----
    var STATE_KEY = OWN_PREFIX + slug + ":sync";       // {uid, serverAt, hash}: the row this device last uploaded / restored
    var PENDING_KEY = OWN_PREFIX + slug + ":pending";  // {uid, base, hash}: an upload whose response may never have arrived
    var UNDO_KEY = OWN_PREFIX + slug + ":undo";        // {id, uid, savedAt, serverAt, backedUpAt, shown}: the backup banner
    var NOSYNC_KEY = OWN_PREFIX + slug + ":nosync";    // {reason, at}: why this game cannot sync (read by the drawer via the bridge)
    // GUARD_KEY doubles as the cross-tab restore signal: "<startedMs>:<rowMs>" while a restore is in flight,
    // + "d" once it is written, removed if it failed. Other tabs of this game react via `storage`.
    var GUARD_KEY = OWN_PREFIX + slug + ":restoredAt";
    var RPC_KEY = OWN_PREFIX + "rpc:save_game";        // "yes|<ms>" / "no|<ms>": does public.save_game() exist?
    function guardInfo() {
        var v = null; try { v = rawGetItem(GUARD_KEY); } catch (e) {}
        if (typeof v !== "string" || !v) return null;
        var m = /^(\d+)(?::(\d+))?(d?)$/.exec(v); if (!m) return null;
        return { ts: parseInt(m[1], 10) || 0, at: m[2] ? parseInt(m[2], 10) : 0, done: m[3] === "d" };
    }
    function readJson(k) { try { return JSON.parse(rawGetItem(k)); } catch (e) { return null; } }
    function writeJson(k, v) { try { rawSetItem.call(ls, k, JSON.stringify(v)); } catch (e) {} }
    function removeKey(k) { try { rawRemoveItem.call(ls, k); } catch (e) {} }

    // ---- per-game ownership of storage keys / records (v5, multi-owner since v14) ----
    // pzsync:own = {ls:{key:owner}, rec:{"db|store|key":owner}, store:{"db|store":owner}, wr:{"kind|name":[slugs]}}
    // owner is a slug or (v14) an array of slugs. wr lists the games that have actually WRITTEN the thing:
    // a key/record nobody wrote was only claimed as a leftover by whichever game met it first, so the first real
    // writer takes it over (v5's rule); once a game has written it, a second writer is ADDED as a co-owner
    // instead (OvO + OvO Dimensions share localforage DedraOvO), so the key stays in both games' rows.
    var OWN_KEY = OWN_PREFIX + "own";
    var own = null, ownDirty = false;
    function loadOwn() {
        if (own) return own;
        try { own = JSON.parse(rawGetItem(OWN_KEY)); } catch (e) { own = null; }
        if (!own || typeof own !== "object" || typeof own.ls !== "object" || !own.ls) own = { ls: {} };
        if (typeof own.rec !== "object" || !own.rec) own.rec = {};
        if (typeof own.store !== "object" || !own.store) own.store = {};
        if (typeof own.wr !== "object" || !own.wr) own.wr = {};
        return own;
    }
    function saveOwn() { if (!ownDirty) return; ownDirty = false; try { rawSetItem.call(ls, OWN_KEY, JSON.stringify(loadOwn())); } catch (e) {} }
    function ownersOf(kind, name) { var c = loadOwn()[kind][name]; return (c === undefined || c === null) ? null : (Array.isArray(c) ? c : [c]); }
    function isMine(kind, name) { var o = ownersOf(kind, name); return !!o && o.indexOf(slug) !== -1; }
    function othersOwn(kind, name) { var o = ownersOf(kind, name); if (!o) return false; for (var i = 0; i < o.length; i++) if (o[i] !== slug) return true; return false; }
    function markWriter(kind, name) {
        var o = loadOwn(), k = kind + "|" + name, w = o.wr[k] || [];
        if (w.indexOf(slug) !== -1) return;
        o.wr[k] = w.concat([slug]).slice(-8); ownDirty = true;
    }
    // true if this game may include the key: unowned (claimed now) or already one of its owners.
    // force: the game wrote it (or it is being restored into this game) -> it is this game's too.
    function claim(kind, name, force) {
        var o = loadOwn(), cur = ownersOf(kind, name), changed = false;
        if (cur && cur.indexOf(slug) !== -1) { if (force) markWriter(kind, name); saveOwn(); return true; }
        if (cur && !force) return false;
        if (!cur) { o[kind][name] = slug; changed = true; }
        else {
            var w = o.wr[kind + "|" + name];
            o[kind][name] = (w && w.length) ? cur.concat([slug]).slice(-8) : slug;
            changed = true;
        }
        if (force) markWriter(kind, name);
        if (changed) ownDirty = true;
        saveOwn();
        return true;
    }
    // ---- timestamps: the server's own clock only, compared at microsecond precision (PostgREST and the
    //      save_game() RPC both return e.g. 2026-10-05T12:00:00.123456+00:00) ----
    function tsMicro(v) {
        if (typeof v !== "string") return null;
        var ms = Date.parse(v); if (!isFinite(ms)) return null;
        var m = /T\d\d:\d\d:\d\d(?:\.(\d+))?/.exec(v);
        var frac = (m && m[1]) ? (m[1] + "000000").slice(0, 6) : "000000";
        return Math.floor(ms / 1000) * 1e6 + parseInt(frac, 10);
    }
    function sameTs(a, b) { var x = tsMicro(a), y = tsMicro(b); return x !== null && x === y; }
    function fingerprint(s) { // two-lane FNV-1a; only ever asked "is this the same snapshot as last time?"
        var h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
        for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 ^ c, 16777619) >>> 0; }
        return s.length.toString(36) + "." + h1.toString(36) + "." + h2.toString(36);
    }
    function readState(forUid) {
        var s = readJson(STATE_KEY);
        return (s && s.uid === forUid && typeof s.serverAt === "string" && typeof s.hash === "string") ? s : null;
    }
    function writeState(forUid, serverAt, hash) {
        if (forUid && typeof serverAt === "string" && tsMicro(serverAt) !== null) writeJson(STATE_KEY, { uid: forUid, serverAt: serverAt, hash: hash });
        else removeKey(STATE_KEY); // unknown -> next load is "first contact": the account's copy wins (with a backup)
    }
    function readPending(forUid) { var p = readJson(PENDING_KEY); return (p && p.uid === forUid && typeof p.hash === "string") ? p : null; }

    // ---- canonical JSON (jsonb re-orders keys, so byte comparison needs a stable form) ----
    function stableStringify(v) {
        if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
        if (Array.isArray(v)) {
            var a = [];
            for (var i = 0; i < v.length; i++) a.push(stableStringify(v[i]));
            return "[" + a.join(",") + "]";
        }
        var keys = Object.keys(v).sort(), parts = [];
        for (var j = 0; j < keys.length; j++) {
            if (v[keys[j]] === undefined) continue;
            parts.push(JSON.stringify(keys[j]) + ":" + stableStringify(v[keys[j]]));
        }
        return "{" + parts.join(",") + "}";
    }
    function byteLength(s) {
        try { return new Blob([s]).size; } catch (e) { return s.length * 2; }
    }

    // ---- localStorage snapshot / scoped replace ----
    function snapshotLocal() {
        var out = {}, keys = [];
        try {
            for (var i = 0; i < ls.length; i++) keys.push(ls.key(i));
            for (var j = 0; j < keys.length; j++) {
                var k = keys[j];
                if (isOwnKey(k) || IGNORE_KEY.test(k)) continue;
                if (!claim("ls", k, false)) continue;   // another game's key: not ours to sync
                var v = rawGetItem(k);
                if (typeof v === "string") out[k] = v;
            }
        } catch (e) {}
        return out;
    }
    // v14: REPLACE, not overlay. This game's own keys that the incoming copy lacks are removed (a key shared with
    // another game is left alone -- it is that game's progress too); every incoming key is written. Throws on a
    // quota error: the caller rolls the whole restore back.
    function applyLocal(map) {
        var keys = [];
        for (var i = 0; i < ls.length; i++) keys.push(ls.key(i));
        keys.forEach(function (k) {
            if (isOwnKey(k) || IGNORE_KEY.test(k) || Object.prototype.hasOwnProperty.call(map, k)) return;
            if (isMine("ls", k) && !othersOwn("ls", k)) rawRemoveItem.call(ls, k);
        });
        for (var k in map) {
            if (!Object.prototype.hasOwnProperty.call(map, k) || isOwnKey(k) || IGNORE_KEY.test(k)) continue;
            if (typeof map[k] === "string") { rawSetItem.call(ls, k, map[k]); claim("ls", k, true); }
        }
        saveOwn();
    }

    // ---- IndexedDB values (structured clone is not JSON: Emscripten IDBFS stores Dates + Uint8Arrays) ----
    var TYPED = { Int8Array: 1, Uint8Array: 1, Uint8ClampedArray: 1, Int16Array: 1, Uint16Array: 1, Int32Array: 1, Uint32Array: 1, Float32Array: 1, Float64Array: 1 };
    function b64encode(u8) {
        var s = "", CH = 0x8000;
        for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
        return btoa(s);
    }
    function b64decode(str) {
        var bin = atob(str), u8 = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return u8;
    }
    function Unsupported(what) { this.what = what; }
    function encodeValue(v) {
        if (v === null || v === undefined) return null;
        var t = typeof v;
        if (t === "string" || t === "boolean") return v;
        if (t === "number") return isFinite(v) ? v : { __pz: "num", v: String(v) };
        if (t !== "object") throw new Unsupported(t);
        if (v instanceof Date) return { __pz: "date", v: v.getTime() };
        if (ArrayBuffer.isView(v)) {
            var name = v.constructor && v.constructor.name;
            if (!TYPED[name]) throw new Unsupported(name || "view");
            return { __pz: "ta", t: name, b: b64encode(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
        }
        if (v instanceof ArrayBuffer) return { __pz: "ab", b: b64encode(new Uint8Array(v)) };
        if (Array.isArray(v)) {
            var arr = [];
            for (var i = 0; i < v.length; i++) arr.push(encodeValue(v[i]));
            return arr;
        }
        var proto = Object.getPrototypeOf(v);
        if (proto !== Object.prototype && proto !== null) throw new Unsupported((v.constructor && v.constructor.name) || "object");
        var o = {};
        for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = encodeValue(v[k]);
        return Object.prototype.hasOwnProperty.call(v, "__pz") ? { __pz: "obj", o: o } : o;
    }
    function decodeValue(v) {
        if (v === null || typeof v !== "object") return v;
        if (Array.isArray(v)) {
            var arr = [];
            for (var i = 0; i < v.length; i++) arr.push(decodeValue(v[i]));
            return arr;
        }
        if (typeof v.__pz === "string") {
            switch (v.__pz) {
                case "date": return new Date(v.v);
                case "num": return Number(v.v);
                case "ab": return b64decode(v.b).buffer;
                case "ta": {
                    var u8 = b64decode(v.b), C = window[v.t];
                    return (TYPED[v.t] && C) ? new C(u8.buffer, 0, u8.byteLength / C.BYTES_PER_ELEMENT) : u8;
                }
                case "obj": return decodeValue(v.o);
            }
        }
        var o = {};
        for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = decodeValue(v[k]);
        return o;
    }
    function idbSupported() {
        try { return !!(window.indexedDB && typeof indexedDB.databases === "function"); } catch (e) { return false; }
    }
    // Rough byte size of a structured-clone value. Never exact, always cheap.
    function approxSize(v, depth) {
        if (v === null || v === undefined) return 4;
        var t = typeof v;
        if (t === "string") return v.length * 2;
        if (t !== "object") return 8;
        if (ArrayBuffer.isView(v)) return v.byteLength;
        if (v instanceof ArrayBuffer) return v.byteLength;
        if (v instanceof Date) return 8;
        if ((depth || 0) > 6) return 64;
        var n = 16;
        if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) n += approxSize(v[i], (depth || 0) + 1); return n; }
        for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) n += k.length * 2 + approxSize(v[k], (depth || 0) + 1);
        return n;
    }
    // In-line-key store owned by this game as a whole: walk it with a cursor and stop the moment it passes `room`.
    function probeStoreSize(st, room) {
        return new Promise(function (res, rej) {
            var acc = 0, req;
            try { req = st.openCursor(); } catch (e) { return rej(e); }
            req.onsuccess = function () {
                var cur = req.result;
                if (!cur) return res(acc);
                try { acc += approxSize(cur.key, 0) + approxSize(cur.value, 0); } catch (e) { acc += 64; }
                if (acc > room) return res(-1);
                cur["continue"]();
            };
            req.onerror = function () { rej(req.error || new Error("idb probe failed")); };
        });
    }
    function req2p(req) {
        return new Promise(function (res, rej) {
            req.onsuccess = function () { res(req.result); };
            req.onerror = function () { rej(req.error || new Error("idb request failed")); };
        });
    }
    // Open an EXISTING database without touching its version. If it does not exist, abort the implicit upgrade.
    function openExisting(name) {
        return new Promise(function (res, rej) {
            var req;
            try { req = indexedDB.open(name); } catch (e) { return rej(e); }
            var aborted = false;
            req.onupgradeneeded = function (e) { aborted = true; try { e.target.transaction.abort(); } catch (x) {} };
            req.onsuccess = function () { var db = req.result; db.onversionchange = function () { try { db.close(); } catch (x) {} }; res(db); };
            req.onerror = function () { if (aborted) res(null); else rej(req.error || new Error("idb open failed")); };
            req.onblocked = function () { rej(new Error("idb open blocked")); };
        });
    }
    function isInline(st) { return !(st.keyPath === null || st.keyPath === undefined || st.keyPath === ""); }
    // -> {dbs: {name: {version, stores: {name: {keyPath, autoIncrement, indexes, records}}}}, records, bytes, over, failed}
    //    or null when IndexedDB cannot be enumerated. ONLY this game's own records are read (v14): a store's other
    //    records -- another game's save, a 23 MB asset archive -- are never deserialised, never counted.
    function snapshotIdb() {
        if (!idbSupported()) return Promise.resolve(null);
        var out = {}, total = 0, bytes = 0, over = null, failed = [];
        return indexedDB.databases().then(function (list) {
            var chain = Promise.resolve();
            (list || []).forEach(function (info) {
                var name = info && info.name;
                if (!name || IGNORE_DB.test(name)) return;
                chain = chain.then(function () {
                    if (over) return;
                    return openExisting(name).then(function (db) {
                        if (!db) return;
                        var dbOut = { version: db.version, stores: {} };
                        var names = [].slice.call(db.objectStoreNames);
                        if (!names.length) { db.close(); return; }
                        var tx = db.transaction(names, "readonly");
                        return Promise.all(names.map(function (sn) {
                            var st = tx.objectStore(sn);
                            var meta = { keyPath: st.keyPath === undefined ? null : st.keyPath, autoIncrement: !!st.autoIncrement, indexes: [], records: [] };
                            [].slice.call(st.indexNames).forEach(function (ixn) {
                                var ix = st.index(ixn);
                                meta.indexes.push({ name: ixn, keyPath: ix.keyPath, unique: !!ix.unique, multiEntry: !!ix.multiEntry });
                            });
                            if (isInline(st)) {
                                if (!claim("store", name + "|" + sn, false)) return; // another game's in-line-key store
                                return probeStoreSize(st, MAX_BYTES - bytes).then(function (size) {
                                    if (size < 0) { over = name + "/" + sn; return; }
                                    return Promise.all([req2p(st.getAllKeys()), req2p(st.getAll())]).then(function (kv) {
                                        for (var i = 0; i < kv[0].length; i++) meta.records.push([encodeValue(kv[0][i]), encodeValue(kv[1][i])]);
                                        bytes += size; total += kv[0].length; dbOut.stores[sn] = meta;
                                    });
                                });
                            }
                            return req2p(st.getAllKeys()).then(function (keys) {
                                var mine = keys.filter(function (k) {
                                    var ks = String(k);
                                    return !CACHE_REC.test(ks) && claim("rec", name + "|" + sn + "|" + ks, false);
                                });
                                // one record at a time, stopping at the cap: a single oversized record is read once, never alongside the rest
                                return mine.reduce(function (p, k) {
                                    return p.then(function () {
                                        if (over) return;
                                        return req2p(st.get(k)).then(function (v) {
                                            bytes += approxSize(k, 0) + approxSize(v, 0);
                                            if (bytes > MAX_BYTES) { over = name + "/" + sn + "/" + String(k); return; }
                                            meta.records.push([encodeValue(k), encodeValue(v)]);
                                        });
                                    });
                                }, Promise.resolve()).then(function () {
                                    if (meta.records.length) { total += meta.records.length; dbOut.stores[sn] = meta; }
                                });
                            });
                        })).then(function () {
                            db.close();
                            if (Object.keys(dbOut.stores).length) out[name] = dbOut;
                        }, function (err) { try { db.close(); } catch (x) {} throw err; });
                    });
                }).then(null, function (err) {
                    // Exotic values (a Blob) can never be synced: placeholder. Anything else is probably transient:
                    // the payload carries the SERVER's copy of that database instead (see buildPayload), so a hiccup
                    // can never erase it from the account.
                    if (err instanceof Unsupported) out[name] = { unsupported: err.what };
                    else failed.push(name);
                    dlog("idb: skipping database", name, (err instanceof Unsupported) ? err.what : msg(err));
                });
            });
            return chain;
        }).then(function () { return { dbs: out, records: total, bytes: bytes, over: over, failed: failed }; });
    }
    // Open a database for a restore at a version that can never be refused: its EXISTING version when that is at
    // least the snapshot's (v13 asked for the snapshot's version and got VersionError from a newer local copy),
    // one above it when a store has to be created, the snapshot's when the database is older or missing.
    function openForRestore(name, snap) {
        var want = snap.version || 1, storeNames = Object.keys(snap.stores);
        return openExisting(name).then(function (db) {
            var missing = db ? storeNames.filter(function (sn) { return !db.objectStoreNames.contains(sn); }) : storeNames;
            if (db && db.version >= want && !missing.length) return db;
            var target = db ? (db.version >= want ? db.version + 1 : want) : want;
            if (db) db.close();
            return new Promise(function (res, rej) {
                var req;
                try { req = indexedDB.open(name, target); } catch (e) { return rej(e); }
                req.onupgradeneeded = function () {
                    var d = req.result;
                    storeNames.forEach(function (sn) {
                        var m = snap.stores[sn], st;
                        if (d.objectStoreNames.contains(sn)) st = req.transaction.objectStore(sn);
                        else st = d.createObjectStore(sn, { keyPath: m.keyPath === null ? undefined : m.keyPath, autoIncrement: !!m.autoIncrement });
                        (m.indexes || []).forEach(function (ix) {
                            if (!st.indexNames.contains(ix.name)) st.createIndex(ix.name, ix.keyPath, { unique: !!ix.unique, multiEntry: !!ix.multiEntry });
                        });
                    });
                };
                req.onsuccess = function () { var d = req.result; d.onversionchange = function () { try { d.close(); } catch (x) {} }; res(d); };
                req.onerror = function () { rej(req.error || new Error("idb restore open failed: " + name)); };
                req.onblocked = function () { rej(new Error("idb restore blocked: " + name)); };
            });
        });
    }
    // Restore one database: per store, REPLACE this game's own content (in-line store: clear + put; shared
    // out-of-line store: delete only this game's records the snapshot lacks, then put). Other games' records
    // and cache records are never touched.
    function restoreIdbDatabase(name, snap) {
        if (!snap || snap.unsupported || !snap.stores || IGNORE_DB.test(name)) return Promise.resolve();
        var storeNames = Object.keys(snap.stores).filter(function (sn) { return snap.stores[sn] && !snap.stores[sn].oversized; });
        if (!storeNames.length) return Promise.resolve();
        return openForRestore(name, snap).then(function (db) {
            return new Promise(function (res, rej) {
                try {
                    var tx = db.transaction(storeNames, "readwrite");
                    tx.oncomplete = function () { db.close(); res(); };
                    tx.onerror = function () { try { db.close(); } catch (x) {} rej(tx.error || new Error("idb restore tx failed")); };
                    tx.onabort = tx.onerror;
                    storeNames.forEach(function (sn) {
                        var st = tx.objectStore(sn), m = snap.stores[sn], recs = m.records || [];
                        if (isInline(st)) {
                            claim("store", name + "|" + sn, true);
                            rawIdbClear.call(st);
                            recs.forEach(function (rec) { rawIdbPut.call(st, decodeValue(rec[1])); });
                            return;
                        }
                        var incoming = {};
                        recs.forEach(function (rec) { incoming[String(decodeValue(rec[0]))] = 1; });
                        var kr = st.getAllKeys();
                        kr.onsuccess = function () {
                            (kr.result || []).forEach(function (k) {
                                var ks = String(k), id = name + "|" + sn + "|" + ks;
                                if (!incoming[ks] && !CACHE_REC.test(ks) && isMine("rec", id) && !othersOwn("rec", id)) rawIdbDelete.call(st, k);
                            });
                            recs.forEach(function (rec) {
                                var key = decodeValue(rec[0]);
                                rawIdbPut.call(st, decodeValue(rec[1]), key);
                                claim("rec", name + "|" + sn + "|" + String(key), true);
                            });
                        };
                    });
                } catch (e) { try { db.close(); } catch (x) {} rej(e); }
            });
        });
    }
    // This game's records in databases/stores the incoming copy does not have at all: gone too (a replace, not
    // an overlay). Only records/stores this game owns alone.
    function wipeOrphans(dbs) {
        var o = loadOwn(), byStore = {}, inlineStores = [];
        Object.keys(o.rec).forEach(function (id) {
            if (!isMine("rec", id) || othersOwn("rec", id)) return;
            var a = id.indexOf("|"), b = id.indexOf("|", a + 1); if (a < 0 || b < 0) return;
            var dbn = id.slice(0, a), sn = id.slice(a + 1, b), ks = id.slice(b + 1);
            if (IGNORE_DB.test(dbn) || CACHE_REC.test(ks)) return;
            var snap = dbs && dbs[dbn];
            if (snap && snap.unsupported) return;
            if (snap && snap.stores && snap.stores[sn]) return; // handled by restoreIdbDatabase
            (byStore[dbn + "|" + sn] = byStore[dbn + "|" + sn] || { db: dbn, store: sn, keys: {} }).keys[ks] = 1;
        });
        Object.keys(o.store).forEach(function (id) {
            if (!isMine("store", id) || othersOwn("store", id)) return;
            var a = id.indexOf("|"); if (a < 0) return;
            var dbn = id.slice(0, a), sn = id.slice(a + 1), snap = dbs && dbs[dbn];
            if (IGNORE_DB.test(dbn) || (snap && (snap.unsupported || (snap.stores && snap.stores[sn])))) return;
            inlineStores.push({ db: dbn, store: sn });
        });
        var jobs = Object.keys(byStore).map(function (k) { return byStore[k]; }).concat(inlineStores);
        if (!jobs.length || !idbSupported()) return Promise.resolve();
        var chain = Promise.resolve();
        jobs.forEach(function (j) {
            chain = chain.then(function () {
                return openExisting(j.db).then(function (db) {
                    if (!db) return;
                    if (!db.objectStoreNames.contains(j.store)) { db.close(); return; }
                    return new Promise(function (res, rej) {
                        var tx = db.transaction([j.store], "readwrite"), st = tx.objectStore(j.store);
                        tx.oncomplete = function () { db.close(); res(); };
                        tx.onerror = tx.onabort = function () { try { db.close(); } catch (x) {} rej(tx.error || new Error("idb wipe failed")); };
                        if (!j.keys) { rawIdbClear.call(st); return; }
                        var kr = st.getAllKeys();
                        kr.onsuccess = function () { (kr.result || []).forEach(function (k) { if (j.keys[String(k)]) rawIdbDelete.call(st, k); }); };
                    });
                });
            });
        });
        return chain;
    }
    function applyPayload(p) {
        var dbs = (p && p.idb) || {};
        var chain = Promise.resolve();
        Object.keys(dbs).forEach(function (name) { chain = chain.then(function () { return restoreIdbDatabase(name, dbs[name]); }); });
        return chain.then(function () { return wipeOrphans(dbs); }).then(function () { applyLocal((p && p.ls) || {}); });
    }

    // ---- payloads ----
    var lastServerPayload = null; // the decoded server copy as of the last check-in / upload
    function buildPayload(local, idb) {
        var p = { v: PAYLOAD_VERSION, at: new Date().toISOString(), ls: local };
        if (idb) {
            p.idb = {};
            for (var n in idb.dbs) p.idb[n] = idb.dbs[n];
            // a database that could not be read this time: keep the account's copy of it rather than dropping it
            (idb.failed || []).forEach(function (n) {
                var s = lastServerPayload && lastServerPayload.idb && lastServerPayload.idb[n];
                if (s) p.idb[n] = s;
            });
        } else if (idbSupported() && lastServerPayload && lastServerPayload.idb) {
            p.idb = lastServerPayload.idb; // IndexedDB could not be read at all this time: never upload "no databases" over the account's
        }
        return p;
    }
    // What "same save?" and "is there anything here?" mean: records and keys only. Not the database versions,
    // not empty databases (v13 put every database on the origin into every row), not placeholders.
    function comparableObj(p) {
        var idb = {}, dbs = (p && p.idb) || {};
        Object.keys(dbs).forEach(function (n) {
            var st = dbs[n] && dbs[n].stores; if (!st) return;
            var o = {};
            Object.keys(st).forEach(function (s) { if (st[s] && st[s].records && st[s].records.length) o[s] = st[s].records; });
            if (Object.keys(o).length) idb[n] = o;
        });
        return { ls: (p && p.ls) || {}, idb: idb };
    }
    function comparable(p) { return stableStringify(comparableObj(p)); }
    function payloadIsEmpty(p) {
        if (!p || typeof p !== "object") return true;
        var c = comparableObj(p);
        return !Object.keys(c.ls).length && !Object.keys(c.idb).length;
    }

    // ---- wire format: big payloads travel and are stored as gzip+base64 ----
    function canGzip() { return typeof CompressionStream === "function" && typeof Response === "function"; }
    function gzipB64(str) {
        var cs = new CompressionStream("gzip"), w = cs.writable.getWriter();
        w.write(new TextEncoder().encode(str)); w.close();
        return new Response(cs.readable).arrayBuffer().then(function (ab) { return b64encode(new Uint8Array(ab)); });
    }
    function gunzipB64(b64) {
        var ds = new DecompressionStream("gzip"), w = ds.writable.getWriter();
        w.write(b64decode(b64)); w.close();
        return new Response(ds.readable).text();
    }
    // A SYNCHRONOUS gzip for the unload path, where nothing asynchronous (CompressionStream included) can finish
    // before the document is gone, and the keepalive body (base64 inside JSON, so +33%) must fit 64 KiB. Deflate
    // with LZ77 (hash chains, 32 KiB window, lazy matching) and ONE dynamic-Huffman block: within ~10% of zlib -9
    // on save JSON. The output is ordinary gzip -- DecompressionStream reads it, and
    // tools/save-sync-tests/gzipsync-test.mjs round-trips it through zlib on edge cases.
    var CRC_T = null;
    function crc32(u8) {
        if (!CRC_T) { CRC_T = new Int32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); CRC_T[n] = c; } }
        var crc = -1;
        for (var i = 0; i < u8.length; i++) crc = CRC_T[(crc ^ u8[i]) & 255] ^ (crc >>> 8);
        return (crc ^ -1) >>> 0;
    }
    var LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
    var LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
    var DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
    var DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
    var CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
    function lenCode(len) { var i = 0; while (i < 28 && LBASE[i + 1] <= len) i++; return i; }
    function distCode(d) { var i = 0; while (i < 29 && DBASE[i + 1] <= d) i++; return i; }
    // Huffman code lengths for `freq`, no code longer than `limit` (frequencies are halved until it fits).
    function huffLengths(freq, limit) {
        var f = freq.slice(), used = 0, i;
        for (i = 0; i < f.length; i++) if (f[i]) used++;
        for (i = 0; used < 2 && i < f.length; i++) if (!f[i]) { f[i] = 1; used++; } // a valid code needs two symbols
        for (;;) {
            var nodes = [], lens = new Array(f.length);
            for (i = 0; i < f.length; i++) { lens[i] = 0; if (f[i]) nodes.push({ w: f[i], s: [i] }); }
            while (nodes.length > 1) {
                nodes.sort(function (x, y) { return x.w - y.w; });
                var a = nodes.shift(), b = nodes.shift();
                a.s.concat(b.s).forEach(function (sym) { lens[sym]++; });
                nodes.push({ w: a.w + b.w, s: a.s.concat(b.s) });
            }
            var max = 0; for (i = 0; i < lens.length; i++) if (lens[i] > max) max = lens[i];
            if (max <= limit) return lens;
            for (i = 0; i < f.length; i++) if (f[i]) f[i] = Math.max(1, f[i] >> 1);
        }
    }
    function canonCodes(lens) {
        var max = 0, i; for (i = 0; i < lens.length; i++) if (lens[i] > max) max = lens[i];
        var count = new Array(max + 1).fill(0), next = new Array(max + 2).fill(0), codes = new Array(lens.length).fill(0), code = 0;
        for (i = 0; i < lens.length; i++) if (lens[i]) count[lens[i]]++;
        for (var bits = 1; bits <= max; bits++) { code = (code + count[bits - 1]) << 1; next[bits] = code; }
        for (i = 0; i < lens.length; i++) if (lens[i]) codes[i] = next[lens[i]]++;
        return codes;
    }
    function gzipSync(u8) {
        var n = u8.length;
        // 1. LZ77 into tokens: tl = 0 -> literal tv; tl >= 3 -> match of length tl at distance tv
        var tl = new Uint16Array(n + 1), tv = new Uint16Array(n + 1), nt = 0;
        var HS = 1 << 15, head = new Int32Array(HS), prev = new Int32Array(32768), i = 0, z;
        for (z = 0; z < HS; z++) head[z] = -1;
        function hash(p) { return ((u8[p] << 10) ^ (u8[p + 1] << 5) ^ u8[p + 2]) & (HS - 1); }
        function insert(p) { if (p + 2 < n) { var k = hash(p); prev[p & 32767] = head[k]; head[k] = p; } }
        function longest(p) {
            var best = 0, dist = 0;
            if (p + 2 >= n) return [0, 0];
            var cand = head[hash(p)], chain = 32, lim = Math.min(258, n - p);
            while (cand >= 0 && cand < p && p - cand <= 32768 && chain-- > 0) {
                if (u8[cand + best] === u8[p + best]) {
                    var L = 0;
                    while (L < lim && u8[cand + L] === u8[p + L]) L++;
                    if (L > best) { best = L; dist = p - cand; if (L === lim) break; }
                }
                cand = prev[cand & 32767];
            }
            return [best, dist];
        }
        var cur = longest(0);
        while (i < n) {
            var best = cur[0], dist = cur[1];
            if (best >= 3) {
                insert(i);
                var nxt = (best < 32 && i + 1 < n) ? longest(i + 1) : [0, 0];   // lazy: a longer match one byte later wins
                if (nxt[0] > best + 1) { tl[nt] = 0; tv[nt++] = u8[i]; i++; cur = nxt; continue; }
                tl[nt] = best; tv[nt++] = dist;
                for (var j = 1; j < best; j++) insert(i + j);
                i += best;
            } else { tl[nt] = 0; tv[nt++] = u8[i]; insert(i); i++; }
            cur = i < n ? longest(i) : [0, 0];
        }
        // 2. one dynamic-Huffman block
        var lf = new Array(286).fill(0), df = new Array(30).fill(0), t;
        for (t = 0; t < nt; t++) { if (tl[t]) { lf[257 + lenCode(tl[t])]++; df[distCode(tv[t])]++; } else lf[tv[t]]++; }
        lf[256]++;
        var ll = huffLengths(lf, 15), dl = huffLengths(df, 15), lc = canonCodes(ll), dc = canonCodes(dl);
        var hlit = 286; while (hlit > 257 && !ll[hlit - 1]) hlit--;
        var hdist = 30; while (hdist > 1 && !dl[hdist - 1]) hdist--;
        var all = ll.slice(0, hlit).concat(dl.slice(0, hdist)), rle = [];   // [symbol, extraBits, extraValue]
        for (t = 0; t < all.length;) {
            var v = all[t], run = 1;
            while (t + run < all.length && all[t + run] === v) run++;
            if (v === 0 && run >= 3) { var r0 = Math.min(run, 138); rle.push(r0 >= 11 ? [18, 7, r0 - 11] : [17, 3, r0 - 3]); t += r0; }
            else if (v !== 0 && run >= 4) { rle.push([v, 0, 0]); var r1 = Math.min(run - 1, 6); rle.push([16, 2, r1 - 3]); t += 1 + r1; }
            else { rle.push([v, 0, 0]); t++; }
        }
        var cf = new Array(19).fill(0); rle.forEach(function (e) { cf[e[0]]++; });
        var cl = huffLengths(cf, 7), cc = canonCodes(cl);
        var hclen = 19; while (hclen > 4 && !cl[CLORDER[hclen - 1]]) hclen--;
        // 3. write it
        var out = new Uint8Array(Math.max(1024, n + (n >> 3) + 1024)), op = 10, bb = 0, bc = 0;
        out[0] = 0x1f; out[1] = 0x8b; out[2] = 8; out[9] = 0xff;
        function grow() { if (op + 64 < out.length) return; var o2 = new Uint8Array(out.length * 2); o2.set(out); out = o2; }
        function put(val, len) { bb |= val << bc; bc += len; while (bc >= 8) { out[op++] = bb & 255; bb >>>= 8; bc -= 8; } }
        function putRev(code, len) { var r = 0; for (var q = 0; q < len; q++) { r = (r << 1) | (code & 1); code >>>= 1; } put(r, len); }
        put(1, 1); put(2, 2); put(hlit - 257, 5); put(hdist - 1, 5); put(hclen - 4, 4);
        for (t = 0; t < hclen; t++) put(cl[CLORDER[t]], 3);
        rle.forEach(function (e) { grow(); putRev(cc[e[0]], cl[e[0]]); if (e[1]) put(e[2], e[1]); });
        for (t = 0; t < nt; t++) {
            grow();
            if (tl[t]) {
                var li = lenCode(tl[t]), di = distCode(tv[t]);
                putRev(lc[257 + li], ll[257 + li]); if (LEXT[li]) put(tl[t] - LBASE[li], LEXT[li]);
                putRev(dc[di], dl[di]); if (DEXT[di]) put(tv[t] - DBASE[di], DEXT[di]);
            } else putRev(lc[tv[t]], ll[tv[t]]);
        }
        putRev(lc[256], ll[256]);
        if (bc > 0) { out[op++] = bb & 255; bb = 0; bc = 0; }
        grow();
        var crc = crc32(u8);
        out[op++] = crc & 255; out[op++] = (crc >>> 8) & 255; out[op++] = (crc >>> 16) & 255; out[op++] = (crc >>> 24) & 255;
        out[op++] = n & 255; out[op++] = (n >>> 8) & 255; out[op++] = (n >>> 16) & 255; out[op++] = (n >>> 24) & 255;
        return out.subarray(0, op);
    }
    function utf8(str) { return new TextEncoder().encode(str); }
    function wrapGz(p, d) { return JSON.stringify({ v: PAYLOAD_VERSION, at: p.at, z: "gzip-b64", d: d }); }
    function encodeWireSync(p, body) {
        if (byteLength(body) <= COMPRESS_OVER || typeof TextEncoder !== "function" || typeof DecompressionStream !== "function") return body;
        return wrapGz(p, b64encode(gzipSync(utf8(body))));
    }
    function encodeWire(p, body) {
        if (byteLength(body) <= COMPRESS_OVER || typeof DecompressionStream !== "function") return Promise.resolve(body);
        if (!canGzip()) { try { return Promise.resolve(encodeWireSync(p, body)); } catch (e) { return Promise.resolve(body); } }
        return gzipB64(body).then(function (d) { return wrapGz(p, d); }, function () { return body; });
    }
    function decodeWire(p) {
        if (p && typeof p === "object" && p.z === "gzip-b64" && typeof p.d === "string") {
            if (typeof DecompressionStream !== "function") return Promise.reject(new Error("this browser cannot read the compressed save"));
            return gunzipB64(p.d).then(function (t) { return JSON.parse(t); });
        }
        return Promise.resolve(p || null);
    }

    // ---- write detection: patch the prototypes BEFORE any game script runs ----
    // v12(B): bookkeeping written under the old FOLDER slug is renamed once.
    if (folderSlug !== slug) {
        try {
            [":sync", ":writtenAt", ":restoredAt", ":pending", ":undo", ":nosync"].forEach(function (suf) {
                var old = OWN_PREFIX + folderSlug + suf, v = rawGetItem(old);
                if (typeof v === "string") {
                    if (rawGetItem(OWN_PREFIX + slug + suf) === null) rawSetItem.call(ls, OWN_PREFIX + slug + suf, v);
                    rawRemoveItem.call(ls, old);
                }
            });
            var o0 = readJson(OWN_KEY);
            if (o0 && typeof o0 === "object") {
                var changed0 = false;
                ["ls", "idb", "store", "rec"].forEach(function (k) {
                    var m = o0[k];
                    if (!m || typeof m !== "object") return;
                    for (var name in m) {
                        if (!Object.prototype.hasOwnProperty.call(m, name)) continue;
                        if (m[name] === folderSlug) { m[name] = slug; changed0 = true; }
                        else if (Array.isArray(m[name]) && m[name].indexOf(folderSlug) !== -1) { m[name] = m[name].map(function (s) { return s === folderSlug ? slug : s; }); changed0 = true; }
                    }
                });
                if (changed0) { rawSetItem.call(ls, OWN_KEY, JSON.stringify(o0)); own = null; }
            }
        } catch (e) {}
    }

    var dirty = false, debounceT = null, lastUploadAt = 0, lastUploaded = null, flushing = false, flushAgain = false;
    var dirtySince = 0;
    // While a restore is applied (and until the reload) the game's own storage writes are dropped: a game that
    // boots before the server answers has an in-memory FS that knows nothing about the restored files, and
    // Emscripten's IDBFS syncfs(false) deletes any IDB entry its memfs lacks (Dino Bros). v14: this flag is set
    // ONLY around an actual apply, and every exit path clears it.
    var restoring = false;
    function inertRequest() {
        var r = { readyState: "pending", result: undefined, error: null, source: null, transaction: null, onsuccess: null, onerror: null };
        r.addEventListener = r.removeEventListener = function () {};
        r.dispatchEvent = function () { return false; };
        return r;
    }
    var lastIdb = null, idbDirty = false, lastIdbWriteAt = 0;
    var idbHooked = false, workerSeen = false, idbPollTick = 0, idbPolling = false, lastIdbSig = null;
    try {
        ["Worker", "SharedWorker"].forEach(function (n) {
            var C = window[n];
            if (typeof C !== "function" || typeof Proxy !== "function") return;
            window[n] = new Proxy(C, { construct: function (t, a, nt) { workerSeen = true; return Reflect.construct(t, a, nt); } });
        });
    } catch (e) {}

    var localOnly = true;     // set false by startAccount(); a visitor with no account never leaves this state
    function markDirty() {
        if (restoring || localOnly) return;
        dirty = true;
        if (!dirtySince) dirtySince = Date.now();
        schedulePrepare();
        if (!canUpload()) return;  // kept dirty: picked up the moment the check-in completes
        var wait = Math.min(DEBOUNCE_MS, Math.max(0, MAX_DEBOUNCE_MS - (Date.now() - dirtySince)));
        if (debounceT) clearTimeout(debounceT);
        debounceT = setTimeout(function () { debounceT = null; flush("storage changed"); }, wait);
    }
    function wrap(proto, method, kind) {
        try {
            var raw = proto[method];
            if (typeof raw !== "function") return;
            proto[method] = function () {
                var mine = (kind === "ls") ? (this === ls && !isOwnKey(arguments[0]) && !IGNORE_KEY.test(arguments[0])) : true;
                if (restoring && mine) return kind === "ls" ? undefined : inertRequest();
                var r = raw.apply(this, arguments);
                try {
                    if (mine) {
                        if (kind === "ls") claim("ls", arguments[0], true);
                        else { if (!claimIdbWrite(this, method, arguments)) return r; idbDirty = true; idbHooked = true; lastIdbWriteAt = Date.now(); }
                        markDirty();
                    }
                } catch (e) {}
                return r;
            };
        } catch (e) {}
    }
    // The game wrote/deleted a record: it is this game's. -> false for a write that is not progress (a cache db,
    // a cache record), which must not even mark the page dirty.
    function claimIdbWrite(target, method, args) {
        try {
            var store = target, key;
            if (window.IDBCursor && target instanceof IDBCursor) { store = target.source; if (store && store.objectStore) store = store.objectStore; key = target.primaryKey; }
            else key = (method === "delete") ? args[0] : args[1];
            var tx = store && store.transaction, db = tx && tx.db;
            if (!db || !db.name || IGNORE_DB.test(db.name)) return false;
            if (key !== undefined && CACHE_REC.test(String(key))) return false;
            if (isInline(store) || key === undefined || method === "clear") claim("store", db.name + "|" + store.name, true);
            else claim("rec", db.name + "|" + store.name + "|" + String(key), true);
        } catch (e) {}
        return true;
    }
    wrap(Storage.prototype, "setItem", "ls");
    wrap(Storage.prototype, "removeItem", "ls");
    // v14: a game's localStorage.clear() clears THAT GAME's keys only. 40 game folders call clear(); on a shared
    // origin it used to sign the visitor out of the whole site (the session lives here) and wipe every other
    // game's local save. Keys owned solely by another game, the session (sb-*) and pzsync:* survive.
    try {
        Storage.prototype.clear = function () {
            if (this !== ls) return rawClear.apply(this, arguments);
            if (restoring) return;
            try {
                var keys = [];
                for (var i = 0; i < ls.length; i++) keys.push(ls.key(i));
                keys.forEach(function (k) {
                    if (isOwnKey(k)) return;
                    var o = ownersOf("ls", k);
                    if (o && o.indexOf(slug) === -1) return;   // another game's progress
                    rawRemoveItem.call(ls, k);
                });
            } catch (e) {
                // fall back to a real clear, then put the session and the bookkeeping back
                var keep = {};
                try { for (var j = 0; j < ls.length; j++) { var kk = ls.key(j); if (isOwnKey(kk)) keep[kk] = rawGetItem(kk); } } catch (x) {}
                rawClear.call(ls);
                for (var kk2 in keep) { try { rawSetItem.call(ls, kk2, keep[kk2]); } catch (x) {} }
            }
            try { markDirty(); } catch (e) {}
        };
    } catch (e) {}
    if (window.IDBObjectStore) { wrap(IDBObjectStore.prototype, "put", "idb"); wrap(IDBObjectStore.prototype, "add", "idb"); wrap(IDBObjectStore.prototype, "delete", "idb"); wrap(IDBObjectStore.prototype, "clear", "idb"); }
    if (window.IDBCursor) { wrap(IDBCursor.prototype, "update", "idb"); wrap(IDBCursor.prototype, "delete", "idb"); }

    // A snapshot that hit a transient database error is retried once before anyone decides anything from it.
    function takeIdb() {
        idbDirty = false;
        return snapshotIdb().then(function (r) {
            if (r && r.failed && r.failed.length) {
                return new Promise(function (res) { setTimeout(res, 800); }).then(snapshotIdb).then(function (r2) { return r2 || r; }, function () { return r; });
            }
            return r;
        }).then(function (r) { lastIdb = r; return r; }, function (e) { dlog("idb snapshot failed", e); return null; });
    }

    // ---- is this visitor signed in at all? (a synchronous read; a guest pays for nothing below) ----
    function sessionInfo() {
        try {
            var v = JSON.parse(rawGetItem(SUPA_AUTH_KEY));
            var u = v && (v.user || (v.currentSession && v.currentSession.user));
            if (u && u.id && u.is_anonymous !== true) return { uid: String(u.id), token: v.access_token || (v.currentSession && v.currentSession.access_token) || null };
        } catch (e) {}
        return null;
    }
    var hasAccountKey = false;
    try { hasAccountKey = !!rawGetItem(SUPA_AUTH_KEY); } catch (e) {}

    // ---- t0: the baseline, taken before a single game script has run ----
    var start = Date.now();
    var baselineLocal = snapshotLocal(), baselineIdb = null;
    var baselineIdbP = hasAccountKey ? takeIdb().then(function (r) { baselineIdb = r; }) : Promise.resolve();
    dlog("t0 baseline: localStorage keys =", Object.keys(baselineLocal).length, hasAccountKey ? "" : "(local only: no account, nothing is uploaded)");

    // Another tab of this same game restoring the server save (shared storage): freeze this tab's writes when it
    // starts, reload when it is done, resume if it failed -- or if it went silent (v14 timeout).
    var foreignRestore = false, foreignT = null;
    try {
        window.addEventListener("storage", function (ev) {
            try {
                if (!ev || ev.key !== GUARD_KEY) return;
                var v = ev.newValue;
                if (v !== null) { var m = /^(\d+)/.exec(v); if (m && parseInt(m[1], 10) < start) return; }
                if (v === null) {
                    if (foreignRestore) { foreignRestore = false; restoring = false; clearTimeout(foreignT); dlog("other tab's restore failed, resuming"); }
                    return;
                }
                if (!foreignRestore) {
                    foreignRestore = true; restoring = true;
                    if (debounceT) { clearTimeout(debounceT); debounceT = null; }
                    dlog("another tab is restoring this game's save: freezing writes");
                    foreignT = setTimeout(function () {
                        if (foreignRestore) { foreignRestore = false; restoring = false; dlog("the other tab's restore never finished: resuming"); }
                    }, FOREIGN_RESTORE_TIMEOUT_MS);
                }
                if (/d$/.test(v)) { dlog("other tab's restore done, reloading to boot from it"); location.reload(); }
            } catch (e) {}
        });
    } catch (e) {}

    // ---- the account backend: direct REST calls with the session's token ----
    var client = null, uid = null, backend = null, accessToken = null, starting = false, startN = 0, startT = null;
    var checkedIn = false, blocked = null, conflict = false, lastServerAt = null;
    function canUpload() { return !!backend && checkedIn && !blocked && !conflict && !restoring && !foreignRestore; }
    function loadLib() {
        return new Promise(function (res, rej) {
            if (window.supabase && typeof window.supabase.createClient === "function") return res();
            var s = document.createElement("script");
            s.src = SUPA_LIB; s.async = true;
            s.onload = function () { (window.supabase && window.supabase.createClient) ? res() : rej(new Error("supabase global missing")); };
            s.onerror = function () { rej(new Error("supabase-js failed to load from " + SUPA_LIB + " (blocked?)")); };
            (document.head || document.documentElement).appendChild(s);
        });
    }
    function makeClient() {
        // This origin is the one store and the one refresher of the account session (see session-bridge.html).
        return window.supabase.createClient(SUPA_URL, SUPA_KEY, {
            auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: "pkce" },
            global: { headers: { "x-pz-save-sync": String(PAYLOAD_VERSION) } }
        });
    }
    function getToken() {
        if (!client) return Promise.resolve(accessToken);
        return client.auth.getSession().then(function (r) {
            var s = r && r.data && r.data.session;
            if (s && s.access_token) accessToken = s.access_token;
            return accessToken;
        }, function () { return accessToken; });
    }
    function rest(method, path, body, tok, keepalive, prefer) {
        var h = { "apikey": SUPA_KEY, "Authorization": "Bearer " + tok, "Accept": "application/json", "x-pz-save-sync": String(PAYLOAD_VERSION) };
        if (body !== null && body !== undefined) h["Content-Type"] = "application/json";
        if (prefer) h["Prefer"] = prefer;
        return window.fetch(SUPA_URL + path, { method: method, headers: h, body: body, keepalive: !!keepalive, credentials: "omit" }).then(function (r) {
            return r.text().then(function (t) { var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {} return { status: r.status, json: j }; });
        });
    }
    function httpErr(res) { var e = new Error("HTTP " + res.status + (res.json && res.json.message ? " " + res.json.message : "")); e.status = res.status; return e; }
    // Does public.save_game() exist (proposals/supabase-save-game-cas.sql)? PostgREST answers 404 PGRST202 for a
    // missing function; the function itself answers 22023 to the empty slug this probe sends. Nothing is written.
    var rpcMem = null;
    function rpcState() {
        if (rpcMem) return rpcMem;
        try {
            var v = rawGetItem(RPC_KEY), m = /^(yes|no)\|(\d+)$/.exec(v || "");
            if (m && Date.now() - parseInt(m[2], 10) < (m[1] === "yes" ? RPC_CACHE_YES_MS : RPC_CACHE_NO_MS)) return (rpcMem = m[1]);
        } catch (e) {}
        return null;
    }
    function setRpc(v) { rpcMem = v; try { rawSetItem.call(ls, RPC_KEY, v + "|" + Date.now()); } catch (e) {} }
    function probeRpc(tok) {
        if (rpcState()) return Promise.resolve(rpcState());
        return rest("POST", "/rest/v1/rpc/save_game", '{"p_slug":"","p_payload":{},"p_base_updated_at":null}', tok).then(function (res) {
            var code = res.json && res.json.code;
            if (res.status === 404 && code === "PGRST202") setRpc("no");
            else if (code === "22023" || res.status === 200) setRpc("yes");
            dlog("save_game() RPC:", rpcState() || "unknown (HTTP " + res.status + ")");
            return rpcState();
        }, function () { return null; });
    }
    // The account's row for this game. Strict: anything but a clean 200 is an ERROR, never "no save".
    function fetchRowStrict(tok) {
        return rest("GET", "/rest/v1/game_saves?select=payload,updated_at&user_id=eq." + encodeURIComponent(uid) + "&game_slug=eq." + encodeURIComponent(slug), null, tok).then(function (res) {
            if (res.status !== 200 || !Array.isArray(res.json)) throw httpErr(res);
            return res.json[0] || null;
        });
    }
    // -> {ok, updated_at} | {conflict, updated_at, payload?} | {tooLarge, bytes}; throws on a network / server error.
    function saveRemote(wire, base, keepalive) {
        return (keepalive ? Promise.resolve(accessToken) : getToken()).then(function (tok) {
            if (!tok) throw new Error("no access token");
            if (rpcState() !== "no") {
                var body = '{"p_slug":' + JSON.stringify(slug) + ',"p_payload":' + wire + ',"p_base_updated_at":' + JSON.stringify(base || null) + '}';
                return rest("POST", "/rest/v1/rpc/save_game", body, tok, keepalive).then(function (res) {
                    var j = res.json;
                    if (res.status === 200 && j && typeof j === "object") {
                        setRpc("yes");
                        if (j.ok) return { ok: true, updated_at: j.updated_at };
                        if (j.conflict) return { conflict: true, updated_at: j.updated_at, payload: j.payload };
                        if (j.too_large) return { tooLarge: true, bytes: j.bytes };
                    }
                    if (res.status === 404 && j && j.code === "PGRST202") { setRpc("no"); return plainSave(wire, base, tok, keepalive); }
                    throw httpErr(res);
                });
            }
            return plainSave(wire, base, tok, keepalive);
        });
    }
    // Without the RPC: the same compare, as a read before the write (not atomic, but it closes all but a
    // sub-second window). An unload upload cannot wait for a read, so it is a plain upsert as in v13.
    function plainSave(wire, base, tok, keepalive) {
        var pre = keepalive ? Promise.resolve(null) : rest("GET", "/rest/v1/game_saves?select=updated_at&user_id=eq." + encodeURIComponent(uid) + "&game_slug=eq." + encodeURIComponent(slug), null, tok).then(function (res) {
            if (res.status !== 200 || !Array.isArray(res.json)) throw httpErr(res);
            var cur = res.json[0] ? res.json[0].updated_at : null;
            if (cur !== null && (!base || !sameTs(cur, base))) return { conflict: true, updated_at: cur };
            return null;
        });
        return pre.then(function (c) {
            if (c) return c;
            var body = '{"user_id":' + JSON.stringify(uid) + ',"game_slug":' + JSON.stringify(slug) + ',"payload":' + wire + '}';
            return rest("POST", "/rest/v1/game_saves?on_conflict=user_id,game_slug&select=updated_at", body, tok, keepalive, "resolution=merge-duplicates,return=representation").then(function (res) {
                if (res.status === 200 || res.status === 201) { var row = Array.isArray(res.json) ? res.json[0] : res.json; return { ok: true, updated_at: row && row.updated_at }; }
                if (res.json && res.json.code === "23514") return { tooLarge: true, bytes: null };
                throw httpErr(res);
            });
        });
    }

    // ---- cannot-sync: said once per page, console + a small notice + a flag the drawer can read ----
    var saidNoSync = {};
    function noSync(reason, text, persist) {
        if (persist) writeJson(NOSYNC_KEY, { reason: reason, at: new Date().toISOString() });
        if (saidNoSync[reason]) return;
        saidNoSync[reason] = true;
        notice("nosync", text, null, 20000);
    }
    function clearNoSync() { if (rawGetItem(NOSYNC_KEY) !== null) removeKey(NOSYNC_KEY); }
    function block(reason, text, persist) {
        blocked = reason;
        if (debounceT) { clearTimeout(debounceT); debounceT = null; }
        warn("sync paused for this page load:", text);
        noSync(reason, "Progress in this game can't be saved to your account right now: " + text + ".", persist);
    }
    function overCap(what) {
        warn("save for", slug, "is over the", MAX_BYTES, "byte cap (" + what + ") -- not uploaded");
        noSync("too-large", "This game's save is too big to store in your account, so it only stays on this device.", true);
    }

    // ---- uploads ----
    var retryN = 0, retryT = null, sentCmp = null;
    function currentBase() {
        // another tab of this game on this device may have moved the row since: its marker is ours too (same storage)
        var st = readState(uid), a = lastServerAt;
        if (st && (a === null || tsMicro(st.serverAt) > tsMicro(a))) a = st.serverAt;
        return a;
    }
    function scheduleRetry() {
        if (retryT || !backend) return;
        var d = RETRY_MS[Math.min(retryN++, RETRY_MS.length - 1)];
        retryT = setTimeout(function () { retryT = null; if (dirty) flush("retry"); }, d);
    }
    function onSaved(r, cmp, hash, p, why, bytes) {
        lastUploaded = cmp; lastUploadAt = Date.now(); lastServerAt = r.updated_at || null; lastServerPayload = p; retryN = 0;
        writeState(uid, r.updated_at, hash);
        removeKey(PENDING_KEY);
        clearNoSync();
        dlog("uploaded", bytes, "bytes (" + why + "), server updated_at", r.updated_at || "(none -- marker cleared)");
    }
    function onConflict(r) {
        conflict = true;
        if (debounceT) { clearTimeout(debounceT); debounceT = null; }
        removeKey(PENDING_KEY);
        warn("newer progress for this game was saved on another device since this page loaded -- not overwriting it (server updated_at " + r.updated_at + ")");
        notice("conflict", "Newer progress for this game was saved on another device. Reload to load it.", [{ label: "Reload", primary: true, run: function () { location.reload(); } }]);
    }
    // -> "ok" | "conflict" | "toolarge"; throws on a network / server error (the caller retries)
    function upload(p, why) {
        var body = stableStringify(p), bytes = byteLength(body);
        if (bytes > MAX_BYTES) { overCap(bytes + " bytes"); return Promise.resolve("toolarge"); }
        var cmp = comparable(p), hash = fingerprint(cmp), base = currentBase(), forUid = uid;
        return encodeWire(p, body).then(function (wire) {
            writeJson(PENDING_KEY, { uid: forUid, base: base, hash: hash });
            return saveRemote(wire, base, false);
        }).then(function (r) {
            if (uid !== forUid) return "ok";   // signed out / switched meanwhile: nothing more to record
            if (r.ok) { onSaved(r, cmp, hash, p, why, bytes); return "ok"; }
            if (r.conflict) { onConflict(r); return "conflict"; }
            if (r.tooLarge) { overCap("refused by the server" + (r.bytes ? ", " + r.bytes + " bytes" : "")); lastUploaded = cmp; return "toolarge"; }
            throw new Error("unexpected save response");
        });
    }
    function flush(why) {
        if (!canUpload()) return Promise.resolve();
        if (flushing) { flushAgain = true; return Promise.resolve(); }
        var wait = MIN_UPLOAD_GAP_MS - (Date.now() - lastUploadAt);
        if (wait > 0 && why !== "force") {
            if (!debounceT) debounceT = setTimeout(function () { debounceT = null; flush(why); }, wait);
            return Promise.resolve();
        }
        flushing = true; dirty = false; dirtySince = 0;
        var local = snapshotLocal();
        return takeIdb().then(function (idb) {
            if (!canUpload()) return;
            if (idb && idb.over) { overCap(idb.over); return; }
            var p = buildPayload(local, idb);
            if (comparable(p) === lastUploaded) { dlog("flush: unchanged"); return; }
            return upload(p, why);
        }).then(null, function (e) {
            dirty = true;   // v14: a failed upload is not forgotten -- retried with backoff
            warn("upload failed, will retry:", msg(e));
            scheduleRetry();
        }).then(function () {
            flushing = false;
            if (flushAgain || (dirty && !retryT)) { flushAgain = false; if (dirty) markDirty(); }
        });
    }

    // ---- the unload path: synchronous, keepalive ----
    // Nothing asynchronous survives a closing tab (no IndexedDB read, no CompressionStream, no supabase-js session
    // lookup), and a keepalive body must fit 64 KiB. So at pagehide the payload is built from localStorage (read
    // now) + the latest IndexedDB snapshot, gzipped SYNCHRONOUSLY when it is big, and fired as one keepalive fetch
    // with the cached token. To keep that IndexedDB snapshot fresh, a hooked IndexedDB write re-reads it shortly after.
    var prepT = null;
    function schedulePrepare() {
        if (localOnly || !backend || !idbDirty) return;
        if (prepT) clearTimeout(prepT);
        prepT = setTimeout(function () { prepT = null; if (canUpload() && idbDirty) takeIdb(); }, PREPARE_MS);
    }
    function sendNow(why) {
        if (!canUpload() || !accessToken) return;
        try {
            var p = buildPayload(snapshotLocal(), lastIdb), body = stableStringify(p), cmp = comparable(p), wire = body;
            if (cmp === lastUploaded || cmp === sentCmp) return;
            if (byteLength(body) > MAX_BYTES) return;
            if (byteLength(body) > KEEPALIVE_MAX - 1500) wire = encodeWireSync(p, body);
            if (byteLength(wire) > KEEPALIVE_MAX - 1500) {
                dlog("unload: this save is", byteLength(wire), "bytes even compressed -- over the browser's keepalive limit; it stays on this device until the next open");
                return;
            }
            var hash = fingerprint(cmp), base = currentBase(), forUid = uid;
            writeJson(PENDING_KEY, { uid: forUid, base: base, hash: hash });
            sentCmp = cmp;
            saveRemote(wire, base, true).then(function (r) {
                if (uid !== forUid) return;
                if (r.ok) onSaved(r, cmp, hash, p, why, byteLength(wire));
                else if (r.conflict) onConflict(r);
                else if (r.tooLarge) overCap("refused by the server");
            }, function () { sentCmp = null; dirty = true; });
        } catch (e) { dlog("unload send failed", e); }
    }

    // Poll for writes the prototype patches cannot see (localStorage.x = 1, delete localStorage.x) and, on
    // worker-mode pages only, for IndexedDB written from a Worker (v8).
    var lastPollHash = null;
    function poll() {
        if (!canUpload()) return;
        var h = stableStringify(snapshotLocal());
        if (lastPollHash !== null && h !== lastPollHash) markDirty();
        lastPollHash = h;
        if (!workerSeen || idbHooked || idbPolling || restoring || document.hidden || !idbSupported()) return;
        if (++idbPollTick % IDB_POLL_EVERY) return;
        idbPolling = true;
        snapshotIdb().then(function (r) {
            idbPolling = false;
            if (!r) return;
            var sig = stableStringify(comparableObj({ idb: r.dbs }).idb);
            if (sig === lastIdbSig) return;
            lastIdbSig = sig; lastIdb = r;
            if (!r.records && lastUploaded === null) { dlog("idb: empty database appeared, nothing to sync yet"); return; }
            idbDirty = false; lastIdbWriteAt = Date.now();
            dlog("idb changed outside the hooks (worker-mode runtime) -- uploading");
            markDirty();
        }, function (e) { idbPolling = false; dlog("idb poll failed", e); });
    }
    function onHide(force) {
        if (!force && document.visibilityState && document.visibilityState !== "hidden") return;
        if (debounceT) { clearTimeout(debounceT); debounceT = null; }
        playFlush();
        sendNow(force ? "page closed" : "page hidden");
    }

    // ---- backups of this device's copy (never synced; IGNORE_DB) ----
    function openBackupDb() {
        return new Promise(function (res, rej) {
            var r;
            try { r = indexedDB.open(BACKUP_DB, 1); } catch (e) { return rej(e); }
            r.onupgradeneeded = function () { var st = r.result.createObjectStore(BACKUP_STORE, { keyPath: "id", autoIncrement: true }); st.createIndex("slug", "slug", { unique: false }); };
            r.onsuccess = function () { var d = r.result; d.onversionchange = function () { try { d.close(); } catch (x) {} }; res(d); };
            r.onerror = function () { rej(r.error || new Error("backup db open failed")); };
            r.onblocked = function () { rej(new Error("backup db blocked")); };
        });
    }
    function saveBackup(p, replacedAt, savedAt) {
        return openBackupDb().then(function (db) {
            return new Promise(function (res, rej) {
                var tx = db.transaction([BACKUP_STORE], "readwrite"), st = tx.objectStore(BACKUP_STORE), id = null;
                var ar = rawIdbAdd.call(st, { slug: slug, uid: uid, at: new Date().toISOString(), replacedServerAt: replacedAt || null, loadedSavedAt: savedAt || null, payload: stableStringify(p) });
                ar.onsuccess = function () {
                    id = ar.result;
                    var all = st.index("slug").getAll(slug);
                    all.onsuccess = function () {
                        var recs = (all.result || []).sort(function (a, b) { return a.id - b.id; });
                        for (var i = 0; i < recs.length - BACKUP_KEEP; i++) rawIdbDelete.call(st, recs[i].id);
                    };
                };
                tx.oncomplete = function () { db.close(); res(id); };
                tx.onerror = tx.onabort = function () { try { db.close(); } catch (x) {} rej(tx.error || new Error("backup failed")); };
            });
        });
    }
    function loadBackup(id) {
        return openBackupDb().then(function (db) {
            return new Promise(function (res, rej) {
                var r = db.transaction([BACKUP_STORE], "readonly").objectStore(BACKUP_STORE).get(id);
                r.onsuccess = function () { db.close(); res(r.result || null); };
                r.onerror = function () { db.close(); rej(r.error); };
            });
        });
    }
    function listBackups() {
        if (!idbSupported()) return Promise.resolve([]);
        return openBackupDb().then(function (db) {
            return new Promise(function (res) {
                var r = db.transaction([BACKUP_STORE], "readonly").objectStore(BACKUP_STORE).index("slug").getAll(slug);
                r.onsuccess = function () { db.close(); res((r.result || []).map(function (b) { return { id: b.id, at: b.at, uid: b.uid, bytes: (b.payload || "").length }; })); };
                r.onerror = function () { db.close(); res([]); };
            });
        }, function () { return []; });
    }
    function fmtWhen(iso) {
        var d = new Date(iso || NaN);
        if (!isFinite(d.getTime())) return "earlier";
        try { return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); } catch (e) { return d.toISOString().slice(0, 16).replace("T", " "); }
    }
    function maybeUndoBanner() {
        var u = readJson(UNDO_KEY);
        if (!u || u.uid !== uid || u.shown) return;
        u.shown = 1; writeJson(UNDO_KEY, u);
        notice("undo", "Loaded your account's progress (saved " + fmtWhen(u.savedAt) + "). This device had different progress.",
               [{ label: "Use this device's instead", primary: true, run: function (box, btn) { btn.disabled = true; useBackup(u); } }], 30000);
    }
    // The visitor chose this device's copy: put it back locally and make it the account's save, deliberately
    // over whatever the account holds now (a conflict here just means "use the row's current time as the base").
    function useBackup(u) {
        if (!backend || !checkedIn) return Promise.resolve();
        var forUid = uid;
        return loadBackup(u.id).then(function (rec) {
            if (!rec || rec.slug !== slug) throw new Error("that copy is no longer on this device");
            var p = JSON.parse(rec.payload); p.at = new Date().toISOString();
            var body = stableStringify(p), cmp = comparable(p);
            restoring = true;
            return applyPayload(p).then(function () {
                return encodeWire(p, body);
            }).then(function (wire) {
                var base = currentBase();
                return saveRemote(wire, base, false).then(function (r) {
                    return r.conflict ? saveRemote(wire, r.updated_at, false) : r;
                });
            }).then(function (r) {
                if (r && r.ok && uid === forUid) writeState(uid, r.updated_at, fingerprint(cmp));
                removeKey(UNDO_KEY);
                dlog("switched to this device's copy, reloading");
                location.reload();
            }, function (e) {
                // the copy is applied locally; the marker still names the old row, so the next open fast-forwards it up
                removeKey(UNDO_KEY);
                warn("this device's copy is back, but the account could not be updated yet (" + msg(e) + "); it will be on the next open");
                location.reload();
            });
        }).then(null, function (e) {
            restoring = false;
            warn("could not switch to this device's copy:", msg(e));
            notice("undo", "Couldn't switch to this device's progress: " + msg(e) + ".", null, 12000);
        });
    }

    // ---- restore ----
    function restoreFromServer(p, serverAt, opts) {
        var g = guardInfo(), rowMs = Math.floor((tsMicro(serverAt) || 0) / 1000);
        if (g && Date.now() - g.ts < RESTORE_RELOAD_GUARD_MS && g.at === rowMs) {
            // The SAME row was restored moments ago: a loop, or a lost race with another tab of this game.
            if (g.ts > start) { dlog("restore skipped: another tab restored after this page loaded -- reloading to boot from it"); restoring = true; location.reload(); return Promise.resolve(); }
            // v14: pause UPLOADS only. The game keeps saving locally (v13 also dropped its writes for the page).
            blocked = "loop";
            warn("restore skipped: this save was restored moments ago -- uploads paused for this page load (the game still saves on this device)");
            return Promise.resolve();
        }
        restoring = true;
        if (debounceT) { clearTimeout(debounceT); debounceT = null; }
        var gv = String(Date.now()) + ":" + String(rowMs), cur = null, backupId = null;
        try { rawSetItem.call(ls, GUARD_KEY, gv); } catch (e) {} // loop guard + "freeze" signal to other tabs
        dlog("restoring the account's save into this device" + (opts.backup ? " (this device's copy is backed up first)" : ""));
        var local = snapshotLocal();
        return takeIdb().then(function (idb) {
            if (idb && idb.over) throw new Error("this device's copy is over the cap, so it cannot be backed up");
            cur = buildPayload(local, idb);
            if (!opts.backup) return;
            return saveBackup(cur, serverAt, p.at).then(function (id) { backupId = id; }, function (e) { warn("could not back up this device's copy (" + msg(e) + ") -- restoring anyway"); });
        }).then(function () {
            return applyPayload(p);
        }).then(function () {
            lastUploaded = comparable(p);
            writeState(uid, serverAt, fingerprint(lastUploaded));
            removeKey(PENDING_KEY);
            if (backupId !== null) writeJson(UNDO_KEY, { id: backupId, uid: uid, savedAt: p.at || serverAt, serverAt: serverAt, backedUpAt: new Date().toISOString(), shown: 0 });
            try { rawSetItem.call(ls, GUARD_KEY, gv + "d"); } catch (e) {} // "done": other tabs reload now
            dlog("restore done, reloading");
            location.reload();
        }, function (e) {
            warn("restore failed (" + msg(e) + ") -- putting this device's copy back");
            var back = cur ? applyPayload(cur).then(null, function (e2) { warn("could not fully put this device's copy back:", msg(e2)); }) : Promise.resolve();
            return back.then(function () {
                restoring = false;
                removeKey(GUARD_KEY);
                block("restore-failed", "your account's progress could not be loaded into this browser (" + msg(e) + ")", true);
            });
        });
    }

    // ---- the check-in: one successful read of the account's row before ANY upload on this page ----
    function decideAndAct(row, sp, local, idb, baseLocal, baseIdb) {
        if (foreignRestore) { dlog("check-in abandoned: another tab is restoring"); return Promise.resolve(); }
        lastServerAt = row ? row.updated_at : null;
        lastServerPayload = sp || null;
        if (idb && idb.over) { overCap(idb.over); blocked = "too-large"; return Promise.resolve(); }
        var cur = buildPayload(local, idb), curCmp = comparable(cur);
        var serverHas = !!sp && !payloadIsEmpty(sp);
        if (!serverHas) {
            checkedIn = true;
            if (payloadIsEmpty(cur)) { dlog("no local data and no server save yet"); return Promise.resolve(); }
            dlog("reconcile: the account has no save for this game -- uploading this device's progress");
            return upload(cur, "the account's first save of this game");
        }
        var serverCmp = comparable(sp);
        if (serverCmp === curCmp) {
            checkedIn = true; lastUploaded = curCmp;
            writeState(uid, row.updated_at, fingerprint(curCmp)); // heals a marker a lost unload response left stale
            removeKey(PENDING_KEY);
            dlog("local == server, nothing to do");
            return Promise.resolve();
        }
        var st = readState(uid), pend = readPending(uid), serverHash = fingerprint(serverCmp);
        if (st && pend && pend.hash === serverHash && (pend.base === null ? true : sameTs(pend.base, st.serverAt))) {
            // the row is this device's own last upload, whose response never arrived (closed tab)
            st = { uid: uid, serverAt: row.updated_at, hash: serverHash };
            writeState(uid, row.updated_at, serverHash); removeKey(PENDING_KEY);
            dlog("the last unload upload from this device did land");
        }
        var basePayload = buildPayload(baseLocal, baseIdb), baseEmpty = payloadIsEmpty(basePayload);
        // Nothing of this game on this device (new device, wiped profile): restore. Never upload "nothing" over the
        // account's save, whatever a marker says.
        if (baseEmpty || payloadIsEmpty(cur)) { dlog("reconcile: nothing of this game on this device -- restoring the account's save"); return restoreFromServer(sp, row.updated_at, { backup: false }); }
        if (st && tsMicro(row.updated_at) !== null && tsMicro(st.serverAt) !== null && tsMicro(row.updated_at) <= tsMicro(st.serverAt)) {
            checkedIn = true;
            dlog("reconcile: fast-forward -- server unchanged since this device last synced, uploading this device's newer progress");
            return upload(cur, "fast-forward");
        }
        var unchanged = !!st && fingerprint(comparable(basePayload)) === st.hash;
        var why = !st ? "first time this account syncs this game on this device: the account's save wins"
                : unchanged ? "server newer, local unchanged since last sync"
                : "the account's save changed on another device: the account's save wins";
        dlog("reconcile:", why);
        return restoreFromServer(sp, row.updated_at, { backup: !unchanged });
    }
    var checkInT = null, checkInN = 0, watching = false, reconLocalStr = null;
    function runCheckIn(useBaseline) {
        if (!backend) return;
        var myUid = uid;
        var local = null, idb = null, row = null;
        getToken().then(function (tok) {
            if (!tok) throw new Error("no access token");
            return Promise.all([fetchRowStrict(tok), probeRpc(tok), useBaseline ? baselineIdbP : null]);
        }).then(function (rs) {
            row = rs[0];
            return decodeWire(row && row.payload).then(null, function (e) { var x = new Error(msg(e)); x.unreadable = true; throw x; });
        }).then(function (sp) {
            if (uid !== myUid) return;
            local = snapshotLocal(); reconLocalStr = stableStringify(local);
            return takeIdb().then(function (r) {
                idb = r;
                if (uid !== myUid) return;
                return decideAndAct(row, sp, local, idb, useBaseline ? baselineLocal : local, useBaseline ? baselineIdb : idb);
            });
        }).then(function () {
            if (uid !== myUid || !backend) return;
            checkInN = 0;
            if (restoring) return; // reload pending
            afterCheckIn();
        }, function (e) {
            if (uid !== myUid || !backend) return;
            if (e && e.unreadable) { block("unreadable", "the saved progress could not be read in this browser", true); return; }
            var d = RETRY_MS[Math.min(checkInN++, RETRY_MS.length - 1)];
            (checkInN === 1 ? warn : dlog)("could not reach your account (" + msg(e) + ") -- nothing is uploaded until it answers; retrying in " + (d / 1000) + " s");
            checkInT = setTimeout(function () { checkInT = null; runCheckIn(useBaseline); }, d);
        });
    }
    function afterCheckIn() {
        if (!checkedIn || !backend) return;
        if (!watching) {
            watching = true;
            setInterval(poll, POLL_MS);
            document.addEventListener("visibilitychange", function () { onHide(false); });
            window.addEventListener("pagehide", function () { onHide(true); });
        }
        lastPollHash = stableStringify(snapshotLocal());
        lastIdbSig = stableStringify(comparableObj({ idb: (lastIdb && lastIdb.dbs) || {} }).idb);
        // anything written during the round trip (a hooked write set `dirty`; a property-style write shows as a diff)
        if (dirty || lastPollHash !== reconLocalStr) markDirty();
        maybeUndoBanner();
        dlog("watching", slug);
    }

    // ---- start / stop the account path (at boot, and whenever the session changes while the game is open) ----
    function startAccount(useBaseline) {
        if (backend || starting) return;
        starting = true;
        loadLib().then(function () {
            if (!client) client = makeClient();
            return client.auth.getSession();
        }).then(function (r) {
            starting = false; startN = 0;
            var s = r && r.data && r.data.session;
            if (!(s && s.user && s.user.id && s.user.is_anonymous !== true)) {
                dlog(s ? "legacy anonymous Supabase session ignored" : "account session key present but no live session", "-> local only, nothing uploaded");
                localOnly = true;
                return;
            }
            accessToken = s.access_token || null;
            backend = { kind: "account", id: s.user.id }; uid = s.user.id; localOnly = false;
            checkedIn = false; blocked = null; conflict = false; lastUploaded = null; lastServerAt = null; sentCmp = null;
            dlog("backend: account (uid " + uid + ") after", Date.now() - start, "ms");
            playStart();
            runCheckIn(useBaseline);
        }, function (e) {
            starting = false;
            var d = RETRY_MS[Math.min(startN++, RETRY_MS.length - 1)];
            (startN === 1 ? warn : dlog)("account session present but Supabase unavailable: " + msg(e) + " -- nothing is uploaded; retrying in " + (d / 1000) + " s");
            startT = setTimeout(function () { startT = null; if (sessionInfo()) startAccount(useBaseline); }, d);
        });
    }
    function stopAccount(why) {
        if (!backend) return;
        dlog("account changed here (" + why + ") -- sync stopped for this account");
        playFlush();
        backend = null; uid = null; checkedIn = false; localOnly = true; accessToken = null; conflict = false; blocked = null;
        [debounceT, retryT, checkInT, prepT, startT].forEach(function (t) { if (t) clearTimeout(t); });
        debounceT = retryT = checkInT = prepT = startT = null; dirty = false;
        if (playTimer) { clearInterval(playTimer); playTimer = null; }
    }
    function sessionMaybeChanged(src) {
        var s = sessionInfo();
        if (s && backend && s.uid === uid) { if (s.token) accessToken = s.token; return; }  // same account (a refresh in another tab)
        if (backend && (!s || s.uid !== uid)) stopAccount(src);
        if (s && !backend && !starting) { dlog("signed in while the game was open (" + src + ") -- checking in now"); startAccount(false); }
    }
    try {
        window.addEventListener("storage", function (ev) { if (ev && (ev.key === SUPA_AUTH_KEY || ev.key === null)) sessionMaybeChanged("storage event"); });
        window.addEventListener("message", function (ev) {
            if (PORTAL_ORIGINS.indexOf(ev.origin) === -1) return;
            var d = ev.data;
            if (d && typeof d === "object" && d.type === "pz-account-changed") sessionMaybeChanged("portal message");
        });
    } catch (e) {}

    // ---- account play time (signed-in accounts only; unchanged from v13 apart from start/stop) ----
    var playAcc = 0, playSince = 0, playSentMs = 0, playCounted = false, playTimer = null, playHooked = false;
    function playTotal() { return playAcc + (playSince ? Date.now() - playSince : 0); }
    function rpcPlay(secs, play) {
        return window.fetch(SUPA_URL + "/rest/v1/rpc/bump_play_time", {
            method: "POST", keepalive: true, credentials: "omit",
            headers: { "apikey": SUPA_KEY, "Authorization": "Bearer " + accessToken, "Content-Type": "application/json", "x-pz-save-sync": String(PAYLOAD_VERSION) },
            body: JSON.stringify({ p_game: slug, p_seconds: secs, p_play: play })
        }).then(function (r) { return r.ok ? { error: null } : { error: { message: "HTTP " + r.status } }; });
    }
    function playFlush() {
        if (!backend || !accessToken) return;
        if (playSince) { playAcc += Date.now() - playSince; playSince = document.hidden ? 0 : Date.now(); }
        var unsent = playAcc - playSentMs;
        var secs = Math.min(PLAY_MAX_PER_CALL, Math.floor(unsent / 1000));
        if (secs < 1 && playCounted) return;
        var play = !playCounted; playCounted = true;
        playSentMs += secs * 1000;
        try {
            rpcPlay(secs, play).then(function (r) {
                if (r && r.error) { dlog("play time not recorded:", r.error.message || r.error); playSentMs -= secs * 1000; if (play) playCounted = false; }
                else dlog("play time +" + secs + "s" + (play ? " (+1 play)" : ""));
            }, function (e) { dlog("play time request failed:", msg(e)); playSentMs -= secs * 1000; if (play) playCounted = false; });
        } catch (e) {}
    }
    function playStart() {
        if (!backend) return;
        playAcc = 0; playSentMs = 0; playCounted = false;
        playSince = document.hidden ? 0 : Date.now();
        if (!playHooked) {
            playHooked = true;
            document.addEventListener("visibilitychange", function () {
                if (document.hidden) { if (playSince) { playAcc += Date.now() - playSince; playSince = 0; } }
                else if (!playSince && backend) playSince = Date.now();
            });
            window.addEventListener("pageshow", function () { if (!document.hidden && !playSince && backend) playSince = Date.now(); });
        }
        if (playTimer) clearInterval(playTimer);
        playTimer = setInterval(function () { if (!document.hidden) playFlush(); }, PLAY_REPORT_MS);
        setTimeout(playFlush, 2000);
    }

    // ---- boot ----
    if (hasAccountKey) startAccount(true);
    else dlog("no account session -- local only, nothing is uploaded for this visitor");

    try {
        window.PZ_SAVE_SYNC = {
            version: PAYLOAD_VERSION, script: SCRIPT_VERSION, slug: slug, folderSlug: folderSlug,
            localOnly: function () { return localOnly; },
            flush: function () { return flush("force"); },
            mode: function () { return backend ? backend.kind : null; },
            playSeconds: function () { return Math.floor(playTotal() / 1000); },
            owners: function () { return loadOwn(); },
            notices: notices,
            backups: listBackups,
            state: function () { return { checkedIn: checkedIn, blocked: blocked, conflict: conflict, restoring: restoring, rpc: rpcState(), lastServerAt: lastServerAt, dirty: dirty, uid: uid }; }
        };
    } catch (e) {}
})();
