/**
 * Blackbox Log Analysis Engine
 *
 * Performs heuristic analysis on parsed blackbox data to detect
 * common issues and provide tuning suggestions.
 */

import {
  BlackboxLog,
  BlackboxSample,
  AnalysisResult,
  Issue,
  Metric,
  IssueSeverity,
} from '../types.js';

/**
 * Statistical helper functions
 */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const squareDiffs = values.map(v => Math.pow(v - avg, 2));
  return Math.sqrt(mean(squareDiffs));
}

function max(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.max(...values);
}

function min(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.min(...values);
}

function rms(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.sqrt(mean(values.map(v => v * v)));
}

/**
 * Calculate tracking error between setpoint and gyro
 */
function calculateTrackingError(
  samples: BlackboxSample[],
  axis: 'roll' | 'pitch' | 'yaw'
): number[] {
  const errors: number[] = [];

  for (const sample of samples) {
    const gyro = sample.gyro[axis];
    const setpoint = sample.setpoint?.[axis];

    if (setpoint !== undefined) {
      errors.push(Math.abs(setpoint - gyro));
    }
  }

  return errors;
}

/**
 * Detect oscillations using frequency analysis (simplified)
 */
function detectOscillations(
  values: number[],
  sampleRate: number
): { frequency: number; amplitude: number }[] {
  const oscillations: { frequency: number; amplitude: number }[] = [];

  // Simple zero-crossing based frequency detection
  let crossings = 0;
  let lastSign = values[0] >= 0;

  for (let i = 1; i < values.length; i++) {
    const currentSign = values[i] >= 0;
    if (currentSign !== lastSign) {
      crossings++;
      lastSign = currentSign;
    }
  }

  // Frequency = crossings / (2 * duration)
  const duration = values.length / sampleRate;
  const frequency = crossings / (2 * duration);

  if (frequency > 0) {
    const amplitude = standardDeviation(values) * 2;
    oscillations.push({ frequency, amplitude });
  }

  return oscillations;
}

/**
 * Analyze gyro noise levels
 */
function analyzeGyroNoise(samples: BlackboxSample[]): {
  rollNoise: number;
  pitchNoise: number;
  yawNoise: number;
} {
  // Calculate high-frequency noise by looking at sample-to-sample differences
  const rollDiffs: number[] = [];
  const pitchDiffs: number[] = [];
  const yawDiffs: number[] = [];

  for (let i = 1; i < samples.length; i++) {
    rollDiffs.push(Math.abs(samples[i].gyro.roll - samples[i - 1].gyro.roll));
    pitchDiffs.push(Math.abs(samples[i].gyro.pitch - samples[i - 1].gyro.pitch));
    yawDiffs.push(Math.abs(samples[i].gyro.yaw - samples[i - 1].gyro.yaw));
  }

  return {
    rollNoise: rms(rollDiffs),
    pitchNoise: rms(pitchDiffs),
    yawNoise: rms(yawDiffs),
  };
}

/**
 * Analyze motor saturation
 */
function analyzeMotorSaturation(samples: BlackboxSample[]): {
  saturationEvents: number;
  motorImbalance: number;
  maxMotor: number;
  minMotor: number;
} {
  let saturationEvents = 0;
  const motorAverages: number[] = [0, 0, 0, 0];
  let motorSampleCount = 0;
  let maxMotor = 0;
  let minMotor = 100;

  for (const sample of samples) {
    if (!sample.motors) continue;

    motorSampleCount++;

    for (let i = 0; i < 4; i++) {
      const motorValue = sample.motors[i] ?? 0;
      motorAverages[i] += motorValue;

      if (motorValue > maxMotor) maxMotor = motorValue;
      if (motorValue < minMotor) minMotor = motorValue;

      // Check for saturation (motor at max or min)
      if (motorValue >= 99 || motorValue <= 1) {
        saturationEvents++;
      }
    }
  }

  // Calculate motor imbalance
  for (let i = 0; i < 4; i++) {
    motorAverages[i] /= motorSampleCount || 1;
  }

  const avgMotorOutput = mean(motorAverages);
  const motorImbalance = avgMotorOutput > 0
    ? standardDeviation(motorAverages) / avgMotorOutput * 100
    : 0;

  return {
    saturationEvents,
    motorImbalance,
    maxMotor,
    minMotor,
  };
}

