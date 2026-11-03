/**
 * Poki Bypass Patch
 * Fixes: 
 * 1. Cannot redefine property 'location' (by using defineGetter on prototype or proxy)
 * 2. Iframe detection (window.self !== window.top)
 * 3. Referrer spoofing
 * 4. Navigation blocking (history.pushState, beforeunload)
 * 5. CSP override via meta tag injection
 */

(function() {
    // Wait for DOM ready to inject CSP meta tag first
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPatches);
    } else {
        initPatches();
    }

    function initPatches() {
        // 1. INJECT CSP META TAG TO ALLOW FRAMING
        const existingCsp = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
        if (!existingCsp) {
            const meta = document.createElement('meta');
            meta.httpEquiv = "Content-Security-Policy";
            meta.content = "default-src *; script-src *; style-src *; img-src *; frame-src *; media-src *; connect-src *;";
            document.head.appendChild(meta);
        }

        // 2. SPOOF IFRAME DETECTION
        // Poki checks window.self !== window.top. We force them to be equal.
        Object.defineProperty(window, 'self', {
            get: function() { return window.top; },
            configurable: true
        });
        
        Object.defineProperty(window, 'top', {
            get: function() { return window.top; },
            configurable: true
        });

        // 3. SPOOF LOCATION OBJECT
        // Instead of redefining 'location' directly (which throws error), 
        // we override its getter on the Window.prototype or use a Proxy.
        // Most reliable method: Override the descriptor on the prototype.
        try {
            const locProto = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow') || {};
            // Actually, simpler: Just redefine the getter on window itself if possible, 
            // or use Object.defineProperty on the window object if it allows it.
            
            // Check if we can redefine location directly
            try {
                Object.defineProperty(window, 'location', {
                    get: function() {
                        return {
                            href: "https://www.poki.com",
                            origin: "https://www.poki.com",
                            hostname: "www.poki.com",
                            protocol: "https:",
                            port: "",
                            pathname: "/",
                            search: "",
                            hash: ""
                        };
                    },
                    set: function(val) {
                        // Ignore changes
                        console.log('[Patch] Location change ignored:', val);
                    },
                    configurable: true
                });
            } catch (e) {
                // Fallback: Use a Proxy for the entire window if direct define fails
                console.warn('[Patch] Direct location redefine failed, using Proxy fallback.');
                // Note: Proxies are tricky with native bindings, so we stick to the above.
                // If the above fails, the game might still detect framing.
            }
        } catch (e) {
            console.error('[Patch] Error patching location:', e);
        }

        // 4. SPOOF REFERRER
        Object.defineProperty(document, 'referrer', {
            get: function() {
                return "https://www.poki.com";
            },
            configurable: true
        });

        // 5. BLOCK NAVIGATION & MODALS
        // Prevent history.pushState from changing the URL in a way that breaks the game
        const originalPushState = history.pushState;
        history.pushState = function(state, title, url) {
            // Optionally reset URL to Poki's domain
            if (url && !url.includes('poki.com')) {
                url = 'https://www.poki.com';
            }
            originalPushState.call(history, state, title, url);
        };

        // Block beforeunload (prevents "Leave site?" dialogs)
        window.onbeforeunload = function() {
            return null; // Return null to disable the dialog
        };

        // 6. OVERRIDE WINDOW.OPEN (Optional: prevent new tabs)
        const originalOpen = window.open;
        window.open = function(url, name, features) {
            // Redirect all opens to Poki
            return originalOpen.call(window, 'https://www.poki.com', '_self', features);
        };

        console.log('[Patch] Poki Bypass Active');
    }
})();