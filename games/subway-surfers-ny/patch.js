// patch.js - Poki Sitelock Bypass & Bot Detection Evasion
(function() {
    // 1. SPOOF LOCATION USING PROXY (Avoids "Cannot redefine" errors)
    const spoofedHost = "poki.com"; 

    // Create a proxy for the location object
    const locationProxy = new Proxy(window.location, {
        get: function(target, property, receiver) {
            const targetObj = target[property];
            
            // If it's a function, bind it to the original location
            if (typeof targetObj === "function") {
                return (...args) => target[property].apply(target, args);
            }

            // Override specific properties
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
        },
        set: function(target, property, value) {
            // Allow setting but don't actually change anything important
            return true;
        }
    });

    // Replace window.location with our proxy
    Object.defineProperty(window, 'location', {
        get: function() {
            return locationProxy;
        },
        set: function(value) {
            // Ignore external changes
        },
        configurable: true // This helps avoid some definition errors
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
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(...args) {
        // Return a consistent small PNG to avoid fingerprint differences
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
        return true; 
    };

    // Mock WebSocket
    window.WebSocket = class {
        constructor(url) {
            this.url = url;
            this.readyState = 3; 
        }
        send() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
        dispatchEvent() {}
    };

    console.log("[PokiBypass] Patch applied successfully.");
})();