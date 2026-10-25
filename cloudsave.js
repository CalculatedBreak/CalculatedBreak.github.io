/*
 * cloudsave.js - saves a game's localStorage keys to the player's Supabase account.
 *
 * In each game's HTML, put this in <head> BEFORE any game script:
 *   <script>window.CLOUD_SAVE = { slug: "my-game", keys: ["gameSave"] };</script>
 *   <script src="/cloudsave.js"></script>
 *
 * slug   unique name for the game (one cloud save per player per slug)
 * keys   the localStorage key names this game uses (DevTools > Application > Local Storage)
 * prefix optional: also sync every key that starts with this text (e.g. "mygame_")
 *
 * Rules it follows:
 *  - nothing is uploaded until the first read of the account's save has succeeded
 *  - a failed read is never treated as "no save"
 *  - if this device and the account differ, the account wins, and this device's copy is
 *    kept so the player can switch back with one tap
 *  - a save is never uploaded over newer progress from another device
 */
(function () {
  "use strict";

  // Same values as in game-hub.html (publishable / anon key only, never the secret key)
  var SUPA_URL = "YOUR_SUPABASE_URL";
  var SUPA_KEY = "YOUR_SUPABASE_ANON_KEY";
  var LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";

  var cfg = window.CLOUD_SAVE || {};
  var SLUG = cfg.slug, KEYS = cfg.keys || [], PREFIX = cfg.prefix || "";
  if (!SLUG || (!KEYS.length && !PREFIX)) { console.warn("[cloudsave] set window.CLOUD_SAVE = { slug, keys } first"); return; }
  if (SUPA_URL.indexOf("YOUR_") === 0 || SUPA_KEY.indexOf("YOUR_") === 0) { console.warn("[cloudsave] add your Supabase URL and key"); return; }

  var ls;
  try { ls = window.localStorage; ls.getItem("x"); } catch (e) { return; }

  var MARK = "cloudsave:" + SLUG + ":sync";      // {uid, h}: hash of the save this device last synced
  var BACKUP = "cloudsave:" + SLUG + ":backup";  // {uid, map, shown}: this device's copy before a restore
  var GUARD = "cloudsave:" + SLUG + ":restored"; // sessionStorage: stops a restore/reload loop
  var MAX = 1024 * 1024;
  var DEBOUNCE = 4000, POLL = 10000;

  var rawSet = Storage.prototype.setItem, rawRemove = Storage.prototype.removeItem, rawGet = Storage.prototype.getItem;

  function isMine(k) {
    if (typeof k !== "string" || k.indexOf("cloudsave:") === 0 || k.indexOf("sb-") === 0) return false;
    return KEYS.indexOf(k) !== -1 || (PREFIX !== "" && k.indexOf(PREFIX) === 0);
  }
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
  // Replace this game's keys with the given copy (raw methods, so our own writes never look like game writes)
  function apply(map) {
    for (var i = ls.length - 1; i >= 0; i--) {
      var k = ls.key(i);
      if (isMine(k) && !Object.prototype.hasOwnProperty.call(map, k)) rawRemove.call(ls, k);
    }
    for (var key in map) if (Object.prototype.hasOwnProperty.call(map, key) && isMine(key)) rawSet.call(ls, key, map[key]);
  }
  function readJson(k) { try { return JSON.parse(rawGet.call(ls, k)); } catch (e) { return null; } }
  function writeJson(k, v) { try { rawSet.call(ls, k, JSON.stringify(v)); } catch (e) {} }

  var sb = null, uid = null, ready = false, paused = false, busy = false, wroteDuring = false;
  var lastSynced = null, lastSeen = null, timer = null, watching = false, checkTimer = null;

  function warn(m, e) { try { console.warn("[cloudsave]", m, e && e.message ? e.message : (e || "")); } catch (x) {} }
  function readMark() { var m = readJson(MARK); return m && m.uid === uid ? m : null; }
  function setMark(h) { writeJson(MARK, { uid: uid, h: h }); }

  // ---- tiny notice ----
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

  // ---- watch the game's writes (hooks installed immediately, uploads wait for the first check-in) ----
  ["setItem", "removeItem", "clear"].forEach(function (name) {
    var orig = Storage.prototype[name];
    Storage.prototype[name] = function (k) {
      var r = orig.apply(this, arguments);
      try { if (this === ls && (name === "clear" || isMine(k))) changed(); } catch (e) {}
      return r;
    };
  });

  function startWatching() {
    ready = true;
    lastSeen = stable(snapshot());
    if (!watching) {
      watching = true;
      // catches writes the hooks can't see, like localStorage.score = 5
      setInterval(function () {
        if (!ready) return;
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
    if (!localEmpty && !localUnchanged) writeJson(BACKUP, { uid: uid, map: local, shown: 0 });
    try {
      apply(server);
      setMark(serverHash);
      try { sessionStorage.setItem(GUARD, serverHash); } catch (e) {}
      location.reload();                        // so the game boots from the restored save
    } catch (e) {
      apply(local);                             // put this device's copy back
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
        await upload(b.map, true);
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
