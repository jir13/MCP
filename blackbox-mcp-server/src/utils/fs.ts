import fs from 'fs/promises';
import path from 'path';
import { LogFileInfo, FileNotFoundError, InvalidFileError } from '../types.js';
import { isValidBlackboxExtension } from '../config.js';

/**
 * Check if a directory exists
 */
export async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * List all blackbox log files in a directory
 */
export async function listBlackboxFiles(directory: string): Promise<LogFileInfo[]> {
  const exists = await directoryExists(directory);
  if (!exists) {
    throw new FileNotFoundError(directory);
  }

  const entries = await fs.readdir(directory, { withFileTypes: true });
  const logFiles: LogFileInfo[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (ext !== '.bbl' && ext !== '.bfl' && ext !== '.txt') continue;

    const fullPath = path.join(directory, entry.name);
    const stat = await fs.stat(fullPath);

    logFiles.push({
      filename: entry.name,
      fullPath,
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
  }

  // Sort by modification date, newest first
  logFiles.sort((a, b) =>
    new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
  );

  return logFiles;
}

/**
 * Read a blackbox file and return its contents as a buffer
 */
export async function readBlackboxFile(filePath: string): Promise<Buffer> {
  const exists = await fileExists(filePath);
  if (!exists) {
    throw new FileNotFoundError(filePath);
  }

  if (!isValidBlackboxExtension(filePath)) {
    throw new InvalidFileError(
      `Invalid file extension. Expected .bbl, .bfl, or .txt file.`,
      filePath
    );
  }

  return fs.readFile(filePath);
}

/**
 * Get file stats
 */
export async function getFileStats(filePath: string): Promise<{
  sizeBytes: number;
  modifiedAt: string;
}> {
  const exists = await fileExists(filePath);
  if (!exists) {
    throw new FileNotFoundError(filePath);
  }

  const stat = await fs.stat(filePath);
  return {
    sizeBytes: stat.size,
    modifiedAt: stat.mtime.toISOString(),
  };
}

/**
 * Ensure a directory exists, creating it if necessary
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
}
