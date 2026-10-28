// POKI sdk.js (V6.3.0) -- rewarded ads via HilltopAds VAST, house video fallback
(() => {
    "use strict";

    const CONFIG = {
        fallbackVideosUrl: '/scripts/videos/videos.json',
        loadingGifUrl: '/scripts/videos/thumb_anim.gif',
        minLoadingTime: 100,
        vast: {
            // HilltopAds VAST tag. The server runs an auction per request, so it is
            // fetched fresh every time an ad is requested (never cached).
            tagUrl: 'https://unfolded-uncle.com/d/mlF/z.dgGPN/v-ZtGhUe/Ce/my9vutZUUKl/kfPyTMcC1zNKTEkxz/MWDuUPtENGz/UC1jOITIM/wVOjQn',
            fetchTimeoutMs: 5000,     // time allowed to download the VAST XML
            startTimeoutMs: 8000,     // time allowed for the video to actually begin playing
            maxWrapperDepth: 3,
            // Owner policy carried over from the previous SDK: a genuine skip still
            // grants the reward. Set to false to require the ad to finish.
            rewardOnSkip: true
        }
    };

    const GA_ID = 'G-ZL2MS6ZDBK';

    function trackAdEvent(eventName, params) {
        try {
            if (!window.gtag) {
                window.dataLayer = window.dataLayer || [];
                window.gtag = function () { window.dataLayer.push(arguments); };
                window.gtag('js', new Date());
                window.gtag('config', GA_ID, { send_page_view: false });
                const s = document.createElement('script');
                s.async = true;
                s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
                document.head.appendChild(s);
            }
            window.gtag('event', eventName, Object.assign({
                game: location.pathname.split('/')[1] || '(unknown)'
            }, params || {}));
        } catch (e) {}
    }

    let isAdActive = false;
    let fallbackVideos = [];
    let lastIndex = -1;
    let freezeTimer = null;
    let currentVideoElement = null;
    let loadingOverlay = null;
    let loadingStartTime = 0;

    function injectStyles() {
        if (document.getElementById('sdk-v6-styles')) return;
        const css = `
            #poki-gameplay-freeze { position: fixed; inset: 0; z-index: 999999998; pointer-events: all; background: rgba(0,0,0,0.01); }
            .sdk-video-overlay { position: fixed; inset: 0; background: #000; z-index: 999999999; display: flex; align-items: center; justify-content: center; }
            .sdk-loading-overlay {
                position: fixed; inset: 0; background: #000; z-index: 999999999;
                display: flex; align-items: center; justify-content: center;
            }
            .sdk-loading-spinner { width: 120px; height: 120px; }
            .sdk-cta-button {
                position: absolute; top: 36px; right: 16px;
                padding: 16px; background: #FFFFFF; color: #597ed5;
                font-family: sans-serif; font-size: 18px; font-weight: bold;
                border: 1px solid #b2b2b2; border-radius: 6px;
                text-decoration: none; z-index: 1000000002;
                transition: transform 0.2s;
                cursor: pointer;
            }
            .sdk-cta-button:hover { transform: scale(1.04); }
            .sdk-skip-button {
                position: absolute; bottom: 28px; right: 16px;
                padding: 12px 18px; background: rgba(0,0,0,0.7); color: #fff;
                font-family: sans-serif; font-size: 16px; font-weight: bold;
                border: 1px solid #fff; border-radius: 6px;
                z-index: 1000000002; cursor: default;
            }
            .sdk-skip-button.ready { cursor: pointer; background: #fff; color: #000; }
            .sdk-pause-container {
                display: none;
                position: absolute;
                inset: 0;
                background: rgba(0,0,0,0.3);
                z-index: 1000000001;
                cursor: pointer;
            }
            .sdk-play-icon {
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 90px;
                height: 90px;
                background: rgba(0,0,0,0.3);
                border: 2px solid #fff;
                border-radius: 50px;
            }
            .sdk-play-icon::after {
                content: '';
                position: absolute;
                top: 50%;
                left: 55%;
                transform: translate(-50%, -50%);
                border-style: solid;
                border-width: 15px 0 15px 25px;
                border-color: transparent transparent transparent #fff;
            }
            .sdk-pulse { animation: sdk-pulse-anim 1.5s infinite; }
            @keyframes sdk-pulse-anim {
                0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
                100% { transform: translate(-50%, -50%) scale(1.3); opacity: 0; }
            }
            .sdk-progress-bar {
                position: fixed;
                bottom: 0;
                left: 0;
                width: 100%;
                height: 6px;
                background: rgba(255,255,255,0.3);
                z-index: 1000000003;
            }
            .sdk-progress-inner {
                width: 0%;
                height: 100%;
                background: #FFDC00;
            }
        `;
        const style = document.createElement('style');
        style.id = 'sdk-v6-styles';
        style.textContent = css;
        document.head.appendChild(style);
    }

    function showLoadingIndicator() {
        if (loadingOverlay) return;
        loadingStartTime = Date.now();
        loadingOverlay = document.createElement('div');
        loadingOverlay.className = 'sdk-loading-overlay';
        const spinner = document.createElement('img');
        spinner.src = CONFIG.loadingGifUrl;
        spinner.className = 'sdk-loading-spinner';
        loadingOverlay.appendChild(spinner);
        document.body.appendChild(loadingOverlay);
    }

    async function hideLoadingIndicator() {
        if (!loadingOverlay) return;
        const elapsed = Date.now() - loadingStartTime;
        const remainingTime = Math.max(0, CONFIG.minLoadingTime - elapsed);
        if (remainingTime > 0) await new Promise(r => setTimeout(r, remainingTime));
        if (loadingOverlay && loadingOverlay.parentNode) loadingOverlay.remove();
        loadingOverlay = null;
    }

    async function loadFallbackList() {
        try {
            const res = await fetch(CONFIG.fallbackVideosUrl, { cache: "no-store" });
            fallbackVideos = await res.json();
            console.log("[PokiSDK] Fallback list loaded");
        } catch (e) {
            console.warn("[PokiSDK] Fallback load failed");
        }
    }

    function playFallbackVideo() {
        return new Promise((resolve) => {
            if (!fallbackVideos || !fallbackVideos.length) {
                unfreezeGame();
                return resolve();
            }

            if (freezeTimer) {
                clearTimeout(freezeTimer);
                freezeTimer = null;
            }

            let index;
            do {
                index = Math.floor(Math.random() * fallbackVideos.length);
            } while (index === lastIndex && fallbackVideos.length > 1);
            lastIndex = index;
            const videoData = fallbackVideos[index];

            const overlay = document.createElement("div");
            overlay.className = "sdk-video-overlay";

            const video = document.createElement("video");
            video.src = videoData.src;
            video.autoplay = true;
            video.playsInline = true;
            video.muted = true; // autoplay is blocked for unmuted video
            video.style.cssText = "width:100%; height:100%; object-fit:contain; cursor:pointer;";
            currentVideoElement = video;

            const pauseLayer = document.createElement("div");
            pauseLayer.className = "sdk-pause-container";
            pauseLayer.innerHTML = `
                <div class="sdk-play-icon"></div>
                <div class="sdk-play-icon sdk-pulse"></div>
            `;

            const cta = document.createElement("a");
            cta.className = "sdk-cta-button";
            cta.innerText = "Play Now!";
            cta.href = videoData.link;
            cta.target = "_blank";
            cta.onclick = (e) => {
                e.stopPropagation();
                if (!video.paused) {
                    video.pause();
                    pauseLayer.style.display = "block";
                }
            };

            const pb = document.createElement("div");
            pb.className = "sdk-progress-bar";
            const pbi = document.createElement("div");
            pbi.className = "sdk-progress-inner";
            pb.appendChild(pbi);

            overlay.appendChild(video);
            overlay.appendChild(pauseLayer);
            overlay.appendChild(cta);
            document.body.appendChild(overlay);
            document.body.appendChild(pb);

            video.onclick = (e) => {
                e.stopPropagation();
                video.pause();
                pauseLayer.style.display = "block";
            };

            pauseLayer.onclick = (e) => {
                e.stopPropagation();
                video.play();
                pauseLayer.style.display = "none";
            };

            const updateProgressBar = () => {
                if (video.duration) {
                    pbi.style.width = (video.currentTime / video.duration) * 100 + "%";
                }
                if (!video.paused && !video.ended) {
                    requestAnimationFrame(updateProgressBar);
                }
            };

            video.addEventListener('play', () => {
                requestAnimationFrame(updateProgressBar);
            });

            requestAnimationFrame(updateProgressBar);

            let adSettled = false;
            let adGuard = null;
            const onVideoEnd = () => {
                if (adSettled) return;
                adSettled = true;
                if (adGuard) { clearTimeout(adGuard); adGuard = null; }
                unfreezeGame();
                resolve();
            };
            video.onended = () => {
                trackAdEvent('ad_watched', { ad_source: 'fallback_video' });
                onVideoEnd();
            };
            video.onerror = onVideoEnd;
            // tap the ad to hear it; muted only so autoplay is permitted
            overlay.addEventListener('click', () => { try { video.muted = false; } catch (e) {} });
            try {
                const pp = video.play();
                if (pp && typeof pp.catch === 'function') pp.catch(() => onVideoEnd());
            } catch (e) { onVideoEnd(); }
            // last-resort settle: never let the overlay outlive the ad
            adGuard = setTimeout(onVideoEnd, 45000);
        });
    }

    // --- VAST (HilltopAds) -----------------------------------------------------

    function firePixel(url, errorCode) {
        if (!url) return;
        try {
            const u = String(url)
                .replace(/\[ERRORCODE\]/g, String(errorCode == null ? 900 : errorCode))
                .replace(/\[TIMESTAMP\]/g, encodeURIComponent(new Date().toISOString()))
                .replace(/\[CACHEBUSTING\]/g, String(Math.floor(Math.random() * 1e8)));
            new Image().src = u;
        } catch (e) {}
    }

    function fireAll(list, errorCode) {
        (list || []).forEach((u) => firePixel(u, errorCode));
    }

    async function fetchText(url) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), CONFIG.vast.fetchTimeoutMs);
        try {
            const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal, credentials: 'omit' });
            if (!res.ok) throw new Error('vast_http_' + res.status);
            return await res.text();
        } catch (e) {
            if (e && e.name === 'AbortError') throw new Error('vast_fetch_timeout');
            throw e;
        } finally {
            clearTimeout(t);
        }
    }

    function nodeText(node) {
        return node && node.textContent ? node.textContent.trim() : '';
    }

    function texts(root, tag) {
        return Array.prototype.map.call(root.getElementsByTagName(tag), nodeText).filter(Boolean);
    }

    function parseOffset(str, durationSec) {
        if (!str) return null;
        const pct = /^(\d+(?:\.\d+)?)%$/.exec(str);
        if (pct) return durationSec ? (parseFloat(pct[1]) / 100) * durationSec : null;
        const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(str);
        if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
        return null;
    }

    // Walks the VAST (following Wrapper redirects) and returns the first playable inline ad.
    async function resolveVast(xmlText, depth, acc) {
        const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
        if (doc.getElementsByTagName('parsererror').length) throw new Error('vast_parse_error');

        const topErrors = Array.prototype.filter.call(doc.documentElement.children, (n) => n.tagName === 'Error').map(nodeText);
        acc.errors = acc.errors.concat(topErrors);

        const ads = doc.getElementsByTagName('Ad');
        if (!ads.length) throw new Error('vast_no_ads');

        for (let i = 0; i < ads.length; i++) {
            const ad = ads[i];
            const wrapper = ad.getElementsByTagName('Wrapper')[0];
            const inline = ad.getElementsByTagName('InLine')[0];
            const body = inline || wrapper;
            if (!body) continue;

            const local = {
                impressions: texts(body, 'Impression'),
                errors: texts(body, 'Error'),
                tracking: {},
                clickTracking: texts(body, 'ClickTracking')
            };
            Array.prototype.forEach.call(body.getElementsByTagName('Tracking'), (t) => {
                const ev = t.getAttribute('event');
                const u = nodeText(t);
                if (ev && u) (local.tracking[ev] = local.tracking[ev] || []).push(u);
            });

            acc.impressions = acc.impressions.concat(local.impressions);
            acc.errors = acc.errors.concat(local.errors);
            acc.clickTracking = acc.clickTracking.concat(local.clickTracking);
            Object.keys(local.tracking).forEach((ev) => {
                acc.tracking[ev] = (acc.tracking[ev] || []).concat(local.tracking[ev]);
            });

            if (inline) {
                const linear = inline.getElementsByTagName('Linear')[0];
                if (!linear) continue;
                const media = Array.prototype.map.call(linear.getElementsByTagName('MediaFile'), (m) => ({
                    url: nodeText(m),
                    type: (m.getAttribute('type') || '').toLowerCase(),
                    width: parseInt(m.getAttribute('width'), 10) || 0
                })).filter((m) => m.url);

                const probe = document.createElement('video');
                const playable = media.filter((m) => !m.type || probe.canPlayType(m.type));
                const pool = playable.length ? playable : media;
                if (!pool.length) continue;

                // prefer mp4 (h264 plays everywhere), then the largest size that fits the screen
                const maxW = Math.max(640, Math.min(window.innerWidth || 854, 1280));
                pool.sort((a, b) => {
                    const am = a.type.indexOf('mp4') !== -1 ? 0 : 1;
                    const bm = b.type.indexOf('mp4') !== -1 ? 0 : 1;
                    if (am !== bm) return am - bm;
                    const af = a.width <= maxW ? 0 : 1;
                    const bf = b.width <= maxW ? 0 : 1;
                    if (af !== bf) return af - bf;
                    return af === 0 ? b.width - a.width : a.width - b.width;
                });

                const durationSec = parseOffset(nodeText(linear.getElementsByTagName('Duration')[0]), 0);
                const clickNode = linear.getElementsByTagName('ClickThrough')[0];
                return {
                    mediaUrl: pool[0].url,
                    clickThrough: nodeText(clickNode),
                    skipOffsetSec: parseOffset(linear.getAttribute('skipoffset'), durationSec),
                    impressions: acc.impressions,
                    errors: acc.errors,
                    tracking: acc.tracking,
                    clickTracking: acc.clickTracking
                };
            }

            if (wrapper) {
                const next = nodeText(wrapper.getElementsByTagName('VASTAdTagURI')[0]);
                if (next && depth < CONFIG.vast.maxWrapperDepth) {
                    return resolveVast(await fetchText(next), depth + 1, acc);
                }
            }
        }
        throw new Error('vast_no_playable_media');
    }

    async function loadVastAd() {
        const xml = await fetchText(CONFIG.vast.tagUrl);
        const acc = { impressions: [], errors: [], tracking: {}, clickTracking: [] };
        try {
            return await resolveVast(xml, 0, acc);
        } catch (e) {
            fireAll(acc.errors, e && e.message === 'vast_no_ads' ? 303 : 900);
            throw e;
        }
    }

    // Resolves { skipped: boolean } when the ad finishes or is skipped; rejects if it never plays.
    function playVastAd(ad) {
        return new Promise((resolve, reject) => {
            if (freezeTimer) { clearTimeout(freezeTimer); freezeTimer = null; }

            const overlay = document.createElement('div');
            overlay.className = 'sdk-video-overlay';

            const video = document.createElement('video');
            video.src = ad.mediaUrl;
            video.autoplay = true;
            video.playsInline = true;
            video.setAttribute('playsinline', '');
            video.preload = 'auto';
            video.style.cssText = 'width:100%; height:100%; object-fit:contain; cursor:pointer;';
            currentVideoElement = video;

            const pauseLayer = document.createElement('div');
            pauseLayer.className = 'sdk-pause-container';
            pauseLayer.innerHTML = '<div class="sdk-play-icon"></div><div class="sdk-play-icon sdk-pulse"></div>';

            const pb = document.createElement('div');
            pb.className = 'sdk-progress-bar';
            const pbi = document.createElement('div');
            pbi.className = 'sdk-progress-inner';
            pb.appendChild(pbi);

            overlay.appendChild(video);
            overlay.appendChild(pauseLayer);

            const hasClick = !!ad.clickThrough;
            const openClick = (e) => {
                if (e) e.stopPropagation();
                if (!hasClick) return;
                fireAll(ad.clickTracking);
                try { window.open(ad.clickThrough, '_blank', 'noopener'); } catch (err) {}
                if (!video.paused) {
                    video.pause();
                    pauseLayer.style.display = 'block';
                }
            };

            if (hasClick) {
                const cta = document.createElement('div');
                cta.className = 'sdk-cta-button';
                cta.textContent = 'Learn More';
                cta.onclick = openClick;
                overlay.appendChild(cta);
            }

            let skipBtn = null;
            if (ad.skipOffsetSec != null) {
                skipBtn = document.createElement('div');
                skipBtn.className = 'sdk-skip-button';
                overlay.appendChild(skipBtn);
            }

            document.body.appendChild(overlay);
            document.body.appendChild(pb);

            video.onclick = (e) => {
                if (hasClick) return openClick(e);
                e.stopPropagation();
                video.pause();
                pauseLayer.style.display = 'block';
            };
            pauseLayer.onclick = (e) => {
                e.stopPropagation();
                video.play().catch(() => {});
                pauseLayer.style.display = 'none';
            };

            let settled = false;
            let started = false;
            const fired = {};
            let startTimer = null;
            let guardTimer = null;

            const fireOnce = (ev) => {
                if (fired[ev]) return;
                fired[ev] = true;
                fireAll(ad.tracking[ev]);
            };

            const finish = (err, skipped) => {
                if (settled) return;
                settled = true;
                clearTimeout(startTimer);
                clearTimeout(guardTimer);
                try { video.pause(); } catch (e) {}
                if (overlay.parentNode) overlay.remove();
                if (pb.parentNode) pb.remove();
                currentVideoElement = null;
                if (err) reject(err);
                else resolve({ skipped: !!skipped });
            };

            const fail = (msg, code) => {
                if (settled) return;
                fireAll(ad.errors, code || 405);
                finish(new Error(msg));
            };

            // the ad never started: let the caller fall through to the house video
            startTimer = setTimeout(() => {
                if (!started) fail('vast_start_timeout', 402);
            }, CONFIG.vast.startTimeoutMs);

            video.addEventListener('playing', () => {
                if (started) return;
                started = true;
                clearTimeout(startTimer);
                hideLoadingIndicator();
                fireAll(ad.impressions);
                fireOnce('creativeView');
                fireOnce('start');
                const d = video.duration;
                guardTimer = setTimeout(() => finish(null, false), ((isFinite(d) && d > 0 ? d : 60) + 20) * 1000);
            });

            video.addEventListener('timeupdate', () => {
                const d = video.duration, t = video.currentTime;
                if (!d || !isFinite(d)) return;
                pbi.style.width = (t / d) * 100 + '%';
                if (t >= d * 0.25) fireOnce('firstQuartile');
                if (t >= d * 0.5) fireOnce('midpoint');
                if (t >= d * 0.75) fireOnce('thirdQuartile');
                if (skipBtn) {
                    const remain = Math.ceil(ad.skipOffsetSec - t);
                    if (remain > 0) {
                        skipBtn.textContent = 'Skip in ' + remain;
                    } else if (!skipBtn.classList.contains('ready')) {
                        skipBtn.classList.add('ready');
                        skipBtn.textContent = 'Skip \u25B6';
                        skipBtn.onclick = (e) => {
                            e.stopPropagation();
                            fireOnce('skip');
                            finish(null, true);
                        };
                    }
                }
            });

            video.addEventListener('pause', () => { if (started && !video.ended) fireOnce('pause'); });
            video.addEventListener('ended', () => {
                fireOnce('complete');
                finish(null, false);
            });
            video.addEventListener('error', () => fail('vast_media_error', 405));

            // try with sound first (we are normally inside a user gesture); fall back to muted autoplay
            const tryPlay = () => {
                let p;
                try { p = video.play(); } catch (e) { p = Promise.reject(e); }
                if (p && typeof p.catch === 'function') {
                    p.catch(() => {
                        if (video.muted) return fail('vast_play_blocked', 400);
                        video.muted = true;
                        let p2;
                        try { p2 = video.play(); } catch (e) { p2 = Promise.reject(e); }
                        if (p2 && typeof p2.catch === 'function') p2.catch(() => fail('vast_play_blocked', 400));
                    });
                }
            };
            // tap anywhere to unmute if we had to start muted
            overlay.addEventListener('click', () => { try { if (video.muted) video.muted = false; } catch (e) {} });
            tryPlay();
        });
    }

    async function showVastRewardedAd() {
        const ad = await loadVastAd();
        const result = await playVastAd(ad);
        return result;
    }

    // --- restore keyboard/game focus after an ad (overlay steals activeElement) ---
    let savedFocusEl = null;
    let refocusOnWindowFocus = null;

    function rememberFocus() {
        try {
            const ae = document.activeElement;
            savedFocusEl = (ae && ae !== document.body) ? ae : null;
        } catch (e) { savedFocusEl = null; }
    }

    function pickGameSurface() {
        try {
            const mod = (window.unityInstance && window.unityInstance.Module) || window.Module;
            if (mod && mod.canvas && mod.canvas.isConnected) return mod.canvas;
        } catch (e) {}

        let best = null, bestArea = 0;
        try {
            document.querySelectorAll('canvas').forEach(c => {
                if (!c.isConnected) return;
                if (!c.offsetParent && getComputedStyle(c).position !== 'fixed') return;
                const r = c.getBoundingClientRect();
                const area = r.width * r.height;
                if (area > bestArea) { best = c; bestArea = area; }
            });
        } catch (e) {}
        if (best && bestArea > 10000) return best;

        if (savedFocusEl && savedFocusEl.isConnected && /^(CANVAS|IFRAME)$/.test(savedFocusEl.tagName)) {
            return savedFocusEl;
        }
        return document.querySelector('iframe') || best || null;
    }

    function focusGameSurface() {
        const el = pickGameSurface();
        if (!el) return;
        try {
            if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
            el.focus({ preventScroll: true });
            if (el.contentWindow) el.contentWindow.focus();
        } catch (e) {}
    }

    function restoreGameFocus() {
        try { window.focus(); } catch (e) {}
        focusGameSurface();
        // engines can reassert focus while the overlay is being torn down
        requestAnimationFrame(focusGameSurface);
        setTimeout(focusGameSurface, 80);
        setTimeout(focusGameSurface, 300);

        // if the ad's CTA opened a new tab, refocus when the user comes back
        if (refocusOnWindowFocus) window.removeEventListener('focus', refocusOnWindowFocus);
        refocusOnWindowFocus = () => {
            window.removeEventListener('focus', refocusOnWindowFocus);
            refocusOnWindowFocus = null;
            setTimeout(focusGameSurface, 0);
        };
        window.addEventListener('focus', refocusOnWindowFocus);
        setTimeout(() => {
            if (refocusOnWindowFocus) {
                window.removeEventListener('focus', refocusOnWindowFocus);
                refocusOnWindowFocus = null;
            }
        }, 60000);
    }

    function freezeGame() {
        if (document.getElementById('poki-gameplay-freeze')) return;
        rememberFocus();
        const overlay = document.createElement('div');
        overlay.id = 'poki-gameplay-freeze';
        document.body.appendChild(overlay);

        if (freezeTimer) clearTimeout(freezeTimer);
        freezeTimer = setTimeout(() => unfreezeGame(), 180000);

        document.querySelectorAll('audio, video').forEach(el => {
            try { el.muted = true; } catch(e){}
        });
        try {
            if (window.audioContext) window.audioContext.suspend();
        } catch (e) {}
    }

    function unfreezeGame() {
        if (freezeTimer) clearTimeout(freezeTimer);
        freezeTimer = null;

        ['#poki-gameplay-freeze', '.sdk-video-overlay', '.sdk-progress-bar', '.sdk-loading-overlay'].forEach(sel => {
            document.querySelectorAll(sel).forEach(el => el.remove());
        });

        document.querySelectorAll('audio, video').forEach(el => {
            try { el.muted = false; } catch(e){}
        });
        try {
            if (window.audioContext) window.audioContext.resume();
        } catch (e) {}

        restoreGameFocus();

        isAdActive = false;
        currentVideoElement = null;
    }

    async function showRewardedAd() {
        if (isAdActive) return true;

        isAdActive = true;
        console.log('[PokiSDK] Starting rewarded ad...');
        trackAdEvent('ad_requested', { ad_type: 'rewarded' });
        freezeGame();
        showLoadingIndicator();

        // Chain: HilltopAds VAST (primary) -> house fallback video (last resort).
        // A skip still grants the reward when CONFIG.vast.rewardOnSkip is true, and is
        // tracked separately so the skip/completion ratio stays measurable.
        let rewardGranted = false;

        try {
            console.log('[PokiSDK] Strategy: HilltopAds VAST');
            const result = await showVastRewardedAd();
            if (result.skipped) {
                trackAdEvent('ad_skipped' + (CONFIG.vast.rewardOnSkip ? '_rewarded' : ''), { ad_source: 'hilltopads', ad_type: 'rewarded' });
                rewardGranted = !!CONFIG.vast.rewardOnSkip;
            } else {
                console.log('[PokiSDK] \u2705 VAST ad completed');
                trackAdEvent('ad_watched', { ad_source: 'hilltopads', ad_type: 'rewarded' });
                rewardGranted = true;
            }
            await hideLoadingIndicator();
            unfreezeGame();
        } catch (vastError) {
            const reason = (vastError && vastError.message) || 'vast_failed';
            console.warn('[PokiSDK] VAST failed, using fallback video:', reason);
            trackAdEvent('ad_failed', { ad_source: 'hilltopads', ad_type: 'rewarded', reason: String(reason).slice(0, 60) });
            await hideLoadingIndicator();
            await playFallbackVideo();
            // the house fallback video always counts as a completed watch (no fill signal)
            rewardGranted = true;
        } finally {
            isAdActive = false;
            unfreezeGame();
        }

        console.log('[PokiSDK] Rewarding user:', rewardGranted);
        return rewardGranted;
    }

    const noop = () => {};
    const promiseTrue = () => Promise.resolve(true);
    const promiseEmpty = () => Promise.resolve([]);
    const promiseEmptyObj = () => Promise.resolve({});

    window.PokiSDK = {
        init: promiseTrue,
        initWithVideoHB: promiseTrue,
        commercialBreak: promiseTrue,
        rewardedBreak: showRewardedAd,
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
        gameInteractive: () => unfreezeGame(),
        gameplayStart: () => unfreezeGame(),
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
    function whenUnityReady(fn) {
        if (window.unityGame) return fn();
        let tries = 0;
        const t = setInterval(() => {
            if (window.unityGame || ++tries > 900) { clearInterval(t); if (window.unityGame) fn(); }
        }, 100);
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

    injectStyles();
    loadFallbackList();

    console.log("%c PokiSDK V6.3.0 Ready ", "background: #222; color: #fbff00; padding: 5px; border-radius: 3px;");
})();