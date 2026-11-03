(function () {
  "use strict";

  var consoleLog = window.consoleLog || console.log.bind(console);

  // Intercept sendBeacon for debugging.
  navigator.sendBeacon = function () {
    consoleLog("--fx--navigator.sendBeacon--", arguments);
    return true;
  };

  // Disable WebSocket connections (often used for leaderboards/telemetry).
  window.WebSocket = function () {
    consoleLog("--fx--WebSocket blocked--");
  };

  // ***** POKI SDK COMPATIBILITY LAYER *****
  function PokiSDK() {
    this._config = {};
    this._callbacks = {};
  }

  PokiSDK.prototype.getURLParam = function (name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name) || "";
  };

  // ***** INIT *****
  PokiSDK.prototype.init = function (config) {
    consoleLog("--fx--PokiSDK--init--", config);
    this._config = config || {};
    
    // Store callbacks provided by the game
    if (this._config.onGameReady) {
      this._callbacks.onGameReady = this._config.onGameReady;
    }
    if (this._config.onAdBreakComplete) {
      this._callbacks.onAdBreakComplete = this._config.onAdBreakComplete;
    }

    // Return a resolved promise immediately to unblock the loader
    return Promise.resolve("InitDone");
  };

  PokiSDK.prototype.setDebug = function (debug) {
    consoleLog("--fx--PokiSDK--setDebug--", debug);
  };

  PokiSDK.prototype.setDebugTouchOverlayController = function (debug) {
    consoleLog("--fx--PokiSDK--setDebugTouchOverlayController--", debug);
  };

  PokiSDK.prototype.isAdBlocked = function () {
    consoleLog("--fx--PokiSDK--isAdBlocked--");
    return false;
  };

  PokiSDK.prototype.happyTime = function (scale) {
    consoleLog("--fx--PokiSDK--happyTime--", scale);
  };

  // ***** LOADING *****
  PokiSDK.prototype.gameLoadingStart = function () {
    consoleLog("--fx--PokiSDK--gameLoadingStart--");
    // Some games wait for this event to start asset preloading
  };

  PokiSDK.prototype.gameLoadingProgress = function (progress) {
    consoleLog("--fx--PokiSDK--gameLoadingProgress--", progress);
    // Simulate progress if needed, e.g., from 0 to 100
  };

  PokiSDK.prototype.gameLoadingFinished = function () {
    consoleLog("--fx--PokiSDK--gameLoadingFinished--");
    
    // CRITICAL: Notify the game that loading is done.
    // Many engines (like Unity) listen for this specific event or callback.
    if (this._callbacks.onGameReady) {
      try {
        this._callbacks.onGameReady();
      } catch (e) {
        console.error("Error calling onGameReady:", e);
      }
    }
    
    // Also dispatch a custom event for broader compatibility
    window.dispatchEvent(new Event('poki:gameLoadingFinished'));
  };

  PokiSDK.prototype.movePill = function (x, y) {
    consoleLog("--fx--PokiSDK--movePill--", x, y);
  };

  // ***** GAME CONTROL *****
  PokiSDK.prototype.gameplayStart = function () {
    consoleLog("--fx--PokiSDK--gameplayStart--");
    window.dispatchEvent(new Event('poki:gameplayStart'));
  };

  PokiSDK.prototype.gameplayStop = function () {
    consoleLog("--fx--PokiSDK--gameplayStop--");
    window.dispatchEvent(new Event('poki:gameplayStop'));
  };

  // ***** ADS CONTROL *****
  PokiSDK.prototype.commercialBreak = function () {
    consoleLog("--fx--PokiSDK--commercialBreak--");
    // Return resolved promise immediately so the game continues
    return Promise.resolve({ adSkippable: true });
  };

  PokiSDK.prototype.rewardedBreak = function () {
    consoleLog("--fx--PokiSDK--rewardedBreak--");
    return Promise.resolve({ rewarded: false });
  };

  PokiSDK.prototype.displayAd = function () {
    consoleLog("--fx--PokiSDK--displayAd--", arguments);
  };

  PokiSDK.prototype.destroyAd = function () {
    consoleLog("--fx--PokiSDK--destroyAd--", arguments);
  };

  PokiSDK.prototype.customEvent = function () {
    consoleLog("--fx--PokiSDK--customEvent--");
  };

  PokiSDK.prototype.measure = function () {
    consoleLog("--fx--PokiSDK--measure--", arguments);
  };

  PokiSDK.prototype.initWithVideoHB = function () {
    consoleLog("--fx--PokiSDK--initWithVideoHB--");
    return Promise.resolve("");
  };

  // Expose globally
  window.PokiSDK = new PokiSDK();

})();