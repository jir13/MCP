import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  FTXModelFile,
  createEmptyModel,
  listBinModels,
  findBinModel,
  MIXSRC,
} from '../src/parsers/freedomtx-bin.js';

/**
 * Integration test: simulates a full radio workflow
 * 1. Create a temp "radio" directory structure
 * 2. Create a model from scratch
 * 3. Configure mixes (AETR + AUX)
 * 4. Set timers
 * 5. Backup to a separate directory
 * 6. Modify the original
 * 7. Restore from backup
 * 8. Verify data integrity
 */
describe('Full radio workflow integration', () => {
  let radioDir: string;
  let modelsDir: string;
  let backupDir: string;

  beforeEach(() => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'radio-integration-'));
    radioDir = base;
    modelsDir = path.join(base, 'MODELS');
    backupDir = path.join(base, 'backups');
    fs.mkdirSync(modelsDir, { recursive: true });
    fs.mkdirSync(backupDir, { recursive: true });

    // Create a radio structure marker
    fs.mkdirSync(path.join(base, 'RADIO'), { recursive: true });
    fs.writeFileSync(path.join(base, 'RADIO', 'radio.bin'), Buffer.alloc(100));
  });

  afterEach(() => {
    fs.rmSync(radioDir, { recursive: true, force: true });
  });

  it('should complete full create → configure → backup → modify → restore → verify cycle', () => {
    // Step 1: Create model
    const filePath = path.join(modelsDir, 'model1.bin');
    const model = createEmptyModel(filePath, 'Chimera7');
    expect(model.getModelName()).toBe('Chimera7');

    // Step 2: Configure AETR mixes
    model.setMix(0, { weight: 100, destCh: 0, srcRaw: 1, name: 'Ail' });     // CH1 = I1
    model.setMix(1, { weight: 100, destCh: 1, srcRaw: 2, name: 'Ele' });     // CH2 = I2
    model.setMix(2, { weight: 100, destCh: 2, srcRaw: 3, name: 'Thr' });     // CH3 = I3
    model.setMix(3, { weight: 100, destCh: 3, srcRaw: 4, name: 'Rud' });     // CH4 = I4

    // AUX channels
    model.setMix(4, { weight: 100, destCh: 4, srcRaw: MIXSRC.SW_SA, name: 'Arm' });
    model.setMix(5, { weight: 100, destCh: 5, srcRaw: MIXSRC.SW_SB, name: 'FltMod' });
    model.setMix(6, { weight: 100, destCh: 6, srcRaw: MIXSRC.SW_SC, name: 'Beep' });
    model.setMix(7, { weight: 100, destCh: 7, srcRaw: MIXSRC.SW_SD, name: 'GPS' });

    // Step 3: Set timers
    model.setTimer(0, { mode: 3, start: 600, name: 'Flight' }); // 10 min throttle
    model.setTimer(1, { mode: 1, start: 0, name: 'Total' });    // Count-up

    // Step 4: Save to disk
    model.save();

    // Step 5: Verify listing works
    const models = listBinModels(modelsDir);
    expect(models).toHaveLength(1);
    expect(models[0].name).toBe('Chimera7');
    expect(models[0].mixCount).toBe(8);
    expect(models[0].channelCount).toBe(8);

    // Step 6: Backup
    const backupPath = path.join(backupDir, 'model1_backup.bin');
    model.save(backupPath);
    expect(fs.existsSync(backupPath)).toBe(true);

    // Step 7: Modify original (simulate bad change)
    model.setModelName('BROKEN');
    model.setMix(4, { weight: 50, srcRaw: MIXSRC.SW_SF, name: 'Bad' }); // Wrong arm switch!
    model.setTimer(0, { start: 30 }); // Too short
    model.save();

    // Verify changes took effect
    const modified = new FTXModelFile(filePath);
    expect(modified.getModelName()).toBe('BROKEN');
    expect(modified.getMix(4)!.srcRaw).toBe(MIXSRC.SW_SF);
    expect(modified.getTimer(0).start).toBe(30);

    // Step 8: Restore from backup
    fs.copyFileSync(backupPath, filePath);
    const restored = new FTXModelFile(filePath);

    // Step 9: Verify full data integrity
    expect(restored.getModelName()).toBe('Chimera7');

    // Check all 8 mixes
    const mixes = restored.getAllMixes();
    expect(mixes).toHaveLength(8);
    expect(mixes[0].srcName).toBe('I1');
    expect(mixes[0].name).toBe('Ail');
    expect(mixes[4].srcRaw).toBe(MIXSRC.SW_SA);
    expect(mixes[4].name).toBe('Arm');
    expect(mixes[7].srcRaw).toBe(MIXSRC.SW_SD);
    expect(mixes[7].name).toBe('GPS');

    // Check timers
    expect(restored.getTimer(0).mode).toBe(3);
    expect(restored.getTimer(0).start).toBe(600);
    expect(restored.getTimer(0).name).toBe('Flight');
    expect(restored.getTimer(1).mode).toBe(1);
    expect(restored.getTimer(1).name).toBe('Total');

    // Check summary
    const summary = restored.getSummary();
    expect(summary.mixCount).toBe(8);
    expect(summary.channelCount).toBe(8);
  });

  it('should handle find by name across multiple models', () => {
    createEmptyModel(path.join(modelsDir, 'model1.bin'), 'Chimera7');
    createEmptyModel(path.join(modelsDir, 'model2.bin'), 'Evoque F6');
    createEmptyModel(path.join(modelsDir, 'model3.bin'), 'Whoop65');

    const found1 = findBinModel(modelsDir, 'chimera');
    expect(found1).not.toBeNull();
    expect(found1!.getModelName()).toBe('Chimera7');

    const found2 = findBinModel(modelsDir, 'evoque');
    expect(found2).not.toBeNull();
    expect(found2!.getModelName()).toBe('Evoque F6');

    const notFound = findBinModel(modelsDir, 'nonexistent');
    expect(notFound).toBeNull();
  });

  it('should preserve byte-level integrity through save/load cycles', () => {
    const filePath = path.join(modelsDir, 'model1.bin');
    const model = createEmptyModel(filePath, 'ByteTest');

    // Configure then save
    model.setMix(0, { weight: 100, destCh: 0, srcRaw: MIXSRC.STICK_AIL });
    model.setTimer(0, { mode: 3, start: 300, name: 'T1' });
    model.save();

    // Read the raw bytes
    const rawBytes1 = fs.readFileSync(filePath);

    // Load, don't modify, save again
    const reloaded = new FTXModelFile(filePath);
    reloaded.save();

    // Compare byte-for-byte
    const rawBytes2 = fs.readFileSync(filePath);
    expect(Buffer.compare(rawBytes1, rawBytes2)).toBe(0);
  });
});
