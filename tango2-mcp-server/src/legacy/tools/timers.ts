// ============================================================
// Tool: set_timer
// Configuración de timers en modelos EdgeTX
// ============================================================

import { getModelsPath } from './detect.js';
import { findModelByName, writeModelFile } from '../parsers/edgetx-yaml.js';
import { backupFile } from './backup.js';
import type { TimerData, TimerMode } from '../types/edgetx.js';

export interface SetTimerParams {
  modelName: string;
  timerNumber: number;      // 1-indexed (Timer 1, Timer 2, Timer 3)
  mode: TimerMode;
  switch?: string;          // Switch que activa/controla el timer
  value: number;            // Valor en segundos
  countdownBeep?: 'silent' | 'beeps' | 'voice' | 'haptic';
  minuteBeep?: boolean;
  persistent?: boolean;
  name?: string;
}

const VALID_MODES: TimerMode[] = ['off', 'on', 'strt', 'thrs', 'th%', 'thst'];

export function setTimer(params: SetTimerParams): { message: string; timer: TimerData } {
  const {
    modelName,
    timerNumber,
    mode,
    value,
    countdownBeep,
    minuteBeep,
    persistent,
    name,
  } = params;

  // Validar número de timer
  if (timerNumber < 1 || timerNumber > 3) {
    throw new Error(`Número de timer inválido: ${timerNumber}. EdgeTX soporta Timer 1, 2 y 3.`);
  }

  // Validar modo
  if (!VALID_MODES.includes(mode)) {
    throw new Error(
      `Modo de timer inválido: "${mode}". Modos válidos: ${VALID_MODES.join(', ')}.\n` +
      '  - off: Desactivado\n' +
      '  - on: Siempre activo\n' +
      '  - strt: Cuenta desde el inicio\n' +
      '  - thrs: Activo cuando el throttle no está en mínimo\n' +
      '  - th%: Porcentaje de throttle\n' +
      '  - thst: Throttle start'
    );
  }

  // Validar valor
  if (value < 0 || value > 35999) { // Máximo ~10 horas
    throw new Error(`Valor de timer inválido: ${value}. Debe ser entre 0 y 35999 segundos.`);
  }

  const modelsPath = getModelsPath();
  const found = findModelByName(modelsPath, modelName);
  if (!found) {
    throw new Error(`Modelo "${modelName}" no encontrado.`);
  }

  backupFile(found.filePath);

  const model = found.model;
  if (!model.timers) model.timers = [];

  const timer: TimerData = {
    mode,
    start: value,
    switch: params.switch,
    countdownBeep: countdownBeep || 'beeps',
    minuteBeep: minuteBeep ?? true,
    persistent: persistent ?? false,
    name: name || `Timer ${timerNumber}`,
  };

  const idx = timerNumber - 1;

  // Expandir array si es necesario
  while (model.timers.length <= idx) {
    model.timers.push({
      mode: 'off',
      start: 0,
      countdownBeep: 'silent',
      minuteBeep: false,
      persistent: false,
      name: `Timer ${model.timers.length + 1}`,
    });
  }

  model.timers[idx] = timer;

  writeModelFile(found.filePath, model);

  const mins = Math.floor(value / 60);
  const secs = value % 60;
  const timeStr = `${mins}:${String(secs).padStart(2, '0')}`;

  return {
    message: `Timer ${timerNumber} configurado en modelo "${modelName}": ${timeStr} (${mode})${params.switch ? ` activado por ${params.switch}` : ''}.`,
    timer,
  };
}
