// ============================================================
// Parser binario para FreedomTX / OpenTX 2.3 (.bin)
// Compatible con TBS Tango 2
//
// Formato del archivo:
//   [0-3]   uint32 fourcc "otx5"
//   [4+]    ModelData struct (6257 bytes)
//
// El parser trabaja sobre el Buffer completo.
// Solo modifica bytes específicos para preservar integridad.
// ============================================================

import * as fs from 'fs';
import * as path from 'path';

/**
 * Validates that a string contains only printable ASCII (0x20-0x7E).
 * Throws if any character is outside the valid range.
 */
function validateAsciiName(name: string, maxLen: number, fieldName: string): string {
  const truncated = name.substring(0, maxLen);
  for (let i = 0; i < truncated.length; i++) {
    const code = truncated.charCodeAt(i);
    if (code < 0x20 || code > 0x7E) {
      throw new Error(
        `Carácter inválido en ${fieldName} posición ${i}: 0x${code.toString(16)} — solo ASCII imprimible (0x20-0x7E) es válido.`
      );
    }
  }
  return truncated;
}

/**
 * Safely decode a byte buffer as ASCII, returning empty string
 * if any byte is outside printable range (0x20-0x7E).
 */
function decodeAsciiSafe(buf: Buffer): string {
  const chars: string[] = [];
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0) break;
    if (b >= 0x20 && b <= 0x7E) {
      chars.push(String.fromCharCode(b));
    }
    // Skip non-printable bytes silently
  }
  return chars.join('').trim();
}

// --- Constantes del formato ---
export const OTX5_FOURCC = Buffer.from('otx5', 'ascii');
export const FOURCC_SIZE = 4;
export const MODEL_FILE_SIZE = 6261; // Total: fourcc + ModelData

// Offsets dentro del archivo (incluyendo fourcc)
export const HEADER_OFFSET = 4;       // ModelHeader comienza después del fourcc
export const MODEL_NAME_OFFSET = 4;   // char name[10]
export const MODEL_NAME_LENGTH = 10;
export const MODEL_ID_OFFSET = 14;    // uint8_t modelId (bits 0-4) + flags (5-7)

// Timers: 3 timers de 16 bytes cada uno
export const TIMER_OFFSET = 15;       // Offset del primer timer
export const TIMER_SIZE = 16;
export const MAX_TIMERS = 3;
// Timer layout (16 bytes):
//   +0-3: uint32 packed (mode:9 + start:23)
//   +4-7: uint32 packed (value:24 + countdownBeep:2 + minuteBeep:1 + persistent:2 + spare:3)
//   +8-15: char name[8]

// Mixes: 64 mixes de 20 bytes cada uno
export const MIX_OFFSET = 67;         // 0x43 = primer MixData
export const MIX_SIZE = 20;
export const MAX_MIXES = 64;
// MixData layout (20 bytes):
//   +0: int8_t weight
//   +1: uint8_t (destCh:5 << 3 | mltpx:2 | mixWarn:1)
//   +2: uint8_t srcRaw
//   +3: int8_t offset
//   +4: int8_t swtch
//   +5: uint8_t curveType
//   +6: int8_t curveValue
//   +7: uint8_t delayUp
//   +8: uint8_t delayDown
//   +9: uint8_t speedUp
//   +10: uint8_t speedDown
//   +11-12: uint16_t flightModes
//   +13: uint8_t carryTrim/spare
//   +14-19: char name[6]

// Secciones después de los mixes (offsets aproximados)
export const AFTER_MIX_OFFSET = MIX_OFFSET + MAX_MIXES * MIX_SIZE; // 0x543

// --- Source (srcRaw) numbering para FreedomTX/OpenTX 2.3 con LUA ---
// Basado en análisis empírico del Tango 2
export const MIXSRC = {
  NONE: 0,
  FIRST_INPUT: 1,       // Input 1 (I1)
  LAST_INPUT: 32,        // Input 32 (I32)
  FIRST_LUA: 33,         // LUA output 1
  LAST_LUA: 74,          // LUA output 42
  MAX: 75,               // MAX source (always 100%)
  CYC1: 76, CYC2: 77, CYC3: 78,
  // Sticks (RETA internal order)
  STICK_RUD: 79,
  STICK_ELE: 80,
  STICK_THR: 81,
  STICK_AIL: 82,
  // Pots (scroll wheels on Tango 2)
  POT_S1: 83,
  POT_S2: 84,
  // Trims
  TRIM_RUD: 85,
  TRIM_ELE: 86,
  TRIM_THR: 87,
  TRIM_AIL: 88,
  // Switches
  SW_SA: 89,
  SW_SB: 90,
  SW_SC: 91,
  SW_SD: 92,
  SW_SE: 93,
  SW_SF: 94,
  // Channel outputs
  FIRST_CH: 95,          // Ch1
  // Ch1=95, Ch2=96, ..., Ch32=126
} as const;

