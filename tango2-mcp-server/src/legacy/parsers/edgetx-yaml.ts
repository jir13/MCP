// ============================================================
// Parser YAML para archivos de configuración EdgeTX
// Maneja lectura y escritura segura de modelos y radio config
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import * as YAML from 'yaml';
import type { EdgeTXModel, RadioConfig, ModelSummary } from '../types/edgetx.js';

/**
 * Lee y parsea un archivo YAML de modelo EdgeTX
 */
export function readModelFile(filePath: string): EdgeTXModel {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Archivo de modelo no encontrado: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');

  try {
    const parsed = YAML.parse(content);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('El archivo YAML está vacío o no es un objeto válido');
    }
    return normalizeModel(parsed);
  } catch (err) {
    if (err instanceof YAML.YAMLError) {
      throw new Error(`Error de sintaxis YAML en ${filePath}: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Lee la configuración global del radio (radio.yml)
 */
export function readRadioConfig(filePath: string): RadioConfig {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Archivo de configuración del radio no encontrado: ${filePath}`);
  }

  const content = fs.readFileSync(filePath, 'utf-8');

  try {
    const parsed = YAML.parse(content);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('El archivo radio.yml está vacío o no es válido');
    }
    return parsed as RadioConfig;
  } catch (err) {
    if (err instanceof YAML.YAMLError) {
      throw new Error(`Error de sintaxis YAML en radio.yml: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Escribe un modelo a un archivo YAML
 * IMPORTANTE: Siempre hacer backup antes de llamar esta función
 */
export function writeModelFile(filePath: string, model: EdgeTXModel): void {
  const yamlContent = YAML.stringify(model, {
    indent: 2,
    lineWidth: 0,        // No cortar líneas
    nullStr: '',
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN',
  });

  fs.writeFileSync(filePath, yamlContent, 'utf-8');
}

/**
 * Escribe la configuración del radio
 */
export function writeRadioConfig(filePath: string, config: RadioConfig): void {
  const yamlContent = YAML.stringify(config, {
    indent: 2,
    lineWidth: 0,
    nullStr: '',
  });

  fs.writeFileSync(filePath, yamlContent, 'utf-8');
}

/**
 * Lista todos los modelos en un directorio
 */
export function listModelFiles(modelsDir: string): ModelSummary[] {
  if (!fs.existsSync(modelsDir)) {
    throw new Error(`Directorio de modelos no encontrado: ${modelsDir}`);
  }

  const files = fs.readdirSync(modelsDir)
    .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();

  const summaries: ModelSummary[] = [];

  for (const file of files) {
    const filePath = path.join(modelsDir, file);
    try {
      const model = readModelFile(filePath);
      summaries.push({
        fileName: file,
        name: model.header?.name || file.replace(/\.ya?ml$/, ''),
        filePath,
        channelCount: model.limitData?.length || 0,
        mixCount: model.mixData?.length || 0,
        inputCount: model.expoData?.length || 0,
        timerCount: model.timers?.length || 0,
        hasTelemetry: (model.telemetrySensors?.length || 0) > 0,
      });
    } catch {
      // Si un archivo está corrupto, lo incluimos con info mínima
      summaries.push({
        fileName: file,
        name: `[ERROR] ${file}`,
        filePath,
        channelCount: 0,
        mixCount: 0,
        inputCount: 0,
        timerCount: 0,
        hasTelemetry: false,
      });
    }
  }

  return summaries;
}

/**
 * Encuentra un modelo por nombre (busca en header.name o en el nombre del archivo)
 */
export function findModelByName(modelsDir: string, modelName: string): { filePath: string; model: EdgeTXModel } | null {
  const files = fs.readdirSync(modelsDir)
    .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));

  const nameLower = modelName.toLowerCase().trim();

  for (const file of files) {
    const filePath = path.join(modelsDir, file);
    try {
      const model = readModelFile(filePath);
      const headerName = (model.header?.name || '').toLowerCase().trim();
      const fileName = file.replace(/\.ya?ml$/, '').toLowerCase().trim();

      if (headerName === nameLower || fileName === nameLower) {
        return { filePath, model };
      }
    } catch {
      continue;
    }
  }

  // Búsqueda parcial si no hubo coincidencia exacta
  for (const file of files) {
    const filePath = path.join(modelsDir, file);
    try {
      const model = readModelFile(filePath);
      const headerName = (model.header?.name || '').toLowerCase();
      const fileName = file.replace(/\.ya?ml$/, '').toLowerCase();

      if (headerName.includes(nameLower) || fileName.includes(nameLower)) {
        return { filePath, model };
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Normaliza un modelo leído para asegurar que todos los campos tengan
 * al menos valores default, sin perder datos existentes
 */
function normalizeModel(raw: Record<string, unknown>): EdgeTXModel {
  const model: EdgeTXModel = {
    ...raw,
    header: normalizeHeader(raw.header),
    timers: Array.isArray(raw.timers) ? raw.timers : [],
    mixData: Array.isArray(raw.mixData) ? raw.mixData : [],
    expoData: Array.isArray(raw.expoData) ? raw.expoData : [],
    limitData: Array.isArray(raw.limitData) ? raw.limitData : [],
    logicalSw: Array.isArray(raw.logicalSw) ? raw.logicalSw : [],
    curves: Array.isArray(raw.curves) ? raw.curves : [],
    telemetrySensors: Array.isArray(raw.telemetrySensors) ? raw.telemetrySensors : [],
    specialFunctions: Array.isArray(raw.specialFunctions) ? raw.specialFunctions : [],
  };

  return model;
}

function normalizeHeader(raw: unknown): { name: string; [key: string]: unknown } {
  if (raw && typeof raw === 'object' && 'name' in raw) {
    return raw as { name: string; [key: string]: unknown };
  }
  return { name: 'Sin nombre' };
}

/**
 * Genera el siguiente nombre de archivo disponible para un nuevo modelo
 */
export function getNextModelFileName(modelsDir: string): string {
  const existing = fs.readdirSync(modelsDir)
    .filter(f => /^model\d+\.yml$/i.test(f))
    .map(f => {
      const match = f.match(/model(\d+)/i);
      return match ? parseInt(match[1], 10) : 0;
    })
    .sort((a, b) => a - b);

  const nextNum = existing.length > 0 ? existing[existing.length - 1] + 1 : 1;
  return `model${String(nextNum).padStart(2, '0')}.yml`;
}
