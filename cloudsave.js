/*
 * cloudsave.js - fully automatic localStorage & IndexedDB/localforage sync to Supabase.
 */
(function () {
  "use strict";

  var SUPA_URL = "https://yerxoikcfeulgnrdjkyc.supabase.co";
  var SUPA_KEY = "sb_publishable_QX-XZw_wiRj_u0NXHGRkOA_Pq7rGK-p"; // Use your actual key
  var LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js";

  var pathSegments = location.pathname.split("/").filter(Boolean);
  while (pathSegments.length > 0 && (pathSegments[pathSegments.length - 1] === "games" || pathSegments[pathSegments.length - 1] === "")) {
    pathSegments.pop();
  }
  var SLUG = pathSegments[pathSegments.length - 1] || "home";
  
  var cfg = window.CLOUD_SAVE || {};
  if (cfg.slug) SLUG = cfg.slug;

  if (SUPA_URL.indexOf("YOUR_") === 0 || SUPA_KEY.indexOf("YOUR_") === 0) {
    console.warn("[cloudsave] add your Supabase URL and key");
    return;
  }

  var ls;
  try { ls = window.localStorage; ls.getItem("x"); } catch (e) { return; }

  var MARK = "cloudsave:" + SLUG + ":sync";
  var BACKUP = "cloudsave:" + SLUG + ":backup";
  var GUARD = "cloudsave:" + SLUG + ":restored";
  var MAX = 2 * 1024 * 1024;
  var DEBOUNCE = 4000, POLL = 10000;

  var rawSet = Storage.prototype.setItem, rawRemove = Storage.prototype.removeItem, rawGet = Storage.prototype.getItem;

  function isMine(k) {
    if (typeof k !== "string") return false;
    if (k.indexOf("cloudsave:") === 0 || k.indexOf("sb-") === 0 || k.indexOf("GA::") === 0) return false;
    return true;
  }

  // ---- IndexedDB / LocalForage Helper ----
  async function getIDBSnapshot() {
    if (!window.indexedDB || typeof window.indexedDB.databases !== "function") return {};
    try {
      var dbs = await window.indexedDB.databases();
      var idbData = {};
      for (var i = 0; i < dbs.length; i++) {
        var dbName = dbs[i].name;
        // Target common localforage or game DB names
        if (dbName && (dbName.indexOf("localforage") !== -1 || dbName.indexOf("c3") !== -1 || dbName === SLUG)) {
          var storeData = await readIndexedDBStore(dbName);
          if (Object.keys(storeData).length > 0) {
            idbData[dbName] = storeData;
          }
        }
      }
      return idbData;
    } catch (e) {
      return {};
    }
  }

  function readIndexedDBStore(dbName) {
    return new Promise(function (resolve) {
      var req = window.indexedDB.open(dbName);
      req.onerror = function () { resolve({}); };
      req.onsuccess = function (e) {
        var db = e.target.result;
        var result = {};
        var stores = Array.from(db.objectStoreNames);
        if (stores.length === 0) { db.close(); return resolve({}); }
        
        var tx = db.transaction(stores, "readonly");
        var completed = 0;
        stores.forEach(function (storeName) {
          try {
            var store = tx.objectStore(storeName);
            var cursorReq = store.openCursor();
            var storeMap = {};
            cursorReq.onsuccess = function (evt) {
              var cursor = evt.target.result;
              if (cursor) {
                storeMap[cursor.key] = cursor.value;
                cursor.continue();
              } else {
                result[storeName] = storeMap;
                completed++;
                if (completed === stores.length) { db.close(); resolve(result); }
              }
            };
            cursorReq.onerror = function () {
              completed++;
              if (completed === stores.length) { db.close(); resolve(result); }
            };
          } catch (err) {
            completed++;
            if (completed === stores.length) { db.close(); resolve(result); }
          }
        });
      };
    });
  }

  async function applyIDB(idbPayload) {
    if (!idbPayload || typeof idbPayload !== "object") return;
    for (var dbName in idbPayload) {
      if (!Object.prototype.hasOwnProperty.call(idbPayload, dbName)) continue;
      var stores = idbPayload[dbName];
      await writeIndexedDBStore(dbName, stores);
    }
  }

  function writeIndexedDBStore(dbName, storesMap) {
    return new Promise(function (resolve) {
      var req = window.indexedDB.open(dbName);
      req.onerror = function () { resolve(); };
      req.onsuccess = function (e) {
        var db = e.target.result;
        var storeNames = Object.keys(storesMap);
        var validStores = storeNames.filter(function (s) { return db.objectStoreNames.contains(s); });
        if (validStores.length === 0) { db.close(); return resolve(); }

        var tx = db.transaction(validStores, "readwrite");
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { db.close(); resolve(); };

        validStores.forEach(function (storeName) {
          var store = tx.objectStore(storeName);
          var data = storesMap[storeName];
          for (var key in data) {
            if (Object.prototype.hasOwnProperty.call(data, key)) {
              store.put(data[key], key);
            }
          }
        });
      };
    });
  }

  async function snapshot() {
    var o = {};
    // 1. Capture localStorage
    var lsData = {};
    for (var i = 0; i < ls.length; i++) {
      var k = ls.key(i);
      if (isMine(k)) { var v = rawGet.call(ls, k); if (typeof v === "string") lsData[k] = v; }
    }
    if (Object.keys(lsData).length > 0) o.ls = lsData;

    // 2. Capture IndexedDB
    var idbData = await getIDBSnapshot();
    if (Object.keys(idbData).length > 0) o.idb = idbData;

    return o;
  }

  function stable(o) { return JSON.stringify(o); }
  function hash(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; }
    return s.length + "." + h.toString(36);
  }
  function count(o) { return Object.keys(o && o.ls || {}).length + Object.keys(o && o.idb || {}).length; }

  async function apply(map) {
    if (!map) return;
    if (map.ls) {
      for (var i = ls.length - 1; i >= 0; i--) {
        var k = ls.key(i);
        if (isMine(k) && !Object.prototype.hasOwnProperty.call(map.ls, k)) rawRemove.call(ls, k);
      }
      for (var key in map.ls) {
        if (Object.prototype.hasOwnProperty.call(map.ls, key) && isMine(key)) rawSet.call(ls, key, map.ls[key]);
      }
    }
    if (map.idb) {
      await applyIDB(map.idb);
    }
  }

  function readJson(k) { try { return JSON.parse(rawGet.call(ls, k)); } catch (e) { return null; } }
  function writeJson(k, v) { try { rawSet.call(ls, k, JSON.stringify(v)); } catch (e) {} }

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

  async function fetchRow() {
    var r = await sb.from("game_saves").select("payload").eq("user_id", uid).eq("game_slug", SLUG).maybeSingle();
    if (r.error) throw r.error;
    return r.data;
  }
  function rowMap(row) { return row && row.payload && row.payload.keys && typeof row.payload.keys === "object" ? row.payload.keys : null; }

  async function upload(map, force) {
    if (count(map) === 0) return "empty"; // Never upload empty state bugfix
    var str = stable(map);
    if (str.length > MAX) { warn("save is too big to store, skipping"); return "big"; }
    if (!force) {
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
      var map = await snapshot();
      if (count(map) > 0 && stable(map) !== lastSynced) await upload(map, false);
    } catch (e) { failed = true; warn("upload failed, will retry", e); }
    busy = false;
    var currentMap = await snapshot();
    if (!paused && ready && count(currentMap) > 0 && stable(currentMap) !== lastSynced) {
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

  ["setItem", "removeItem", "clear"].forEach(function (name) {
    var orig = Storage.prototype[name];
    Storage.prototype[name] = function (k) {
      var r = orig.apply(this, arguments);
      try { if (this === ls && (name === "clear" || isMine(k))) changed(); } catch (e) {}
      return r;
    };
  });

  async function startWatching() {
    ready = true;
    lastSeen = stable(await snapshot());
    if (!watching) {
      watching = true;
      setInterval(async function () {
        if (!ready) return;
        var s = stable(await snapshot());
        if (s !== lastSeen) { lastSeen = s; changed(); }
      }, POLL);
      document.addEventListener("visibilitychange", function () { if (document.hidden) flush(); });
    }
    if (wroteDuring) changed();
  }

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

    var local = await snapshot(), localStr = stable(local), server = rowMap(row);
    var localEmpty = count(local) === 0;

    if (!count(server)) {
      if (!localEmpty) { try { await upload(local, true); } catch (e) { warn("first upload failed", e); } }
      return startWatching();
    }
    var serverStr = stable(server), serverHash = hash(serverStr), mark = readMark();
    if (serverStr === localStr) { setMark(serverHash); lastSynced = serverStr; return startWatching(); }

    if (mark && mark.h === serverHash && !localEmpty) {
      try { await upload(local, true); } catch (e) { warn("upload failed", e); }
      return startWatching();
    }

    try { if (sessionStorage.getItem(GUARD) === serverHash) { paused = true; warn("this save was just restored; uploads paused for this page"); return; } } catch (e) {}
    var localUnchanged = !!mark && mark.h === hash(localStr);
    if (!localEmpty && !localUnchanged) writeJson(BACKUP, { uid: uid, map: local, shown: 0 });
    try {
      await apply(server);
      setMark(serverHash);
      try { sessionStorage.setItem(GUARD, serverHash); } catch (e) {}
      location.reload();
    } catch (e) {
      await apply(local);
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
        await apply(b.map);
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
    sb.auth.onAuthStateChange(function (event, session) {
      var u = session && session.user;
      setTimeout(function () {
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
