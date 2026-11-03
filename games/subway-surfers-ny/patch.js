// patch.js - Poki Sitelock Bypass & Bot Detection Evasion

(function() {
    // 1. SPOOF LOCATION
    // Change 'poki.com' to 'localhost' if you are testing locally without a server
    const spoofedHost = "poki.com"; 

    Object.defineProperty(window, 'location', {
        get: function() {
            return new Proxy({}, {
                get: function(target, property, receiver) {
                    const targetObj = location[property];
                    if (typeof targetObj === "function") {
                        return (...args) => target[property].apply(location, args);
                    }
                    if (property === "host" || property === "hostname") {
                        return spoofedHost;
                    }
                    if (property === "href") {
                        return `https://${spoofedHost}/`;
                    }
                    if (property === "origin") {
                        return `https://${spoofedHost}`;
                    }
                    if (property === "assign" || property === "reload" || property === "replace") {
                        return () => {}; 
                    }
                    return targetObj;
                }
            });
        },
        set: function() {}
    });

    // 2. HIDE WEBDRIVER FLAG
    Object.defineProperty(navigator, 'webdriver', {
        get: () => false
    });

    // 3. REMOVE SELENIUM/BOT FLAGS
    delete window._Selenium_IDE_Recorder;
    delete window._selenium;
    delete window.calledSelenium;
    delete window.navigator.webdriver;

    // Remove $cdc_ keys (common Selenium/ChromeDriver artifact)
    for (let key of Object.keys(window)) {
        if (key.startsWith('$cdc_')) {
            delete window[key];
        }
    }

    // 4. PATCH CANVAS FINGERPRINTING
    // Forces canvas output to be consistent so bot detection can't flag you
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(...args) {
        // Returns a tiny, consistent PNG base64 string
        return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
    };

    // 5. OVERRIDE EVAL (Obfuscation Bypass)
    var originalEval = window.eval;
    window.eval = function(code) {
        // Replace base64 sitelock URLs found in Poki's obfuscated code
        code = code.replace("aHR0cHM6Ly9wb2tpLmNvbS9zaXRlbG9jaw==", "bGl0dGxlYm95"); 
        code = code.replace("'location'", "'xlocation'");
        code = code.replace("] = _0x3296f7;", "]==_0x3296f7;");
        code = code.replace("] = window[_0xcdc9(", "]==window[_0xcdc9(");
        
        return originalEval(code);
    };

    // 6. MOCK TELEMETRY
    window.navigator.sendBeacon = function(url, data) {
        return true; // Pretend telemetry sent successfully
    };

    // Mock WebSocket to prevent connection errors if the game tries to sync
    window.WebSocket = class {
        constructor(url) {
            this.url = url;
            this.readyState = 3; // CLOSED
        }
        send() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
        dispatchEvent() {}
    };

    console.log("[PokiBypass] Patch applied successfully.");
})();