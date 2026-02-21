/**
 * accidentDetection.js
 * Analyzes device telemetry to determine if an accident occurred.
 */

// Rules:
// Accident if:
// - Acceleration > 3g combined with a sudden drop (not implemented fully without historical context, but we use > 3g as threshold)
// OR
// - Vehicle tilt > 60 degrees
// OR
// - Emergency button pressed

function analyzeTelemetry(data, previousData = null) {
    let isAccident = false;
    let severity = 'None';
    let triggers = [];

    const acceleration = parseFloat(data.acceleration);
    const tilt = parseFloat(data.tilt_angle);
    const emergencyButton = data.emergency_button;

    if (emergencyButton === true || emergencyButton === 'true') {
        isAccident = true;
        severity = 'Critical';
        triggers.push('Emergency Button Pressed');
    }

    // 3g acceleration threshold
    if (acceleration > 3.0) {
        isAccident = true;
        // Over 5g is critical, 3-5g is high/medium
        if (acceleration > 5.0) {
            severity = severity === 'Critical' ? 'Critical' : 'High';
        } else {
            severity = severity === 'Critical' || severity === 'High' ? severity : 'Medium';
        }
        triggers.push(`High Impact (${acceleration.toFixed(2)}g)`);
    }

    // Tilt > 60 degrees detection
    if (tilt > 60.0) {
        isAccident = true;
        severity = severity === 'Critical' || severity === 'High' ? severity : 'Medium';
        triggers.push(`High Tilt/Rollover (${tilt.toFixed(2)}°)`);
    }

    return {
        isAccident,
        severity,
        triggers,
        timestamp: new Date().toISOString()
    };
}

module.exports = { analyzeTelemetry };
