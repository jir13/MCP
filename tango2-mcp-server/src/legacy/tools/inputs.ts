// ============================================================
// Tool: set_input
// Configuración de inputs (expo/rates) en modelos EdgeTX
// ============================================================

import { getModelsPath } from './detect.js';
import { findModelByName, writeModelFile } from '../parsers/edgetx-yaml.js';
import { backupFile } from './backup.js';
import type { InputData, CurveRef } from '../types/edgetx.js';

export interface SetInputParams {
  modelName: string;
  inputNumber: number;    // 0-indexed (Input 0 = primer input)
  source: string;         // Fuente (ej: "Ail", "Ele", "Thr", "Rud")
  weight: number;         // Rate/peso (-100 a 100)
  trim?: boolean;         // Usar trim
  curve?: string;         // Expo (ej: "expo:35")
  switch?: string;        // Switch condicional
  name?: string;          // Nombre del input
}

export function setInput(params: SetInputParams): { message: string; input: InputData } {
  const { modelName, inputNumber, source, weight, trim, name } = params;

  // Validar número de input
  if (inputNumber < 0 || inputNumber > 31) {
    throw new Error(`Número de input inválido: ${inputNumber}. Debe ser entre 0 y 31.`);
  }

  // Validar peso
  if (weight < -100 || weight > 100) {
    throw new Error(`Peso inválido: ${weight}. Debe ser entre -100 y 100.`);
  }

  // Validar fuente
  const validSources = ['Ail', 'Ele', 'Thr', 'Rud', 'SA', 'SB', 'SC', 'SD', 'SE', 'SF', 'S1', 'S2', 'LS', 'RS'];
  if (!validSources.includes(source)) {
    console.error(`Advertencia: Fuente "${source}" no es estándar. Las fuentes conocidas son: ${validSources.join(', ')}`);
  }

  const modelsPath = getModelsPath();
  const found = findModelByName(modelsPath, modelName);

  if (!found) {
    throw new Error(`Modelo "${modelName}" no encontrado.`);
  }

  // Backup antes de modificar
  backupFile(found.filePath);

  const model = found.model;
  if (!model.expoData) {
    model.expoData = [];
  }

  // Parsear curva
  let curveRef: CurveRef | undefined;
  if (params.curve) {
    curveRef = parseCurveParam(params.curve);
  }

  const input: InputData = {
    chn: inputNumber,
    srcRaw: source,
    weight,
    trim: trim ?? true,
    curve: curveRef,
    switch: params.switch,
    name: name || undefined,
  };

  // Buscar si ya existe un input con el mismo canal, fuente y switch
  const existingIdx = model.expoData.findIndex(
    e => e.chn === inputNumber && e.srcRaw === source && (e.switch || '') === (params.switch || '')
  );

  let action: string;
  if (existingIdx >= 0) {
    model.expoData[existingIdx] = { ...model.expoData[existingIdx], ...input };
    action = 'actualizado';
  } else {
    // Insertar ordenado por canal
    const insertIdx = model.expoData.findIndex(e => e.chn > inputNumber);
    if (insertIdx === -1) {
      model.expoData.push(input);
    } else {
      model.expoData.splice(insertIdx, 0, input);
    }
    action = 'agregado';
  }

  writeModelFile(found.filePath, model);

  const curveDesc = curveRef ? ` con expo ${curveRef.value}%` : '';

  return {
    message: `Input ${action} en Input ${inputNumber} del modelo "${modelName}": ${source} al ${weight}%${curveDesc}.`,
    input,
  };
}

function parseCurveParam(curveStr: string): CurveRef {
  const parts = curveStr.split(':');

  if (parts.length === 2) {
    const type = parts[0].toLowerCase();
    const value = parseInt(parts[1], 10);
    if (isNaN(value)) throw new Error(`Valor de curva inválido: ${parts[1]}`);
    if (type === 'expo') return { type: 'expo', value };
    if (type === 'curve') return { type: 'curve', value };
  }

  const num = parseInt(curveStr, 10);
  if (!isNaN(num)) return { type: 'expo', value: num };

  throw new Error(`Formato de curva inválido: "${curveStr}". Usá "expo:35" o "curve:1".`);
}
