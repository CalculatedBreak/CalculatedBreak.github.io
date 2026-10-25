// CrazyGames SDK v3 - local stub
// No ads, no network requests, no external references.
// Every ad request succeeds instantly, so rewarded ads grant the reward immediately.
(() => {
    "use strict";

    let isAdActive = false;

    // === AD MODULE ===
    class CustomAdModule {
        addAdblockPopupListener(callback) {}
        removeAdblockPopupListener(callback) {}

        async hasAdblock() {
            return false;
        }

        prefetchAd(type) {}

        // Works for 'rewarded', 'midgame' and any other type.
        // Fires adStarted then adFinished right away, so the game grants its reward.
        async requestAd(type, callbacks = {}) {
            try {
                if (callbacks.adStarted) callbacks.adStarted();
            } catch (e) {
                console.error('[CrazyGames SDK] adStarted callback threw:', e);
            }
            try {
                if (callbacks.adFinished) callbacks.adFinished();
            } catch (e) {
                console.error('[CrazyGames SDK] adFinished callback threw:', e);
            }
            return Promise.resolve();
        }

        get isAdPlaying() {
            return isAdActive; // always false
        }
    }

    // === BANNER MODULE ===
    class CustomBannerModule {
        constructor() {
            this.renderedBanners = new Set();
        }
        async requestBanner(options) {}
        async requestResponsiveBanner(containerId) {}
        async requestOverlayBanners(options) {}
        clearBanner(containerId) { this.renderedBanners.delete(containerId); }
        clearAllBanners() { this.renderedBanners.clear(); }
        get activeBannersCount() { return this.renderedBanners.size; }
    }

    // === GAME MODULE ===
    class CustomGameModule {
        constructor() {
            this.link = window.location.href;
            this.id = 'game';
        }
        happytime() {}
        gameplayStart() {}
        gameplayStop() {}
        loadingStart() {}
        loadingStop() {}
        addSettingsChangeListener(callback) {}
        removeSettingsChangeListener(callback) {}
        inviteLink(params) { return this.link; }
        showInviteButton(params) { return this.link; }
        hideInviteButton() {}
        getInviteParam(key) {
            return new URLSearchParams(window.location.search).get(key);
        }
    }

    // === USER MODULE ===
    class CustomUserModule {
        constructor() {
            this.user = null;
        }
        async showAuthPrompt() { return null; }
        async getUser() { return this.user; }
        async getUserToken() { throw new Error('User authentication not available'); }
        async getXsollaUserToken() { return null; }
        get isUserAccountAvailable() { return false; }
        get systemInfo() {
            return {
                device: { type: 'desktop' },
                browser: { name: 'unknown', version: 'unknown' },
                os: { name: 'unknown', version: 'unknown' }
            };
        }
        addAuthListener(callback) {}
        removeAuthListener(callback) {}
    }

    // === DATA MODULE (localStorage-backed) ===
    class CustomDataModule {
        constructor() {
            this.storage = {};
            this.loadFromLocalStorage();
        }

        syncUnityGameData() {}

        loadFromLocalStorage() {
            try {
                const saved = localStorage.getItem('crazygames_sdk_data');
                if (saved) this.storage = JSON.parse(saved);
            } catch (e) {}
        }

        saveToLocalStorage() {
            try {
                localStorage.setItem('crazygames_sdk_data', JSON.stringify(this.storage));
            } catch (e) {}
        }

        getItem(key) {
            return Object.prototype.hasOwnProperty.call(this.storage, key) ? this.storage[key] : null;
        }

        setItem(key, value) {
            this.storage[key] = String(value);
            this.saveToLocalStorage();
        }

        removeItem(key) {
            delete this.storage[key];
            this.saveToLocalStorage();
        }

        clear() {
            this.storage = {};
            this.saveToLocalStorage();
        }
    }

    // === ANALYTICS MODULE ===
    class CustomAnalyticsModule {
        trackOrder(provider, orderJson) {}
    }

    // === MAIN SDK ===
    class CustomSDK {
        constructor() {
            this.initialized = false;
            this.adModule = new CustomAdModule();
            this.bannerModule = new CustomBannerModule();
            this.gameModule = new CustomGameModule();
            this.userModule = new CustomUserModule();
            this.dataModule = new CustomDataModule();
            this.analyticsModule = new CustomAnalyticsModule();
        }

        async init(options = {}) {
            this.initialized = true;
        }

        get ad() { return this.adModule; }
        get banner() { return this.bannerModule; }
        get game() { return this.gameModule; }
        get user() { return this.userModule; }
        get data() { return this.dataModule; }
        get analytics() { return this.analyticsModule; }
        get environment() { return 'crazygames'; }
        get isQaTool() { return false; }
    }

    window.CrazyGames = { SDK: new CustomSDK() };
})();