import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  FTXModelFile,
  createEmptyModel,
  listBinModels,
  findBinModel,
  getNextBinModelFileName,
  srcRawToName,
  nameToSrcRaw,
  MIXSRC,
  MODEL_FILE_SIZE,
  OTX5_FOURCC,
} from '../src/parsers/freedomtx-bin.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ftx-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ========================================
// FTXModelFile constructor
// ========================================
describe('FTXModelFile constructor', () => {
  it('should open a valid otx5 file', () => {
    const filePath = path.join(tmpDir, 'model1.bin');
    createEmptyModel(filePath, 'TestModel');
    const model = new FTXModelFile(filePath);
    expect(model.buffer.length).toBe(MODEL_FILE_SIZE);
  });

  it('should reject a file with wrong fourcc', () => {
    const filePath = path.join(tmpDir, 'bad.bin');
    const buf = Buffer.alloc(MODEL_FILE_SIZE, 0);
    buf.write('NOPE', 0, 'ascii');
    fs.writeFileSync(filePath, buf);
    expect(() => new FTXModelFile(filePath)).toThrow('Formato inválido');
  });

  it('should reject a file that is too small', () => {
    const filePath = path.join(tmpDir, 'tiny.bin');
    fs.writeFileSync(filePath, Buffer.from([1, 2]));
    expect(() => new FTXModelFile(filePath)).toThrow('demasiado pequeño');
  });

  it('should reject a nonexistent file', () => {
    expect(() => new FTXModelFile('/tmp/does-not-exist-99999.bin')).toThrow('no encontrado');
  });
});

// ========================================
// Model Name get/set
// ========================================
describe('Model Name', () => {
  it('should roundtrip a simple ASCII name', () => {
    const filePath = path.join(tmpDir, 'model1.bin');
    const model = createEmptyModel(filePath, 'Chimera7');
    expect(model.getModelName()).toBe('Chimera7');
  });

  it('should truncate names longer than 10 chars', () => {
    const filePath = path.join(tmpDir, 'model1.bin');
    const model = createEmptyModel(filePath, 'VeryLongNameHere');
    expect(model.getModelName()).toBe('VeryLongNa');
  });

  it('should update name via setModelName', () => {
    const filePath = path.join(tmpDir, 'model1.bin');
    const model = createEmptyModel(filePath, 'Old');
    model.setModelName('New');
    expect(model.getModelName()).toBe('New');
  });

  it('should reject non-ASCII characters in setModelName', () => {
    const filePath = path.join(tmpDir, 'model1.bin');
    const model = createEmptyModel(filePath, 'Test');
    expect(() => model.setModelName('Ñoño')).toThrow('Carácter inválido');
  });

  it('should fall back to filename for default (non-ASCII) model names', () => {
    const filePath = path.join(tmpDir, 'model5.bin');
    const buf = Buffer.alloc(MODEL_FILE_SIZE, 0);
    OTX5_FOURCC.copy(buf, 0);
    // Write non-printable bytes in name area
    buf[4] = 0xFF;
    buf[5] = 0x80;
    fs.writeFileSync(filePath, buf);
    const model = new FTXModelFile(filePath);
    expect(model.getModelName()).toBe('model5');
  });
});

