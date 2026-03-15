/**
 * Betaflight Blackbox Log Parser
 *
 * This parser handles .bbl (Betaflight Blackbox Log) files.
 * The format is a mix of ASCII headers and binary-encoded frame data.
 *
 * Reference: https://github.com/betaflight/blackbox-log-viewer
 */

import {
  BlackboxLog,
  BlackboxHeader,
  BlackboxSample,
  ParseError,
} from '../types.js';
import {
  parseHeaderLine,
  parseFieldDefinition,
  parseNumericArray,
  readSignedVB,
  readUnsignedVB,
  FRAME_TYPES,
} from './decoder.js';

/**
 * Field name mappings from blackbox to our normalized structure
 */
const FIELD_MAPPINGS = {
  // Gyro
  'gyroADC[0]': 'gyro_roll',
  'gyroADC[1]': 'gyro_pitch',
  'gyroADC[2]': 'gyro_yaw',

  // Setpoint / RC Command
  'rcCommand[0]': 'setpoint_roll',
  'rcCommand[1]': 'setpoint_pitch',
  'rcCommand[2]': 'setpoint_yaw',
  'rcCommand[3]': 'throttle',

  // PID values (roll)
  'axisP[0]': 'pid_roll_p',
  'axisI[0]': 'pid_roll_i',
  'axisD[0]': 'pid_roll_d',

  // PID values (pitch)
  'axisP[1]': 'pid_pitch_p',
  'axisI[1]': 'pid_pitch_i',
  'axisD[1]': 'pid_pitch_d',

  // PID values (yaw)
  'axisP[2]': 'pid_yaw_p',
  'axisI[2]': 'pid_yaw_i',
  'axisD[2]': 'pid_yaw_d',

  // Motors
  'motor[0]': 'motor_0',
  'motor[1]': 'motor_1',
  'motor[2]': 'motor_2',
  'motor[3]': 'motor_3',

  // Battery
  'vbatLatest': 'battery_voltage',
  'amperageLatest': 'battery_current',

  // Time
  'loopIteration': 'loop_iteration',
  'time': 'time',
};

/**
 * Parse the header section of a blackbox log
 */
function parseHeaders(lines: string[]): BlackboxHeader {
  const header: BlackboxHeader = {
    fieldNames: [],
    fieldSigned: [],
    fieldPredictor: [],
    fieldEncoding: [],
  };

  for (const line of lines) {
    const parsed = parseHeaderLine(line);
    if (!parsed) continue;

    const { key, value } = parsed;

    switch (key) {
      case 'Firmware revision':
      case 'Firmware type':
        header.firmware = value;
        break;
      case 'Craft name':
        header.craftName = value;
        break;
      case 'Log start datetime':
        header.dateRecorded = value;
        break;
      case 'Field I name':
        header.fieldNames = parseFieldDefinition(value);
        break;
      case 'Field I signed':
        header.fieldSigned = parseNumericArray(value).map(v => v === 1);
        break;
      case 'Field I predictor':
        header.fieldPredictor = parseNumericArray(value);
        break;
      case 'Field I encoding':
        header.fieldEncoding = parseNumericArray(value);
        break;
      case 'looptime':
        header.loopTime = parseInt(value, 10);
        break;
      case 'gyro_scale':
        header.gyroScale = parseFloat(value);
        break;
      case 'motorOutput':
        const motorRange = value.split(',').map(v => parseInt(v.trim(), 10));
        if (motorRange.length >= 2) {
          header.motorOutputLow = motorRange[0];
          header.motorOutputHigh = motorRange[1];
        }
        break;
      case 'vbat_scale':
      case 'vbatscale':
        header.vbatScale = parseInt(value, 10);
        break;
      case 'vbatref':
        header.vbatRef = parseInt(value, 10);
        break;
      case 'currentSensor':
      case 'currentScale':
        header.currentScale = parseInt(value, 10);
        break;
      case 'Firmware date':
        // Additional firmware info
        if (header.firmware) {
          header.firmware += ` (${value})`;
        }
        break;
      case 'debug_mode':
        header.debugMode = value;
        break;
      case 'rollPID':
        header.rollPID = parseNumericArray(value);
        break;
      case 'pitchPID':
        header.pitchPID = parseNumericArray(value);
        break;
      case 'yawPID':
        header.yawPID = parseNumericArray(value);
        break;
      case 'rates':
        header.rates = parseNumericArray(value);
        break;
      case 'rc_rates':
        header.rcRates = parseNumericArray(value);
        break;
      case 'rc_expo':
        header.rcExpo = parseNumericArray(value);
        break;
      case 'features':
        header.features = value.split(',').map(f => f.trim());
        break;
    }
  }

  return header;
}

