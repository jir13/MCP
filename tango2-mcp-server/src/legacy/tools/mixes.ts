// ============================================================
// Tool: set_mix
// Configuración de mixes en modelos EdgeTX
// ============================================================

import { getModelsPath } from './detect.js';
import { findModelByName, writeModelFile } from '../parsers/edgetx-yaml.js';
import { backupFile } from './backup.js';
import type { MixData, CurveRef } from '../types/edgetx.js';

export interface SetMixParams {
  modelName: string;
  channel: number;        // 1-indexed (CH1 = 1)
  source: string;         // Fuente del mix (ej: "SA", "I[Ail]", "Thr")
  weight: number;         // Peso (-100 a 100)
  switch?: string;        // Switch condicional (ej: "SA↓")
  offset?: number;        // Offset
  curve?: string;         // Referencia a curva o expo (ej: "expo:30")
  name?: string;          // Nombre del mix
  multiplex?: 'add' | 'multiply' | 'replace';
}

export function setMix(params: SetMixParams): { message: string; mix: MixData } {
  const { modelName, channel, source, weight, offset, name, multiplex } = params;

  // Validar canal
  if (channel < 1 || channel > 16) {
    throw new Error(`Canal inválido: ${channel}. Debe ser entre 1 y 16.`);
  }

  // Validar peso
  if (weight < -150 || weight > 150) {
    throw new Error(`Peso inválido: ${weight}. Debe ser entre -150 y 150.`);
  }

  const modelsPath = getModelsPath();
  const found = findModelByName(modelsPath, modelName);

  if (!found) {
    throw new Error(`Modelo "${modelName}" no encontrado.`);
  }

  // Backup antes de modificar
  backupFile(found.filePath);

  const model = found.model;
  if (!model.mixData) {
    model.mixData = [];
  }

  // Parsear curva si se proporcionó
  let curveRef: CurveRef | undefined;
  if (params.curve) {
    curveRef = parseCurveParam(params.curve);
  }

  // Buscar mix existente en el canal con la misma fuente
  const destCh = channel - 1; // Convertir a 0-indexed
  const existingIdx = model.mixData.findIndex(
    m => m.destCh === destCh && m.srcRaw === source
  );

  const mix: MixData = {
    destCh,
    srcRaw: source,
    weight,
    offset: offset || 0,
    switch: params.switch,
    curve: curveRef,
    name: name || undefined,
    multiplex: multiplex || 'add',
  };

  let action: string;
  if (existingIdx >= 0) {
    // Actualizar mix existente
    model.mixData[existingIdx] = { ...model.mixData[existingIdx], ...mix };
    action = 'actualizado';
  } else {
    // Insertar en la posición correcta (ordenado por canal)
    const insertIdx = model.mixData.findIndex(m => m.destCh > destCh);
    if (insertIdx === -1) {
      model.mixData.push(mix);
    } else {
      model.mixData.splice(insertIdx, 0, mix);
    }
    action = 'agregado';
  }

  // Asegurar que exista el límite del canal
  if (!model.limitData) {
    model.limitData = [];
  }
  while (model.limitData.length <= destCh) {
    model.limitData.push({ min: -100, max: 100, name: `CH${model.limitData.length + 1}` });
  }

  writeModelFile(found.filePath, model);

  return {
    message: `Mix ${action} en CH${channel} del modelo "${modelName}": ${source} con peso ${weight}%.`,
    mix,
  };
}

/**
 * Elimina un mix de un canal
 */
export function removeMix(modelName: string, channel: number, source?: string): { message: string } {
  const modelsPath = getModelsPath();
  const found = findModelByName(modelsPath, modelName);

  if (!found) {
    throw new Error(`Modelo "${modelName}" no encontrado.`);
  }

  backupFile(found.filePath);

  const model = found.model;
  const destCh = channel - 1;

  if (!model.mixData) {
    throw new Error(`El modelo no tiene mixes configurados.`);
  }

  const before = model.mixData.length;

  if (source) {
    model.mixData = model.mixData.filter(m => !(m.destCh === destCh && m.srcRaw === source));
  } else {
    model.mixData = model.mixData.filter(m => m.destCh !== destCh);
  }

  const removed = before - model.mixData.length;
  if (removed === 0) {
    throw new Error(`No se encontró ningún mix en CH${channel}${source ? ` con fuente "${source}"` : ''}.`);
  }

  writeModelFile(found.filePath, model);

  return {
    message: `Se eliminaron ${removed} mix(es) de CH${channel} del modelo "${modelName}".`,
  };
}

function parseCurveParam(curveStr: string): CurveRef {
  // Formato: "expo:30" o "curve:1" o número directo
  const parts = curveStr.split(':');

  if (parts.length === 2) {
    const type = parts[0].toLowerCase();
    const value = parseInt(parts[1], 10);

    if (isNaN(value)) {
      throw new Error(`Valor de curva inválido: ${parts[1]}`);
    }

    if (type === 'expo') {
      return { type: 'expo', value };
    } else if (type === 'curve') {
      return { type: 'curve', value };
    }
  }

  // Intentar como número directo (expo)
  const num = parseInt(curveStr, 10);
  if (!isNaN(num)) {
    return { type: 'expo', value: num };
  }

  throw new Error(`Formato de curva inválido: "${curveStr}". Usá "expo:30" o "curve:1".`);
}