// ========================================
// Timers get/set
// ========================================
describe('Timers', () => {
  it('should default to zeroed timers', () => {
    const filePath = path.join(tmpDir, 'model1.bin');
    const model = createEmptyModel(filePath, 'T');
    const timer = model.getTimer(0);
    expect(timer.start).toBe(0);
    expect(timer.mode).toBe(0);
    expect(timer.name).toBe('');
  });

  it('should set and get timer values', () => {
    const filePath = path.join(tmpDir, 'model1.bin');
    const model = createEmptyModel(filePath, 'T');
    model.setTimer(0, { mode: 3, start: 300, name: 'Vuelo' });
    const timer = model.getTimer(0);
    expect(timer.mode).toBe(3);
    expect(timer.start).toBe(300);
    expect(timer.name).toBe('Vuelo');
  });

  it('should handle all 3 timers independently', () => {
    const filePath = path.join(tmpDir, 'model1.bin');
    const model = createEmptyModel(filePath, 'T');
    model.setTimer(0, { start: 100, name: 'T1' });
    model.setTimer(1, { start: 200, name: 'T2' });
    model.setTimer(2, { start: 300, name: 'T3' });
    expect(model.getTimer(0).start).toBe(100);
    expect(model.getTimer(1).start).toBe(200);
    expect(model.getTimer(2).start).toBe(300);
  });

  it('should reject out-of-range timer index', () => {
    const filePath = path.join(tmpDir, 'model1.bin');
    const model = createEmptyModel(filePath, 'T');
    expect(() => model.getTimer(3)).toThrow('fuera de rango');
    expect(() => model.getTimer(-1)).toThrow('fuera de rango');
  });

  it('should reject non-ASCII timer names', () => {
    const filePath = path.join(tmpDir, 'model1.bin');
    const model = createEmptyModel(filePath, 'T');
    expect(() => model.setTimer(0, { name: 'Señal' })).toThrow('Carácter inválido');
  });

  it('should preserve existing timer fields on partial update', () => {
    const filePath = path.join(tmpDir, 'model1.bin');
    const model = createEmptyModel(filePath, 'T');
    model.setTimer(0, { mode: 3, start: 300, name: 'Vuelo' });
    model.setTimer(0, { start: 600 }); // Only update start
    const timer = model.getTimer(0);
    expect(timer.mode).toBe(3);
    expect(timer.start).toBe(600);
    expect(timer.name).toBe('Vuelo');
  });
});

// ========================================
// Mixes get/set
// ========================================
describe('Mixes', () => {
  it('should return null for empty mix slots', () => {
    const filePath = path.join(tmpDir, 'model1.bin');
    const model = createEmptyModel(filePath, 'T');
    expect(model.getMix(0)).toBeNull();
  });

  it('should set and get a mix', () => {
    const filePath = path.join(tmpDir, 'model1.bin');
    const model = createEmptyModel(filePath, 'T');
    model.setMix(0, { weight: 100, destCh: 0, srcRaw: MIXSRC.STICK_AIL, name: 'Ail' });
    const mix = model.getMix(0);
    expect(mix).not.toBeNull();
    expect(mix!.weight).toBe(100);
    expect(mix!.destCh).toBe(0);
    expect(mix!.srcRaw).toBe(MIXSRC.STICK_AIL);
    expect(mix!.srcName).toBe('Ail');
    expect(mix!.name).toBe('Ail');
  });

  it('should handle negative weights', () => {
    const filePath = path.join(tmpDir, 'model1.bin');
    const model = createEmptyModel(filePath, 'T');
    model.setMix(0, { weight: -75, destCh: 0, srcRaw: 1 });
    expect(model.getMix(0)!.weight).toBe(-75);
  });

  it('should clear a mix slot', () => {
    const filePath = path.join(tmpDir, 'model1.bin');
    const model = createEmptyModel(filePath, 'T');
    model.setMix(0, { weight: 100, destCh: 0, srcRaw: 1, name: 'Test' });
    model.clearMix(0);
    expect(model.getMix(0)).toBeNull();
  });

  it('should get all active mixes', () => {
    const filePath = path.join(tmpDir, 'model1.bin');
    const model = createEmptyModel(filePath, 'T');
    model.setMix(0, { weight: 100, destCh: 0, srcRaw: MIXSRC.STICK_AIL });
    model.setMix(1, { weight: 100, destCh: 1, srcRaw: MIXSRC.STICK_ELE });
    model.setMix(2, { weight: 100, destCh: 2, srcRaw: MIXSRC.STICK_THR });
    model.setMix(3, { weight: 100, destCh: 3, srcRaw: MIXSRC.STICK_RUD });
    expect(model.getAllMixes()).toHaveLength(4);
  });

  it('should reject non-ASCII mix names', () => {
    const filePath = path.join(tmpDir, 'model1.bin');
    const model = createEmptyModel(filePath, 'T');
    expect(() => model.setMix(0, { name: 'Módulo' })).toThrow('Carácter inválido');
  });

  it('should reject out-of-range mix index', () => {
    const filePath = path.join(tmpDir, 'model1.bin');
    const model = createEmptyModel(filePath, 'T');
    expect(() => model.setMix(64, { weight: 100 })).toThrow('fuera de rango');
    expect(() => model.setMix(-1, { weight: 100 })).toThrow('fuera de rango');
  });
});