// Mapeo legible de srcRaw a nombre
export function srcRawToName(src: number): string {
  if (src === 0) return 'None';
  if (src >= MIXSRC.FIRST_INPUT && src <= MIXSRC.LAST_INPUT) return `I${src - MIXSRC.FIRST_INPUT + 1}`;
  if (src >= MIXSRC.FIRST_LUA && src <= MIXSRC.LAST_LUA) return `Lua${src - MIXSRC.FIRST_LUA + 1}`;
  if (src === MIXSRC.MAX) return 'MAX';
  if (src >= MIXSRC.CYC1 && src <= MIXSRC.CYC3) return `CYC${src - MIXSRC.CYC1 + 1}`;
  if (src === MIXSRC.STICK_RUD) return 'Rud';
  if (src === MIXSRC.STICK_ELE) return 'Ele';
  if (src === MIXSRC.STICK_THR) return 'Thr';
  if (src === MIXSRC.STICK_AIL) return 'Ail';
  if (src === MIXSRC.POT_S1) return 'S1';
  if (src === MIXSRC.POT_S2) return 'S2';
  if (src === MIXSRC.TRIM_RUD) return 'TrmR';
  if (src === MIXSRC.TRIM_ELE) return 'TrmE';
  if (src === MIXSRC.TRIM_THR) return 'TrmT';
  if (src === MIXSRC.TRIM_AIL) return 'TrmA';
  if (src === MIXSRC.SW_SA) return 'SA';
  if (src === MIXSRC.SW_SB) return 'SB';
  if (src === MIXSRC.SW_SC) return 'SC';
  if (src === MIXSRC.SW_SD) return 'SD';
  if (src === MIXSRC.SW_SE) return 'SE';
  if (src === MIXSRC.SW_SF) return 'SF';
  if (src >= MIXSRC.FIRST_CH && src < MIXSRC.FIRST_CH + 32) return `Ch${src - MIXSRC.FIRST_CH + 1}`;
  return `src(${src})`;
}

// Mapeo de nombre a srcRaw
export function nameToSrcRaw(name: string): number | null {
  const n = name.trim();
  const upper = n.toUpperCase();

  // Inputs
  const inputMatch = n.match(/^I(\d+)$/i);
  if (inputMatch) return MIXSRC.FIRST_INPUT + parseInt(inputMatch[1]) - 1;

  // Sticks
  if (upper === 'RUD' || upper === 'RUDDER') return MIXSRC.STICK_RUD;
  if (upper === 'ELE' || upper === 'ELEVATOR') return MIXSRC.STICK_ELE;
  if (upper === 'THR' || upper === 'THROTTLE') return MIXSRC.STICK_THR;
  if (upper === 'AIL' || upper === 'AILERON') return MIXSRC.STICK_AIL;

  // Pots
  if (upper === 'S1') return MIXSRC.POT_S1;
  if (upper === 'S2') return MIXSRC.POT_S2;

  // Trims
  if (upper === 'TRMR') return MIXSRC.TRIM_RUD;
  if (upper === 'TRME') return MIXSRC.TRIM_ELE;
  if (upper === 'TRMT') return MIXSRC.TRIM_THR;
  if (upper === 'TRMA') return MIXSRC.TRIM_AIL;

  // Switches
  if (upper === 'SA') return MIXSRC.SW_SA;
  if (upper === 'SB') return MIXSRC.SW_SB;
  if (upper === 'SC') return MIXSRC.SW_SC;
  if (upper === 'SD') return MIXSRC.SW_SD;
  if (upper === 'SE') return MIXSRC.SW_SE;
  if (upper === 'SF') return MIXSRC.SW_SF;

  // MAX
  if (upper === 'MAX') return MIXSRC.MAX;

  // Channel outputs
  const chMatch = n.match(/^Ch(\d+)$/i);
  if (chMatch) return MIXSRC.FIRST_CH + parseInt(chMatch[1]) - 1;

  return null;
}

