/* poki-sdk-core.js — local implementation of the PokiSDK API.
   Rewarded ads are served by AppLixir (sandbox key for now). Everything else
   makes no network requests: no tracking, no other ad calls. */
(function () {
  "use strict";

  var debug = false;
  var log = function () {
    if (debug && window.console) console.log.apply(console, ["[PokiSDK-local]"].concat([].slice.call(arguments)));
  };

  // ---------------------------------------------------------------------------
  // AppLixir config
  // ---------------------------------------------------------------------------
  var APPLIXIR = {
    sdkUrl: "https://cdn.applixir.com/applixir.app.v6.1.0.js",
    // SANDBOX key: test ads only, no revenue. Swap for your real key after activation.
    apiKey: "5a4db0c5-0000-4000-8000-5a4db0c50001",
    startTimeoutMs: 8000,   // ad must load/start by then, or we move on
    resultTimeoutMs: 90000  // overall cap once the ad has started
  };

  // Ad events that let the player move on. Skips count too (owner policy).
  var DONE_EVENTS = ["complete", "skipped", "manuallyEnded", "allAdsCompleted", "consentDeclined"];

  var sdkPromise = null;
  var adActive = false;

  function loadApplixirSdk() {
    if (typeof window.initializeAndOpenPlayer === "function") return Promise.resolve();
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = APPLIXIR.sdkUrl;
      s.async = true;
      s.onload = function () {
        typeof window.initializeAndOpenPlayer === "function"
          ? resolve()
          : reject(new Error("applixir_sdk_missing"));
      };
      s.onerror = function () { sdkPromise = null; reject(new Error("applixir_sdk_blocked")); };
      document.head.appendChild(s);
    });
    return sdkPromise;
  }

  function pauseAudio() {
    try { if (window.audioContext && window.audioContext.suspend) window.audioContext.suspend(); } catch (e) {}
  }
  function resumeAudio() {
    try { if (window.audioContext && window.audioContext.resume) window.audioContext.resume(); } catch (e) {}
  }

  // Shows one rewarded ad. ALWAYS resolves (never rejects, never hangs) so the
  // game can't get stuck. Resolves true: completed, skipped, or couldn't load.
  function showRewardedAd() {
    return new Promise(function (resolve) {
      if (adActive) return resolve(true);
      adActive = true;

      var settled = false;
      var startTimer = null;
      var resultTimer = null;
      var container = null;

      function finish(reason) {
        if (settled) return;
        settled = true;
        clearTimeout(startTimer);
        clearTimeout(resultTimer);
        if (container && container.parentNode) container.parentNode.removeChild(container);
        container = null;
        adActive = false;
        resumeAudio();
        log("rewarded ad finished:", reason);
        resolve(true);
      }

      pauseAudio();

      loadApplixirSdk().then(function () {
        if (settled) return;

        container = document.createElement("div");
        container.id = "applixir-ad-container";
        container.style.cssText =
          "position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;background:#000;";
        document.body.appendChild(container);

        startTimer = setTimeout(function () { finish("start_timeout"); }, APPLIXIR.startTimeoutMs);

        var options = {
          apiKey: APPLIXIR.apiKey,
          injectionElementId: "applixir-ad-container",
          adStatusCallbackFn: function (status) {
            var type = status && status.type;
            if (type === "loaded" || type === "started") {
              // ad is really playing: stop the short start race, allow a long result window
              clearTimeout(startTimer);
              if (!resultTimer) {
                resultTimer = setTimeout(function () { finish("result_timeout"); }, APPLIXIR.resultTimeoutMs);
              }
            } else if (DONE_EVENTS.indexOf(type) !== -1) {
              finish(type);
            }
          },
          adErrorCallbackFn: function (error) {
            var code = "error";
            try { code = String(error.getError().data.errorCode || "error"); } catch (e) {}
            finish("error_" + code);
          }
        };

        try {
          var p = window.initializeAndOpenPlayer(options);
          if (p && typeof p.catch === "function") p.catch(function () { finish("init_rejected"); });
        } catch (e) { finish("init_threw"); }
      }).catch(function () { finish("sdk_unavailable"); });
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
      // warm up the AppLixir SDK so the first ad request isn't waiting on the script
      loadApplixirSdk().catch(function () {});
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
    // rewarded breaks show an AppLixir video; reward is granted on complete OR skip
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
