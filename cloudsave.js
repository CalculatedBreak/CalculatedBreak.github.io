/*
 * cloudsave.js - automatic localStorage sync to the player's Supabase account.
 * Add to each game's <head>, before any game script:
 *   <script src="/cloudsave.js"></script>
 * The game's name comes from its folder (/moto-x3m/index.html -> "moto-x3m").
 * Optional override: <script>window.CLOUD_SAVE = { slug: "my-game" };</script> first.
 *
 * Every game on your site shares ONE localStorage, so this tracks which keys each game
 * has written and only syncs a game's own keys.
 */
(function () {
  "use strict";

  var SUPA_URL = "https://yerxoikcfeulgnrdjkyc.supabase.co";
  var SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InllcnhvaWtjZmV1bGducmRqa3ljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5NTU5MjQsImV4cCI6MjEwODUzMTkyNH0.30CNvMAFfmUfCVbW8w9QWzvxUWB-Y7L45DENNH-kyvc";
  var LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";
  // Leading URL segments to skip before the game folder. 0 for https://name.github.io/game/,
  // 1 for a project site like https://name.github.io/repo/game/
  var SKIP = 0;

  var cfg = window.CLOUD_SAVE || {};
  var seg = location.pathname.split("/").filter(Boolean);
  var SLUG = cfg.slug || (seg[SKIP] || "home").replace(/\.html?$/i, "");
  try { SLUG = decodeURIComponent(SLUG); } catch (e) {}
  SLUG = SLUG.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 100);

  if (SUPA_URL.indexOf("YOUR_") === 0 || SUPA_KEY.indexOf("YOUR_") === 0) { console.warn("[cloudsave] add your Supabase URL and key"); return; }

  var ls;
  try { ls = window.localStorage; ls.getItem("x"); } catch (e) { return; }

  var MARK = "cloudsave:" + SLUG + ":sync";      // {uid, h}: hash of the save this device last synced
  var BACKUP = "cloudsave:" + SLUG + ":backup";  // {uid, map, shown}: this device's copy before a restore
  var GUARD = "cloudsave:" + SLUG + ":restored"; // sessionStorage: stops a restore/reload loop
  var OWN = "cloudsave:own";                     // {key: [game slugs that wrote it]}
  var MAX = 1024 * 1024, DEBOUNCE = 4000, POLL = 10000;

  var rawSet = Storage.prototype.setItem, rawRemove = Storage.prototype.removeItem,
      rawGet = Storage.prototype.getItem, rawClear = Storage.prototype.clear;

  function isSystem(k) {
    return typeof k !== "string" || k.indexOf("cloudsave:") === 0 || k.indexOf("sb-") === 0 || k.indexOf("GA::") === 0;
  }
  function readJson(k) { try { return JSON.parse(rawGet.call(ls, k)); } catch (e) { return null; } }
  function writeJson(k, v) { try { rawSet.call(ls, k, JSON.stringify(v)); } catch (e) {} }

  // ---- which keys belong to this game ----
  function owners(k) { var o = (readJson(OWN) || {})[k]; return Array.isArray(o) ? o : []; }
  function owned(k) { return owners(k).indexOf(SLUG) !== -1; }
  function claim(k) {
    if (isSystem(k)) return;
    var all = readJson(OWN) || {}, o = Array.isArray(all[k]) ? all[k] : [];
    if (o.indexOf(SLUG) === -1) { all[k] = o.concat([SLUG]).slice(-8); writeJson(OWN, all); }
  }
  function isMine(k) { return !isSystem(k) && owned(k); }

  function snapshot() {
    var o = {};
    for (var i = 0; i < ls.length; i++) {
      var k = ls.key(i);
      if (isMine(k)) { var v = rawGet.call(ls, k); if (typeof v === "string") o[k] = v; }
    }
    return o;
  }
  function stable(o) { return JSON.stringify(Object.keys(o).sort().map(function (k) { return [k, o[k]]; })); }
  function hash(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; }
    return s.length + "." + h.toString(36);
  }
  function count(o) { return Object.keys(o || {}).length; }

  // Replace this game's keys with the given copy. A key shared with another game is never removed.
  function apply(map) {
    for (var i = ls.length - 1; i >= 0; i--) {
      var k = ls.key(i);
      if (isMine(k) && owners(k).length === 1 && !Object.prototype.hasOwnProperty.call(map, k)) rawRemove.call(ls, k);
    }
    for (var key in map) {
      if (Object.prototype.hasOwnProperty.call(map, key) && !isSystem(key)) { rawSet.call(ls, key, map[key]); claim(key); }
    }
  }

  // Writes the hooks can't see (localStorage.x = 1) are noticed by comparing with what was there at load
  var known = {};
  for (var ki = 0; ki < ls.length; ki++) { var kk = ls.key(ki); if (!isSystem(kk)) known[kk] = rawGet.call(ls, kk); }
  function claimChanges() {
    for (var i = 0; i < ls.length; i++) {
      var k = ls.key(i);
      if (isSystem(k)) continue;
      var v = rawGet.call(ls, k);
      if (known[k] !== v) { known[k] = v; claim(k); }
    }
  }

  var sb = null, uid = null, ready = false, paused = false, busy = false, wroteDuring = false;
  var lastSynced = null, lastSeen = null, timer = null, watching = false, checkTimer = null;

  function warn(m, e) { try { console.warn("[cloudsave]", m, e && e.message ? e.message : (e || "")); } catch (x) {} }
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
  function rowMap(row) { return row && row.payload && row.payload.keys && typeof row.payload.keys === "object" ? row.payload.keys : null; }

  async function upload(map, force) {
    var str = stable(map);
    if (str.length > MAX) { warn("save is too big to store, skipping"); return "big"; }
    if (!force) {
      // never overwrite progress another device saved since this device last synced
      var cur = rowMap(await fetchRow());
      if (count(cur)) {
        var cs = stable(cur), mark = readMark();
        if (cs !== str && !(mark && mark.h === hash(cs))) {
          paused = true;
          clearTimeout(timer);
          notice("Newer progress for this game was saved on another device.", "Reload", function () { location.reload(); });
          return "conflict";
        }
      }
    }
    var r = await sb.from("game_saves").upsert(
      { user_id: uid, game_slug: SLUG, payload: { v: 1, keys: map }, updated_at: new Date().toISOString() },
      { onConflict: "user_id,game_slug" }
    );
    if (r.error) throw r.error;
    setMark(hash(str));
    lastSynced = str;
    return "ok";
  }

  async function flush() {
    if (!ready || paused || busy || !uid) return;
    busy = true;
    var failed = false;
    try {
      claimChanges();
      var map = snapshot();
      if (stable(map) !== lastSynced) await upload(map, false);
    } catch (e) { failed = true; warn("upload failed, will retry", e); }
    busy = false;
    if (!paused && ready && stable(snapshot()) !== lastSynced) {
      clearTimeout(timer);
      timer = setTimeout(flush, failed ? 20000 : DEBOUNCE);
    }
  }

  function changed() {
    wroteDuring = true;
    if (!ready || paused) return;
    clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE);
  }

  // ---- watch the game's writes (hooks go in immediately; uploads wait for the first check-in) ----
  ["setItem", "removeItem"].forEach(function (name) {
    var orig = Storage.prototype[name];
    Storage.prototype[name] = function (k) {
      var r = orig.apply(this, arguments);
      try { if (this === ls && !isSystem(k)) { claim(k); known[k] = rawGet.call(ls, k); changed(); } } catch (e) {}
      return r;
    };
  });
  // clear() removes this game's keys only: not the login session, not other games' saves
  Storage.prototype.clear = function () {
    if (this !== ls) return rawClear.apply(this, arguments);
    for (var i = ls.length - 1; i >= 0; i--) {
      var k = ls.key(i);
      if (isSystem(k)) continue;
      var o = owners(k);
      if (o.length && o.indexOf(SLUG) === -1) continue;
      rawRemove.call(ls, k);
    }
    try { changed(); } catch (e) {}
  };

  function startWatching() {
    ready = true;
    claimChanges();
    lastSeen = stable(snapshot());
    if (!watching) {
      watching = true;
      setInterval(function () {
        if (!ready) return;
        claimChanges();
        var s = stable(snapshot());
        if (s !== lastSeen) { lastSeen = s; changed(); }
      }, POLL);
      document.addEventListener("visibilitychange", function () { if (document.hidden) flush(); });
    }
    if (wroteDuring) changed();
  }

  // ---- the check-in: one successful read of the account's save before anything is uploaded ----
  async function checkIn() {
    var myUid = uid, row;
    try { row = await fetchRow(); }
    catch (e) {
      warn("could not reach your account, nothing is uploaded; retrying", e);
      clearTimeout(checkTimer);
      checkTimer = setTimeout(function () { if (uid === myUid) checkIn(); }, 15000);
      return;
    }
    if (uid !== myUid) return;

    claimChanges();
    var local = snapshot(), localStr = stable(local), server = rowMap(row);
    var localEmpty = !count(local);

    if (!count(server)) {                       // the account has no save for this game yet
      if (!localEmpty) { try { await upload(local, true); } catch (e) { warn("first upload failed", e); } }
      return startWatching();
    }
    var serverStr = stable(server), serverHash = hash(serverStr), mark = readMark();
    if (serverStr === localStr) { setMark(serverHash); lastSynced = serverStr; return startWatching(); }

    // this device was in sync with the account's save and has played since: send its progress up
    if (mark && mark.h === serverHash && !localEmpty) {
      try { await upload(local, true); } catch (e) { warn("upload failed", e); }
      return startWatching();
    }

    // otherwise the account's save wins
    try { if (sessionStorage.getItem(GUARD) === serverHash) { paused = true; warn("this save was just restored; uploads paused for this page"); return; } } catch (e) {}
    var localUnchanged = !!mark && mark.h === hash(localStr);
    // keep this device's copy, including older local saves under the same key names that no game has written yet
    var keep = {}, k;
    for (k in local) keep[k] = local[k];
    for (k in server) {
      var cur = rawGet.call(ls, k);
      if (!isSystem(k) && typeof cur === "string" && cur !== server[k] && !(k in keep)) keep[k] = cur;
    }
    if (count(keep) && !localUnchanged) writeJson(BACKUP, { uid: uid, map: keep, shown: 0 });
    try {
      apply(server);
      setMark(serverHash);
      try { sessionStorage.setItem(GUARD, serverHash); } catch (e) {}
      location.reload();                        // so the game boots from the restored save
    } catch (e) {
      apply(keep);                              // put this device's copy back
      paused = true;
      warn("could not load your account's save into this browser", e);
      notice("Your account's progress could not be loaded in this browser, so saving is paused.");
    }
  }

  function maybeUndoBanner() {
    var b = readJson(BACKUP);
    if (!b || b.uid !== uid || b.shown) return;
    b.shown = 1; writeJson(BACKUP, b);
    notice("Loaded your account's progress. This device had different progress.", "Use this device's instead", async function () {
      try {
        apply(b.map);
        await upload(snapshot(), true);
        rawRemove.call(ls, BACKUP);
      } catch (e) { warn("could not switch", e); }
      location.reload();
    });
  }

  function reset() {
    ready = false; paused = false; busy = false; lastSynced = null;
    clearTimeout(timer); clearTimeout(checkTimer);
  }

  function boot() {
    sb = window.supabase.createClient(SUPA_URL, SUPA_KEY);
    // Same origin as the hub page, so this picks up the session the hub's login created
    sb.auth.onAuthStateChange(function (event, session) {
      var u = session && session.user;
      setTimeout(function () {                  // never call supabase from inside this callback directly
        if (u && u.is_anonymous !== true) {
          if (u.id !== uid) { reset(); uid = u.id; maybeUndoBanner(); checkIn(); }
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
