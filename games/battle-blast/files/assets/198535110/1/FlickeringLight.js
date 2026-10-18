// Create a new script called 'flickeringLight'
var FlickeringLight = pc.createScript('flickeringLight');

// Define script attributes that can be modified in the PlayCanvas editor
FlickeringLight.attributes.add('flickerMin', {
    type: 'number',
    default: 0.05,
    title: 'Min Flicker Time',
    description: 'Minimum time (in seconds) for each flicker interval'
});

FlickeringLight.attributes.add('flickerMax', {
    type: 'number',
    default: 0.3,
    title: 'Max Flicker Time',
    description: 'Maximum time (in seconds) for each flicker interval'
});

FlickeringLight.attributes.add('flickerDuration', {
    type: 'number',
    default: 2,
    title: 'Flicker Duration',
    description: 'Total duration (in seconds) for the flickering phase'
});

FlickeringLight.attributes.add('offTime', {
    type: 'number',
    default: 5,
    title: 'Off Time',
    description: 'Time (in seconds) the light stays off after flickering'
});

// Initialize the script
FlickeringLight.prototype.initialize = function() {
    this.light = this.entity.light;  // Get the light component from the entity
    this.flickerTimer = 0;           // Timer to control flickering
    this.flickering = false;         // Whether we are currently flickering
    this.offTimer = 0;               // Timer to control how long light stays off
    this.totalFlickerTime = 0;       // Track the total time of the flickering phase
};

// Update the script every frame
FlickeringLight.prototype.update = function(dt) {
    // If the light is currently off, check if it should stay off for the specified offTime
    if (this.offTimer > 0) {
        this.offTimer -= dt;
        if (this.offTimer <= 0) {
            this.flickering = false;   // Stop flickering
            this.totalFlickerTime = 0; // Reset flicker duration
        }
        return;
    }

    // Handle flickering logic
    if (this.flickering) {
        this.flickerTimer -= dt;
        this.totalFlickerTime += dt;

        // Check if it's time to toggle the light again
        if (this.flickerTimer <= 0) {
            // Toggle the light component on or off
            this.light.enabled = !this.light.enabled;

            // Set the next flicker interval (random between flickerMin and flickerMax)
            this.flickerTimer = pc.math.random(this.flickerMin, this.flickerMax);
        }

        // If total flickering time exceeds the specified flickerDuration, disable the light
        if (this.totalFlickerTime >= this.flickerDuration) {
            this.light.enabled = false;
            this.offTimer = this.offTime;  // Set timer for how long the light stays off
        }
    } else {
        // Start flickering if not already flickering
        this.startFlickering();
    }
};

// Function to start flickering
FlickeringLight.prototype.startFlickering = function() {
    this.flickering = true;
    this.flickerTimer = pc.math.random(this.flickerMin, this.flickerMax); // Randomize the first flicker
};
