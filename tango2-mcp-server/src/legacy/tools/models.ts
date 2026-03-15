// ============================================================
// Tools: list_models, read_model, create_model,
//        compare_models, export_model_summary
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { getModelsPath } from './detect.js';
import {
  listModelFiles,
  findModelByName,
  readModelFile,
  writeModelFile,
  getNextModelFileName,
} from '../parsers/edgetx-yaml.js';
import { backupFile } from './backup.js';
import { createFreestyleTemplate } from '../templates/freestyle.js';
import { createLongRangeTemplate } from '../templates/longrange.js';
import { createCinematicTemplate } from '../templates/cinematic.js';
import type { EdgeTXModel, ModelComparison, ComparisonDiff } from '../types/edgetx.js';

/**
 * Lista todos los modelos en el radio
 */
export function listModels(): ReturnType<typeof listModelFiles> {
  const modelsPath = getModelsPath();
  return listModelFiles(modelsPath);
}

/**
 * Lee la configuración completa de un modelo
 */
export function readModel(modelName: string): { model: EdgeTXModel; filePath: string } {
  const modelsPath = getModelsPath();
  const found = findModelByName(modelsPath, modelName);

  if (!found) {
    throw new Error(
      `Modelo "${modelName}" no encontrado. Usá list_models para ver los modelos disponibles.`
    );
  }

  return { model: found.model, filePath: found.filePath };
}

/**
 * Crea un nuevo modelo, opcionalmente basado en un template
 */
export function createModel(
  modelName: string,
  template?: 'freestyle_5inch' | 'long_range_7inch' | 'cinematic'
): { filePath: string; message: string } {
  const modelsPath = getModelsPath();

  // Verificar que no exista ya un modelo con ese nombre
  const existing = findModelByName(modelsPath, modelName);
  if (existing) {
    throw new Error(`Ya existe un modelo con el nombre "${modelName}".`);
  }

  let model: EdgeTXModel;

  switch (template) {
    case 'freestyle_5inch':
      model = createFreestyleTemplate(modelName);
      break;
    case 'long_range_7inch':
      model = createLongRangeTemplate(modelName);
      break;
    case 'cinematic':
      model = createCinematicTemplate(modelName);
      break;
    default:
      // Modelo vacío base
      model = {
        header: { name: modelName, modelId: 0 },
        timers: [],
        mixData: [],
        expoData: [],
        limitData: Array.from({ length: 8 }, (_, i) => ({
          min: -100,
          max: 100,
          name: `CH${i + 1}`,
        })),
        logicalSw: [],
        curves: [],
        telemetrySensors: [],
        specialFunctions: [],
      };
  }

  const fileName = getNextModelFileName(modelsPath);
  const filePath = path.join(modelsPath, fileName);

  writeModelFile(filePath, model);

  const templateMsg = template ? ` basado en template "${template}"` : '';

  return {
    filePath,
    message: `Modelo "${modelName}" creado exitosamente${templateMsg} en ${fileName}.`,
  };
}

/**
 * Compara dos modelos y muestra diferencias
 */
