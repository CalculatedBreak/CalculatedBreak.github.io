/* poki-sdk.js — local stand-in. No network, no external domains. */
(function () {
  "use strict";

  var resolved = function () { return Promise.resolve(); };
  var noop = function () {};

  // Safe fallback so the game works even before/without the core file.
  var fallback = {
    init: resolved,
    initWithVideoHB: resolved,
    commercialBreak: function (cb) { try { if (typeof cb === "function") cb(); } catch (e) {} return Promise.resolve(); },
    rewardedBreak: function () { return Promise.resolve(true); },
    displayAd: function (c, s, onCanDestroy, onRendered) { if (onRendered) onRendered(true); if (onCanDestroy) onCanDestroy(); },
    getLeaderboard: function () { return Promise.resolve([]); },
    shareableURL: function () { return Promise.resolve(location.href); },
    getURLParam: function () { return ""; },
    getLanguage: function () { return (navigator.language || "en").toLowerCase().split("-")[0]; },
    getDeviceInfo: function () { return { category: "desktop" }; },
    isAdBlocked: function () { return false; },
    getUser: function () { return Promise.resolve(null); },
    getToken: function () { return Promise.resolve(null); },
    login: resolved,
    generateScreenshot: function () { return Promise.resolve(null); },
    measure: noop
  };

  ["captureError", "customEvent", "gameInteractive", "gameLoadingFinished",
   "gameLoadingProgress", "gameLoadingStart", "gameplayStart", "gameplayStop",
   "happyTime", "logError", "muteAd", "roundEnd", "roundStart", "sendHighscore",
   "setDebug", "setDebugTouchOverlayController", "setLogging", "setPlayerAge",
   "setPlaytestCanvas", "enableEventTracking", "openExternalLink",
   "playtestSetCanvas", "playtestCaptureHtmlOnce", "playtestCaptureHtmlForce",
   "playtestCaptureHtmlOn", "playtestCaptureHtmlOff", "movePill",
   "showLeaderboard", "destroyAd", "setVolume"
  ].forEach(function (name) { fallback[name] = noop; });

  window.PokiSDK = fallback;

  // Load the core implementation from the same folder (relative path only).
  var s = document.createElement("script");
  s.src = "/poki-sdk-core.js";
  s.async = false;
  document.head.appendChild(s);
})();