/**
 * Build field index map for quick lookup
 */
function buildFieldIndexMap(fieldNames: string[]): Map<string, number> {
  const map = new Map<string, number>();

  for (let i = 0; i < fieldNames.length; i++) {
    const name = fieldNames[i];
    map.set(name, i);

    // Also map to normalized names
    const normalizedName = FIELD_MAPPINGS[name as keyof typeof FIELD_MAPPINGS];
    if (normalizedName) {
      map.set(normalizedName, i);
    }
  }

  return map;
}

/**
 * Convert raw frame values to BlackboxSample
 */
function frameToSample(
  values: number[],
  fieldMap: Map<string, number>,
  header: BlackboxHeader,
  frameIndex: number
): BlackboxSample {
  const getValue = (name: string): number | undefined => {
    const idx = fieldMap.get(name);
    return idx !== undefined ? values[idx] : undefined;
  };

  // Get gyro scale factor (default for Betaflight)
  const gyroScale = header.gyroScale || (1.0 / 16.4); // Default for 2000dps

  // Get time - either from 'time' field or calculate from loop iteration
  let t = getValue('time') ?? getValue('loopIteration') ?? frameIndex;
  if (header.loopTime && getValue('loopIteration') !== undefined) {
    t = (getValue('loopIteration')! * header.loopTime) / 1000000; // Convert to seconds
  }

  const sample: BlackboxSample = {
    t,
    gyro: {
      roll: (getValue('gyroADC[0]') ?? 0) * gyroScale,
      pitch: (getValue('gyroADC[1]') ?? 0) * gyroScale,
      yaw: (getValue('gyroADC[2]') ?? 0) * gyroScale,
    },
  };

  // Setpoint / RC commands
  const setpointRoll = getValue('rcCommand[0]');
  const setpointPitch = getValue('rcCommand[1]');
  const setpointYaw = getValue('rcCommand[2]');
  const throttle = getValue('rcCommand[3]');

  if (setpointRoll !== undefined || setpointPitch !== undefined || setpointYaw !== undefined) {
    sample.setpoint = {
      roll: setpointRoll,
      pitch: setpointPitch,
      yaw: setpointYaw,
      throttle,
    };
  }

  // PID values
  const pidRollP = getValue('axisP[0]');
  const pidPitchP = getValue('axisP[1]');
  const pidYawP = getValue('axisP[2]');

  if (pidRollP !== undefined || pidPitchP !== undefined) {
    sample.pid = {
      roll: {
        p: pidRollP,
        i: getValue('axisI[0]'),
        d: getValue('axisD[0]'),
      },
      pitch: {
        p: pidPitchP,
        i: getValue('axisI[1]'),
        d: getValue('axisD[1]'),
      },
      yaw: {
        p: pidYawP,
        i: getValue('axisI[2]'),
        d: getValue('axisD[2]'),
      },
    };
  }

  // Motor outputs
  const motor0 = getValue('motor[0]');
  const motor1 = getValue('motor[1]');
  const motor2 = getValue('motor[2]');
  const motor3 = getValue('motor[3]');

  if (motor0 !== undefined) {
    sample.motors = [motor0, motor1 ?? 0, motor2 ?? 0, motor3 ?? 0];

    // Normalize motor values to percentage if we have the range
    if (header.motorOutputLow !== undefined && header.motorOutputHigh !== undefined) {
      const range = header.motorOutputHigh - header.motorOutputLow;
      if (range > 0) {
        sample.motors = sample.motors.map(m =>
          Math.max(0, Math.min(100, ((m - header.motorOutputLow!) / range) * 100))
        );
      }
    }
  }

  // Battery voltage
  const vbat = getValue('vbatLatest');
  if (vbat !== undefined) {
    // Convert to actual voltage (scale factor varies by firmware)
    const scale = header.vbatScale || 110;
    sample.battery = {
      voltage: vbat / scale,
    };
  }

  // Debug fields
  const debug0 = getValue('debug[0]');
  if (debug0 !== undefined) {
    sample.debug = {
      'debug[0]': debug0,
      'debug[1]': getValue('debug[1]') ?? 0,
      'debug[2]': getValue('debug[2]') ?? 0,
      'debug[3]': getValue('debug[3]') ?? 0,
    };
  }

  return sample;
}

