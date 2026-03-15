#!/usr/bin/env node

/**
 * Blackbox Log Analyzer MCP Server
 *
 * An MCP server that provides tools for analyzing Betaflight blackbox logs.
 * Migrated to McpServer.tool() API with Zod validation.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { getConfig, normalizeLogPath, isValidBlackboxExtension } from './config.js';
import { listBlackboxFiles, readBlackboxFile, getFileStats, directoryExists } from './utils/fs.js';
import { parseBlackboxLog, extractTimeSeries, getAvailableChannels } from './blackbox/parser.js';
import { analyzeLog } from './analysis/engine.js';
import {
  BlackboxError,
  FileNotFoundError,
  InvalidFileError,
} from './types.js';

const config = getConfig();

function formatError(error: unknown): string {
  if (error instanceof BlackboxError) {
    return JSON.stringify({ error: error.message, code: error.code, details: error.details }, null, 2);
  }
  if (error instanceof Error) {
    return `Error: ${error.message}`;
  }
  return String(error);
}

async function main() {
  const server = new McpServer({
    name: 'blackbox-mcp-server',
    version: '1.0.0',
  });

  // --- list_blackbox_logs ---
  server.tool(
    'list_blackbox_logs',
    'List available blackbox log files (.bbl/.bfl/.txt) in a directory',
    {
      directory: z.string().optional().describe(`Directory to search for logs. Defaults to ${config.logDirectory}`),
    },
    async ({ directory }) => {
      try {
        const dir = directory || config.logDirectory;
        const exists = await directoryExists(dir);
        if (!exists) throw new FileNotFoundError(dir);

        const files = await listBlackboxFiles(dir);
        return { content: [{ type: 'text', text: JSON.stringify(files, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: formatError(error) }], isError: true };
      }
    }
  );

  // --- analyze_blackbox_log ---
  server.tool(
    'analyze_blackbox_log',
    'Parse and analyze a blackbox log file, detecting issues and providing tuning suggestions',
    {
      filePath: z.string().describe('Path to the .bbl/.bfl/.txt file (absolute or relative to log directory)'),
    },
    async ({ filePath }) => {
      try {
        const normalized = normalizeLogPath(filePath, config);
        if (!isValidBlackboxExtension(normalized)) {
          throw new InvalidFileError('Invalid file extension. Expected .bbl, .bfl, or .txt file.', normalized);
        }

        const stats = await getFileStats(normalized);
        const buffer = await readBlackboxFile(normalized);

        if (buffer.length > config.maxFileSizeBytes) {
          throw new BlackboxError(
            `File too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Maximum: ${(config.maxFileSizeBytes / 1024 / 1024).toFixed(0)}MB`,
            'FILE_TOO_LARGE',
            { size: buffer.length, maxSize: config.maxFileSizeBytes }
          );
        }

        const log = await parseBlackboxLog(buffer);
        const result = analyzeLog(log, normalized, stats.sizeBytes);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: formatError(error) }], isError: true };
      }
    }
  );

  // --- get_blackbox_timeseries ---
  server.tool(
    'get_blackbox_timeseries',
    'Extract time-series data from a blackbox log for specific channels',
    {
      filePath: z.string().describe('Path to the .bbl/.bfl/.txt file'),
      channels: z.array(z.string()).describe('Channel names to extract (e.g., ["gyro_roll", "setpoint_roll", "motor_0"])'),
      maxPoints: z.number().optional().describe('Maximum number of data points to return (for downsampling). Default: 1000'),
    },
    async ({ filePath, channels, maxPoints }) => {
      try {
        const normalized = normalizeLogPath(filePath, config);
        if (!isValidBlackboxExtension(normalized)) {
          throw new InvalidFileError('Invalid file extension. Expected .bbl, .bfl, or .txt file.', normalized);
        }

        const buffer = await readBlackboxFile(normalized);
        const log = await parseBlackboxLog(buffer);
        const points = maxPoints || config.defaultMaxPoints;
        const data = extractTimeSeries(log, channels, points);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ filePath: normalized, channels, pointCount: data.length, data }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: formatError(error) }], isError: true };
      }
    }
  );

  // --- get_available_channels ---
  server.tool(
    'get_available_channels',
    'Get list of available channel names from a blackbox log',
    {
      filePath: z.string().describe('Path to the .bbl/.bfl/.txt file'),
    },
    async ({ filePath }) => {
      try {
        const normalized = normalizeLogPath(filePath, config);
        if (!isValidBlackboxExtension(normalized)) {
          throw new InvalidFileError('Invalid file extension. Expected .bbl, .bfl, or .txt file.', normalized);
        }

        const buffer = await readBlackboxFile(normalized);
        const log = await parseBlackboxLog(buffer);
        const channels = getAvailableChannels(log);

        return { content: [{ type: 'text', text: JSON.stringify({ channels }, null, 2) }] };
      } catch (error) {
        return { content: [{ type: 'text', text: formatError(error) }], isError: true };
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Blackbox MCP Server started');
  console.error(`Log directory: ${config.logDirectory}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
