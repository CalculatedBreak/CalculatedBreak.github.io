
/*
 * poki-sdk-core.js
 * Local PokiSDK compatibility layer with Applixir rewarded ads.
 *
 * Applixir handles rewarded ads.
 * Other PokiSDK methods remain local compatibility implementations.
 */
(function () {
  "use strict";

  var debug = false;

  var log = function () {
    if (debug && window.console) {
      console.log.apply(
        console,
        ["[PokiSDK-local]"].concat([].slice.call(arguments))
      );
    }
  };

  // --------------------------------------------------
  // Applixir configuration
  // --------------------------------------------------

  var APPLIXIR_OPTIONS = {
    apiKey: "5a4db0c5-0000-4000-8000-5a4db0c50001",
    injectionElementId: "applixir-ad-container"
  };

  var activeRewardedAd = false;

  function ensureApplixirContainer() {
    var container = document.getElementById(
      APPLIXIR_OPTIONS.injectionElementId
    );

    if (!container) {
      container = document.createElement("div");
      container.id = APPLIXIR_OPTIONS.injectionElementId;

      if (document.body) {
        document.body.appendChild(container);
      } else {
        console.error(
          "[PokiSDK-local] Document body is unavailable."
        );
        return null;
      }
    }

    return container;
  }

  function showApplixirRewardedAd() {
    return new Promise(function (resolve) {
      if (activeRewardedAd) {
        log("A rewarded ad is already active.");
        resolve(false);
        return;
      }

      if (
        typeof window.initializeAndOpenPlayer !== "function"
      ) {
        console.error(
          "[PokiSDK-local] Applixir SDK is unavailable. " +
          "Check that applixir.app.v6.1.0.js loads before poki-sdk-core.js."
        );

        resolve(false);
        return;
      }

      var container = ensureApplixirContainer();

      if (!container) {
        resolve(false);
        return;
      }

      activeRewardedAd = true;

      var finished = false;

      function finish(success) {
        if (finished) return;

        finished = true;
        activeRewardedAd = false;
        resolve(success);
      }

      var options = {
        apiKey: APPLIXIR_OPTIONS.apiKey,

        injectionElementId:
          APPLIXIR_OPTIONS.injectionElementId,

        adStatusCallbackFn: function (status) {
          log("Applixir ad status:", status);

          if (status && status.type === "complete") {
            finish(true);
          }

          // Do not grant a reward for other statuses.
        },

        adErrorCallbackFn: function (error) {
          console.error(
            "[PokiSDK-local] Applixir ad error:",
            error
          );

          finish(false);
        }
      };

      try {
        window.initializeAndOpenPlayer(options);
      } catch (error) {
        console.error(
          "[PokiSDK-local] Failed to open Applixir:",
          error
        );

        finish(false);
      }
    });
  }

  // --------------------------------------------------
  // URL parameters
  // --------------------------------------------------

  function getParam(name) {
    var m = new RegExp(
      "[?&]" + name + "=([^&#]*)"
    ).exec(location.search);

    return m
      ? decodeURIComponent(m[1].replace(/\+/g, " "))
      : "";
  }

  // --------------------------------------------------
  // Device detection
  // --------------------------------------------------

  function deviceCategory() {
    var ua = navigator.userAgent || "";

    if (
      navigator.platform === "MacIntel" &&
      navigator.maxTouchPoints > 1
    ) {
      return "tablet";
    }

    if (
      /phone|ipod|android.+mobile|iemobile|blackberry|opera mini/i.test(ua)
    ) {
      return "mobile";
    }

    if (/ipad|android|tablet/i.test(ua)) {
      return "tablet";
    }

    return "desktop";
  }

  // --------------------------------------------------
  // PokiSDK compatibility API
  // --------------------------------------------------

  var SDK = {

    // ---- lifecycle ----

    init: function (opts) {
      log("init", opts);
      return Promise.resolve();
    },

    initWithVideoHB: function (opts) {
      return SDK.init(opts);
    },

    setDebug: function (v) {
      debug = v !== false;
    },

    setLogging: function (v) {
      debug = !!v;
    },

    // ---- ads ----

    commercialBreak: function (onStart) {
      log("commercialBreak");

      try {
        if (typeof onStart === "function") {
          onStart();
        }
      } catch (e) {
        console.error(e);
      }

      // Interstitial ads are not implemented here.
      // Do not pretend a commercial ad was displayed.
      return Promise.resolve();
    },

    rewardedBreak: function (arg) {
      log("rewardedBreak");

      var cb =
        typeof arg === "function"
          ? arg
          : arg && arg.onStart;

      try {
        if (typeof cb === "function") {
          cb();
        }
      } catch (e) {
        console.error(e);
      }

      // Opens Applixir and resolves true only when the
      // configured completion callback reports completion.
      return showApplixirRewardedAd();
    },

    displayAd: function (
      container,
      size,
      onCanDestroy,
      onDisplayRendered
    ) {
      log("displayAd", size);

      // No banner ad is displayed by this implementation.
      if (typeof onDisplayRendered === "function") {
        onDisplayRendered(false);
      }

      if (typeof onCanDestroy === "function") {
        onCanDestroy();
      }
    },

    destroyAd: function () {},
    muteAd: function () {},
    setVolume: function () {},

    isAdBlocked: function () {
      return false;
    },

    // ---- gameplay / loading events ----

    gameLoadingStart: function () {},

    gameLoadingProgress: function () {},

    gameLoadingFinished: function () {
      log("gameLoadingFinished");
    },

    gameInteractive: function () {},

    gameplayStart: function () {
      log("gameplayStart");
    },

    gameplayStop: function () {
      log("gameplayStop");
    },

    roundStart: function () {},
    roundEnd: function () {},
    happyTime: function () {},
    customEvent: function () {},
    measure: function () {},
    enableEventTracking: function () {},
    setPlayerAge: function () {},

    // ---- errors ----

    captureError: function (e) {
      log("captureError", e);
    },

    logError: function (e) {
      log("logError", e);
    },

    // ---- scores / leaderboard ----

    sendHighscore: function () {},

    getLeaderboard: function () {
      return Promise.resolve([]);
    },

    showLeaderboard: function () {},

    // ---- accounts ----

    getUser: function () {
      return Promise.resolve(null);
    },

    getToken: function () {
      return Promise.resolve(null);
    },

    login: function () {
      return Promise.resolve();
    },

    // ---- utilities ----

    getURLParam: function (key) {
      return getParam("gd" + key) || getParam(key) || "";
    },

    getLanguage: function () {
      return (
        getParam("iso_lang") ||
        navigator.language ||
        "en"
      ).toLowerCase().split("-")[0];
    },

    getDeviceInfo: function () {
      return {
        category: deviceCategory()
      };
    },

    shareableURL: function (params) {
      var p = new URLSearchParams();

      Object.keys(params || {}).forEach(function (k) {
        if (
          params[k] !== undefined &&
          params[k] !== null
        ) {
          p.set(k, params[k]);
        }
      });

      return Promise.resolve(
        location.origin +
        location.pathname +
        "?" +
        p.toString()
      );
    },

    openExternalLink: function (url) {
      window.open(url, "_blank", "noopener");
    },

    generateScreenshot: function () {
      return Promise.resolve(null);
    },

    // ---- misc compatibility methods ----

    setDebugTouchOverlayController: function () {},
    setPlaytestCanvas: function () {},
    playtestSetCanvas: function () {},
    playtestCaptureHtmlOnce: function () {},
    playtestCaptureHtmlForce: function () {},
    playtestCaptureHtmlOn: function () {},
    playtestCaptureHtmlOff: function () {},
    movePill: function () {}
  };

  // Expose the compatibility API.
  window.PokiSDK = SDK;

})();