/**
 * Analyze voltage sag
 */
function analyzeVoltageSag(samples: BlackboxSample[]): {
  minVoltage: number;
  maxVoltage: number;
  sagPercent: number;
  sagAtHighThrottle: boolean;
} {
  const voltages: number[] = [];
  const highThrottleVoltages: number[] = [];
  const lowThrottleVoltages: number[] = [];

  for (const sample of samples) {
    if (sample.battery?.voltage === undefined) continue;

    const voltage = sample.battery.voltage;
    voltages.push(voltage);

    const throttle = sample.setpoint?.throttle ?? 0;
    if (throttle > 1500) {
      highThrottleVoltages.push(voltage);
    } else if (throttle < 1200) {
      lowThrottleVoltages.push(voltage);
    }
  }

  if (voltages.length === 0) {
    return { minVoltage: 0, maxVoltage: 0, sagPercent: 0, sagAtHighThrottle: false };
  }

  const minVoltage = min(voltages);
  const maxVoltage = max(voltages);
  const sagPercent = maxVoltage > 0 ? ((maxVoltage - minVoltage) / maxVoltage) * 100 : 0;

  // Check if sag correlates with high throttle
  const avgHighThrottle = mean(highThrottleVoltages);
  const avgLowThrottle = mean(lowThrottleVoltages);
  const sagAtHighThrottle = avgLowThrottle > 0 && avgHighThrottle < avgLowThrottle * 0.95;

  return { minVoltage, maxVoltage, sagPercent, sagAtHighThrottle };
}

/**
 * Analyze D-term behavior
 */
function analyzeDTerm(samples: BlackboxSample[]): {
  rollDMax: number;
  pitchDMax: number;
  dTermNoise: number;
} {
  const rollD: number[] = [];
  const pitchD: number[] = [];

  for (const sample of samples) {
    if (sample.pid?.roll?.d !== undefined) {
      rollD.push(Math.abs(sample.pid.roll.d));
    }
    if (sample.pid?.pitch?.d !== undefined) {
      pitchD.push(Math.abs(sample.pid.pitch.d));
    }
  }

  return {
    rollDMax: max(rollD),
    pitchDMax: max(pitchD),
    dTermNoise: (standardDeviation(rollD) + standardDeviation(pitchD)) / 2,
  };
}

/**
 * Detect propwash oscillations
 * Propwash typically occurs after throttle reduction with pitch/roll input
 */
function detectPropwash(samples: BlackboxSample[]): {
  detected: boolean;
  severity: IssueSeverity;
  throttleRange: string;
} {
  let propwashEvents = 0;
  let inThrottleDrop = false;
  let throttleDropStart = 0;

  for (let i = 10; i < samples.length - 10; i++) {
    const currentThrottle = samples[i].setpoint?.throttle ?? 1000;
    const prevThrottle = samples[i - 5].setpoint?.throttle ?? 1000;

    // Detect throttle drop
    if (prevThrottle - currentThrottle > 200 && currentThrottle < 1600 && currentThrottle > 1200) {
      inThrottleDrop = true;
      throttleDropStart = i;
    }

    // Check for oscillations during/after throttle drop
    if (inThrottleDrop && i - throttleDropStart < 50) {
      const gyroNoise = Math.abs(samples[i].gyro.roll) + Math.abs(samples[i].gyro.pitch);
      const setpointMagnitude = Math.abs(samples[i].setpoint?.roll ?? 0) +
                                Math.abs(samples[i].setpoint?.pitch ?? 0);

      // High gyro activity with low setpoint suggests unwanted oscillation
      if (gyroNoise > 100 && setpointMagnitude < 200) {
        propwashEvents++;
      }
    }

    if (i - throttleDropStart > 50) {
      inThrottleDrop = false;
    }
  }

  const eventRate = propwashEvents / (samples.length / 1000);

  return {
    detected: propwashEvents > 10,
    severity: eventRate > 0.5 ? 'high' : eventRate > 0.2 ? 'medium' : 'low',
    throttleRange: '1200-1600',
  };
}