// ========================================
// srcRawToName / nameToSrcRaw roundtrips
// ========================================
describe('Source name mapping', () => {
  const roundtripCases: [string, number][] = [
    ['Ail', MIXSRC.STICK_AIL],
    ['Ele', MIXSRC.STICK_ELE],
    ['Thr', MIXSRC.STICK_THR],
    ['Rud', MIXSRC.STICK_RUD],
    ['SA', MIXSRC.SW_SA],
    ['SB', MIXSRC.SW_SB],
    ['SC', MIXSRC.SW_SC],
    ['SD', MIXSRC.SW_SD],
    ['SE', MIXSRC.SW_SE],
    ['SF', MIXSRC.SW_SF],
    ['S1', MIXSRC.POT_S1],
    ['S2', MIXSRC.POT_S2],
    ['MAX', MIXSRC.MAX],
    ['I1', MIXSRC.FIRST_INPUT],
    ['I32', MIXSRC.LAST_INPUT],
    ['Ch1', MIXSRC.FIRST_CH],
  ];

  for (const [name, srcRaw] of roundtripCases) {
    it(`srcRawToName(${srcRaw}) === "${name}"`, () => {
      expect(srcRawToName(srcRaw)).toBe(name);
    });

    it(`nameToSrcRaw("${name}") === ${srcRaw}`, () => {
      expect(nameToSrcRaw(name)).toBe(srcRaw);
    });
  }

  it('should return null for unknown names', () => {
    expect(nameToSrcRaw('BOGUS')).toBeNull();
  });

  it('should handle case-insensitive lookups', () => {
    expect(nameToSrcRaw('sa')).toBe(MIXSRC.SW_SA);
    expect(nameToSrcRaw('ail')).toBe(MIXSRC.STICK_AIL);
    expect(nameToSrcRaw('max')).toBe(MIXSRC.MAX);
  });
});

// ========================================
// dumpRaw bounds checking
// ========================================
describe('dumpRaw', () => {
  it('should dump hex bytes correctly', () => {
    const filePath = path.join(tmpDir, 'model1.bin');
    const model = createEmptyModel(filePath, 'Test');
    const hex = model.dumpRaw(0, 4);
    expect(hex).toBe('6f 74 78 35'); // "otx5"
  });

  it('should reject offset beyond file size', () => {
    const filePath = path.join(tmpDir, 'model1.bin');
    const model = createEmptyModel(filePath, 'T');
    expect(() => model.dumpRaw(99999, 1)).toThrow('fuera de rango');
  });

  it('should reject read that exceeds file size', () => {
    const filePath = path.join(tmpDir, 'model1.bin');
    const model = createEmptyModel(filePath, 'T');
    expect(() => model.dumpRaw(MODEL_FILE_SIZE - 5, 10)).toThrow('excede');
  });

  it('should reject negative offset', () => {
    const filePath = path.join(tmpDir, 'model1.bin');
    const model = createEmptyModel(filePath, 'T');
    expect(() => model.dumpRaw(-1, 4)).toThrow('fuera de rango');
  });
});

