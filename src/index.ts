#!/usr/bin/env node

/**
 * Blackbox Log Analyzer MCP Server
 *
 * An MCP server that provides tools for analyzing Betaflight blackbox logs.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { getConfig, normalizeLogPath, isValidBlackboxExtension } from './config.js';
import { listBlackboxFiles, readBlackboxFile, getFileStats, directoryExists } from './utils/fs.js';
import { parseBlackboxLog, extractTimeSeries, getAvailableChannels } from './blackbox/parser.js';
import { analyzeLog } from './analysis/engine.js';
import {
  BlackboxError,
  FileNotFoundError,
  InvalidFileError,
  LogFileInfo,
  AnalysisResult,
  TimeSeriesResult,
} from './types.js';

const config = getConfig();

/**
 * Tool definitions
 */
const tools: Tool[] = [
  {
    name: 'list_blackbox_logs',
    description: 'List available blackbox log files (.bbl/.bfl) in a directory',
    inputSchema: {
      type: 'object',
      properties: {
        directory: {
          type: 'string',
          description: `Directory to search for logs. Defaults to ${config.logDirectory}`,
        },
      },
      required: [],
    },
  },
  {
    name: 'analyze_blackbox_log',
    description: 'Parse and analyze a blackbox log file, detecting issues and providing tuning suggestions',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the .bbl/.bfl file (absolute or relative to log directory)',
        },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'get_blackbox_timeseries',
    description: 'Extract time-series data from a blackbox log for specific channels',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the .bbl/.bfl file',
        },
        channels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Channel names to extract (e.g., ["gyro_roll", "setpoint_roll", "motor_0"])',
        },
        maxPoints: {
          type: 'number',
          description: 'Maximum number of data points to return (for downsampling). Default: 1000',
        },
      },
      required: ['filePath', 'channels'],
    },
  },
  {
    name: 'get_available_channels',
    description: 'Get list of available channel names from a blackbox log',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the .bbl/.bfl file',
        },
      },
      required: ['filePath'],
    },
  },
];

/**
 * Handle list_blackbox_logs tool
 */
async function handleListBlackboxLogs(args: {
  directory?: string;
}): Promise<LogFileInfo[]> {
  const directory = args.directory || config.logDirectory;

  const exists = await directoryExists(directory);
  if (!exists) {
    throw new FileNotFoundError(directory);
  }

  return listBlackboxFiles(directory);
}

/**
 * Handle analyze_blackbox_log tool
 */
async function handleAnalyzeBlackboxLog(args: {
  filePath: string;
}): Promise<AnalysisResult> {
  const filePath = normalizeLogPath(args.filePath, config);

  if (!isValidBlackboxExtension(filePath)) {
    throw new InvalidFileError(
      'Invalid file extension. Expected .bbl or .bfl file.',
      filePath
    );
  }

  const stats = await getFileStats(filePath);
  const buffer = await readBlackboxFile(filePath);

  if (buffer.length > config.maxFileSizeBytes) {
    throw new BlackboxError(
      `File too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB). Maximum: ${(config.maxFileSizeBytes / 1024 / 1024).toFixed(0)}MB`,
      'FILE_TOO_LARGE',
      { size: buffer.length, maxSize: config.maxFileSizeBytes }
    );
  }

  const log = await parseBlackboxLog(buffer);
  return analyzeLog(log, filePath, stats.sizeBytes);
}

/**
 * Handle get_blackbox_timeseries tool
 */
async function handleGetBlackboxTimeseries(args: {
  filePath: string;
  channels: string[];
  maxPoints?: number;
}): Promise<TimeSeriesResult> {
  const filePath = normalizeLogPath(args.filePath, config);

  if (!isValidBlackboxExtension(filePath)) {
    throw new InvalidFileError(
      'Invalid file extension. Expected .bbl or .bfl file.',
      filePath
    );
  }

  const buffer = await readBlackboxFile(filePath);
  const log = await parseBlackboxLog(buffer);

  const maxPoints = args.maxPoints || config.defaultMaxPoints;
  const data = extractTimeSeries(log, args.channels, maxPoints);

  return {
    filePath,
    channels: args.channels,
    pointCount: data.length,
    data,
  };
}

/**
 * Handle get_available_channels tool
 */
async function handleGetAvailableChannels(args: {
  filePath: string;
}): Promise<{ channels: string[] }> {
  const filePath = normalizeLogPath(args.filePath, config);

  if (!isValidBlackboxExtension(filePath)) {
    throw new InvalidFileError(
      'Invalid file extension. Expected .bbl or .bfl file.',
      filePath
    );
  }

  const buffer = await readBlackboxFile(filePath);
  const log = await parseBlackboxLog(buffer);

  return {
    channels: getAvailableChannels(log),
  };
}

/**
 * Format error for MCP response
 */
function formatError(error: unknown): { error: string; code?: string; details?: Record<string, unknown> } {
  if (error instanceof BlackboxError) {
    return {
      error: error.message,
      code: error.code,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      error: error.message,
    };
  }

  return {
    error: String(error),
  };
}

/**
 * Main server setup
 */
async function main() {
  const server = new Server(
    {
      name: 'blackbox-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handle tool listing
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
  });

  // Handle tool execution
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: unknown;

      switch (name) {
        case 'list_blackbox_logs':
          result = await handleListBlackboxLogs(args as { directory?: string });
          break;

        case 'analyze_blackbox_log':
          result = await handleAnalyzeBlackboxLog(args as { filePath: string });
          break;

        case 'get_blackbox_timeseries':
          result = await handleGetBlackboxTimeseries(
            args as { filePath: string; channels: string[]; maxPoints?: number }
          );
          break;

        case 'get_available_channels':
          result = await handleGetAvailableChannels(args as { filePath: string });
          break;

        default:
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ error: `Unknown tool: ${name}` }),
              },
            ],
            isError: true,
          };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const formattedError = formatError(error);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(formattedError, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('Blackbox MCP Server started');
  console.error(`Log directory: ${config.logDirectory}`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