export function compareModels(modelA: string, modelB: string): ModelComparison {
  const modelsPath = getModelsPath();

  const foundA = findModelByName(modelsPath, modelA);
  const foundB = findModelByName(modelsPath, modelB);

  if (!foundA) throw new Error(`Modelo "${modelA}" no encontrado.`);
  if (!foundB) throw new Error(`Modelo "${modelB}" no encontrado.`);

  const diffs: ComparisonDiff[] = [];

  // Comparar inputs
  const inputsA = foundA.model.expoData || [];
  const inputsB = foundB.model.expoData || [];
  if (inputsA.length !== inputsB.length) {
    diffs.push({
      section: 'Inputs',
      field: 'cantidad',
      valueA: inputsA.length,
      valueB: inputsB.length,
      description: `${modelA} tiene ${inputsA.length} inputs, ${modelB} tiene ${inputsB.length}`,
    });
  }
  const maxInputs = Math.max(inputsA.length, inputsB.length);
  for (let i = 0; i < maxInputs; i++) {
    const ia = inputsA[i];
    const ib = inputsB[i];
    if (!ia || !ib) continue;

    if (ia.weight !== ib.weight) {
      diffs.push({
        section: 'Inputs',
        field: `Input ${i} (${ia.name || ''}) weight`,
        valueA: ia.weight,
        valueB: ib.weight,
        description: `Peso del input ${i}: ${ia.weight} vs ${ib.weight}`,
      });
    }
    if (ia.curve?.value !== ib.curve?.value) {
      diffs.push({
        section: 'Inputs',
        field: `Input ${i} (${ia.name || ''}) expo`,
        valueA: ia.curve?.value,
        valueB: ib.curve?.value,
        description: `Expo del input ${i}: ${ia.curve?.value ?? 'sin curva'} vs ${ib.curve?.value ?? 'sin curva'}`,
      });
    }
  }

  // Comparar mixes
  const mixesA = foundA.model.mixData || [];
  const mixesB = foundB.model.mixData || [];
  if (mixesA.length !== mixesB.length) {
    diffs.push({
      section: 'Mixes',
      field: 'cantidad',
      valueA: mixesA.length,
      valueB: mixesB.length,
      description: `${modelA} tiene ${mixesA.length} mixes, ${modelB} tiene ${mixesB.length}`,
    });
  }

  // Comparar por canal destino
  const mixesByCh = (mixes: typeof mixesA) => {
    const map = new Map<number, typeof mixesA>();
    for (const m of mixes) {
      const existing = map.get(m.destCh) || [];
      existing.push(m);
      map.set(m.destCh, existing);
    }
    return map;
  };

  const chMixA = mixesByCh(mixesA);
  const chMixB = mixesByCh(mixesB);

  const allChannels = new Set([...chMixA.keys(), ...chMixB.keys()]);
  for (const ch of allChannels) {
    const aList = chMixA.get(ch) || [];
    const bList = chMixB.get(ch) || [];

    if (aList.length !== bList.length) {
      diffs.push({
        section: 'Mixes',
        field: `CH${ch + 1} cantidad de mixes`,
        valueA: aList.length,
        valueB: bList.length,
        description: `CH${ch + 1}: ${aList.length} mixes en ${modelA}, ${bList.length} en ${modelB}`,
      });
    }

    for (let i = 0; i < Math.min(aList.length, bList.length); i++) {
      if (aList[i].srcRaw !== bList[i].srcRaw) {
        diffs.push({
          section: 'Mixes',
          field: `CH${ch + 1} mix ${i} fuente`,
          valueA: aList[i].srcRaw,
          valueB: bList[i].srcRaw,
          description: `CH${ch + 1} mix ${i}: fuente "${aList[i].srcRaw}" vs "${bList[i].srcRaw}"`,
        });
      }
      if (aList[i].switch !== bList[i].switch) {
        diffs.push({
          section: 'Mixes',
          field: `CH${ch + 1} mix ${i} switch`,
          valueA: aList[i].switch || 'ninguno',
          valueB: bList[i].switch || 'ninguno',
          description: `CH${ch + 1} mix ${i}: switch "${aList[i].switch || 'ninguno'}" vs "${bList[i].switch || 'ninguno'}"`,
        });
      }
    }
  }

  // Comparar timers
  const timersA = foundA.model.timers || [];
  const timersB = foundB.model.timers || [];
  if (timersA.length !== timersB.length) {
    diffs.push({
      section: 'Timers',
      field: 'cantidad',
      valueA: timersA.length,
      valueB: timersB.length,
      description: `${modelA} tiene ${timersA.length} timers, ${modelB} tiene ${timersB.length}`,
    });
  }
  for (let i = 0; i < Math.min(timersA.length, timersB.length); i++) {
    if (timersA[i].start !== timersB[i].start) {
      diffs.push({
        section: 'Timers',
        field: `Timer ${i + 1} valor`,
        valueA: `${timersA[i].start}s`,
        valueB: `${timersB[i].start}s`,
        description: `Timer ${i + 1}: ${timersA[i].start}s vs ${timersB[i].start}s`,
      });
    }
  }

  // Comparar limits
  const limitsA = foundA.model.limitData || [];
  const limitsB = foundB.model.limitData || [];
  if (limitsA.length !== limitsB.length) {
    diffs.push({
      section: 'Outputs',
      field: 'cantidad de canales',
      valueA: limitsA.length,
      valueB: limitsB.length,
      description: `${modelA} tiene ${limitsA.length} canales, ${modelB} tiene ${limitsB.length}`,
    });
  }

  const summary = diffs.length === 0
    ? `Los modelos "${modelA}" y "${modelB}" son idénticos en configuración.`
    : `Se encontraron ${diffs.length} diferencias entre "${modelA}" y "${modelB}".`;

  return { modelA, modelB, differences: diffs, summary };
}

