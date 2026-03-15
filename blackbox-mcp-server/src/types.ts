// ============================================
// Blackbox Data Types
// ============================================

export interface BlackboxSample {
  t: number; // timestamp or sample index
  gyro: { roll: number; pitch: number; yaw: number };
  setpoint?: { roll?: number; pitch?: number; yaw?: number; throttle?: number };
  pid?: {
    roll?: { p?: number; i?: number; d?: number };
    pitch?: { p?: number; i?: number; d?: number };
    yaw?: { p?: number; i?: number; d?: number };
  };
  motors?: number[]; // per motor output
  battery?: { voltage?: number };
  debug?: Record<string, number>;
}

export interface BlackboxHeader {
  firmware?: string;
  craftName?: string;
  dateRecorded?: string;
  fieldNames: string[];
  fieldSigned: boolean[];
  fieldPredictor: number[];
  fieldEncoding: number[];
  loopTime?: number;
  gyroScale?: number;
  motorOutputLow?: number;
  motorOutputHigh?: number;
  vbatScale?: number;
  vbatRef?: number;
  currentScale?: number;
  pidController?: string;
  rollPID?: number[];
  pitchPID?: number[];
  yawPID?: number[];
  rates?: number[];
  rcRates?: number[];
  rcExpo?: number[];
  features?: string[];
  debugMode?: string;
}

export interface BlackboxLog {
  header: BlackboxHeader;
  samples: BlackboxSample[];
  rawFrameCount: number;
  duration?: number; // in seconds
}

export interface LogFileInfo {
  filename: string;
  fullPath: string;
  sizeBytes: number;
  modifiedAt: string;
}

// ============================================
// Analysis Types
// ============================================

export type IssueSeverity = 'low' | 'medium' | 'high';

export interface Issue {
  type: string;
  severity: IssueSeverity;
  description: string;
  evidence: string;
  suggestions: string[];
}

export interface Metric {
  name: string;
  value: number | string;
  unit?: string;
  description?: string;
}

export interface AnalysisResult {
  logInfo: {
    filePath: string;
    sizeBytes: number;
    firmware?: string;
    craftName?: string;
    dateRecorded?: string;
    duration?: number;
    sampleCount?: number;
  };
  summary: string;
  issues: Issue[];
  metrics: Metric[];
}

export interface TimeSeriesPoint {
  t: number;
  values: Record<string, number>;
}

export interface TimeSeriesResult {
  filePath: string;
  channels: string[];
  pointCount: number;
  data: TimeSeriesPoint[];
}

// ============================================
// Configuration Types
// ============================================

export interface ServerConfig {
  logDirectory: string;
  maxFileSizeBytes: number;
  defaultMaxPoints: number;
}

// ============================================
// Error Types
// ============================================

export class BlackboxError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'BlackboxError';
  }
}

export class ParseError extends BlackboxError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'PARSE_ERROR', details);
    this.name = 'ParseError';
  }
}

export class FileNotFoundError extends BlackboxError {
  constructor(filePath: string) {
    super(`File not found: ${filePath}`, 'FILE_NOT_FOUND', { filePath });
    this.name = 'FileNotFoundError';
  }
}

export class InvalidFileError extends BlackboxError {
  constructor(message: string, filePath: string) {
    super(message, 'INVALID_FILE', { filePath });
    this.name = 'InvalidFileError';
  }
}
