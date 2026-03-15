// ============================================================
// Tipos TypeScript para configuración EdgeTX / FreedomTX
// Compatible con TBS Tango 2
// ============================================================

// --- Fuentes de entrada (sticks, pots, sliders, switches) ---
export type StickSource = 'Rud' | 'Ele' | 'Thr' | 'Ail';
export type SwitchId = 'SA' | 'SB' | 'SC' | 'SD' | 'SE' | 'SF' | 'SG' | 'SH';
export type SwitchPosition = 'up' | 'mid' | 'down' | '!up' | '!mid' | '!down';

export const VALID_SWITCHES: SwitchId[] = ['SA', 'SB', 'SC', 'SD', 'SE', 'SF', 'SG', 'SH'];

// Tango 2 tiene: SA (2pos), SB (3pos), SC (3pos), SD (2pos), SE (2pos), SF (2pos)
// SG y SH pueden o no estar disponibles según la versión
export const TANGO2_SWITCHES: Record<SwitchId, { positions: number; available: boolean }> = {
  SA: { positions: 2, available: true },
  SB: { positions: 3, available: true },
  SC: { positions: 3, available: true },
  SD: { positions: 2, available: true },
  SE: { positions: 2, available: true },
  SF: { positions: 2, available: true },
  SG: { positions: 2, available: false },
  SH: { positions: 2, available: false },
};

// --- Canales estándar ---
export const CHANNEL_ORDER_AETR = ['Ail', 'Ele', 'Thr', 'Rud'] as const;
export const MAX_CHANNELS = 16;

// --- Mix ---
export interface MixData {
  destCh: number;           // Canal destino (0-indexed)
  srcRaw: string;           // Fuente (stick, input, canal, etc.)
  weight: number;           // Peso (-100 a 100)
  offset?: number;          // Offset (-100 a 100)
  switch?: string;          // Switch condicional (ej: "SA↑", "SB-")
  curve?: CurveRef;         // Referencia a curva
  delayUp?: number;         // Delay subida (0.0 - 25.0s)
  delayDown?: number;       // Delay bajada
  speedUp?: number;         // Velocidad subida
  speedDown?: number;       // Velocidad bajada
  name?: string;            // Nombre del mix
  multiplex?: 'add' | 'multiply' | 'replace';  // Tipo de operación
  flightModes?: number[];   // Modos de vuelo activos
}

// --- Input (Expo/DR) ---
export interface InputData {
  chn: number;              // Número de input (0-indexed)
  srcRaw: string;           // Fuente (stick)
  weight: number;           // Peso/rate (-100 a 100)
  offset?: number;          // Offset
  switch?: string;          // Switch condicional
  curve?: CurveRef;         // Curva (expo)
  trim?: boolean;           // Usar trim
  name?: string;            // Nombre del input
  flightModes?: number[];   // Modos de vuelo activos
}

// --- Output (Límites de canal) ---
export interface LimitData {
  min: number;              // Límite mínimo (-100 a 0, default -100)
  max: number;              // Límite máximo (0 a 100, default 100)
  offset?: number;          // Subtrim (-100 a 100)
  symetrical?: boolean;     // Simétrico
  name?: string;            // Nombre del canal
  revert?: boolean;         // Invertir canal
  ppmCenter?: number;       // Centro PPM (1500 default)
}

// --- Curvas ---
export type CurveType = 'custom' | 'expo' | 'func';

export interface CurveRef {
  type: 'curve' | 'expo' | 'func';
  value: number;            // ID de curva o valor de expo
}

export interface CurveData {
  type: CurveType;
  smooth?: boolean;
  points: number[];         // Puntos de la curva (-100 a 100)
  name?: string;
}

// --- Switch Lógico ---
export type LogicalSwitchFunction =
  | 'a>x' | 'a<x' | 'a>b'
  | '|a|>x' | '|a|<x'
  | 'AND' | 'OR' | 'XOR'
  | 'a=x' | 'a~x'
  | 'Timer' | 'Sticky' | 'Edge';

export interface LogicalSwitch {
  func: LogicalSwitchFunction;
  v1: string | number;      // Valor 1 / fuente
  v2: string | number;      // Valor 2 / umbral
  andSwitch?: string;       // Switch AND adicional
  delay?: number;           // Delay (0.0 - 25.0s)
  duration?: number;        // Duración (0.0 - 25.0s)
  name?: string;
}

// --- Timer ---
export type TimerMode = 'off' | 'on' | 'strt' | 'thrs' | 'th%' | 'thst';