/**
 * Exporta un resumen legible del modelo en formato Markdown
 */
export function exportModelSummary(modelName: string): string {
  const { model } = readModel(modelName);
  const lines: string[] = [];

  lines.push(`# Modelo: ${model.header.name}`);
  lines.push('');

  // Timers
  if (model.timers && model.timers.length > 0) {
    lines.push('## Timers');
    for (const [i, timer] of model.timers.entries()) {
      const mins = Math.floor(timer.start / 60);
      const secs = timer.start % 60;
      lines.push(`- **Timer ${i + 1}** (${timer.name || ''}): ${mins}:${String(secs).padStart(2, '0')} | Modo: ${timer.mode} | Switch: ${timer.switch || 'N/A'}`);
    }
    lines.push('');
  }

  // Inputs
  if (model.expoData && model.expoData.length > 0) {
    lines.push('## Inputs (Expo/Rates)');
    lines.push('| # | Nombre | Fuente | Peso | Expo | Switch |');
    lines.push('|---|--------|--------|------|------|--------|');
    for (const input of model.expoData) {
      const expo = input.curve?.type === 'expo' ? `${input.curve.value}%` : (input.curve ? 'curva' : '0%');
      lines.push(`| ${input.chn} | ${input.name || '-'} | ${input.srcRaw} | ${input.weight}% | ${expo} | ${input.switch || '-'} |`);
    }
    lines.push('');
  }

  // Mixes
  if (model.mixData && model.mixData.length > 0) {
    lines.push('## Mixes');
    lines.push('| Canal | Nombre | Fuente | Peso | Switch | Offset |');
    lines.push('|-------|--------|--------|------|--------|--------|');
    for (const mix of model.mixData) {
      lines.push(`| CH${mix.destCh + 1} | ${mix.name || '-'} | ${mix.srcRaw} | ${mix.weight}% | ${mix.switch || '-'} | ${mix.offset || 0} |`);
    }
    lines.push('');
  }

  // Outputs/Limits
  if (model.limitData && model.limitData.length > 0) {
    lines.push('## Canales de salida');
    lines.push('| Canal | Nombre | Min | Max | Invertido |');
    lines.push('|-------|--------|-----|-----|-----------|');
    for (const [i, limit] of model.limitData.entries()) {
      lines.push(`| CH${i + 1} | ${limit.name || '-'} | ${limit.min} | ${limit.max} | ${limit.revert ? 'Sí' : 'No'} |`);
    }
    lines.push('');
  }

  // Switches lógicos
  if (model.logicalSw && model.logicalSw.length > 0) {
    lines.push('## Switches Lógicos');
    for (const [i, ls] of model.logicalSw.entries()) {
      if (ls.func) {
        lines.push(`- **L${i + 1}**: ${ls.func} | V1: ${ls.v1} | V2: ${ls.v2} | AND: ${ls.andSwitch || '-'}`);
      }
    }
    lines.push('');
  }

  // Telemetría
  if (model.telemetrySensors && model.telemetrySensors.length > 0) {
    lines.push('## Sensores de Telemetría');
    for (const sensor of model.telemetrySensors) {
      lines.push(`- **${sensor.name}** (ID: ${sensor.id}) | Unidad: ${sensor.unit || '-'}`);
    }
    lines.push('');
  }

  // Resumen rápido de AUX channels
  const auxMixes = (model.mixData || []).filter(m => m.destCh >= 4);
  if (auxMixes.length > 0) {
    lines.push('## Asignación de canales AUX');
    for (const mix of auxMixes) {
      const auxNum = mix.destCh - 3;
      lines.push(`- **AUX${auxNum}** (CH${mix.destCh + 1}): ${mix.name || '-'} → ${mix.srcRaw}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