/**
 * Parse binary frame data (simplified parser)
 *
 * Note: This is a simplified implementation. Full blackbox parsing requires
 * handling all encoding types, predictors, and frame types. For production use,
 * consider using the betaflight-blackbox-parser library or similar.
 */
function parseFrameData(
  buffer: Buffer,
  startOffset: number,
  header: BlackboxHeader
): { samples: BlackboxSample[]; framesRead: number } {
  const samples: BlackboxSample[] = [];
  const fieldMap = buildFieldIndexMap(header.fieldNames);
  const fieldCount = header.fieldNames.length;

  let offset = startOffset;
  let framesRead = 0;
  let previousValues: number[] = new Array(fieldCount).fill(0);

  // Maximum samples to parse (safety limit)
  const maxSamples = 100000;

  while (offset < buffer.length && samples.length < maxSamples) {
    // Check for frame type marker
    const frameType = String.fromCharCode(buffer[offset]);

    if (frameType === FRAME_TYPES.INTRA) {
      // Intra frame - complete values
      offset++; // Skip frame type byte
      const values: number[] = [];
      let frameValid = true;

      try {
        for (let i = 0; i < fieldCount && offset < buffer.length; i++) {
          const { value, bytesRead } = header.fieldSigned[i]
            ? readSignedVB(buffer, offset)
            : readUnsignedVB(buffer, offset);
          values.push(value);
          offset += bytesRead;
        }

        if (values.length === fieldCount) {
          previousValues = [...values];
          const sample = frameToSample(values, fieldMap, header, framesRead);
          samples.push(sample);
          framesRead++;
        }
      } catch {
        // Frame parsing failed, try to find next frame
        frameValid = false;
      }

      if (!frameValid) {
        offset++;
      }
    } else if (frameType === FRAME_TYPES.INTER) {
      // Inter frame - delta from previous
      offset++; // Skip frame type byte
      const values: number[] = [];

      try {
        for (let i = 0; i < fieldCount && offset < buffer.length; i++) {
          const { value: delta, bytesRead } = readSignedVB(buffer, offset);
          // Apply delta based on predictor type
          const predictor = header.fieldPredictor[i] || 0;
          let newValue: number;

          if (predictor === 1) {
            // Previous value prediction
            newValue = previousValues[i] + delta;
          } else {
            newValue = delta;
          }

          values.push(newValue);
          offset += bytesRead;
        }

        if (values.length === fieldCount) {
          previousValues = [...values];
          const sample = frameToSample(values, fieldMap, header, framesRead);
          samples.push(sample);
          framesRead++;
        }
      } catch {
        // Skip malformed frame
        offset++;
      }
    } else if (frameType === FRAME_TYPES.EVENT || frameType === FRAME_TYPES.SLOW) {
      // Skip event and slow frames for now
      offset++;
      // Try to skip the frame data
      try {
        const { bytesRead } = readUnsignedVB(buffer, offset);
        offset += bytesRead;
      } catch {
        offset++;
      }
    } else if (frameType === 'H') {
      // Hit another header section - this might be a new log segment
      // Find end of line and continue
      while (offset < buffer.length && buffer[offset] !== 0x0A) {
        offset++;
      }
      offset++; // Skip newline
    } else {
      // Unknown byte, skip
      offset++;
    }
  }

  return { samples, framesRead };
}

/**
 * Main parser function
 */