export interface TimerData {
  mode: TimerMode;
  start: number;            // Valor inicial en segundos
  switch?: string;          // Switch que activa el timer
  countdownBeep?: 'silent' | 'beeps' | 'voice' | 'haptic';
  minuteBeep?: boolean;
  persistent?: boolean;     // Persistente entre sesiones
  name?: string;
}

// --- Telemetría ---
export interface TelemetrySensor {
  id: number;
  instance: number;
  name: string;
  unit?: string;
  precision?: number;
  formula?: string;
  logs?: boolean;
}

// --- Funciones especiales ---
export interface SpecialFunction {
  switch: string;
  func: string;
  value?: number | string;
  mode?: string;
  param?: number;
  active?: boolean;
  name?: string;
}

// --- Header del modelo ---
export interface ModelHeader {
  name: string;
  modelId?: number;
  bitmap?: string;
  functionSwitches?: number;
  switchWarningState?: number;
}

// --- Modelo completo ---
export interface EdgeTXModel {
  header: ModelHeader;
  timers?: TimerData[];
  mixData?: MixData[];
  expoData?: InputData[];    // "expo" es el nombre interno de EdgeTX para inputs
  limitData?: LimitData[];
  logicalSw?: LogicalSwitch[];
  curves?: CurveData[];
  telemetrySensors?: TelemetrySensor[];
  specialFunctions?: SpecialFunction[];
  // Campos adicionales que preservamos al leer/escribir
  [key: string]: unknown;
}

// --- Configuración global del radio ---
export interface RadioConfig {
  generalSettings?: {
    name?: string;
    batteryCalibration?: number;
    backlightBright?: number;
    backlightDuration?: number;
    contrast?: number;
    vBatWarn?: number;
    vBatMin?: number;
    vBatMax?: number;
    internalModule?: string;
    externalModule?: string;
    [key: string]: unknown;
  };
  calibData?: unknown[];
  [key: string]: unknown;
}

// --- Resultado de detección del radio ---
export interface RadioDetectionResult {
  found: boolean;
  mountPoint?: string;
  modelsPath?: string;
  radioConfigPath?: string;
  platform: 'macos' | 'windows' | 'linux';
  error?: string;
}

// --- Resumen de modelo (para listado) ---
export interface ModelSummary {
  fileName: string;
  name: string;
  filePath: string;
  channelCount: number;
  mixCount: number;
  inputCount: number;
  timerCount: number;
  hasTelemetry: boolean;
}

// --- Resultado de comparación ---
export interface ModelComparison {
  modelA: string;
  modelB: string;
  differences: ComparisonDiff[];
  summary: string;
}

export interface ComparisonDiff {
  section: string;
  field: string;
  valueA: unknown;
  valueB: unknown;
  description: string;
}

// --- Modos de vuelo comunes en Betaflight ---
export const BETAFLIGHT_MODES: Record<string, { auxChannel: number; range: [number, number]; description: string }> = {
  'ARM': { auxChannel: 1, range: [1800, 2100], description: 'Armado del quad' },
  'ANGLE': { auxChannel: 2, range: [900, 1300], description: 'Modo Angle (auto-level)' },
  'HORIZON': { auxChannel: 2, range: [1300, 1700], description: 'Modo Horizon (semi auto-level)' },
  'ACRO': { auxChannel: 2, range: [1700, 2100], description: 'Modo Acro (manual)' },
  'BEEPER': { auxChannel: 3, range: [1800, 2100], description: 'Buzzer/Beeper' },
  'LAUNCH_CONTROL': { auxChannel: 4, range: [1800, 2100], description: 'Launch Control (turtle mode launch)' },
  'GPS_RESCUE': { auxChannel: 4, range: [1800, 2100], description: 'GPS Rescue (retorno automático)' },
  'FAILSAFE': { auxChannel: 4, range: [1800, 2100], description: 'Failsafe' },
  'AIRMODE': { auxChannel: 5, range: [1800, 2100], description: 'Air Mode' },
  'FLIP_OVER_AFTER_CRASH': { auxChannel: 6, range: [1800, 2100], description: 'Turtle Mode' },
};

// --- Mapeo de canales AUX ---
// En Betaflight: AUX1 = CH5, AUX2 = CH6, etc.
export function auxToChannel(aux: number): number {
  return aux + 4; // AUX1 -> CH5
}

export function channelToAux(ch: number): number {
  return ch - 4; // CH5 -> AUX1
}
