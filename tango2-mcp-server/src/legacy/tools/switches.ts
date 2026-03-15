// ============================================================
// Tools: assign_switch, set_logical_switch
// Gestión de switches en modelos EdgeTX
// ============================================================

import { getModelsPath } from './detect.js';
import { findModelByName, writeModelFile } from '../parsers/edgetx-yaml.js';
import { backupFile } from './backup.js';
import { TANGO2_SWITCHES, BETAFLIGHT_MODES, auxToChannel } from '../types/edgetx.js';
import type { LogicalSwitch, LogicalSwitchFunction, SwitchId, MixData } from '../types/edgetx.js';

export interface AssignSwitchParams {
  modelName: string;
  channel: number;          // Canal AUX (1-indexed: CH5=5, CH6=6, etc.) o AUX number
  switch_id: string;        // Switch físico (ej: "SA", "SB", "SC")
  position?: string;        // Posición del switch (ej: "up", "mid", "down")
  modeName?: string;        // Nombre del modo (ej: "Launch Control")
}

/**
 * Asigna un switch a un canal AUX para activar un modo de vuelo
 */
export function assignSwitch(params: AssignSwitchParams): { message: string; mix: MixData } {
  const { modelName, switch_id, modeName } = params;
  let { channel } = params;

  // Si el canal es menor a 5, asumimos que es número de AUX
  if (channel < 5) {
    channel = auxToChannel(channel);
  }

  if (channel < 5 || channel > 16) {
    throw new Error(`Canal inválido: ${channel}. Los canales AUX son del CH5 al CH16.`);
  }

  // Validar switch
  const upperSwitch = switch_id.toUpperCase() as SwitchId;
  const switchInfo = TANGO2_SWITCHES[upperSwitch];
  if (!switchInfo) {
    throw new Error(`Switch inválido: ${switch_id}. Los switches válidos son: SA, SB, SC, SD, SE, SF.`);
  }
  if (!switchInfo.available) {
    console.error(`Advertencia: ${upperSwitch} podría no estar disponible en el Tango 2.`);
  }

  const modelsPath = getModelsPath();
  const found = findModelByName(modelsPath, modelName);
  if (!found) {
    throw new Error(`Modelo "${modelName}" no encontrado.`);
  }

  backupFile(found.filePath);

  const model = found.model;
  if (!model.mixData) model.mixData = [];

  const destCh = channel - 1; // 0-indexed

  // Construir la referencia del switch con posición
  let switchRef: string = upperSwitch;
  if (params.position) {
    const posMap: Record<string, string> = {
      'up': '↑', 'mid': '-', 'down': '↓',
      '!up': '!↑', '!mid': '!-', '!down': '!↓',
    };
    const suffix = posMap[params.position.toLowerCase()];
    if (suffix) {
      switchRef = `${upperSwitch}${suffix}`;
    }
  }

  const mix: MixData = {
    destCh,
    srcRaw: upperSwitch,
    weight: 100,
    name: modeName || `AUX${channel - 4}`,
  };

  // Buscar mix existente en el canal
  const existingIdx = model.mixData.findIndex(m => m.destCh === destCh);

  if (existingIdx >= 0) {
    model.mixData[existingIdx] = { ...model.mixData[existingIdx], ...mix };
  } else {
    const insertIdx = model.mixData.findIndex(m => m.destCh > destCh);
    if (insertIdx === -1) {
      model.mixData.push(mix);
    } else {
      model.mixData.splice(insertIdx, 0, mix);
    }
  }

  // Asegurar que exista el límite del canal
  if (!model.limitData) model.limitData = [];
  while (model.limitData.length <= destCh) {
    model.limitData.push({ min: -100, max: 100, name: `CH${model.limitData.length + 1}` });
  }
  model.limitData[destCh].name = modeName || `AUX${channel - 4}`;

  writeModelFile(found.filePath, model);

  return {
    message: `Switch ${upperSwitch} asignado a CH${channel} (AUX${channel - 4}) del modelo "${modelName}"${modeName ? ` para "${modeName}"` : ''}.`,
    mix,
  };
}

/**
 * Muestra los switches que están libres (no asignados a ningún canal AUX)
 */
