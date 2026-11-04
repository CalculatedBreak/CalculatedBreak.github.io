// PizzaEdition letter-folder save migration -- v1 (2026-10-05, staged, NOT live).
// Served as /scripts/save-migrate.js?v=1 on games.pizzaedition.com once rolled out.
//
// WHY THIS EXISTS. Every game lives at games.pizzaedition.com/<folder>/<letter>/..., and a content change
// promotes it to a NEW letter (Cloudflare caches the old URL ~186 days). Several engines key their save on
// the page's (or the SWF's) own URL, so each promotion silently orphaned every player's progress. The old
// data is still in the visitor's browser; this script copies it to where the live letter will look for it.
//
//   mode "idbfs"   Unity WebGL. The save lives in IndexedDB "/idbfs", store FILE_DATA, under
//                  /idbfs/<md5(dirname(document.URL))>/PlayerPrefs (+ sibling files). Verified against 186/186
//                  folders captured in the 2026-10-05 audit: the hash is md5 of the page URL with the file name,
//                  query and fragment removed and NO trailing slash, e.g. md5("https://games.pizzaedition.com/slope/i").
//   mode "ls"      localStorage keys that embed the letter: OpenFL/Stencyl SharedObject ("/run-3/g/index.html:Run3"),
//                  Ruffle SharedObject ("games.pizzaedition.com/henryfleeingthecomplex/h/5.swf/FleeingtheComplex").
//   mode "cookie"  Tiny Fishing (GameMaker): cookies set with no path= default to the page's folder
//                  (/tiny-fishing/g), which no other letter can even SEE. Same-origin helper iframes placed in
//                  the old letter folders read them; they are re-written at a letter-independent path.
//
// RULES (all three modes):
//   * Never overwrite: if the live letter already has a save, nothing is copied. A visitor who already started
//     fresh at the new letter is left alone, even if an older, bigger save exists (accepted tradeoff).
//   * Never delete: the old copy is left exactly where it was.
//   * The source is the NEWEST other letter that has a save (IndexedDB: by record timestamp; localStorage and
//     cookies carry no timestamp, so by letter order -- letters are promoted in ascending order, and the
//     pre-2026-09-14 numeric folders all predate "a").
//   * Idempotent: a second run finds the live save and does nothing.
//   * Fails closed and silent: no storage, a blocked profile, a missing database -> no-op, game untouched.
//
// ORDERING -- THE ONE THING THAT MUST NOT BREAK. This tag goes FIRST, before save-sync.js and before any game
// script. For "idbfs" the guarantee does not depend on how a game starts Unity (createUnityInstance,
// UnityLoader.instantiate, Poki's master-loader -> unity.js, or a custom boot): the "/idbfs" open request is
// issued synchronously while this script executes, IndexedDB serves open requests in order, and ALL of the
// work runs inside ONE readwrite transaction created in that open's success handler. IndexedDB does not start
// any transaction created later on an overlapping scope until a readwrite one finishes, so Unity's
// FS.syncfs(populate) read -- and save-sync's baseline snapshot -- cannot run before the copy commits.
// (Wrapping createUnityInstance was considered and rejected: it is a global *function declaration* in most
// builds, which replaces any accessor we define instead of calling it, and a third of these games never call
// it at all.) The prototypes are captured here, before save-sync.js patches them, so our own writes are
// never mistaken for the game's.
//
// The page opts in per game with data-mode on the tag; tools/wire-save-migrate.js decides which games get
// which mode (and none for the 14 Poki-v3-loader games and the 11 fake-URL Unity builds).
// ?pzdebug=1 logs what happened; window.PZ_SAVE_MIGRATE carries the result; window.PZ_NO_SAVE_MIGRATE = true
// before the tag disables it.
(function () {
    "use strict";
    if (window.PZ_SAVE_MIGRATE) return;
    var T0 = (window.performance && performance.now) ? performance.now() : Date.now();
    var now = function () { return ((window.performance && performance.now) ? performance.now() : Date.now()) - T0; };
    var me = document.currentScript;
    var attr = function (n) { return (me && me.getAttribute(n)) || ""; };
    var MODE = attr("data-mode") || "idbfs";
    var DEBUG = /[?&]pzdebug=1\b/.test(location.search);
    var resolveReady, state = { v: 1, mode: MODE, done: false, result: null, ms: null };
    state.ready = new Promise(function (r) { resolveReady = r; });
    window.PZ_SAVE_MIGRATE = state;
    function log() { if (DEBUG) try { console.log.apply(console, ["[save-migrate]"].concat([].slice.call(arguments))); } catch (e) {} }
    function finish(result, extra) {
        if (state.done) return;
        state.done = true; state.result = result; state.ms = Math.round(now() * 10) / 10; state.doneAt = T0 + state.ms;
        if (extra) for (var k in extra) state[k] = extra[k];
        log(MODE + ": " + result + " in " + state.ms + " ms", extra || "");
        resolveReady(state);
    }
    if (window.PZ_NO_SAVE_MIGRATE) return finish("disabled");

    // ---- where are we: /<folder>/<letter>/<rest...> ----
    var segs = location.pathname.split("/");   // ["", folder, letter, ...rest]
    if (segs.length < 4 || !segs[1] || !segs[2]) return finish("not-a-game-path");
    var FOLDER = segs[1], LIVE = segs[2];
    var REST_DIR = segs.slice(3, -1).join("/");   // nested documents: 1v1.lol-main/d/1v1.lol/index.html -> "1v1.lol"

    // Every folder name the letter scheme has ever produced: 0-9, a-z, 00-99 (the pre-2026-09-14 numeric
    // folders went up to "10"). Cheap: ~136 MD5s of ~45-byte strings, well under a millisecond.
    var LETTERS = [];
    (function () {
        var i;
        for (i = 0; i < 10; i++) LETTERS.push(String(i));
        for (i = 0; i < 26; i++) LETTERS.push(String.fromCharCode(97 + i));
        for (i = 0; i < 100; i++) LETTERS.push((i < 10 ? "0" : "") + i);
    })();
    // newest first: letters (z..a) above numbers (99..0); "10" above "9"
    function rank(l) { return /^[a-z]$/.test(l) ? 1000 + l.charCodeAt(0) : parseInt(l, 10); }
    var OTHERS = LETTERS.filter(function (l) { return l !== LIVE; });

    function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
    function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }

    if (MODE === "ls") return runLocalStorage();
    if (MODE === "cookie") return runCookies();
    if (MODE === "idbfs") return runIdbfs();
    return finish("unknown-mode");

    // =========================================================================================== localStorage
    function runLocalStorage() {
        var ls;
        try { ls = window.localStorage; ls.length; } catch (e) { return finish("no-storage"); }
        // a key embeds the letter after one of these prefixes (OpenFL pathname, Ruffle host+path, OpenFL's old href form)
        var prefixes = ["/" + FOLDER + "/", location.host + "/" + FOLDER + "/", location.origin + "/" + FOLDER + "/"];
        var groups = {};   // prefix -> letter -> {suffix: key}
        var keys = [];
        try { for (var i = 0; i < ls.length; i++) keys.push(ls.key(i)); } catch (e) { return finish("no-storage"); }
        keys.forEach(function (k) {
            if (!k) return;
            for (var p = 0; p < prefixes.length; p++) {
                if (k.indexOf(prefixes[p]) !== 0) continue;
                var rest = k.slice(prefixes[p].length), slash = rest.indexOf("/");
                if (slash < 1) continue;
                var letter = rest.slice(0, slash);
                if (letter !== LIVE && OTHERS.indexOf(letter) < 0) continue;
                ((groups[prefixes[p]] = groups[prefixes[p]] || {})[letter] = groups[prefixes[p]][letter] || {})[rest.slice(slash)] = k;
                return;
            }
        });
        var copied = [], skipped = [];
        Object.keys(groups).forEach(function (p) {
            var g = groups[p];
            if (g[LIVE]) { skipped.push(p); return; }   // the live letter already has a save under this prefix
            var src = Object.keys(g).sort(function (a, b) { return rank(b) - rank(a); })[0];
            if (!src) return;
            Object.keys(g[src]).forEach(function (suffix) {
                var to = p + LIVE + suffix, v = lsGet(g[src][suffix]);
                if (v === null || lsGet(to) !== null) return;
                try { ls.setItem(to, v); copied.push(to); } catch (e) { /* quota: leave the rest alone */ }
            });
            if (copied.length) state.from = src;
        });
        return finish(copied.length ? "copied" : (skipped.length ? "live-has-save" : "nothing-to-migrate"), { copied: copied.length, keys: copied });
    }

    // ================================================================================================ cookies
    function runCookies() {
        var prefix = attr("data-prefix"), path = attr("data-path") || ("/" + FOLDER + "/"), probe = attr("data-probe") || "pz-cookie-probe.html";
        var letters = attr("data-letters").split(",").filter(function (l) { return l && l !== LIVE; });
        var days = parseInt(attr("data-days"), 10) || 100;
        if (!prefix) return finish("no-prefix");
        var mine = function (s) { return (s || "").split(/;\s*/).filter(function (c) { return c.indexOf(prefix) === 0 && c.indexOf("=") > 0; }); };
        var visible;
        try { visible = document.cookie; } catch (e) { return finish("no-storage"); }
        if (mine(visible).length) return finish("live-has-save");
        if (!letters.length || !navigator.cookieEnabled) return finish("nothing-to-migrate");
        var found = {}, left = letters.length, frames = [];
        var timer = setTimeout(done, 4000);   // never hold the game hostage: a probe that does not load is skipped
        letters.forEach(function (l) {
            var f = document.createElement("iframe");
            f.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
            f.setAttribute("aria-hidden", "true"); f.tabIndex = -1;
            f.onload = function () {
                // same origin: the probe document's document.cookie is what the browser sends for /<folder>/<l>/
                try { var c = mine(f.contentDocument.cookie); if (c.length) found[l] = c; } catch (e) {}
                if (--left === 0) done();
            };
            f.src = "/" + FOLDER + "/" + l + "/" + probe;
            frames.push(f);
            (document.body || document.documentElement).appendChild(f);
        });
        function done() {
            if (state.done) return;
            clearTimeout(timer);
            frames.forEach(function (f) { try { f.parentNode && f.parentNode.removeChild(f); } catch (e) {} });
            var src = Object.keys(found).sort(function (a, b) { return rank(b) - rank(a); })[0];
            if (!src) return finish("nothing-to-migrate", { probed: letters.length });
            if (mine(document.cookie).length) return finish("live-has-save");   // the game wrote while we probed
            var exp = new Date(Date.now() + days * 864e5).toUTCString(), n = 0;
            found[src].forEach(function (c) {
                var eq = c.indexOf("=");
                try { document.cookie = c.slice(0, eq) + "=" + c.slice(eq + 1) + "; expires=" + exp + "; path=" + path; n++; } catch (e) {}
            });
            finish("copied", { from: src, copied: n, probed: letters.length });
        }
    }

    // ================================================================================================ Unity
    function runIdbfs() {
        var idb;
        try { idb = window.indexedDB; } catch (e) { idb = null; }
        if (!idb || !window.IDBKeyRange) return finish("no-indexeddb");
        // capture BEFORE save-sync.js (next tag) wraps these: our copy is not a game write
        var P = window.IDBObjectStore && IDBObjectStore.prototype, D = window.IDBDatabase && IDBDatabase.prototype;
        var open = IDBFactory.prototype.open, oCursor = P.openCursor, oGet = P.get, oPut = P.put, oCount = P.count, oTx = D.transaction;
        var dirOf = function (l) { return location.origin + "/" + FOLDER + "/" + l + (REST_DIR ? "/" + REST_DIR : ""); };
        var LIVE_H = md5(location.href.split("#")[0].split("?")[0].replace(/\/[^\/]*$/, ""));
        var marker = "pzsync:mig:" + LIVE_H;
        if (lsGet(marker)) return finish("already-migrated", { live: LIVE_H });
        // the Poki v3 loader remaps every game's folder to ONE origin-wide hash; that folder is not this game's
        var v3 = lsGet("savegame_idbfs_hash");
        var cands = OTHERS.map(function (l) { return { l: l, h: md5(dirOf(l)) }; }).filter(function (c) { return c.h !== LIVE_H && c.h !== v3; });
        state.live = LIVE_H; state.hashMs = Math.round(now() * 10) / 10;
        var holdMs = +window.PZ_MIGRATE_TEST_HOLD_MS || 0;   // test harness only: proves the ordering guarantee

        var req;
        try { req = open.call(idb, "/idbfs"); } catch (e) { return finish("no-indexeddb"); }
        var created = false;
        req.onupgradeneeded = function () {
            // no "/idbfs" yet: this visitor has never run a Unity game here. Abort so we do not create it
            // (an aborted first upgrade leaves no database behind).
            created = true;
            try { req.transaction.abort(); } catch (e) {}
        };
        req.onblocked = function () { finish("blocked"); };
        req.onerror = function (e) { try { e.preventDefault(); } catch (x) {} finish(created ? "no-database" : "open-failed"); };
        state.syncMs = Math.round(now() * 10) / 10;   // main-thread time this script cost; the rest is async
        req.onsuccess = function () {
            var db = req.result;
            db.onversionchange = function () { try { db.close(); } catch (e) {} };
            if (!db.objectStoreNames.contains("FILE_DATA")) { db.close(); return finish("no-store"); }
            var tx, st, result = null, extra = { live: LIVE_H };
            try { tx = oTx.call(db, ["FILE_DATA"], "readwrite"); st = tx.objectStore("FILE_DATA"); }
            catch (e) { db.close(); return finish("tx-failed"); }
            tx.oncomplete = function () {
                db.close();
                if (result === "copied") lsSet(marker, JSON.stringify({ from: extra.from, n: extra.copied, at: Date.now() }));
                finish(result || "nothing-to-migrate", extra);
            };
            tx.onabort = tx.onerror = function (e) { try { e && e.preventDefault && e.preventDefault(); } catch (x) {} try { db.close(); } catch (x) {} finish("tx-error", extra); };

            var hold = function (cb) {   // test only: keep this readwrite transaction alive for holdMs
                if (!holdMs) return cb();
                (function spin() { if (now() > holdMs) return cb(); oGet.call(st, "/idbfs").onsuccess = spin; })();
            };
            var range = function (h) { return IDBKeyRange.bound("/idbfs/" + h, "/idbfs/" + h + "/￿"); };
            // read every record of one hash folder: [{key, value, rel}]
            var readFolder = function (h, cb) {
                var out = [], c = oCursor.call(st, range(h));
                c.onsuccess = function () {
                    var cur = c.result;
                    if (!cur) return cb(out);
                    var k = String(cur.key);
                    out.push({ key: k, value: cur.value, rel: k.slice(("/idbfs/" + h).length) });
                    cur["continue"]();
                };
            };
            var isDir = function (v) { return v && typeof v.mode === "number" && (v.mode & 61440) === 16384; };
            // "a save" = any file that is not Unity's own analytics/cache tree or a known boot-time default
            var junk = /^\/(Unity|UnityCache)(\/|$)|^\/(com\.paperplanetools\.ratebox\.RateBoxStatistics\.xml|RemoteConfigCache\.json)$/;
            var saveRecs = function (recs) { return recs.filter(function (r) { return r.rel && !isDir(r.value) && !junk.test(r.rel); }); };
            var newest = function (recs) { var t = 0; recs.forEach(function (r) { var d = r.value && r.value.timestamp; d = d && d.getTime ? d.getTime() : +d || 0; if (d > t) t = d; }); return t; };

            hold(function () {
                readFolder(LIVE_H, function (live) {
                    if (saveRecs(live).length) { result = "live-has-save"; return; }
                    var have = {}; live.forEach(function (r) { have[r.key] = 1; });
                    // which candidate folders exist at all: one count() each, all in this transaction
                    var hits = [], left = cands.length;
                    if (!left) { result = "nothing-to-migrate"; return; }
                    cands.forEach(function (c) {
                        var q = oCount.call(st, range(c.h));
                        q.onsuccess = function () { if (q.result) hits.push(c); if (--left === 0) pick(); };
                    });
                    function pick() {
                        if (!hits.length) { result = "nothing-to-migrate"; return; }
                        var best = null, n = hits.length;
                        hits.forEach(function (c) {
                            readFolder(c.h, function (recs) {
                                var s = saveRecs(recs);
                                if (s.length) { var t = newest(s); if (!best || t > best.t || (t === best.t && rank(c.l) > rank(best.c.l))) best = { c: c, t: t, recs: recs }; }
                                if (--n === 0) copy(best);
                            });
                        });
                    }
                    function copy(best) {
                        if (!best) { result = "nothing-to-migrate"; extra.foldersSeen = hits.length; return; }
                        var copied = 0;
                        best.recs.forEach(function (r) {
                            if (/^\/(Unity|UnityCache)(\/|$)/.test(r.rel)) return;   // analytics backlog + asset cache: never copied
                            var to = "/idbfs/" + LIVE_H + r.rel;
                            if (have[to]) return;                                       // never overwrite
                            oPut.call(st, r.value, to); copied++;
                        });
                        result = "copied"; extra.from = best.c.l; extra.fromHash = best.c.h; extra.copied = copied; extra.foldersSeen = hits.length;
                    }
                });
            });
        };
    }

    // ================================================================================================ MD5
    // RFC 1321 over the UTF-8 bytes; returns lowercase hex. (URLs here are ASCII, so this equals Unity's.)
    function md5(str) {
        var s = unescape(encodeURIComponent(str)), n = s.length, i;
        var words = new Array(((n + 8) >> 6) + 1 << 4);
        for (i = 0; i < words.length; i++) words[i] = 0;
        for (i = 0; i < n; i++) words[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
        words[n >> 2] |= 0x80 << ((n % 4) << 3);
        words[words.length - 2] = n * 8;
        var a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
        var add = function (x, y) { var l = (x & 0xffff) + (y & 0xffff); return (((x >> 16) + (y >> 16) + (l >> 16)) << 16) | (l & 0xffff); };
        var rol = function (x, k) { return (x << k) | (x >>> (32 - k)); };
        var cmn = function (q, a, b, x, s, t) { return add(rol(add(add(a, q), add(x, t)), s), b); };
        var ff = function (a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); };
        var gg = function (a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); };
        var hh = function (a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); };
        var ii = function (a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); };
        for (i = 0; i < words.length; i += 16) {
            var oa = a, ob = b, oc = c, od = d, x = words;
            a = ff(a, b, c, d, x[i], 7, -680876936); d = ff(d, a, b, c, x[i + 1], 12, -389564586); c = ff(c, d, a, b, x[i + 2], 17, 606105819); b = ff(b, c, d, a, x[i + 3], 22, -1044525330);
            a = ff(a, b, c, d, x[i + 4], 7, -176418897); d = ff(d, a, b, c, x[i + 5], 12, 1200080426); c = ff(c, d, a, b, x[i + 6], 17, -1473231341); b = ff(b, c, d, a, x[i + 7], 22, -45705983);
            a = ff(a, b, c, d, x[i + 8], 7, 1770035416); d = ff(d, a, b, c, x[i + 9], 12, -1958414417); c = ff(c, d, a, b, x[i + 10], 17, -42063); b = ff(b, c, d, a, x[i + 11], 22, -1990404162);
            a = ff(a, b, c, d, x[i + 12], 7, 1804603682); d = ff(d, a, b, c, x[i + 13], 12, -40341101); c = ff(c, d, a, b, x[i + 14], 17, -1502002290); b = ff(b, c, d, a, x[i + 15], 22, 1236535329);
            a = gg(a, b, c, d, x[i + 1], 5, -165796510); d = gg(d, a, b, c, x[i + 6], 9, -1069501632); c = gg(c, d, a, b, x[i + 11], 14, 643717713); b = gg(b, c, d, a, x[i], 20, -373897302);
            a = gg(a, b, c, d, x[i + 5], 5, -701558691); d = gg(d, a, b, c, x[i + 10], 9, 38016083); c = gg(c, d, a, b, x[i + 15], 14, -660478335); b = gg(b, c, d, a, x[i + 4], 20, -405537848);
            a = gg(a, b, c, d, x[i + 9], 5, 568446438); d = gg(d, a, b, c, x[i + 14], 9, -1019803690); c = gg(c, d, a, b, x[i + 3], 14, -187363961); b = gg(b, c, d, a, x[i + 8], 20, 1163531501);
            a = gg(a, b, c, d, x[i + 13], 5, -1444681467); d = gg(d, a, b, c, x[i + 2], 9, -51403784); c = gg(c, d, a, b, x[i + 7], 14, 1735328473); b = gg(b, c, d, a, x[i + 12], 20, -1926607734);
            a = hh(a, b, c, d, x[i + 5], 4, -378558); d = hh(d, a, b, c, x[i + 8], 11, -2022574463); c = hh(c, d, a, b, x[i + 11], 16, 1839030562); b = hh(b, c, d, a, x[i + 14], 23, -35309556);
            a = hh(a, b, c, d, x[i + 1], 4, -1530992060); d = hh(d, a, b, c, x[i + 4], 11, 1272893353); c = hh(c, d, a, b, x[i + 7], 16, -155497632); b = hh(b, c, d, a, x[i + 10], 23, -1094730640);
            a = hh(a, b, c, d, x[i + 13], 4, 681279174); d = hh(d, a, b, c, x[i], 11, -358537222); c = hh(c, d, a, b, x[i + 3], 16, -722521979); b = hh(b, c, d, a, x[i + 6], 23, 76029189);
            a = hh(a, b, c, d, x[i + 9], 4, -640364487); d = hh(d, a, b, c, x[i + 12], 11, -421815835); c = hh(c, d, a, b, x[i + 15], 16, 530742520); b = hh(b, c, d, a, x[i + 2], 23, -995338651);
            a = ii(a, b, c, d, x[i], 6, -198630844); d = ii(d, a, b, c, x[i + 7], 10, 1126891415); c = ii(c, d, a, b, x[i + 14], 15, -1416354905); b = ii(b, c, d, a, x[i + 5], 21, -57434055);
            a = ii(a, b, c, d, x[i + 12], 6, 1700485571); d = ii(d, a, b, c, x[i + 3], 10, -1894986606); c = ii(c, d, a, b, x[i + 10], 15, -1051523); b = ii(b, c, d, a, x[i + 1], 21, -2054922799);
            a = ii(a, b, c, d, x[i + 8], 6, 1873313359); d = ii(d, a, b, c, x[i + 15], 10, -30611744); c = ii(c, d, a, b, x[i + 6], 15, -1560198380); b = ii(b, c, d, a, x[i + 13], 21, 1309151649);
            a = ii(a, b, c, d, x[i + 4], 6, -145523070); d = ii(d, a, b, c, x[i + 11], 10, -1120210379); c = ii(c, d, a, b, x[i + 2], 15, 718787259); b = ii(b, c, d, a, x[i + 9], 21, -343485551);
            a = add(a, oa); b = add(b, ob); c = add(c, oc); d = add(d, od);
        }
        var hex = "", w = [a, b, c, d];
        for (i = 0; i < 16; i++) hex += ("0" + ((w[i >> 2] >>> ((i % 4) << 3)) & 255).toString(16)).slice(-2);
        return hex;
    }
})();
