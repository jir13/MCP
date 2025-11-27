/**
 * Binary decoding utilities for Betaflight blackbox logs
 *
 * Betaflight blackbox format reference:
 * https://github.com/betaflight/blackbox-log-viewer
 * https://github.com/betaflight/betaflight/blob/master/docs/development/Blackbox%20Internals.md
 */

/**
 * Read a variable-length unsigned integer (used in blackbox encoding)
 */
export function readUnsignedVB(buffer: Buffer, offset: number): { value: number; bytesRead: number } {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;

  while (offset + bytesRead < buffer.length) {
    const byte = buffer[offset + bytesRead];
    bytesRead++;

    value |= (byte & 0x7F) << shift;

    if ((byte & 0x80) === 0) {
      break;
    }

    shift += 7;

    if (shift > 28) {
      throw new Error('Variable-length integer too long');
    }
  }

  return { value, bytesRead };
}

/**
 * Read a variable-length signed integer (zigzag encoded)
 */
export function readSignedVB(buffer: Buffer, offset: number): { value: number; bytesRead: number } {
  const { value: unsigned, bytesRead } = readUnsignedVB(buffer, offset);
  // Zigzag decode
  const signed = (unsigned >>> 1) ^ -(unsigned & 1);
  return { value: signed, bytesRead };
}

/**
 * Read a null-terminated string from buffer
 */
export function readString(buffer: Buffer, offset: number, maxLength: number = 256): { value: string; bytesRead: number } {
  let end = offset;
  while (end < buffer.length && end < offset + maxLength && buffer[end] !== 0) {
    end++;
  }
  const value = buffer.slice(offset, end).toString('utf-8');
  return { value, bytesRead: end - offset + 1 }; // +1 for null terminator
}

/**
 * Parse a header line from blackbox log
 */
export function parseHeaderLine(line: string): { key: string; value: string } | null {
  if (!line.startsWith('H ')) {
    return null;
  }

  const colonIndex = line.indexOf(':');
  if (colonIndex === -1) {
    return null;
  }

  const key = line.slice(2, colonIndex).trim();
  const value = line.slice(colonIndex + 1).trim();

  return { key, value };
}

/**
 * Parse field definition from header
 */
export function parseFieldDefinition(value: string): string[] {
  return value.split(',').map(f => f.trim());
}

/**
 * Parse numeric array from header value
 */
export function parseNumericArray(value: string): number[] {
  return value.split(',').map(v => parseInt(v.trim(), 10));
}

/**
 * Decode a frame based on predictor and encoding
 */
export function decodeFrame(
  buffer: Buffer,
  offset: number,
  fieldCount: number,
  predictors: number[],
  encodings: number[],
  signed: boolean[],
  previousValues: number[]
): { values: number[]; bytesRead: number } {
  const values: number[] = new Array(fieldCount);
  let bytesRead = 0;

  for (let i = 0; i < fieldCount; i++) {
    let rawValue: number;
    let fieldBytesRead: number;

    // Decode based on encoding type
    const encoding = encodings[i] || 0;

    switch (encoding) {
      case 0: // Signed variable byte
        ({ value: rawValue, bytesRead: fieldBytesRead } = readSignedVB(buffer, offset + bytesRead));
        break;
      case 1: // Unsigned variable byte
        ({ value: rawValue, bytesRead: fieldBytesRead } = readUnsignedVB(buffer, offset + bytesRead));
        break;
      case 6: // TAG8_8SVB (8 values encoded together)
        // Simplified - just read as signed VB
        ({ value: rawValue, bytesRead: fieldBytesRead } = readSignedVB(buffer, offset + bytesRead));
        break;
      case 7: // TAG2_3S32
      case 8: // TAG8_4S16
        // Simplified - read as signed VB
        ({ value: rawValue, bytesRead: fieldBytesRead } = readSignedVB(buffer, offset + bytesRead));
        break;
      case 9: // NULL - skip
        rawValue = 0;
        fieldBytesRead = 0;
        break;
      default:
        // Default to signed variable byte
        ({ value: rawValue, bytesRead: fieldBytesRead } = readSignedVB(buffer, offset + bytesRead));
    }

    bytesRead += fieldBytesRead;

    // Apply predictor
    const predictor = predictors[i] || 0;
    switch (predictor) {
      case 0: // No prediction
        values[i] = rawValue;
        break;
      case 1: // Previous value
        values[i] = (previousValues[i] || 0) + rawValue;
        break;
      case 2: // Straight line prediction
        values[i] = rawValue; // Simplified
        break;
      case 3: // Average of last 2
        values[i] = rawValue; // Simplified
        break;
      default:
        values[i] = rawValue;
    }
  }

  return { values, bytesRead };
}

/**
 * Frame type identifiers
 */
export const FRAME_TYPES = {
  INTRA: 'I',     // Complete frame with all values
  INTER: 'P',     // Delta frame
  GPS: 'G',       // GPS frame
  GPS_HOME: 'H',  // GPS home frame
  EVENT: 'E',     // Event frame
  SLOW: 'S',      // Slow frame
} as const;

/**
 * Event types in blackbox logs
 */
export const EVENT_TYPES = {
  SYNC_BEEP: 0,
  INFLIGHT_ADJUSTMENT: 1,
  AUTOTUNE_CYCLE_START: 2,
  AUTOTUNE_CYCLE_RESULT: 3,
  AUTOTUNE_TARGETS: 4,
  RC_SMOOTHING: 5,
  FLIGHT_MODE: 30,
  LOGGING_RESUME: 255,
} as const;