export function getFreeSwitches(modelName: string): { free: string[]; used: Array<{ switch_id: string; channel: number; name: string }> } {
  const modelsPath = getModelsPath();
  const found = findModelByName(modelsPath, modelName);
  if (!found) {
    throw new Error(`Modelo "${modelName}" no encontrado.`);
  }

  const usedSwitches: Array<{ switch_id: string; channel: number; name: string }> = [];
  const usedIds = new Set<string>();

  for (const mix of (found.model.mixData || [])) {
    if (mix.destCh >= 4) { // Solo canales AUX
      const src = mix.srcRaw.replace(/[↑↓\-!]/g, '').toUpperCase();
      if (src.match(/^S[A-H]$/)) {
        usedSwitches.push({
          switch_id: src,
          channel: mix.destCh + 1,
          name: mix.name || `CH${mix.destCh + 1}`,
        });
        usedIds.add(src);
      }
    }
  }

  const free: string[] = [];
  for (const [id, info] of Object.entries(TANGO2_SWITCHES)) {
    if (info.available && !usedIds.has(id)) {
      free.push(`${id} (${info.positions} posiciones)`);
    }
  }

  return { free, used: usedSwitches };
}

export interface SetLogicalSwitchParams {
  modelName: string;
  function_type: LogicalSwitchFunction;
  v1: string | number;
  v2: string | number;
  andSwitch?: string;
  delay?: number;
  duration?: number;
  name?: string;
  slotNumber?: number;      // Slot específico (1-indexed), o se usa el primer slot libre
}

/**
 * Configura un switch lógico
 */
export function setLogicalSwitch(params: SetLogicalSwitchParams): { message: string; slot: number; ls: LogicalSwitch } {
  const { modelName, function_type, v1, v2, andSwitch, delay, duration, name } = params;

  const validFunctions: LogicalSwitchFunction[] = [
    'a>x', 'a<x', 'a>b', '|a|>x', '|a|<x',
    'AND', 'OR', 'XOR', 'a=x', 'a~x',
    'Timer', 'Sticky', 'Edge',
  ];

  if (!validFunctions.includes(function_type)) {
    throw new Error(`Función inválida: ${function_type}. Funciones válidas: ${validFunctions.join(', ')}`);
  }

  const modelsPath = getModelsPath();
  const found = findModelByName(modelsPath, modelName);
  if (!found) {
    throw new Error(`Modelo "${modelName}" no encontrado.`);
  }

  backupFile(found.filePath);

  const model = found.model;
  if (!model.logicalSw) model.logicalSw = [];

  const ls: LogicalSwitch = {
    func: function_type,
    v1,
    v2,
    andSwitch,
    delay,
    duration,
    name,
  };

  let slot: number;

  if (params.slotNumber !== undefined) {
    slot = params.slotNumber - 1; // Convertir a 0-indexed
    if (slot < 0 || slot >= 64) {
      throw new Error(`Slot inválido: ${params.slotNumber}. Debe ser entre 1 y 64.`);
    }
    // Expandir array si es necesario
    while (model.logicalSw.length <= slot) {
      model.logicalSw.push({ func: '' as LogicalSwitchFunction, v1: 0, v2: 0 });
    }
    model.logicalSw[slot] = ls;
  } else {
    // Buscar primer slot libre
    const emptyIdx = model.logicalSw.findIndex(l => !l.func || l.func === ('' as LogicalSwitchFunction));
    if (emptyIdx >= 0) {
      model.logicalSw[emptyIdx] = ls;
      slot = emptyIdx;
    } else {
      model.logicalSw.push(ls);
      slot = model.logicalSw.length - 1;
    }
  }

  writeModelFile(found.filePath, model);

  return {
    message: `Switch lógico L${slot + 1} configurado en modelo "${modelName}": ${function_type}(${v1}, ${v2}).`,
    slot: slot + 1,
    ls,
  };
}

/**
 * Sugiere la configuración de switch para un modo de Betaflight
 */
export function suggestSwitchForMode(mode: string): { suggestion: string; details: typeof BETAFLIGHT_MODES[string] | null } {
  const modeUpper = mode.toUpperCase().replace(/\s+/g, '_');
  const modeInfo = BETAFLIGHT_MODES[modeUpper];

  if (modeInfo) {
    return {
      suggestion: `Para "${mode}": Usar AUX${modeInfo.auxChannel} (CH${modeInfo.auxChannel + 4}) con rango ${modeInfo.range[0]}-${modeInfo.range[1]}. ${modeInfo.description}`,
      details: modeInfo,
    };
  }

  return {
    suggestion: `Modo "${mode}" no encontrado en la base de datos. Los modos conocidos son: ${Object.keys(BETAFLIGHT_MODES).join(', ')}`,
    details: null,
  };
}
