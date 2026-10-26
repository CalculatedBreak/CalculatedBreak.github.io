/* poki-sdk-core.js — local implementation of the PokiSDK API.
   No network requests, no ads, no tracking, no external domains. */
(function () {
  "use strict";

  var debug = false;
  var log = function () {
    if (debug && window.console) console.log.apply(console, ["[PokiSDK-local]"].concat([].slice.call(arguments)));
  };

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

    // ---- ads (always "completed" immediately, nothing is shown) ----
    commercialBreak: function (onStart) {
      log("commercialBreak");
      try { if (typeof onStart === "function") onStart(); } catch (e) { console.error(e); }
      return Promise.resolve();
    },
    rewardedBreak: function (arg) {
      log("rewardedBreak");
      try {
        var cb = typeof arg === "function" ? arg : arg && arg.onStart;
        if (typeof cb === "function") cb();
      } catch (e) { console.error(e); }
      return Promise.resolve(true); // reward always granted
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