// --- Interfaces para datos parseados ---
export interface FTXMixData {
  weight: number;
  destCh: number;        // 0-indexed
  srcRaw: number;
  srcName: string;       // Nombre legible
  mltpx: number;         // 0=add, 1=multiply, 2=replace
  mixWarn: number;
  offset: number;
  swtch: number;
  curveType: number;
  curveValue: number;
  delayUp: number;
  delayDown: number;
  speedUp: number;
  speedDown: number;
  flightModes: number;
  carryTrim: number;
  name: string;
}

export interface FTXTimerData {
  mode: number;
  start: number;         // segundos
  value: number;
  countdownBeep: number;
  minuteBeep: boolean;
  persistent: number;
  name: string;
}

export interface FTXModelSummary {
  fileName: string;
  filePath: string;
  name: string;
  modelId: number;
  mixes: FTXMixData[];
  timers: FTXTimerData[];
  mixCount: number;
  channelCount: number;
}

// ============================================================
// Clase principal: FTXModelFile
// Wrappea un Buffer y proporciona acceso tipado a los campos
// ============================================================

export class FTXModelFile {
  readonly buffer: Buffer;
  readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;

    if (!fs.existsSync(filePath)) {
      throw new Error(`Archivo no encontrado: ${filePath}`);
    }

    this.buffer = fs.readFileSync(filePath);

    // Verificar fourcc
    if (this.buffer.length < FOURCC_SIZE) {
      throw new Error(`Archivo demasiado pequeño: ${filePath}`);
    }

