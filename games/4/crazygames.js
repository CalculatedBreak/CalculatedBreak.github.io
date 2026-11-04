/*
 * No-ads stub of the CrazyGames JS SDK (API-compatible with v1.30.0).
 * For LOCAL TESTING ONLY. Swap the real SDK back in before submitting to CrazyGames.
 *
 * - No overlay, no fake banners, no network requests, no iframe messaging.
 * - requestAd() still fires adStarted -> adFinished (asynchronously, instantly)
 *   so any game code that pauses/resumes around ads keeps working.
 */
(() => {
  const AD_TYPES = { midgame: "midgame", rewarded: "rewarded" };
  const EVENT_TYPES = {
    adStarted: "adStarted",
    adFinished: "adFinished",
    adError: "adError",
    adblockDetectionExecuted: "adblockDetectionExecuted",
  };
  const VALID_EVENTS = new Set([
    "adStarted", "adFinished", "adError", "adblockDetectionExecuted",
    "bannerRendered", "bannerError", "requestBanner", "initialized",
  ]);

  const USER_INFO = {
    browser: { name: "Chrome", version: "89.0.4389.82" },
    countryCode: "FR",
    locale: "en-US",
    os: { name: "Windows", version: "10" },
  };

  class NoAdsSDK {
    constructor() {
      this.listeners = {};
      this.hasAdblock = false;
      this.requestInProgress = false;
      this.userInfo = USER_INFO;
    }

    static getInstance() {
      if (!NoAdsSDK.instance) NoAdsSDK.instance = new NoAdsSDK();
      return NoAdsSDK.instance;
    }

    init() { return Promise.resolve(); }

    // --- events ---
    addEventListener(name, cb) {
      if (!VALID_EVENTS.has(name)) {
        console.error("[NoAdsSDK] Invalid event", name);
        return;
      }
      (this.listeners[name] = this.listeners[name] || []).push(cb);
      // Mimic the real SDK: these two fire immediately if already "done".
      if (name === "initialized") queueMicrotask(() => cb({ userInfo: this.userInfo }));
      if (name === "adblockDetectionExecuted") queueMicrotask(() => cb({ hasAdblock: false }));
    }

    removeEventListener(name, cb) {
      if (!VALID_EVENTS.has(name)) return;
      this.listeners[name] = (this.listeners[name] || []).filter((f) => f !== cb);
    }

    callListeners(name, data) {
      (this.listeners[name] || []).slice().forEach((f) => {
        try { f(data); } catch (e) { console.error(e); }
      });
    }

    // --- ads: skip instantly, no UI ---
    async requestAd(type = "midgame") {
      if (this.requestInProgress) return;
      this.requestInProgress = true;
      this.callListeners("adStarted", {});
      // Fire on next tick so callers that register listeners right after calling still get it.
      setTimeout(() => {
        this.requestInProgress = false;
        this.callListeners("adFinished", {});
      }, 0);
    }

    // --- banners: do nothing ---
    async requestBanner(_banners) {}
    async requestResponsiveBanner(_ids) {}
    clearBanner(_id) {}
    clearAllBanners() {}

    // --- misc ---
    inviteLink(params = {}) {
      const qs = new URLSearchParams({ czy_invite: "true", utm_source: "invite", ...params });
      return `${location.origin}${location.pathname}?${qs}`;
    }

    async happytime() {}
    async gameplayStart() {}
    async gameplayStop() {}
    async sdkGameLoadingStart() {}
    async sdkGameLoadingStop() {}
  }
  NoAdsSDK.instance = null;

  window.CrazyGames = {
    CrazySDK: NoAdsSDK,
    CrazyAdType: AD_TYPES,
    CrazyEventType: EVENT_TYPES,
  };
})();