export async function parseBlackboxLog(buffer: Buffer): Promise<BlackboxLog> {
  // Convert buffer to string for header parsing
  const content = buffer.toString('utf-8', 0, Math.min(buffer.length, 50000));

  // Find all header lines
  const lines = content.split('\n');
  const headerLines: string[] = [];
  let headerEndOffset = 0;

  for (const line of lines) {
    headerEndOffset += line.length + 1; // +1 for newline

    if (line.startsWith('H ')) {
      headerLines.push(line);
    } else if (line.length > 0 && !line.startsWith('H')) {
      // First non-header line with content indicates start of frame data
      // Backtrack to include this line in frame data
      headerEndOffset -= line.length + 1;
      break;
    }
  }

  if (headerLines.length === 0) {
    throw new ParseError('No header lines found in blackbox log');
  }

  const header = parseHeaders(headerLines);

  if (header.fieldNames.length === 0) {
    throw new ParseError('No field definitions found in blackbox log');
  }

  // Parse frame data
  const { samples, framesRead } = parseFrameData(buffer, headerEndOffset, header);

  // Calculate duration
  let duration: number | undefined;
  if (samples.length > 1) {
    const firstTime = samples[0].t;
    const lastTime = samples[samples.length - 1].t;
    duration = lastTime - firstTime;

    // If duration seems wrong (negative or huge), estimate from loop time
    if (duration <= 0 || duration > 3600) {
      if (header.loopTime) {
        duration = (samples.length * header.loopTime) / 1000000; // Convert µs to seconds
      }
    }
  }

  return {
    header,
    samples,
    rawFrameCount: framesRead,
    duration,
  };
}

/**
 * Get available channel names from a parsed log
 */
export function getAvailableChannels(log: BlackboxLog): string[] {
  const channels: string[] = [];

  // Add all field names
  for (const field of log.header.fieldNames) {
    channels.push(field);

    // Add normalized name if available
    const normalized = FIELD_MAPPINGS[field as keyof typeof FIELD_MAPPINGS];
    if (normalized && !channels.includes(normalized)) {
      channels.push(normalized);
    }
  }

  return channels;
}

/**
 * Extract specific channels as time series data
 */
export function extractTimeSeries(
  log: BlackboxLog,
  channels: string[],
  maxPoints?: number
): { t: number; values: Record<string, number> }[] {
  const result: { t: number; values: Record<string, number> }[] = [];
  const fieldMap = buildFieldIndexMap(log.header.fieldNames);

  // Determine downsampling factor
  const totalSamples = log.samples.length;
  const targetPoints = maxPoints || totalSamples;
  const step = Math.max(1, Math.floor(totalSamples / targetPoints));

  for (let i = 0; i < totalSamples; i += step) {
    const sample = log.samples[i];
    const values: Record<string, number> = {};

    for (const channel of channels) {
      // Get value from sample based on channel name
      let value: number | undefined;

      switch (channel) {
        case 'gyro_roll':
        case 'gyroADC[0]':
          value = sample.gyro.roll;
          break;
        case 'gyro_pitch':
        case 'gyroADC[1]':
          value = sample.gyro.pitch;
          break;
        case 'gyro_yaw':
        case 'gyroADC[2]':
          value = sample.gyro.yaw;
          break;
        case 'setpoint_roll':
        case 'rcCommand[0]':
          value = sample.setpoint?.roll;
          break;
        case 'setpoint_pitch':
        case 'rcCommand[1]':
          value = sample.setpoint?.pitch;
          break;
        case 'setpoint_yaw':
        case 'rcCommand[2]':
          value = sample.setpoint?.yaw;
          break;
        case 'throttle':
        case 'rcCommand[3]':
          value = sample.setpoint?.throttle;
          break;
        case 'motor_0':
        case 'motor[0]':
          value = sample.motors?.[0];
          break;
        case 'motor_1':
        case 'motor[1]':
          value = sample.motors?.[1];
          break;
        case 'motor_2':
        case 'motor[2]':
          value = sample.motors?.[2];
          break;
        case 'motor_3':
        case 'motor[3]':
          value = sample.motors?.[3];
          break;
        case 'battery_voltage':
        case 'vbatLatest':
          value = sample.battery?.voltage;
          break;
        case 'pid_roll_p':
        case 'axisP[0]':
          value = sample.pid?.roll?.p;
          break;
        case 'pid_roll_d':
        case 'axisD[0]':
          value = sample.pid?.roll?.d;
          break;
        case 'pid_pitch_p':
        case 'axisP[1]':
          value = sample.pid?.pitch?.p;
          break;
        case 'pid_pitch_d':
        case 'axisD[1]':
          value = sample.pid?.pitch?.d;
          break;
      }

      if (value !== undefined) {
        values[channel] = value;
      }
    }

    if (Object.keys(values).length > 0) {
      result.push({ t: sample.t, values });
    }
  }

  return result;
}
