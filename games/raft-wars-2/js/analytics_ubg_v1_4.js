window.dataLayer = window.dataLayer || [];
window.gtag = window.gtag || function(){window.dataLayer.push(arguments);};
window.ga = window.ga || function(command, hitType, category, action, label) {
    if (command === "send" && hitType === "event" && action) {
        var eventParameters = {event_category: category};
        if (label !== undefined) {
            eventParameters.event_label = label;
        }
        window.gtag("event", action, eventParameters);
    }
};

function loadGoogleAnalytics(id) {
    // Google tag (gtag.js)
    var firstScript= document.getElementsByTagName("script")[0];
    newScript= document.createElement("script");
    newScript.async= "";
    newScript.src= "https://www.googletagmanager.com/gtag/js?id="+ id;
    firstScript.parentNode.insertBefore(newScript, firstScript);

    window.gtag('js', new Date());
    window.gtag('config', id);
}

window.addEventListener("load", function() {
    if (navigator.webdriver) {
      console.log('Bot Browser');
      loadGoogleAnalytics("G-LE1ZGTPC77");

    } else {
      console.log('Human Browser');
      loadGoogleAnalytics("G-E7D3EVY6HR");
    }
});
