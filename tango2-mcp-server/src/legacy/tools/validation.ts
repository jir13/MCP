// ============================================================
// Tool: validate_config
// Validación de configuración de modelos EdgeTX
// ============================================================

import { getModelsPath } from './detect.js';
import { findModelByName } from '../parsers/edgetx-yaml.js';
import { TANGO2_SWITCHES, MAX_CHANNELS } from '../types/edgetx.js';
import type { EdgeTXModel, SwitchId } from '../types/edgetx.js';

export interface ValidationResult {
  valid: boolean;
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
  info: ValidationMessage[];
}

export interface ValidationMessage {
  section: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

/**
 * Valida la configuración completa de un modelo
 */
export function validateConfig(modelName: string): ValidationResult {
  const modelsPath = getModelsPath();
  const found = findModelByName(modelsPath, modelName);

  if (!found) {
    throw new Error(`Modelo "${modelName}" no encontrado.`);
  }

  return validateModel(found.model);
}

export function validateModel(model: EdgeTXModel): ValidationResult {
  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];
  const info: ValidationMessage[] = [];

  // 1. Validar header
  if (!model.header?.name || model.header.name.trim() === '') {
    errors.push({ section: 'Header', message: 'El modelo no tiene nombre.', severity: 'error' });
  } else if (model.header.name.length > 15) {
    warnings.push({ section: 'Header', message: `Nombre del modelo muy largo (${model.header.name.length} chars). EdgeTX soporta máximo 15 caracteres.`, severity: 'warning' });
  }

  // 2. Validar mixes
  validateMixes(model, errors, warnings, info);

  // 3. Validar inputs
  validateInputs(model, errors, warnings, info);

  // 4. Validar outputs/límites
  validateLimits(model, errors, warnings, info);

  // 5. Validar timers
  validateTimers(model, errors, warnings, info);

  // 6. Validar switches lógicos
  validateLogicalSwitches(model, errors, warnings, info);

  // 7. Validaciones de seguridad FPV
  validateFPVSafety(model, errors, warnings, info);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    info,
  };
}

function validateMixes(model: EdgeTXModel, errors: ValidationMessage[], warnings: ValidationMessage[], info: ValidationMessage[]): void {
  const mixes = model.mixData || [];

  if (mixes.length === 0) {
    warnings.push({ section: 'Mixes', message: 'El modelo no tiene mixes configurados.', severity: 'warning' });
    return;
  }

  // Verificar que los canales básicos (AETR) tengan mixes
  const channelsWithMixes = new Set(mixes.map(m => m.destCh));
  for (let ch = 0; ch < 4; ch++) {
    if (!channelsWithMixes.has(ch)) {
      errors.push({ section: 'Mixes', message: `CH${ch + 1} (${['Ail', 'Ele', 'Thr', 'Rud'][ch]}) no tiene mix asignado.`, severity: 'error' });
    }
  }

  // Verificar pesos extremos
  for (const mix of mixes) {
    if (Math.abs(mix.weight) > 125) {
      warnings.push({ section: 'Mixes', message: `CH${mix.destCh + 1} (${mix.name || ''}): peso de ${mix.weight}% es muy alto.`, severity: 'warning' });
    }

    if (mix.destCh >= MAX_CHANNELS) {
      errors.push({ section: 'Mixes', message: `Mix apunta a canal ${mix.destCh + 1} que excede el máximo de ${MAX_CHANNELS}.`, severity: 'error' });
    }

    // Verificar switches válidos
    if (mix.switch) {
      validateSwitchRef(mix.switch, `Mix CH${mix.destCh + 1}`, warnings);
    }
  }

  info.push({ section: 'Mixes', message: `${mixes.length} mixes configurados en ${channelsWithMixes.size} canales.`, severity: 'info' });
}

function validateInputs(model: EdgeTXModel, errors: ValidationMessage[], warnings: ValidationMessage[], info: ValidationMessage[]): void {
  const inputs = model.expoData || [];

  if (inputs.length === 0) {
    warnings.push({ section: 'Inputs', message: 'El modelo no tiene inputs configurados. Los mixes usarán las fuentes directamente.', severity: 'warning' });
    return;
  }

  for (const input of inputs) {
    if (Math.abs(input.weight) > 100) {
      warnings.push({ section: 'Inputs', message: `Input ${input.chn} (${input.name || ''}): peso de ${input.weight}% fuera del rango normal.`, severity: 'warning' });
    }

    if (input.curve?.type === 'expo' && Math.abs(input.curve.value) > 100) {
      errors.push({ section: 'Inputs', message: `Input ${input.chn} (${input.name || ''}): expo de ${input.curve.value}% fuera de rango (-100 a 100).`, severity: 'error' });
    }

    if (input.switch) {
      validateSwitchRef(input.switch, `Input ${input.chn}`, warnings);
    }
  }

  info.push({ section: 'Inputs', message: `${inputs.length} inputs configurados.`, severity: 'info' });
}

