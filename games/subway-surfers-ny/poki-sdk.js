(function () {
  "use strict";

  var consoleLog = window.consoleLog || console.log.bind(console);

  // Intercept sendBeacon for debugging.
  navigator.sendBeacon = function () {
    consoleLog("--fx--navigator.sendBeacon--", arguments);
    return true;
  };

  // Disable WebSocket connections.
  window.WebSocket = function () {
    consoleLog("--fx--WebSocket blocked--");
  };

  // ***** POKI SDK COMPATIBILITY LAYER *****
  function PokiSDK() {

    this.getURLParam = function (name) {
      return "";
    };

    // ***** INIT *****
    this.init = function () {
      return Promise.resolve("InitDone");
    };

    this.setDebug = function (debug) {
      consoleLog("--fx--PokiSDK--setDebug--", debug);
    };

    this.setDebugTouchOverlayController = function (debug) {
      consoleLog("--fx--PokiSDK--setDebugTouchOverlayController--", debug);
    };

    this.isAdBlocked = function () {
      consoleLog("--fx--PokiSDK--isAdBlocked--");
      return false;
    };

    this.happyTime = function (scale) {
      consoleLog("--fx--PokiSDK--happyTime--", scale);
    };

    // ***** LOADING *****
    this.gameLoadingStart = function () {
      consoleLog("--fx--PokiSDK--gameLoadingStart--");
    };

    this.gameLoadingProgress = function (progress) {
      consoleLog("--fx--PokiSDK--gameLoadingProgress--", progress);
    };

    this.gameLoadingFinished = function () {
      consoleLog("--fx--PokiSDK--gameLoadingFinished--");
    };

    this.movePill = function (x, y) {
      consoleLog("--fx--PokiSDK--movePill--", x, y);
    };

    // ***** GAME CONTROL *****
    this.gameplayStart = function () {
      consoleLog("--fx--PokiSDK--gameplayStart--");
    };

    this.gameplayStop = function () {
      consoleLog("--fx--PokiSDK--gameplayStop--");
    };

    // ***** ADS CONTROL *****
    this.commercialBreak = function () {
      consoleLog("--fx--PokiSDK--commercialBreak--");
      return Promise.resolve(false);
    };

    this.rewardedBreak = function () {
      consoleLog("--fx--PokiSDK--rewardedBreak--");
      return Promise.resolve(false);
    };

    this.displayAd = function () {
      consoleLog("--fx--PokiSDK--displayAd--", arguments);
    };

    this.destroyAd = function () {
      consoleLog("--fx--PokiSDK--destroyAd--", arguments);
    };
  }

  PokiSDK.prototype.initWithVideoHB = function () {
    consoleLog("--fx--PokiSDK--initWithVideoHB--");
    return Promise.resolve("");
  };

  PokiSDK.prototype.customEvent = function () {
    consoleLog("--fx--PokiSDK--customEvent--");
  };

  PokiSDK.prototype.measure = function () {
    consoleLog("--fx--PokiSDK--measure--", arguments);
  };

  window.PokiSDK = new PokiSDK();

})();