    const fourcc = this.buffer.subarray(0, 4).toString('ascii');
    if (fourcc !== 'otx5') {
      throw new Error(`Formato inválido (esperado "otx5", encontrado "${fourcc}"): ${filePath}`);
    }
  }

  // --- Model Name ---
  getModelName(): string {
    const nameBytes = this.buffer.subarray(MODEL_NAME_OFFSET, MODEL_NAME_OFFSET + MODEL_NAME_LENGTH);
    // Check each byte is printable ASCII (0x20-0x7E) before converting
    const chars: string[] = [];
    for (let i = 0; i < nameBytes.length; i++) {
      const b = nameBytes[i];
      if (b === 0) break; // null terminator
      if (b >= 0x20 && b <= 0x7E) {
        chars.push(String.fromCharCode(b));
      } else {
        // Non-printable byte found — name is not valid ASCII, use filename
        return path.basename(this.filePath, '.bin');
      }
    }
    const name = chars.join('').trim();
    if (name.length > 0) return name;
    return path.basename(this.filePath, '.bin');
  }

  setModelName(name: string): void {
    const validated = validateAsciiName(name, MODEL_NAME_LENGTH, 'model name');
    const nameBytes = Buffer.alloc(MODEL_NAME_LENGTH, 0);
    nameBytes.write(validated, 'ascii');
    nameBytes.copy(this.buffer, MODEL_NAME_OFFSET);
  }

  // --- Model ID ---
  getModelId(): number {
    return this.buffer.readUInt8(MODEL_ID_OFFSET) & 0x1F;
  }

  setModelId(id: number): void {
    const current = this.buffer.readUInt8(MODEL_ID_OFFSET);
    this.buffer.writeUInt8((current & 0xE0) | (id & 0x1F), MODEL_ID_OFFSET);
  }

  // --- Timers ---
  getTimer(index: number): FTXTimerData {
    if (index < 0 || index >= MAX_TIMERS) throw new Error(`Timer index ${index} fuera de rango (0-${MAX_TIMERS - 1})`);

    const off = TIMER_OFFSET + index * TIMER_SIZE;
    const word0 = this.buffer.readUInt32LE(off);
    const word1 = this.buffer.readUInt32LE(off + 4);

    let mode = word0 & 0x1FF; // 9 bits
    if (mode >= 256) mode -= 512; // sign extend
    const start = (word0 >>> 9) & 0x7FFFFF; // 23 bits

    let value = word1 & 0xFFFFFF; // 24 bits
    if (value >= 0x800000) value -= 0x1000000; // sign extend
    const countdownBeep = (word1 >>> 24) & 0x03;
    const minuteBeep = !!((word1 >>> 26) & 0x01);
    const persistent = (word1 >>> 27) & 0x03;

    const nameBytes = this.buffer.subarray(off + 8, off + 16);
    const name = decodeAsciiSafe(nameBytes);

    return { mode, start, value, countdownBeep, minuteBeep, persistent, name };
  }

  setTimer(index: number, timer: Partial<FTXTimerData>): void {
    if (index < 0 || index >= MAX_TIMERS) throw new Error(`Timer index ${index} fuera de rango`);

    const off = TIMER_OFFSET + index * TIMER_SIZE;
    const current = this.getTimer(index);
    const merged = { ...current, ...timer };

    // Pack word0: mode(9) + start(23)
    const mode9 = merged.mode & 0x1FF;
    const start23 = merged.start & 0x7FFFFF;
    this.buffer.writeUInt32LE((start23 << 9) | mode9, off);

    // Pack word1: value(24) + countdownBeep(2) + minuteBeep(1) + persistent(2) + spare(3)
    const val24 = merged.value & 0xFFFFFF;
    const cb2 = (merged.countdownBeep & 0x03) << 24;
    const mb1 = (merged.minuteBeep ? 1 : 0) << 26;
    const pers2 = (merged.persistent & 0x03) << 27;
    this.buffer.writeUInt32LE(val24 | cb2 | mb1 | pers2, off + 4);

    // Name (8 bytes)
    if (timer.name !== undefined) {
      const validated = validateAsciiName(merged.name, 8, 'timer name');
      const nameBytes = Buffer.alloc(8, 0);
      nameBytes.write(validated, 'ascii');
      nameBytes.copy(this.buffer, off + 8);
    }
  }

  // --- Mixes ---
  getMix(index: number): FTXMixData | null {
    if (index < 0 || index >= MAX_MIXES) return null;

    const off = MIX_OFFSET + index * MIX_SIZE;
    const weight = this.buffer.readInt8(off);

    if (weight === 0) {
      // Verificar si hay otros datos (un mix podría tener weight=0 intencionalmente)
      const hasData = this.buffer.subarray(off, off + MIX_SIZE).some(b => b !== 0);
      if (!hasData) return null;
    }

    const packed = this.buffer.readUInt8(off + 1);
    const destCh = (packed >> 3) & 0x1F;
    const mltpx = (packed >> 1) & 0x03;
    const mixWarn = packed & 0x01;

    const srcRaw = this.buffer.readUInt8(off + 2);
    const offset = this.buffer.readInt8(off + 3);
    const swtch = this.buffer.readInt8(off + 4);
    const curveType = this.buffer.readUInt8(off + 5);
    const curveValue = this.buffer.readInt8(off + 6);
    const delayUp = this.buffer.readUInt8(off + 7);
    const delayDown = this.buffer.readUInt8(off + 8);
    const speedUp = this.buffer.readUInt8(off + 9);
    const speedDown = this.buffer.readUInt8(off + 10);
    const flightModes = this.buffer.readUInt16LE(off + 11);
    const carryTrim = this.buffer.readUInt8(off + 13);
    const nameBytes = this.buffer.subarray(off + 14, off + 20);
    const name = decodeAsciiSafe(nameBytes);

    return {
      weight, destCh, srcRaw,
      srcName: srcRawToName(srcRaw),
      mltpx, mixWarn, offset, swtch,
      curveType, curveValue,
      delayUp, delayDown, speedUp, speedDown,
      flightModes, carryTrim, name,
    };
  }

  getAllMixes(): FTXMixData[] {
    const mixes: FTXMixData[] = [];
    for (let i = 0; i < MAX_MIXES; i++) {
      const mix = this.getMix(i);
      if (mix) mixes.push(mix);
    }
    return mixes;
  }

  getMixesForChannel(ch: number): FTXMixData[] {
    return this.getAllMixes().filter(m => m.destCh === ch);
  }

  /**
   * Escribe un mix en un slot específico
   */
  setMix(index: number, mix: Partial<FTXMixData>): void {
    if (index < 0 || index >= MAX_MIXES) throw new Error(`Mix index ${index} fuera de rango`);

    const off = MIX_OFFSET + index * MIX_SIZE;

    if (mix.weight !== undefined) this.buffer.writeInt8(mix.weight, off);

    if (mix.destCh !== undefined || mix.mltpx !== undefined || mix.mixWarn !== undefined) {
      const current = this.getMix(index);
      const destCh = mix.destCh ?? current?.destCh ?? 0;
      const mltpx = mix.mltpx ?? current?.mltpx ?? 0;
      const mixWarn = mix.mixWarn ?? current?.mixWarn ?? 0;
      this.buffer.writeUInt8(((destCh & 0x1F) << 3) | ((mltpx & 0x03) << 1) | (mixWarn & 0x01), off + 1);
    }

    if (mix.srcRaw !== undefined) this.buffer.writeUInt8(mix.srcRaw, off + 2);
    if (mix.offset !== undefined) this.buffer.writeInt8(mix.offset, off + 3);
    if (mix.swtch !== undefined) this.buffer.writeInt8(mix.swtch, off + 4);
    if (mix.curveType !== undefined) this.buffer.writeUInt8(mix.curveType, off + 5);
    if (mix.curveValue !== undefined) this.buffer.writeInt8(mix.curveValue, off + 6);
    if (mix.delayUp !== undefined) this.buffer.writeUInt8(mix.delayUp, off + 7);
    if (mix.delayDown !== undefined) this.buffer.writeUInt8(mix.delayDown, off + 8);
    if (mix.speedUp !== undefined) this.buffer.writeUInt8(mix.speedUp, off + 9);
    if (mix.speedDown !== undefined) this.buffer.writeUInt8(mix.speedDown, off + 10);
    if (mix.flightModes !== undefined) this.buffer.writeUInt16LE(mix.flightModes, off + 11);
    if (mix.carryTrim !== undefined) this.buffer.writeUInt8(mix.carryTrim, off + 13);

    if (mix.name !== undefined) {
      const validated = validateAsciiName(mix.name, 6, 'mix name');
      const nameBytes = Buffer.alloc(6, 0);
      nameBytes.write(validated, 'ascii');
      nameBytes.copy(this.buffer, off + 14);
    }
  }

  /**
   * Encuentra el primer slot de mix libre
   */
  findFreeMixSlot(): number {
    for (let i = 0; i < MAX_MIXES; i++) {
      if (!this.getMix(i)) return i;
    }
    return -1;
  }

  /**
   * Encuentra el primer slot de mix libre DESPUÉS de los mixes del canal dado
   * Para insertar en orden
   */
  findMixSlotForChannel(destCh: number): number {
    let lastForChannel = -1;
    for (let i = 0; i < MAX_MIXES; i++) {
      const mix = this.getMix(i);
      if (!mix) {
        // Slot libre - si ya pasamos el canal, este es bueno
        if (lastForChannel >= 0) return i;
        // Si no hemos visto ningún mix del canal, buscar el punto de inserción
        return i;
      }
      if (mix.destCh === destCh) lastForChannel = i;
      if (mix.destCh > destCh && lastForChannel < 0) return i;
    }
    return lastForChannel >= 0 ? lastForChannel + 1 : this.findFreeMixSlot();
  }

  /**
   * Limpia un slot de mix (pone a cero)
   */
  clearMix(index: number): void {
    if (index < 0 || index >= MAX_MIXES) return;
    const off = MIX_OFFSET + index * MIX_SIZE;
    this.buffer.fill(0, off, off + MIX_SIZE);
  }

  // --- Guardar ---
  save(targetPath?: string): void {
    fs.writeFileSync(targetPath || this.filePath, this.buffer);
  }

  // --- Resumen ---
  getSummary(): FTXModelSummary {
    const mixes = this.getAllMixes();
    const channels = new Set(mixes.map(m => m.destCh));
    const timers: FTXTimerData[] = [];
    for (let i = 0; i < MAX_TIMERS; i++) {
      timers.push(this.getTimer(i));
    }

    return {
      fileName: path.basename(this.filePath),
      filePath: this.filePath,
      name: this.getModelName(),
      modelId: this.getModelId(),
      mixes,
      timers,
      mixCount: mixes.length,
      channelCount: channels.size,
    };
  }

  // --- Dump raw de una sección ---
  dumpRaw(offset: number, length: number): string {
    if (offset < 0 || offset >= this.buffer.length) {
      throw new Error(`Offset ${offset} fuera de rango (archivo tiene ${this.buffer.length} bytes).`);
    }
    if (offset + length > this.buffer.length) {
      throw new Error(`Lectura de ${length} bytes desde offset ${offset} excede el tamaño del archivo (${this.buffer.length} bytes).`);
    }
    const bytes = this.buffer.subarray(offset, offset + length);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
  }
}