// ========================================
// Save / persistence
// ========================================
describe('save', () => {
  it('should persist changes to disk', () => {
    const filePath = path.join(tmpDir, 'model1.bin');
    const model = createEmptyModel(filePath, 'Before');
    model.setModelName('After');
    model.save();

    const reloaded = new FTXModelFile(filePath);
    expect(reloaded.getModelName()).toBe('After');
  });

  it('should save to a different path', () => {
    const filePath = path.join(tmpDir, 'model1.bin');
    const copyPath = path.join(tmpDir, 'copy.bin');
    const model = createEmptyModel(filePath, 'Original');
    model.save(copyPath);

    const copy = new FTXModelFile(copyPath);
    expect(copy.getModelName()).toBe('Original');
  });
});

// ========================================
// Utility functions
// ========================================
describe('listBinModels', () => {
  it('should list all model files', () => {
    createEmptyModel(path.join(tmpDir, 'model1.bin'), 'Alpha');
    createEmptyModel(path.join(tmpDir, 'model2.bin'), 'Beta');
    const models = listBinModels(tmpDir);
    expect(models).toHaveLength(2);
    expect(models[0].name).toBe('Alpha');
    expect(models[1].name).toBe('Beta');
  });

  it('should ignore non-model files', () => {
    createEmptyModel(path.join(tmpDir, 'model1.bin'), 'A');
    fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'hi');
    fs.writeFileSync(path.join(tmpDir, 'radio.bin'), 'data');
    expect(listBinModels(tmpDir)).toHaveLength(1);
  });

  it('should throw for missing directory', () => {
    expect(() => listBinModels('/nonexistent-dir-999')).toThrow('no encontrado');
  });
});

describe('findBinModel', () => {
  it('should find by exact name', () => {
    createEmptyModel(path.join(tmpDir, 'model1.bin'), 'Chimera');
    const found = findBinModel(tmpDir, 'Chimera');
    expect(found).not.toBeNull();
    expect(found!.getModelName()).toBe('Chimera');
  });

  it('should find by partial name', () => {
    createEmptyModel(path.join(tmpDir, 'model1.bin'), 'Chimera7');
    const found = findBinModel(tmpDir, 'chimera');
    expect(found).not.toBeNull();
  });

  it('should find by filename', () => {
    createEmptyModel(path.join(tmpDir, 'model1.bin'), 'MyDrone');
    const found = findBinModel(tmpDir, 'model1');
    expect(found).not.toBeNull();
  });

  it('should return null if not found', () => {
    createEmptyModel(path.join(tmpDir, 'model1.bin'), 'Alpha');
    expect(findBinModel(tmpDir, 'NonExistent')).toBeNull();
  });
});

describe('getNextBinModelFileName', () => {
  it('should return model1.bin for empty dir', () => {
    expect(getNextBinModelFileName(tmpDir)).toBe('model1.bin');
  });

  it('should return next available number', () => {
    createEmptyModel(path.join(tmpDir, 'model1.bin'), 'A');
    createEmptyModel(path.join(tmpDir, 'model2.bin'), 'B');
    expect(getNextBinModelFileName(tmpDir)).toBe('model3.bin');
  });
});

// ========================================
// getSummary
// ========================================
describe('getSummary', () => {
  it('should return complete summary', () => {
    const filePath = path.join(tmpDir, 'model1.bin');
    const model = createEmptyModel(filePath, 'Summary');
    model.setMix(0, { weight: 100, destCh: 0, srcRaw: MIXSRC.STICK_AIL, name: 'Ail' });
    model.setMix(1, { weight: 100, destCh: 1, srcRaw: MIXSRC.STICK_ELE, name: 'Ele' });
    model.setTimer(0, { mode: 3, start: 300, name: 'Flight' });

    const summary = model.getSummary();
    expect(summary.name).toBe('Summary');
    expect(summary.mixCount).toBe(2);
    expect(summary.channelCount).toBe(2);
    expect(summary.timers).toHaveLength(3);
    expect(summary.timers[0].start).toBe(300);
  });
});