function validateLimits(model: EdgeTXModel, errors: ValidationMessage[], warnings: ValidationMessage[], info: ValidationMessage[]): void {
  const limits = model.limitData || [];

  for (const [i, limit] of limits.entries()) {
    if (limit.min > 0) {
      warnings.push({ section: 'Outputs', message: `CH${i + 1}: límite mínimo positivo (${limit.min}). Esto puede causar comportamiento inesperado.`, severity: 'warning' });
    }
    if (limit.max < 0) {
      warnings.push({ section: 'Outputs', message: `CH${i + 1}: límite máximo negativo (${limit.max}). Esto puede causar comportamiento inesperado.`, severity: 'warning' });
    }
    if (limit.min > limit.max) {
      errors.push({ section: 'Outputs', message: `CH${i + 1}: límite mínimo (${limit.min}) es mayor que el máximo (${limit.max}).`, severity: 'error' });
    }
  }
}

function validateTimers(model: EdgeTXModel, errors: ValidationMessage[], warnings: ValidationMessage[], info: ValidationMessage[]): void {
  const timers = model.timers || [];

  for (const [i, timer] of timers.entries()) {
    if (timer.mode !== 'off' && timer.start === 0 && timer.mode !== 'on') {
      warnings.push({ section: 'Timers', message: `Timer ${i + 1}: valor es 0 con modo "${timer.mode}". ¿Es intencional?`, severity: 'warning' });
    }

    if (timer.switch) {
      validateSwitchRef(timer.switch, `Timer ${i + 1}`, warnings);
    }
  }
}

function validateLogicalSwitches(model: EdgeTXModel, errors: ValidationMessage[], warnings: ValidationMessage[], info: ValidationMessage[]): void {
  const lsArray = model.logicalSw || [];
  let activeCount = 0;

  for (const [i, ls] of lsArray.entries()) {
    if (!ls.func) continue;
    activeCount++;

    if (ls.andSwitch) {
      validateSwitchRef(ls.andSwitch, `Switch Lógico L${i + 1}`, warnings);
    }
  }

  if (activeCount > 0) {
    info.push({ section: 'Logical Switches', message: `${activeCount} switches lógicos activos.`, severity: 'info' });
  }
}

function validateFPVSafety(model: EdgeTXModel, errors: ValidationMessage[], warnings: ValidationMessage[], info: ValidationMessage[]): void {
  const mixes = model.mixData || [];

  // Verificar que hay un canal de ARM
  const armMix = mixes.find(m =>
    m.destCh >= 4 && (
      (m.name || '').toLowerCase().includes('arm') ||
      m.srcRaw === 'SA'
    )
  );

  if (!armMix) {
    warnings.push({
      section: 'Seguridad FPV',
      message: 'No se detectó un canal ARM. Es MUY recomendable tener un switch dedicado para armar/desarmar el quad.',
      severity: 'warning',
    });
  } else {
    info.push({
      section: 'Seguridad FPV',
      message: `Canal ARM detectado en CH${armMix.destCh + 1} (${armMix.srcRaw}).`,
      severity: 'info',
    });
  }

  // Verificar modo de vuelo
  const flightModeMix = mixes.find(m =>
    m.destCh >= 4 && (
      (m.name || '').toLowerCase().includes('flt') ||
      (m.name || '').toLowerCase().includes('mode') ||
      (m.name || '').toLowerCase().includes('angle')
    )
  );

  if (!flightModeMix) {
    info.push({
      section: 'Seguridad FPV',
      message: 'No se detectó un canal de modo de vuelo. Considerá agregar uno para cambiar entre Acro/Angle/Horizon.',
      severity: 'info',
    });
  }

  // Verificar que Throttle no está invertido
  const thrLimit = (model.limitData || [])[2]; // CH3 = Throttle en AETR
  if (thrLimit?.revert) {
    warnings.push({
      section: 'Seguridad FPV',
      message: 'Canal de Throttle (CH3) está invertido. Verificá que esto sea intencional.',
      severity: 'warning',
    });
  }
}

function validateSwitchRef(ref: string, context: string, warnings: ValidationMessage[]): void {
  // Extraer el ID del switch (ej: "SA↓" -> "SA")
  const switchId = ref.replace(/[↑↓\-!]/g, '').toUpperCase();
  if (switchId.match(/^S[A-H]$/)) {
    const sw = TANGO2_SWITCHES[switchId as SwitchId];
    if (sw && !sw.available) {
      warnings.push({
        section: 'Switches',
        message: `${context}: usa switch ${switchId} que podría no estar disponible en el Tango 2.`,
        severity: 'warning',
      });
    }
  }
}

/**
 * Genera un reporte de validación formateado
 */
export function formatValidationReport(result: ValidationResult): string {
  const lines: string[] = [];

  lines.push(result.valid ? '✅ La configuración es válida.' : '❌ Se encontraron errores en la configuración.');
  lines.push('');

  if (result.errors.length > 0) {
    lines.push(`### Errores (${result.errors.length})`);
    for (const err of result.errors) {
      lines.push(`- ❌ [${err.section}] ${err.message}`);
    }
    lines.push('');
  }

  if (result.warnings.length > 0) {
    lines.push(`### Advertencias (${result.warnings.length})`);
    for (const warn of result.warnings) {
      lines.push(`- ⚠️ [${warn.section}] ${warn.message}`);
    }
    lines.push('');
  }

  if (result.info.length > 0) {
    lines.push(`### Info`);
    for (const inf of result.info) {
      lines.push(`- ℹ️ [${inf.section}] ${inf.message}`);
    }
  }

  return lines.join('\n');
}
