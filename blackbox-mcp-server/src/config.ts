import { ServerConfig } from './types.js';
import path from 'path';
import os from 'os';

/**
 * Get the server configuration from environment variables or defaults
 */
export function getConfig(): ServerConfig {
  const defaultLogDir = process.env.BLACKBOX_LOG_DIR ||
    path.join(os.homedir(), 'blackbox-logs');

  return {
    logDirectory: defaultLogDir,
    maxFileSizeBytes: parseInt(process.env.MAX_FILE_SIZE || '104857600', 10), // 100MB default
    defaultMaxPoints: parseInt(process.env.DEFAULT_MAX_POINTS || '1000', 10),
  };
}

/**
 * Validate and normalize a file path
 */
export function normalizeLogPath(filePath: string, config: ServerConfig): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.join(config.logDirectory, filePath);
}

/**
 * Check if a file extension is valid for blackbox logs
 */
export function isValidBlackboxExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.bbl' || ext === '.bfl' || ext === '.txt';
}