// ============================================================
// Funciones de utilidad para trabajar con archivos del radio
// ============================================================

/**
 * Lista todos los archivos de modelo .bin en un directorio
 */
export function listBinModels(modelsDir: string): FTXModelSummary[] {
  if (!fs.existsSync(modelsDir)) {
    throw new Error(`Directorio de modelos no encontrado: ${modelsDir}`);
  }

  const files = fs.readdirSync(modelsDir)
    .filter(f => f.endsWith('.bin') && f.startsWith('model'))
    .sort();

  const summaries: FTXModelSummary[] = [];

  for (const file of files) {
    const filePath = path.join(modelsDir, file);
    try {
      const model = new FTXModelFile(filePath);
      summaries.push(model.getSummary());
    } catch (err) {
      console.error(`Error parsing model ${file}: ${(err as Error).message}`);
      summaries.push({
        fileName: file,
        filePath,
        name: `[ERROR] ${file}`,
        modelId: 0,
        mixes: [],
        timers: [],
        mixCount: 0,
        channelCount: 0,
      });
    }
  }

  return summaries;
}

/**
 * Encuentra un modelo por nombre (busca en model name o filename)
 */
export function findBinModel(modelsDir: string, name: string): FTXModelFile | null {
  const files = fs.readdirSync(modelsDir)
    .filter(f => f.endsWith('.bin') && f.startsWith('model'));

  const nameLower = name.toLowerCase().trim();

  // Búsqueda exacta primero
  for (const file of files) {
    const filePath = path.join(modelsDir, file);
    try {
      const model = new FTXModelFile(filePath);
      const modelName = model.getModelName().toLowerCase().trim();
      const fileName = file.replace('.bin', '').toLowerCase();

      if (modelName === nameLower || fileName === nameLower) return model;
    } catch (err) { console.error(`Error reading model ${file}: ${(err as Error).message}`); continue; }
  }

  // Búsqueda parcial
  for (const file of files) {
    const filePath = path.join(modelsDir, file);
    try {
      const model = new FTXModelFile(filePath);
      const modelName = model.getModelName().toLowerCase();
      const fileName = file.replace('.bin', '').toLowerCase();

      if (modelName.includes(nameLower) || fileName.includes(nameLower)) return model;
    } catch (err) { console.error(`Error reading model ${file}: ${(err as Error).message}`); continue; }
  }

  return null;
}