/**
 * Main analysis function
 */
export async function analyzeLog(
  log: BlackboxLog,
  filePath: string,
  sizeBytes: number
): Promise<AnalysisResult> {
  const issues: Issue[] = [];
  const metrics: Metric[] = [];

  const samples = log.samples;

  if (samples.length < 100) {
    return {
      logInfo: {
        filePath,
        sizeBytes,
        firmware: log.header.firmware,
        craftName: log.header.craftName,
        dateRecorded: log.header.dateRecorded,
        duration: log.duration,
        sampleCount: samples.length,
      },
      summary: 'Insufficient data for analysis. Log contains too few samples.',
      issues: [{
        type: 'insufficient_data',
        severity: 'high',
        description: 'The log file contains too few samples for meaningful analysis.',
        evidence: `Only ${samples.length} samples found`,
        suggestions: ['Ensure logging is enabled', 'Check SD card / flash storage', 'Try a longer flight'],
      }],
      metrics: [],
    };
  }

  // Calculate sample rate
  const sampleRate = log.header.loopTime
    ? 1000000 / log.header.loopTime
    : 1000; // Default assumption

  // === Gyro Noise Analysis ===
  const gyroNoise = analyzeGyroNoise(samples);

  metrics.push({
    name: 'Roll Gyro Noise',
    value: gyroNoise.rollNoise.toFixed(2),
    unit: 'deg/s',
    description: 'RMS of sample-to-sample gyro changes',
  });

  metrics.push({
    name: 'Pitch Gyro Noise',
    value: gyroNoise.pitchNoise.toFixed(2),
    unit: 'deg/s',
  });

  metrics.push({
    name: 'Yaw Gyro Noise',
    value: gyroNoise.yawNoise.toFixed(2),
    unit: 'deg/s',
  });

  // High gyro noise issue
  const maxGyroNoise = Math.max(gyroNoise.rollNoise, gyroNoise.pitchNoise);
  if (maxGyroNoise > 10) {
    issues.push({
      type: 'high_gyro_noise',
      severity: maxGyroNoise > 20 ? 'high' : 'medium',
      description: 'High frequency noise detected on gyro signals.',
      evidence: `Roll noise: ${gyroNoise.rollNoise.toFixed(1)}°/s, Pitch noise: ${gyroNoise.pitchNoise.toFixed(1)}°/s`,
      suggestions: [
        'Check gyro soft mounting / dampening',
        'Increase gyro lowpass filter cutoff',
        'Check for damaged props or unbalanced motors',
        'Verify FC mounting is secure',
      ],
    });
  }

  // === Tracking Error Analysis ===
  const rollTrackingError = calculateTrackingError(samples, 'roll');
  const pitchTrackingError = calculateTrackingError(samples, 'pitch');

  if (rollTrackingError.length > 0 && pitchTrackingError.length > 0) {
    const avgRollError = mean(rollTrackingError);
    const avgPitchError = mean(pitchTrackingError);
    const maxRollError = max(rollTrackingError);
    const maxPitchError = max(pitchTrackingError);

    metrics.push({
      name: 'Average Tracking Error (Roll)',
      value: avgRollError.toFixed(1),
      unit: 'deg/s',
      description: 'Average difference between commanded and actual roll rate',
    });

    metrics.push({
      name: 'Average Tracking Error (Pitch)',
      value: avgPitchError.toFixed(1),
      unit: 'deg/s',
    });

    metrics.push({
      name: 'Max Tracking Error',
      value: Math.max(maxRollError, maxPitchError).toFixed(1),
      unit: 'deg/s',
    });

    // Large tracking error issue
    const avgError = (avgRollError + avgPitchError) / 2;
    if (avgError > 50) {
      issues.push({
        type: 'poor_tracking',
        severity: avgError > 100 ? 'high' : 'medium',
        description: 'The quad is not following stick inputs accurately.',
        evidence: `Average tracking error: Roll ${avgRollError.toFixed(0)}°/s, Pitch ${avgPitchError.toFixed(0)}°/s`,
        suggestions: [
          'Increase P gain slightly',
          'Check if I term is too low',
          'Verify motor/prop setup is correct',
          'Check ESC timing and protocol',
        ],
      });
    }
  }

  // === Motor Analysis ===
  const motorAnalysis = analyzeMotorSaturation(samples);

  metrics.push({
    name: 'Motor Imbalance',
    value: motorAnalysis.motorImbalance.toFixed(1),
    unit: '%',
    description: 'Variation between motor outputs (lower is better)',
  });

  metrics.push({
    name: 'Motor Saturation Events',
    value: motorAnalysis.saturationEvents,
    description: 'Number of times motors hit min/max limits',
  });

  if (motorAnalysis.saturationEvents > samples.length * 0.01) {
    issues.push({
      type: 'motor_saturation',
      severity: motorAnalysis.saturationEvents > samples.length * 0.05 ? 'high' : 'medium',
      description: 'Motors are frequently hitting their output limits.',
      evidence: `${motorAnalysis.saturationEvents} saturation events detected`,
      suggestions: [
        'Reduce overall PID gains',
        'Check if thrust-to-weight ratio is adequate',
        'Verify motor/ESC/prop match',
        'Consider using motor output limiting',
      ],
    });
  }

  if (motorAnalysis.motorImbalance > 15) {
    issues.push({
      type: 'motor_imbalance',
      severity: motorAnalysis.motorImbalance > 25 ? 'high' : 'medium',
      description: 'One or more motors are working harder than others.',
      evidence: `Motor output imbalance: ${motorAnalysis.motorImbalance.toFixed(1)}%`,
      suggestions: [
        'Check center of gravity',
        'Verify all motors and props are identical',
        'Check for bent motor shafts',
        'Calibrate ESCs',
        'Check frame for twists or damage',
      ],
    });
  }

  // === Voltage Sag Analysis ===
  const voltageSag = analyzeVoltageSag(samples);

  if (voltageSag.maxVoltage > 0) {
    metrics.push({
      name: 'Min Battery Voltage',
      value: voltageSag.minVoltage.toFixed(2),
      unit: 'V',
    });

    metrics.push({
      name: 'Max Battery Voltage',
      value: voltageSag.maxVoltage.toFixed(2),
      unit: 'V',
    });

    metrics.push({
      name: 'Voltage Sag',
      value: voltageSag.sagPercent.toFixed(1),
      unit: '%',
      description: 'Maximum voltage drop during flight',
    });

    if (voltageSag.sagPercent > 15) {
      issues.push({
        type: 'voltage_sag',
        severity: voltageSag.sagPercent > 25 ? 'high' : 'medium',
        description: 'Significant battery voltage drop under load.',
        evidence: `Voltage dropped from ${voltageSag.maxVoltage.toFixed(1)}V to ${voltageSag.minVoltage.toFixed(1)}V (${voltageSag.sagPercent.toFixed(0)}% sag)`,
        suggestions: [
          'Use a battery with higher C rating',
          'Check battery health and internal resistance',
          'Verify XT60/battery connector is secure',
          'Consider using a larger capacity battery',
        ],
      });
    }
  }

  // === D-Term Analysis ===
  const dTermAnalysis = analyzeDTerm(samples);

  if (dTermAnalysis.rollDMax > 0) {
    metrics.push({
      name: 'Max D-Term Output',
      value: Math.max(dTermAnalysis.rollDMax, dTermAnalysis.pitchDMax).toFixed(0),
      description: 'Peak D-term controller output',
    });

    metrics.push({
      name: 'D-Term Noise',
      value: dTermAnalysis.dTermNoise.toFixed(1),
      description: 'Standard deviation of D-term output',
    });

    if (dTermAnalysis.dTermNoise > 100) {
      issues.push({
        type: 'd_term_noise',
        severity: dTermAnalysis.dTermNoise > 200 ? 'high' : 'medium',
        description: 'D-term output is very noisy, which can cause motor heat and vibrations.',
        evidence: `D-term noise level: ${dTermAnalysis.dTermNoise.toFixed(0)}`,
        suggestions: [
          'Lower D-term gains',
          'Increase D-term lowpass filter strength',
          'Check for propwash or mechanical issues',
          'Try D-term dynamic filter if available',
        ],
      });
    }
  }

  // === Propwash Detection ===
  const propwash = detectPropwash(samples);

  if (propwash.detected) {
    issues.push({
      type: 'propwash',
      severity: propwash.severity,
      description: 'Propwash oscillations detected during throttle transitions.',
      evidence: `Oscillations detected in throttle range ${propwash.throttleRange}`,
      suggestions: [
        'Increase D-term gain slightly',
        'Try enabling/tuning anti-gravity',
        'Experiment with prop wash tuning features',
        'Check prop condition (bent/damaged props amplify propwash)',
        'Consider using feed-forward tuning',
      ],
    });
  }

  // === Oscillation Detection ===
  const gyroValues = samples.map(s => s.gyro.roll);
  const oscillations = detectOscillations(gyroValues, sampleRate);

  if (oscillations.length > 0 && oscillations[0].amplitude > 20) {
    const osc = oscillations[0];
    issues.push({
      type: 'oscillation',
      severity: osc.amplitude > 50 ? 'high' : 'medium',
      description: `Oscillations detected at approximately ${osc.frequency.toFixed(0)} Hz.`,
      evidence: `Amplitude: ${osc.amplitude.toFixed(1)}°/s at ~${osc.frequency.toFixed(0)} Hz`,
      suggestions: osc.frequency > 100
        ? [
            'This is likely mechanical vibration or filter issue',
            'Lower gyro lowpass filter cutoff',
            'Check motor/prop balance',
            'Verify soft mounting',
          ]
        : [
            'This is likely a PID tuning issue',
            'Reduce P gain on affected axis',
            'May also need to adjust D gain',
            'Check for loose components',
          ],
    });
  }

  // === Generate Summary ===
  const summary = generateSummary(issues, metrics, log);

  return {
    logInfo: {
      filePath,
      sizeBytes,
      firmware: log.header.firmware,
      craftName: log.header.craftName,
      dateRecorded: log.header.dateRecorded,
      duration: log.duration,
      sampleCount: samples.length,
    },
    summary,
    issues,
    metrics,
  };
}

