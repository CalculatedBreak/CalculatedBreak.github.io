"use strict";
var scripts = document.getElementsByTagName("script"),
    scriptUrl = scripts[scripts.length - 1].src,
    root = scriptUrl.split("master-loader.js")[0],
    loaders = {
        unity: "unity.js", "unity-2020": "unity-2020.js"
    };
if (0 <= window.location.href.indexOf("pokiForceLocalLoader") 
	&& (loaders.unity = "./unity.js", 
		
		root = "/loaders"), !window.config) throw Error("window.config not found");
var loader = loaders[window.config.loader];
if (!loader) throw Error('Loader "' + window.config.loader + '" not found');
if (!window.config.unityWebglLoaderUrl) {
    var versionSplit = window.config.unityVersion ? window.config.unityVersion.split(".") : [],
        year = versionSplit[0],
        minor = versionSplit[1];
          window.config.unityWebglLoaderUrl ="./UnityLoader.js";
    // switch (year) {
    //     case "2019":
    //         window.config.unityWebglLoaderUrl = 1 === minor ? "./UnityLoader.2019.1.js" : "./UnityLoader.2019.2.js";
    //         break;
    //     default:
    //         window.config.unityWebglLoaderUrl = "https://game-cdn.poki.com/loaders/v2/unity/static/UnityLoader.js"
    // }
}
var sdkScript = document.createElement("script");
var loaderStarted = false;
var sdkTimeout;

function startUnityLoader() {
    if (loaderStarted) return;
    loaderStarted = true;
    clearTimeout(sdkTimeout);
    var i = document.createElement("script");
    i.src = root + loader;
    i.onerror = function() {
        console.error("Failed to load Unity loader:", i.src);
    };
    document.body.appendChild(i);
}

sdkScript.src = "./poki-sdk.js";
sdkScript.onload = startUnityLoader;
sdkScript.onerror = function() {
    console.error("Failed to load Poki SDK; loading the game without it.");
    startUnityLoader();
};
sdkTimeout = setTimeout(function() {
    console.error("Poki SDK did not load in time; loading the game without it.");
    startUnityLoader();
}, 5000);
document.body.appendChild(sdkScript);