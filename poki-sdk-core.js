/* poki-sdk-core.js — local implementation of the PokiSDK API.
   Rewarded ads are served by HilltopAds through a VAST tag, played by the small
   built-in video player below. Everything else makes no network requests: no
   tracking, no other ad calls. */
(function () {
  "use strict";

  var debug = false;
  var log = function () {
    if (debug && window.console) console.log.apply(console, ["[PokiSDK-local]"].concat([].slice.call(arguments)));
  };

  // ---------------------------------------------------------------------------
  // HilltopAds VAST config
  // ---------------------------------------------------------------------------
  var VAST = {
    tagUrl: "https://unfolded-uncle.com/d/mlF/z.dgGPN/v-ZtGhUe/Ce/my9vutZUUKl/kfPyTMcC1zNKTEkxz/MWDuUPtENGz/UC1jOITIM/wVOjQn",
    fetchTimeoutMs: 6000,    // the VAST XML must arrive by then, or we move on
    startTimeoutMs: 8000,    // the video must start playing by then, or we try the next file/ad
    totalTimeoutMs: 90000,   // hard cap for the whole rewarded break
    maxWrapperDepth: 3
  };

  var adActive = false;

  function pauseAudio() {
    try { if (window.audioContext && window.audioContext.suspend) window.audioContext.suspend(); } catch (e) {}
  }
  function resumeAudio() {
    try { if (window.audioContext && window.audioContext.resume) window.audioContext.resume(); } catch (e) {}
  }

  // ---------------------------------------------------------------------------
  // VAST helpers
  // ---------------------------------------------------------------------------
  function txt(node) { return node ? (node.textContent || "").trim() : ""; }
  function list(node, name) { return Array.prototype.slice.call(node.getElementsByTagName(name)); }

  function parseTime(s) {
    var m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec((s || "").trim());
    return m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : null;
  }

  function skipSeconds(raw, duration) {
    if (!raw) return null;
    raw = raw.trim();
    if (raw.charAt(raw.length - 1) === "%") {
      var pct = parseFloat(raw);
      return duration && !isNaN(pct) ? duration * pct / 100 : null;
    }
    return parseTime(raw);
  }

  // Fires a tracking pixel. Never throws.
  function pixel(url, errorCode) {
    if (!url) return;
    url = url
      .replace(/\[ERRORCODE\]/g, String(errorCode || 900))
      .replace(/\[(CACHEBUSTING|TIMESTAMP)\]/g, String(Date.now()));
    try { var img = new Image(); img.src = url; } catch (e) {}
    log("pixel", url.slice(0, 80));
  }
  function pixels(urls, errorCode) {
    (urls || []).forEach(function (u) { pixel(u, errorCode); });
  }

  function fetchText(url, ms) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var ctrl = typeof AbortController === "function" ? new AbortController() : null;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        try { if (ctrl) ctrl.abort(); } catch (e) {}
        reject(new Error("vast_timeout"));
      }, ms);
      fetch(url, { cache: "no-store", credentials: "omit", signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) {
          if (!r.ok) throw new Error("vast_http_" + r.status);
          return r.text();
        })
        .then(function (text) {
          if (done) return;
          done = true; clearTimeout(timer); resolve(text);
        })
        .catch(function (e) {
          if (done) return;
          done = true; clearTimeout(timer); reject(e);
        });
    });
  }

  // Pulls impressions / errors / tracking / click trackers out of one <Ad>.
  function collect(adEl) {
    var info = { impressions: [], errors: [], tracking: {}, clickTracking: [] };
    list(adEl, "Impression").forEach(function (n) { var u = txt(n); if (u) info.impressions.push(u); });
    list(adEl, "Error").forEach(function (n) { var u = txt(n); if (u) info.errors.push(u); });
    list(adEl, "ClickTracking").forEach(function (n) { var u = txt(n); if (u) info.clickTracking.push(u); });
    list(adEl, "Tracking").forEach(function (n) {
      var ev = n.getAttribute("event"), u = txt(n);
      if (ev && u) (info.tracking[ev] = info.tracking[ev] || []).push(u);
    });
    return info;
  }

  function merge(a, b) {
    var out = {
      impressions: a.impressions.concat(b.impressions),
      errors: a.errors.concat(b.errors),
      clickTracking: a.clickTracking.concat(b.clickTracking),
      tracking: {}
    };
    [a.tracking, b.tracking].forEach(function (t) {
      Object.keys(t).forEach(function (k) { out.tracking[k] = (out.tracking[k] || []).concat(t[k]); });
    });
    return out;
  }

  // Loads a VAST tag (following wrappers) and resolves to a list of playable creatives.
  function loadVast(url, depth, inherit) {
    return fetchText(url, VAST.fetchTimeoutMs).then(function (text) {
      var doc = new DOMParser().parseFromString(text, "text/xml");
      if (doc.getElementsByTagName("parsererror").length) throw new Error("vast_parse");

      var root = doc.documentElement;
      var docErrors = list(root, "Error")
        .filter(function (n) { return n.parentNode === root; })
        .map(txt).filter(Boolean);

      var jobs = list(doc, "Ad").map(function (ad) {
        var own = collect(ad);
        own.errors = own.errors.concat(docErrors);
        var info = merge(inherit, own);

        var wrapper = list(ad, "Wrapper")[0];
        if (wrapper) {
          var next = txt(list(wrapper, "VASTAdTagURI")[0]);
          if (!next || depth >= VAST.maxWrapperDepth) return [];
          return loadVast(next, depth + 1, info).catch(function () { return []; });
        }

        var linear = list(ad, "Linear")[0];
        if (!linear) return [];
        var duration = parseTime(txt(list(linear, "Duration")[0]));
        return [{
          media: list(linear, "MediaFile").map(function (n) {
            return {
              url: txt(n),
              type: n.getAttribute("type") || "",
              width: parseInt(n.getAttribute("width"), 10) || 0
            };
          }),
          clickThrough: txt(list(linear, "ClickThrough")[0]),
          duration: duration,
          skipAt: skipSeconds(linear.getAttribute("skipoffset"), duration),
          info: info
        }];
      });

      return Promise.all(jobs).then(function (parts) { return [].concat.apply([], parts); });
    });
  }

  // Playable media files, MP4 first, closest to the screen width first.
  function pickMedia(files) {
    var probe = document.createElement("video");
    var targetW = Math.min(window.innerWidth || 1280, 1280);
    return files
      .filter(function (m) { return m.url && probe.canPlayType(m.type) !== ""; })
      .sort(function (a, b) {
        var am = /mp4/i.test(a.type) ? 0 : 1, bm = /mp4/i.test(b.type) ? 0 : 1;
        if (am !== bm) return am - bm;
        return Math.abs(a.width - targetW) - Math.abs(b.width - targetW);
      });
  }

  // ---------------------------------------------------------------------------
  // Rewarded ad
  // ---------------------------------------------------------------------------
  // Shows one rewarded video. ALWAYS resolves (never rejects, never hangs) so the
  // game can't get stuck. Resolves true: finished, skipped, or couldn't load.
  function showRewardedAd() {
    return new Promise(function (resolve) {
      if (adActive) return resolve(true);
      adActive = true;

      var settled = false;
      var totalTimer = null;
      var startTimer = null;
      var container = null;
      var video = null;
      var skipBtn = null;
      var unmuteBtn = null;
      var creatives = [];

      function dropVideo() {
        clearTimeout(startTimer);
        if (video) {
          try { video.pause(); video.removeAttribute("src"); video.load(); } catch (e) {}
          if (video.parentNode) video.parentNode.removeChild(video);
          video = null;
        }
      }

      function finish(reason) {
        if (settled) return;
        settled = true;
        clearTimeout(totalTimer);
        dropVideo();
        if (container && container.parentNode) container.parentNode.removeChild(container);
        container = null;
        adActive = false;
        resumeAudio();
        log("rewarded ad finished:", reason);
        resolve(true);
      }

      function buildContainer() {
        if (container) return;
        container = document.createElement("div");
        container.id = "hilltop-ad-container";
        container.style.cssText =
          "position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;background:#000;" +
          "display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;";

        var badge = document.createElement("div");
        badge.textContent = "Advertisement";
        badge.style.cssText =
          "position:absolute;top:12px;left:12px;padding:4px 10px;border-radius:6px;" +
          "background:rgba(0,0,0,.6);color:#fff;font-size:13px;z-index:2;";
        container.appendChild(badge);

        skipBtn = document.createElement("button");
        skipBtn.type = "button";
        skipBtn.hidden = true;
        skipBtn.style.cssText =
          "position:absolute;top:12px;right:12px;padding:8px 14px;border:0;border-radius:8px;" +
          "background:rgba(255,255,255,.92);color:#000;font:600 14px system-ui,sans-serif;" +
          "cursor:pointer;z-index:2;";
        container.appendChild(skipBtn);

        unmuteBtn = document.createElement("button");
        unmuteBtn.type = "button";
        unmuteBtn.hidden = true;
        unmuteBtn.textContent = "Unmute";
        unmuteBtn.style.cssText =
          "position:absolute;bottom:12px;left:12px;padding:8px 14px;border:0;border-radius:8px;" +
          "background:rgba(255,255,255,.92);color:#000;font:600 14px system-ui,sans-serif;" +
          "cursor:pointer;z-index:2;";
        container.appendChild(unmuteBtn);

        document.body.appendChild(container);
      }

      // Plays one media file of one creative. Calls onFail() if it never starts.
      function startVideo(c, media, onFail) {
        buildContainer();
        dropVideo();

        var info = c.info;
        var started = false;
        var sent = {};

        function once(ev) {
          if (sent[ev]) return;
          sent[ev] = true;
          pixels(info.tracking[ev]);
        }

        video = document.createElement("video");
        video.setAttribute("playsinline", "");
        video.setAttribute("webkit-playsinline", "");
        video.preload = "auto";
        video.style.cssText = "width:100%;height:100%;object-fit:contain;background:#000;";
        container.insertBefore(video, container.firstChild);

        var v = video;

        startTimer = setTimeout(function () {
          if (started || settled || v !== video) return;
          pixels(info.errors, 402);
          dropVideo();
          onFail();
        }, VAST.startTimeoutMs);

        v.addEventListener("playing", function () {
          if (started) return;
          started = true;
          clearTimeout(startTimer);
          pixels(info.impressions);
          once("creativeView");
          once("start");
          if (c.skipAt != null) { skipBtn.hidden = false; updateSkip(0); }
        });

        v.addEventListener("timeupdate", function () {
          if (!started) return;
          var d = v.duration, t = v.currentTime;
          if (d && isFinite(d)) {
            var p = t / d;
            if (p >= 0.25) once("firstQuartile");
            if (p >= 0.5) once("midpoint");
            if (p >= 0.75) once("thirdQuartile");
          }
          updateSkip(t);
        });

        v.addEventListener("ended", function () {
          if (settled || v !== video) return;
          once("complete");
          finish("complete");
        });

        v.addEventListener("error", function () {
          if (settled || v !== video) return;
          pixels(info.errors, 405);
          if (!started) { dropVideo(); onFail(); }
          else finish("video_error");
        });

        function updateSkip(t) {
          if (c.skipAt == null) return;
          var left = Math.ceil(c.skipAt - t);
          if (left > 0) {
            skipBtn.textContent = "Skip ad in " + left;
            skipBtn.disabled = true;
            skipBtn.style.opacity = ".7";
          } else {
            skipBtn.textContent = "Skip ad \u203A";
            skipBtn.disabled = false;
            skipBtn.style.opacity = "1";
          }
        }

        skipBtn.onclick = function () {
          if (skipBtn.disabled) return;
          pixels(info.tracking.skip);
          finish("skipped");
        };

        unmuteBtn.onclick = function () {
          v.muted = false;
          unmuteBtn.hidden = true;
        };

        v.addEventListener("click", function () {
          if (!c.clickThrough) return;
          pixels(info.clickTracking);
          pixels(info.tracking.click);
          try { window.open(c.clickThrough, "_blank", "noopener"); } catch (e) {}
        });

        v.src = media.url;
        var p = v.play();
        if (p && typeof p.catch === "function") {
          p.catch(function () {
            // Autoplay with sound was blocked: retry muted and offer an Unmute button.
            if (settled || v !== video) return;
            v.muted = true;
            unmuteBtn.hidden = false;
            var p2 = v.play();
            if (p2 && typeof p2.catch === "function") p2.catch(function () {});
          });
        }
      }

      // Tries creative i with media file j, then the next file, then the next creative.
      function attempt(i, j) {
        if (settled) return;
        if (i >= creatives.length) return finish("no_playable_ad");
        var c = creatives[i];
        if (!c._media) c._media = pickMedia(c.media);
        if (j >= c._media.length) {
          pixels(c.info.errors, 403);
          return attempt(i + 1, 0);
        }
        startVideo(c, c._media[j], function () { attempt(i, j + 1); });
      }

      pauseAudio();
      totalTimer = setTimeout(function () { finish("total_timeout"); }, VAST.totalTimeoutMs);

      var empty = { impressions: [], errors: [], tracking: {}, clickTracking: [] };
      loadVast(VAST.tagUrl, 0, empty).then(function (found) {
        if (settled) return;
        creatives = found || [];
        if (!creatives.length) return finish("no_ad");
        attempt(0, 0);
      }).catch(function (e) {
        log("vast load failed:", e && e.message);
        finish("vast_unavailable");
      });
    });
  }

  // ---------------------------------------------------------------------------

  function getParam(name) {
    var m = new RegExp("[?&]" + name + "=([^&#]*)").exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : "";
  }

  function deviceCategory() {
    var ua = navigator.userAgent || "";
    if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) return "tablet";
    if (/phone|ipod|android.+mobile|iemobile|blackberry|opera mini/i.test(ua)) return "mobile";
    if (/ipad|android|tablet/i.test(ua)) return "tablet";
    return "desktop";
  }

  var SDK = {
    // ---- lifecycle ----
    init: function (opts) {
      log("init", opts);
      return Promise.resolve();
    },
    initWithVideoHB: function (opts) { return SDK.init(opts); },
    setDebug: function (v) { debug = v !== false; },
    setLogging: function (v) { debug = !!v; },

    // ---- ads ----
    // commercial breaks stay as no-ops (nothing shown)
    commercialBreak: function (onStart) {
      log("commercialBreak");
      try { if (typeof onStart === "function") onStart(); } catch (e) { console.error(e); }
      return Promise.resolve();
    },
    // rewarded breaks show a HilltopAds VAST video; reward is granted on complete OR skip
    rewardedBreak: function (arg) {
      log("rewardedBreak");
      try {
        var cb = typeof arg === "function" ? arg : arg && arg.onStart;
        if (typeof cb === "function") cb();
      } catch (e) { console.error(e); }
      return showRewardedAd(); // resolves true
    },
    displayAd: function (container, size, onCanDestroy, onDisplayRendered) {
      log("displayAd", size);
      if (typeof onDisplayRendered === "function") onDisplayRendered(true);
      if (typeof onCanDestroy === "function") onCanDestroy();
    },
    destroyAd: function () {},
    muteAd: function () {},
    setVolume: function () {},
    isAdBlocked: function () { return false; },

    // ---- gameplay / loading events (no-ops) ----
    gameLoadingStart: function () {},
    gameLoadingProgress: function () {},
    gameLoadingFinished: function () { log("gameLoadingFinished"); },
    gameInteractive: function () {},
    gameplayStart: function () { log("gameplayStart"); },
    gameplayStop: function () { log("gameplayStop"); },
    roundStart: function () {},
    roundEnd: function () {},
    happyTime: function () {},
    customEvent: function () {},
    measure: function () {},
    enableEventTracking: function () {},
    setPlayerAge: function () {},

    // ---- errors ----
    captureError: function (e) { log("captureError", e); },
    logError: function (e) { log("logError", e); },

    // ---- scores / leaderboard ----
    sendHighscore: function () {},
    getLeaderboard: function () { return Promise.resolve([]); },
    showLeaderboard: function () {},

    // ---- accounts ----
    getUser: function () { return Promise.resolve(null); },
    getToken: function () { return Promise.resolve(null); },
    login: function () { return Promise.resolve(); },

    // ---- utilities ----
    getURLParam: function (key) { return getParam("gd" + key) || getParam(key) || ""; },
    getLanguage: function () {
      return (getParam("iso_lang") || navigator.language || "en").toLowerCase().split("-")[0];
    },
    getDeviceInfo: function () { return { category: deviceCategory() }; },
    shareableURL: function (params) {
      var p = new URLSearchParams();
      Object.keys(params || {}).forEach(function (k) {
        if (params[k] !== undefined && params[k] !== null) p.set(k, params[k]);
      });
      return Promise.resolve(location.origin + location.pathname + "?" + p.toString());
    },
    openExternalLink: function (url) { window.open(url, "_blank", "noopener"); },
    generateScreenshot: function () { return Promise.resolve(null); },

    // ---- misc no-ops kept for API compatibility ----
    setDebugTouchOverlayController: function () {},
    setPlaytestCanvas: function () {},
    playtestSetCanvas: function () {},
    playtestCaptureHtmlOnce: function () {},
    playtestCaptureHtmlForce: function () {},
    playtestCaptureHtmlOn: function () {},
    playtestCaptureHtmlOff: function () {},
    movePill: function () {}
  };

  window.PokiSDK = SDK;
})();