/**
 * Generate a human-readable summary of the analysis
 */
function generateSummary(issues: Issue[], metrics: Metric[], log: BlackboxLog): string {
  const parts: string[] = [];

  // Basic info
  if (log.duration) {
    parts.push(`Flight duration: ${log.duration.toFixed(1)} seconds.`);
  }
  parts.push(`Analyzed ${log.samples.length.toLocaleString()} samples.`);

  // Issue summary
  const highIssues = issues.filter(i => i.severity === 'high');
  const mediumIssues = issues.filter(i => i.severity === 'medium');
  const lowIssues = issues.filter(i => i.severity === 'low');

  if (highIssues.length > 0) {
    parts.push(`\n⚠️ Found ${highIssues.length} HIGH severity issue(s): ${highIssues.map(i => i.type).join(', ')}.`);
  }

  if (mediumIssues.length > 0) {
    parts.push(`Found ${mediumIssues.length} MEDIUM severity issue(s): ${mediumIssues.map(i => i.type).join(', ')}.`);
  }

  if (lowIssues.length > 0) {
    parts.push(`Found ${lowIssues.length} LOW severity issue(s).`);
  }

  if (issues.length === 0) {
    parts.push('\n✅ No significant issues detected. Flight looks good!');
  }

  // Key recommendations
  if (highIssues.length > 0) {
    parts.push('\nTop priority: ' + highIssues[0].suggestions[0]);
  }

  return parts.join(' ');
}