/**
 * Crea un nuevo archivo de modelo con la estructura base
 */
export function createEmptyModel(filePath: string, name: string, modelId: number = 0): FTXModelFile {
  const buf = Buffer.alloc(MODEL_FILE_SIZE, 0);

  // Fourcc
  OTX5_FOURCC.copy(buf, 0);

  // Model name
  const validatedName = validateAsciiName(name, MODEL_NAME_LENGTH, 'model name');
  buf.write(validatedName, MODEL_NAME_OFFSET, 'ascii');

  // Model ID
  buf.writeUInt8(modelId & 0x1F, MODEL_ID_OFFSET);

  fs.writeFileSync(filePath, buf);
  return new FTXModelFile(filePath);
}

/**
 * Obtiene el siguiente nombre de archivo disponible para un nuevo modelo
 */
export function getNextBinModelFileName(modelsDir: string): string {
  const existing = fs.readdirSync(modelsDir)
    .filter(f => /^model\d+\.bin$/i.test(f))
    .map(f => {
      const match = f.match(/model(\d+)/i);
      return match ? parseInt(match[1], 10) : 0;
    })
    .sort((a, b) => a - b);

  const nextNum = existing.length > 0 ? existing[existing.length - 1] + 1 : 1;
  return `model${nextNum}.bin`;
}
