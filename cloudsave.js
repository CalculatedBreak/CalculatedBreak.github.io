/*
 * cloudsave.js - automatic save sync to the player's Supabase account.
 * Syncs localStorage AND IndexedDB (Construct 3 / localforage games keep their saves in IndexedDB).
 *
 * Add to each game's <head>, before any game script:
 *   <script src="/cloudsave.js"></script>
 * The game's name comes from its folder (/games/blumgi-merge/ -> "blumgi-merge").
 * Debug: add ?cloudsave_debug=1 to a game's URL to see what it is doing in the console.
 */
(function () {
  "use strict";

 var SUPA_URL = "https://yerxoikcfeulgnrdjkyc.supabase.co";
var SUPA_KEY = "sb_publishable_QX-XZw_wiRj_u0NXHGRkOA_Pq7rGK-p"; // Use your actual key
var LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";
  // Leading URL segments to skip before the game folder:
  // 1 for https://name.github.io/games/blumgi-merge/   0 for https://name.github.io/blumgi-merge/
  var SKIP = 1;

  var cfg = window.CLOUD_SAVE || {};
  var seg = location.pathname.split("/").filter(Boolean);
  var SLUG = cfg.slug || (seg[SKIP] || "home").replace(/\.html?$/i, "");
  try { SLUG = decodeURIComponent(SLUG); } catch (e) {}
  SLUG = SLUG.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 100);
  var DEBUG = /[?&]cloudsave_debug=1(?:&|$)/.test(location.search);

  if (SUPA_URL.indexOf("YOUR_") === 0 || SUPA_KEY.indexOf("YOUR_") === 0) { console.warn("[cloudsave] add your Supabase URL and key"); return; }

  var ls;
  try { ls = window.localStorage; ls.getItem("x"); } catch (e) { return; }

  var MARK = "cloudsave:" + SLUG + ":sync";      // {uid, h}: hash of the save this device last synced
  var BACKUP = "cloudsave:" + SLUG + ":backup";  // {uid, p, shown}: this device's copy before a restore
  var GUARD = "cloudsave:" + SLUG + ":restored"; // sessionStorage: stops a restore/reload loop
  var OWN = "cloudsave:own2";                    // {"ls|key" / "idb|name": [game slugs]}
  var MAX = 1024 * 1024, DEBOUNCE = 4000, POLL = 10000;
  // databases that are caches or other tools' data, never progress
  var IGNORE_DB = /cache|^\/idbfs-test$|^pzsync-backup$/i;

  var rawSet = Storage.prototype.setItem, rawRemove = Storage.prototype.removeItem,
      rawGet = Storage.prototype.getItem, rawClear = Storage.prototype.clear;
  var IDBOS = window.IDBObjectStore ? IDBObjectStore.prototype : null;
  var rawPut = IDBOS && IDBOS.put, rawIdbClear = IDBOS && IDBOS.clear;
  var rawOpen = window.IDBFactory ? IDBFactory.prototype.open : null;

  function dlog() { if (DEBUG) { try { console.log.apply(console, ["[cloudsave]"].concat([].slice.call(arguments))); } catch (e) {} } }
  function warn(m, e) { try { console.warn("[cloudsave]", m, e && e.message ? e.message : (e || "")); } catch (x) {} }

  function isSystem(k) {
    return typeof k !== "string" || k.indexOf("cloudsave:") === 0 || k.indexOf("sb-") === 0 || k.indexOf("GA::") === 0;
  }
  function readJson(k) { try { return JSON.parse(rawGet.call(ls, k)); } catch (e) { return null; } }
  function writeJson(k, v) { try { rawSet.call(ls, k, JSON.stringify(v)); } catch (e) {} }

  // ---- which keys / databases belong to this game ----
  function owners(id) { var o = (readJson(OWN) || {})[id]; return Array.isArray(o) ? o : []; }
  function owned(id) { return owners(id).indexOf(SLUG) !== -1; }
  function claim(id) {
    var all = readJson(OWN) || {}, o = Array.isArray(all[id]) ? all[id] : [];
    if (o.indexOf(SLUG) === -1) { all[id] = o.concat([SLUG]).slice(-8); writeJson(OWN, all); }
  }

  // ---- canonical JSON (the server stores jsonb, which re-orders keys) ----
  function stableStringify(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
    if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
    var keys = Object.keys(v).sort(), parts = [];
    for (var i = 0; i < keys.length; i++) if (v[keys[i]] !== undefined) parts.push(JSON.stringify(keys[i]) + ":" + stableStringify(v[keys[i]]));
    return "{" + parts.join(",") + "}";
  }
  function hash(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; }
    return s.length + "." + h.toString(36);
  }
  function count(o) { return Object.keys(o || {}).length; }

  // ---- IndexedDB values (structured clone is not JSON) ----
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
    if (t === "number") return isFinite(v) ? v : { __cs: "num", v: String(v) };
    if (t !== "object") throw new Unsupported(t);
    if (v instanceof Date) return { __cs: "date", v: v.getTime() };
    if (ArrayBuffer.isView(v)) {
      var name = v.constructor && v.constructor.name;
      if (!TYPED[name]) throw new Unsupported(name || "view");
      return { __cs: "ta", t: name, b: b64encode(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    }
    if (v instanceof ArrayBuffer) return { __cs: "ab", b: b64encode(new Uint8Array(v)) };
    if (Array.isArray(v)) return v.map(encodeValue);
    var proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) throw new Unsupported((v.constructor && v.constructor.name) || "object");
    var o = {};
    for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = encodeValue(v[k]);
    return Object.prototype.hasOwnProperty.call(v, "__cs") ? { __cs: "obj", o: o } : o;
  }
  function decodeValue(v) {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(decodeValue);
    if (typeof v.__cs === "string") {
      switch (v.__cs) {
        case "date": return new Date(v.v);
        case "num": return Number(v.v);
        case "ab": return b64decode(v.b).buffer;
        case "ta": { var u8 = b64decode(v.b), C = window[v.t]; return (TYPED[v.t] && C) ? new C(u8.buffer, 0, u8.byteLength / C.BYTES_PER_ELEMENT) : u8; }
        case "obj": return decodeValue(v.o);
      }
    }
    var o = {};
    for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = decodeValue(v[k]);
    return o;
  }
  function approxSize(v, depth) {
    if (v === null || v === undefined) return 4;
    var t = typeof v;
    if (t === "string") return v.length * 2;
    if (t !== "object") return 8;
    if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return v.byteLength;
    if (v instanceof Date) return 8;
    if ((depth || 0) > 6) return 64;
    var n = 16;
    if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) n += approxSize(v[i], (depth || 0) + 1); return n; }
    for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) n += k.length * 2 + approxSize(v[k], (depth || 0) + 1);
    return n;
  }
  function idbOk() { try { return !!(window.indexedDB && rawOpen && typeof indexedDB.databases === "function"); } catch (e) { return false; } }
  function req2p(req) { return new Promise(function (res, rej) { req.onsuccess = function () { res(req.result); }; req.onerror = function () { rej(req.error || new Error("idb request failed")); }; }); }
  function isInline(st) { return !(st.keyPath === null || st.keyPath === undefined || st.keyPath === ""); }

  // open an EXISTING database without changing it (a missing one is not created)
  function openExisting(name) {
    return new Promise(function (res, rej) {
      var req, aborted = false;
      try { req = rawOpen.call(indexedDB, name); } catch (e) { return rej(e); }
      req.onupgradeneeded = function (e) { aborted = true; try { e.target.transaction.abort(); } catch (x) {} };
      req.onsuccess = function () { var db = req.result; db.onversionchange = function () { try { db.close(); } catch (x) {} }; res(db); };
      req.onerror = function () { if (aborted) res(null); else rej(req.error || new Error("idb open failed")); };
      req.onblocked = function () { rej(new Error("idb open blocked")); };
    });
  }
  function readStore(st, room) {
    return new Promise(function (res, rej) {
      var recs = [], size = 0, req;
      try { req = st.openCursor(); } catch (e) { return rej(e); }
      req.onsuccess = function () {
        var c = req.result;
        if (!c) return res({ records: recs, size: size });
        try {
          size += approxSize(c.key) + approxSize(c.value);
          if (size > room) return res(null);
          recs.push([encodeValue(c.key), encodeValue(c.value)]);
        } catch (e) { return rej(e); }
        c["continue"]();
      };
      req.onerror = function () { rej(req.error || new Error("idb read failed")); };
    });
  }
  // -> {dbs, over}; throws on a read error (nothing is decided from half a snapshot)
  async function readIdb(pred, room) {
    var out = {}, bytes = 0, over = false;
    if (!idbOk()) return { dbs: out, over: false };
    var list = await indexedDB.databases();
    for (var i = 0; i < list.length && !over; i++) {
      var name = list[i] && list[i].name;
      if (!name || IGNORE_DB.test(name) || !pred(name)) continue;
      var db = await openExisting(name);
      if (!db) continue;
      try {
        var names = [].slice.call(db.objectStoreNames);
        if (!names.length) continue;
        var dbOut = { version: db.version, stores: {} };
        var tx = db.transaction(names, "readonly");
        var results = await Promise.all(names.map(function (sn) {
          var st = tx.objectStore(sn);
          var meta = { keyPath: st.keyPath === undefined ? null : st.keyPath, autoIncrement: !!st.autoIncrement, indexes: [], records: [] };
          [].slice.call(st.indexNames).forEach(function (n) { var ix = st.index(n); meta.indexes.push({ name: n, keyPath: ix.keyPath, unique: !!ix.unique, multiEntry: !!ix.multiEntry }); });
          return readStore(st, room - bytes).then(function (r) { return { sn: sn, meta: meta, r: r }; });
        }));
        results.forEach(function (x) {
          if (!x.r) { over = true; return; }
          bytes += x.r.size;
          if (x.r.records.length) { x.meta.records = x.r.records; dbOut.stores[x.sn] = x.meta; }
        });
        if (count(dbOut.stores)) out[name] = dbOut;
      } catch (e) {
        if (e instanceof Unsupported) { out[name] = { unsupported: e.what }; warn("a value in " + name + " (" + e.what + ") cannot be synced"); }
        else throw e;
      } finally { try { db.close(); } catch (x) {} }
    }
    return { dbs: out, over: over || bytes > room };
  }
  // open for a restore at a version that cannot be refused
  function openForRestore(name, snap) {
    var want = snap.version || 1, storeNames = Object.keys(snap.stores);
    return openExisting(name).then(function (db) {
      var missing = db ? storeNames.filter(function (sn) { return !db.objectStoreNames.contains(sn); }) : storeNames;
      if (db && db.version >= want && !missing.length) return db;
      var target = db ? (db.version >= want ? db.version + 1 : want) : want;
      if (db) db.close();
      return new Promise(function (res, rej) {
        var req;
        try { req = rawOpen.call(indexedDB, name, target); } catch (e) { return rej(e); }
        req.onupgradeneeded = function () {
          var d = req.result;
          storeNames.forEach(function (sn) {
            var m = snap.stores[sn], st;
            if (d.objectStoreNames.contains(sn)) st = req.transaction.objectStore(sn);
            else st = d.createObjectStore(sn, { keyPath: m.keyPath === null ? undefined : m.keyPath, autoIncrement: !!m.autoIncrement });
            (m.indexes || []).forEach(function (ix) { if (!st.indexNames.contains(ix.name)) st.createIndex(ix.name, ix.keyPath, { unique: !!ix.unique, multiEntry: !!ix.multiEntry }); });
          });
        };
        req.onsuccess = function () { var d = req.result; d.onversionchange = function () { try { d.close(); } catch (x) {} }; res(d); };
        req.onerror = function () { rej(req.error || new Error("idb restore open failed: " + name)); };
        req.onblocked = function () { rej(new Error("idb restore blocked: " + name)); };
      });
    });
  }
  async function applyIdb(dbs) {
    for (var name in dbs) {
      var snap = dbs[name];
      if (!snap || snap.unsupported || !snap.stores || IGNORE_DB.test(name) || !idbOk()) continue;
      var storeNames = Object.keys(snap.stores);
      if (!storeNames.length) continue;
      var db = await openForRestore(name, snap);
      await new Promise(function (res, rej) {
        try {
          var tx = db.transaction(storeNames, "readwrite");
          tx.oncomplete = function () { db.close(); res(); };
          tx.onerror = tx.onabort = function () { try { db.close(); } catch (x) {} rej(tx.error || new Error("idb restore failed")); };
          storeNames.forEach(function (sn) {
            var st = tx.objectStore(sn), recs = snap.stores[sn].records || [], inline = isInline(st);
            rawIdbClear.call(st);
            recs.forEach(function (rec) {
              if (inline) rawPut.call(st, decodeValue(rec[1]));
              else rawPut.call(st, decodeValue(rec[1]), decodeValue(rec[0]));
            });
          });
        } catch (e) { try { db.close(); } catch (x) {} rej(e); }
      });
      claim("idb|" + name);
    }
  }

  // ---- localStorage ----
  function snapshotLs() {
    var o = {};
    for (var i = 0; i < ls.length; i++) {
      var k = ls.key(i);
      if (!isSystem(k) && owned("ls|" + k)) { var v = rawGet.call(ls, k); if (typeof v === "string") o[k] = v; }
    }
    return o;
  }
  function applyLs(map) {
    for (var i = ls.length - 1; i >= 0; i--) {
      var k = ls.key(i);
      if (!isSystem(k) && owned("ls|" + k) && owners("ls|" + k).length === 1 && !Object.prototype.hasOwnProperty.call(map, k)) rawRemove.call(ls, k);
    }
    for (var key in map) if (Object.prototype.hasOwnProperty.call(map, key) && !isSystem(key)) { rawSet.call(ls, key, map[key]); claim("ls|" + key); }
  }
  // writes the hooks can't see (localStorage.x = 1) are noticed by comparing with what was there at load
  var known = {};
  for (var ki = 0; ki < ls.length; ki++) { var kk = ls.key(ki); if (!isSystem(kk)) known[kk] = rawGet.call(ls, kk); }
  function claimChanges() {
    for (var i = 0; i < ls.length; i++) {
      var k = ls.key(i);
      if (isSystem(k)) continue;
      var v = rawGet.call(ls, k);
      if (known[k] !== v) { known[k] = v; claim("ls|" + k); }
    }
  }

  // ---- a whole snapshot: {ls, idb}, always in encoded form ----
  var overNotified = false;
  async function takeSnapshot() {
    claimChanges();
    var l = snapshotLs();
    var r = await readIdb(function (n) { return owned("idb|" + n); }, MAX - approxSize(l));
    if (r.over) {
      paused = true; clearTimeout(timer);
      warn("this game's save is over " + MAX + " bytes, so it is not synced");
      if (!overNotified) { overNotified = true; notice("This game's save is too big to store in your account, so it stays on this device."); }
      return null;
    }
    return { ls: l, idb: r.dbs };
  }
  function comparableIdb(p) {
    var out = {}, dbs = (p && p.idb) || {};
    Object.keys(dbs).forEach(function (n) {
      var st = dbs[n] && dbs[n].stores; if (!st) return;
      var o = {};
      Object.keys(st).forEach(function (s) { if (st[s] && st[s].records && st[s].records.length) o[s] = st[s].records; });
      if (count(o)) out[n] = o;
    });
    return out;
  }
  function cmp(p) { return stableStringify({ ls: (p && p.ls) || {}, idb: comparableIdb(p) }); }
  function isEmpty(p) { return !p || (!count(p.ls) && !count(comparableIdb(p))); }
  function rowPayload(row) {
    var pl = row && row.payload;
    if (!pl || typeof pl !== "object") return null;
    return { ls: pl.ls || pl.keys || {}, idb: pl.idb || {} };
  }
  async function applyPayload(p) { await applyIdb(p.idb || {}); applyLs(p.ls || {}); }

  var sb = null, uid = null, ready = false, paused = false, busy = false, again = false, wroteDuring = false;
  var lastSynced = null, lastSeenLs = null, timer = null, watching = false, checkTimer = null;
  function readMark() { var m = readJson(MARK); return m && m.uid === uid ? m : null; }
  function setMark(h) { writeJson(MARK, { uid: uid, h: h }); }

  function whenBody(fn) { if (document.body) fn(); else document.addEventListener("DOMContentLoaded", fn, { once: true }); }
  function notice(text, label, onClick) {
    whenBody(function () {
      var d = document.createElement("div");
      d.setAttribute("role", "status");
      d.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:2147483647;max-width:min(92vw,380px);padding:10px 34px 10px 12px;border-radius:12px;background:#161616;color:#fff;font:500 13px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.45)";
      d.appendChild(document.createTextNode(text + " "));
      if (label) {
        var b = document.createElement("button");
        b.type = "button"; b.textContent = label;
        b.style.cssText = "margin-top:6px;display:block;padding:6px 12px;border:0;border-radius:999px;background:#1f6dff;color:#fff;font:600 12px system-ui,sans-serif;cursor:pointer";
        b.onclick = function () { b.disabled = true; onClick(); };
        d.appendChild(b);
      }
      var x = document.createElement("button");
      x.type = "button"; x.textContent = "\u00d7"; x.setAttribute("aria-label", "Dismiss");
      x.style.cssText = "position:absolute;top:6px;right:8px;border:0;background:none;color:#bbb;font-size:18px;cursor:pointer";
      x.onclick = function () { d.remove(); };
      d.appendChild(x);
      document.body.appendChild(d);
    });
  }

  // ---- server ----
  async function fetchRow() {
    var r = await sb.from("game_saves").select("payload").eq("user_id", uid).eq("game_slug", SLUG).maybeSingle();
    if (r.error) throw r.error;
    return r.data;
  }
  async function upload(p, force) {
    var c = cmp(p);
    if (isEmpty(p)) { dlog("nothing to upload"); return "empty"; }
    if (c.length > MAX) { warn("save is too big to store, skipping"); return "big"; }
    if (!force) {
      // never overwrite progress another device saved since this device last synced
      var cur = rowPayload(await fetchRow());
      if (cur && !isEmpty(cur)) {
        var cs = cmp(cur), mark = readMark();
        if (cs !== c && !(mark && mark.h === hash(cs))) {
          paused = true;
          clearTimeout(timer);
          notice("Newer progress for this game was saved on another device.", "Reload", function () { location.reload(); });
          return "conflict";
        }
      }
    }
    var r = await sb.from("game_saves").upsert(
      { user_id: uid, game_slug: SLUG, payload: { v: 2, ls: p.ls, idb: p.idb }, updated_at: new Date().toISOString() },
      { onConflict: "user_id,game_slug" }
    );
    if (r.error) throw r.error;
    setMark(hash(c));
    lastSynced = c;
    dlog("uploaded", c.length, "chars");
    return "ok";
  }

  async function flush() {
    if (!ready || paused || busy || !uid) return;
    busy = true; again = false;
    var failed = false;
    try {
      var p = await takeSnapshot();
      if (p && !isEmpty(p) && cmp(p) !== lastSynced) await upload(p, false);
    } catch (e) { failed = true; warn("upload failed, will retry", e); }
    busy = false;
    if (!paused && ready && (failed || again)) { clearTimeout(timer); timer = setTimeout(flush, failed ? 20000 : DEBOUNCE); }
  }
  function changed() {
    wroteDuring = true;
    if (!ready || paused) return;
    if (busy) { again = true; return; }
    clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE);
  }

  // ---- watch the game's writes (hooks go in immediately; uploads wait for the first check-in) ----
  ["setItem", "removeItem"].forEach(function (name) {
    var orig = Storage.prototype[name];
    Storage.prototype[name] = function (k) {
      var r = orig.apply(this, arguments);
      try { if (this === ls && !isSystem(k)) { claim("ls|" + k); known[k] = rawGet.call(ls, k); changed(); } } catch (e) {}
      return r;
    };
  });
  // clear() removes this game's keys only: not the login session, not other games' saves
  Storage.prototype.clear = function () {
    if (this !== ls) return rawClear.apply(this, arguments);
    for (var i = ls.length - 1; i >= 0; i--) {
      var k = ls.key(i);
      if (isSystem(k)) continue;
      var o = owners("ls|" + k);
      if (o.length && o.indexOf(SLUG) === -1) continue;
      rawRemove.call(ls, k);
    }
    try { changed(); } catch (e) {}
  };
  function hookIdb(proto, method, isCursor) {
    if (!proto || typeof proto[method] !== "function") return;
    var orig = proto[method];
    proto[method] = function () {
      var r = orig.apply(this, arguments);
      try {
        var st = this;
        if (isCursor) { st = this.source; if (st && st.objectStore) st = st.objectStore; }
        var name = st && st.transaction && st.transaction.db && st.transaction.db.name;
        if (name && !IGNORE_DB.test(name)) { claim("idb|" + name); changed(); }
      } catch (e) {}
      return r;
    };
  }
  ["put", "add", "delete", "clear"].forEach(function (m) { hookIdb(IDBOS, m, false); });
  if (window.IDBCursor) { hookIdb(IDBCursor.prototype, "update", true); hookIdb(IDBCursor.prototype, "delete", true); }
  // a database this page opens is this game's database
  if (rawOpen) {
    IDBFactory.prototype.open = function (name) {
      try { if (typeof name === "string" && !IGNORE_DB.test(name)) { claim("idb|" + name); dlog("game opened database", name); } } catch (e) {}
      return rawOpen.apply(this, arguments);
    };
  }

  function startWatching() {
    ready = true;
    claimChanges();
    lastSeenLs = stableStringify(snapshotLs());
    if (!watching) {
      watching = true;
      // catches property-style localStorage writes
      setInterval(function () {
        if (!ready) return;
        claimChanges();
        var s = stableStringify(snapshotLs());
        if (s !== lastSeenLs) { lastSeenLs = s; changed(); }
      }, POLL);
      document.addEventListener("visibilitychange", function () { if (document.hidden) flush(); });
    }
    if (wroteDuring) changed();
    dlog("watching", SLUG);
  }

  // ---- the check-in: one successful read of the account's save before anything is uploaded ----
  function retryCheckIn(myUid, e) {
    warn("could not check your account's save, nothing is uploaded; retrying", e);
    clearTimeout(checkTimer);
    checkTimer = setTimeout(function () { if (uid === myUid) checkIn(); }, 15000);
  }
  async function buildBackup(local, server) {
    var keep = { ls: {}, idb: {} }, k;
    for (k in local.ls) keep.ls[k] = local.ls[k];
    for (k in local.idb) keep.idb[k] = local.idb[k];
    try {
      // older local saves under the same names that no game has written yet are kept too
      for (k in (server.ls || {})) {
        var cur = rawGet.call(ls, k);
        if (!isSystem(k) && typeof cur === "string" && !(k in keep.ls) && cur !== server.ls[k]) keep.ls[k] = cur;
      }
      var names = Object.keys(server.idb || {}).filter(function (n) { return !(n in keep.idb); });
      if (names.length) {
        var r = await readIdb(function (n) { return names.indexOf(n) !== -1; }, MAX);
        if (!r.over) for (k in r.dbs) keep.idb[k] = r.dbs[k];
      }
    } catch (e) { warn("could not fully back up this device's copy", e); }
    return keep;
  }
  async function checkIn() {
    var myUid = uid, row, local;
    try { row = await fetchRow(); } catch (e) { return retryCheckIn(myUid, e); }
    if (uid !== myUid) return;
    try { local = await takeSnapshot(); } catch (e) { return retryCheckIn(myUid, e); }
    if (!local || uid !== myUid) return;

    var server = rowPayload(row), localEmpty = isEmpty(local);
    dlog("check-in: local", localEmpty ? "empty" : "has data", "| account", (!server || isEmpty(server)) ? "empty" : "has data");

    if (!server || isEmpty(server)) {           // the account has no save for this game yet
      if (!localEmpty) { try { await upload(local, true); } catch (e) { warn("first upload failed", e); } }
      return startWatching();
    }
    var sc = cmp(server), sh = hash(sc), lc = cmp(local), mark = readMark();
    if (sc === lc) { setMark(sh); lastSynced = sc; return startWatching(); }

    // this device was in sync with the account's save and has played since: send its progress up
    if (mark && mark.h === sh && !localEmpty) {
      try { await upload(local, true); } catch (e) { warn("upload failed", e); }
      return startWatching();
    }

    // otherwise the account's save wins
    try { if (sessionStorage.getItem(GUARD) === sh) { paused = true; warn("this save was just restored; uploads paused for this page"); return; } } catch (e) {}
    var localUnchanged = !!mark && mark.h === hash(lc);
    var keep = await buildBackup(local, server);
    if (!isEmpty(keep) && !localUnchanged) writeJson(BACKUP, { uid: uid, p: keep, shown: 0 });
    try {
      await applyPayload(server);
      setMark(sh);
      try { sessionStorage.setItem(GUARD, sh); } catch (e) {}
      dlog("restored the account's save, reloading");
      location.reload();                        // so the game boots from the restored save
    } catch (e) {
      try { await applyPayload(keep); } catch (e2) { warn("could not fully put this device's copy back", e2); }
      paused = true;
      warn("could not load your account's save into this browser", e);
      notice("Your account's progress could not be loaded in this browser, so saving is paused.");
    }
  }

  function maybeUndoBanner() {
    var b = readJson(BACKUP);
    if (!b || b.uid !== uid || b.shown || !b.p) return;
    b.shown = 1; writeJson(BACKUP, b);
    notice("Loaded your account's progress. This device had different progress.", "Use this device's instead", async function () {
      try {
        await applyPayload(b.p);
        var p = await takeSnapshot();
        if (p) await upload(p, true);
        rawRemove.call(ls, BACKUP);
      } catch (e) { warn("could not switch", e); }
      location.reload();
    });
  }

  function reset() {
    ready = false; paused = false; busy = false; again = false; lastSynced = null;
    clearTimeout(timer); clearTimeout(checkTimer);
  }

  function boot() {
    sb = window.supabase.createClient(SUPA_URL, SUPA_KEY);
    // Same origin as the hub page, so this picks up the session the hub's login created
    sb.auth.onAuthStateChange(function (event, session) {
      var u = session && session.user;
      setTimeout(function () {                  // never call supabase from inside this callback directly
        if (u && u.is_anonymous !== true) {
          if (u.id !== uid) { reset(); uid = u.id; dlog("signed in, slug =", SLUG); maybeUndoBanner(); checkIn(); }
        } else if (uid) { reset(); uid = null; }
      }, 0);
    });
  }

  if (window.supabase && window.supabase.createClient) boot();
  else {
    var s = document.createElement("script");
    s.src = LIB; s.async = true;
    s.onload = boot;
    s.onerror = function () { warn("could not load the login library; progress stays on this device"); };
    (document.head || document.documentElement).appendChild(s);
  }
})();
