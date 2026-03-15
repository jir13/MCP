// ============================================================
// Tool: backup_model, restore_model
// Gestión de backups de modelos
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { getModelsPath } from './detect.js';
import { findModelByName } from '../parsers/edgetx-yaml.js';

const BACKUP_DIR_NAME = '_backups';

/**
 * Obtiene o crea el directorio de backups
 */
function getBackupDir(): string {
  const modelsPath = getModelsPath();
  const backupDir = path.join(modelsPath, BACKUP_DIR_NAME);

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  return backupDir;
}

/**
 * Genera un nombre de archivo de backup con timestamp
 */
function generateBackupName(originalFile: string): string {
  const baseName = path.basename(originalFile, path.extname(originalFile));
  const timestamp = new Date().toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
  return `${baseName}_backup_${timestamp}.yml`;
}

/**
 * Hace backup de un archivo de modelo
 * Retorna la ruta del backup creado
 */
export function backupModel(modelName: string): { backupPath: string; message: string } {
  const modelsPath = getModelsPath();
  const found = findModelByName(modelsPath, modelName);

  if (!found) {
    throw new Error(`Modelo "${modelName}" no encontrado en el radio.`);
  }

  const backupDir = getBackupDir();
  const backupName = generateBackupName(found.filePath);
  const backupPath = path.join(backupDir, backupName);

  fs.copyFileSync(found.filePath, backupPath);

  return {
    backupPath,
    message: `Backup creado exitosamente: ${backupName}`,
  };
}

/**
 * Hace backup de un archivo específico por ruta
 * Usado internamente antes de cualquier escritura
 */
export function backupFile(filePath: string): string {
  const backupDir = getBackupDir();
  const backupName = generateBackupName(filePath);
  const backupPath = path.join(backupDir, backupName);

  fs.copyFileSync(filePath, backupPath);

  return backupPath;
}

/**
 * Restaura un modelo desde un backup
 */
export function restoreModel(modelName: string, backupPath: string): { message: string } {
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Archivo de backup no encontrado: ${backupPath}`);
  }

  const modelsPath = getModelsPath();
  const found = findModelByName(modelsPath, modelName);

  if (!found) {
    throw new Error(`Modelo "${modelName}" no encontrado en el radio.`);
  }

  // Hacer backup del estado actual antes de restaurar
  backupFile(found.filePath);

  // Restaurar
  fs.copyFileSync(backupPath, found.filePath);

  return {
    message: `Modelo "${modelName}" restaurado exitosamente desde ${path.basename(backupPath)}. Se creó un backup del estado anterior.`,
  };
}

/**
 * Lista todos los backups disponibles
 */
export function listBackups(): { backups: Array<{ fileName: string; filePath: string; date: string; size: number }> } {
  let backupDir: string;
  try {
    backupDir = getBackupDir();
  } catch {
    return { backups: [] };
  }

  if (!fs.existsSync(backupDir)) {
    return { backups: [] };
  }

  const files = fs.readdirSync(backupDir)
    .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort()
    .reverse(); // Más recientes primero

  const backups = files.map(f => {
    const filePath = path.join(backupDir, f);
    const stat = fs.statSync(filePath);
    return {
      fileName: f,
      filePath,
      date: stat.mtime.toISOString(),
      size: stat.size,
    };
  });

  return { backups };
}

/**
 * Hace backup de TODOS los modelos
 */
export function backupAllModels(): { backups: string[]; message: string } {
  const modelsPath = getModelsPath();
  const files = fs.readdirSync(modelsPath)
    .filter(f => (f.endsWith('.yml') || f.endsWith('.yaml')) && !f.startsWith('.'));

  const backups: string[] = [];

  for (const file of files) {
    const filePath = path.join(modelsPath, file);
    const backupPath = backupFile(filePath);
    backups.push(backupPath);
  }

  return {
    backups,
    message: `Se crearon ${backups.length} backups exitosamente.`,
  };
}
