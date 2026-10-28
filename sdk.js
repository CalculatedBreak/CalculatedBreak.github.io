// POKI sdk.js (V6.3.0) -- ad-free: no ads, no ad tracking, rewarded breaks grant instantly
(() => {
    "use strict";

    const noop = () => {};
    const promiseTrue = () => Promise.resolve(true);
    const promiseEmpty = () => Promise.resolve([]);
    const promiseEmptyObj = () => Promise.resolve({});

    // Calls an optional onStart callback (function, or object with onStart) safely.
    function callStart(arg) {
        try {
            const cb = typeof arg === 'function' ? arg : (arg && arg.onStart);
            if (typeof cb === 'function') cb();
        } catch (e) { console.error(e); }
    }

    window.PokiSDK = {
        init: promiseTrue,
        initWithVideoHB: promiseTrue,

        // ads: nothing is shown
        commercialBreak: (arg) => { callStart(arg); return Promise.resolve(true); },
        rewardedBreak: (arg) => { callStart(arg); return Promise.resolve(true); }, // instant reward
        displayAd: noop,
        destroyAd: noop,
        isAdBlocked: () => false,
        muteAd: noop,
        movePill: noop,

        setDebug: noop,
        setLogging: noop,
        setPlayerAge: noop,
        enableEventTracking: noop,
        playtestSetCanvas: noop,
        playtestCaptureHtmlOnce: noop,
        playtestCaptureHtmlOn: noop,
        playtestCaptureHtmlOff: noop,
        measure: noop,
        captureError: noop,
        logError: noop,
        customEvent: () => ({ doNothing: noop }),
        gameLoadingStart: noop,
        gameLoadingProgress: noop,
        gameLoadingFinished: noop,
        gameInteractive: noop,
        gameplayStart: noop,
        gameplayStop: noop,
        happyTime: noop,
        roundStart: noop,
        roundEnd: noop,
        sendHighscore: noop,
        setDebugTouchOverlayController: noop,
        setPlaytestCanvas: noop,

        getLeaderboard: promiseEmpty,
        showLeaderboard: (id) => {
            console.info('[PokiSDK] showLeaderboard:', id);
            if (window.parent !== window) {
                window.parent.postMessage({
                    type: 'pokiMessageShowLeaderboard',
                    content: { data: { id: id || -1 } }
                }, '*');
            }
        },

        getLanguage: () => navigator.language.split('-')[0] || 'en',
        getIsoLanguage: () => new URLSearchParams(window.location.search).get('iso_lang') || undefined,
        getURLParam: (p) => {
            const params = new URLSearchParams(window.location.search);
            return params.get(`gd${p}`) || params.get(p) || "";
        },

        getUser: promiseEmptyObj,
        getToken: () => Promise.resolve(null),
        login: () => Promise.reject(new Error('Login not supported')),

        openExternalLink: (url) => {
            console.info('[PokiSDK] openExternalLink:', url);
            if (window.parent !== window) {
                window.parent.postMessage({
                    type: 'pokiMessageOpenExternalLink',
                    content: { params: { url } }
                }, '*');
            } else {
                window.open(url, '_blank');
            }
        },

        shareableURL: () => Promise.resolve({ url: window.location.href }),
        generateScreenshot: () => Promise.resolve(null)
    };


    // --- Unity bridge globals -------------------------------------------------
    // Unity builds reach these through _JS_PokiSDK_* as *window* functions, not as
    // PokiSDK methods. If they are absent the bridge never registers, the C# side
    // keeps a null reference, and the first use throws NullReferenceException.
    let pokiBridgeObjectName = null;
    const pokiInitStatus = 'ready';

    function bridgeSend(method, arg) {
        try {
            if (!window.unityGame || !pokiBridgeObjectName) return;
            if (arg === undefined) window.unityGame.SendMessage(pokiBridgeObjectName, method);
            else window.unityGame.SendMessage(pokiBridgeObjectName, method, arg);
        } catch (e) { console.warn('[PokiSDK] bridge send failed:', method, e); }
    }
    function settle(p, ok, fail) {
        try { Promise.resolve(p).then(ok, fail || ok); } catch (e) { (fail || ok)(); }
    }

    window.getUser = function () {
        settle(PokiSDK.getUser(),
            (u) => bridgeSend('getUserResolved', JSON.stringify(u || {})),
            () => bridgeSend('getUserRejected'));
    };
    window.getToken = function () {
        settle(PokiSDK.getToken(),
            (t) => bridgeSend('getTokenResolved', t || ''),
            () => bridgeSend('getTokenRejected'));
    };
    window.login = function () {
        settle(PokiSDK.login(), () => bridgeSend('loginResolved'), () => bridgeSend('loginRejected'));
    };

    // Some Unity/PokiSDK plugin builds call this from their JS bridge to stringify
    // whatever value they're about to hand to a PokiSDK method. It only needs to turn
    // its input into a string without throwing.
    window.properUnityStringify = function (v) {
        try {
            if (v == null) return '';
            return typeof v === 'string' ? v : JSON.stringify(v);
        } catch (e) { return String(v); }
    };

    console.log("%c PokiSDK V6.3.0 Ready ", "background: #222; color: #fbff00; padding: 5px; border-radius: 3px;");
})();
