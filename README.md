# Blackbox Log Analyzer MCP Server

An MCP (Model Context Protocol) server for analyzing Betaflight blackbox logs. This server connects to your AI assistant (Claude Desktop, Cursor, etc.) and provides tools to list, parse, and analyze `.bbl` blackbox log files from your FPV drone.

## Features

- **List blackbox logs** - Find all `.bbl`/`.bfl` files in a directory
- **Analyze logs** - Parse logs and detect common issues:
  - Oscillations / noise
  - Tracking error (setpoint vs gyro)
  - Propwash oscillations
  - Motor saturation / imbalance
  - D-term noise
  - Voltage sag
- **Extract time-series data** - Get downsampled channel data for deeper analysis
- **Get available channels** - Discover what data is in a log file

## Installation

### Prerequisites

- Node.js 18+
- npm or pnpm

### Setup

```bash
cd blackbox-mcp-server

# Install dependencies
npm install

# Build the project
npm run build
```

### Configure Log Directory

Set the `BLACKBOX_LOG_DIR` environment variable to point to your blackbox logs:

```bash
export BLACKBOX_LOG_DIR=/path/to/your/blackbox/logs
```

Or the server will default to `~/blackbox-logs`.

## Configuration for AI Assistants

### Claude Desktop

Add to your Claude Desktop config file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "blackbox-analyzer": {
      "command": "node",
      "args": ["/full/path/to/blackbox-mcp-server/dist/index.js"],
      "env": {
        "BLACKBOX_LOG_DIR": "/path/to/your/blackbox/logs"
      }
    }
  }
}
```

### Cursor

Add to your Cursor MCP settings:

```json
{
  "mcpServers": {
    "blackbox-analyzer": {
      "command": "node",
      "args": ["/full/path/to/blackbox-mcp-server/dist/index.js"],
      "env": {
        "BLACKBOX_LOG_DIR": "/path/to/your/blackbox/logs"
      }
    }
  }
}
```

### Claude Code

Add to `~/.claude/config.json` or project `.claude/config.json`:

```json
{
  "mcpServers": {
    "blackbox-analyzer": {
      "command": "node",
      "args": ["/full/path/to/blackbox-mcp-server/dist/index.js"],
      "env": {
        "BLACKBOX_LOG_DIR": "/path/to/your/blackbox/logs"
      }
    }
  }
}
```

## Available Tools

### `list_blackbox_logs`

List available blackbox log files in a directory.

**Parameters:**
- `directory` (optional): Directory to search. Defaults to `BLACKBOX_LOG_DIR`.

**Example Response:**
```json
[
  {
    "filename": "LOG00042.BFL",
    "fullPath": "/Users/pilot/blackbox-logs/LOG00042.BFL",
    "sizeBytes": 15728640,
    "modifiedAt": "2024-01-15T14:30:00.000Z"
  }
]
```

### `analyze_blackbox_log`

Parse and analyze a blackbox log, detecting issues and providing tuning suggestions.

**Parameters:**
- `filePath` (required): Path to the `.bbl`/`.bfl` file

**Example Response:**
```json
{
  "logInfo": {
    "filePath": "/Users/pilot/blackbox-logs/LOG00042.BFL",
    "sizeBytes": 15728640,
    "firmware": "Betaflight 4.4.2",
    "craftName": "FreeStyle5",
    "duration": 180.5,
    "sampleCount": 180500
  },
  "summary": "Flight duration: 180.5 seconds. Analyzed 180,500 samples. Found 1 HIGH severity issue(s): propwash. Found 2 MEDIUM severity issue(s): motor_imbalance, voltage_sag. Top priority: Increase D-term gain slightly",
  "issues": [
    {
      "type": "propwash",
      "severity": "high",
      "description": "Propwash oscillations detected during throttle transitions.",
      "evidence": "Oscillations detected in throttle range 1200-1600",
      "suggestions": [
        "Increase D-term gain slightly",
        "Try enabling/tuning anti-gravity",
        "Experiment with prop wash tuning features",
        "Check prop condition (bent/damaged props amplify propwash)",
        "Consider using feed-forward tuning"
      ]
    }
  ],
  "metrics": [
    {
      "name": "Roll Gyro Noise",
      "value": "5.23",
      "unit": "deg/s",
      "description": "RMS of sample-to-sample gyro changes"
    },
    {
      "name": "Motor Imbalance",
      "value": "18.5",
      "unit": "%",
      "description": "Variation between motor outputs (lower is better)"
    }
  ]
}
```

### `get_blackbox_timeseries`

Extract time-series data for specific channels (useful for plotting or detailed analysis).

**Parameters:**
- `filePath` (required): Path to the log file
- `channels` (required): Array of channel names to extract
- `maxPoints` (optional): Maximum points to return (for downsampling). Default: 1000

**Available Channels:**
- Gyro: `gyro_roll`, `gyro_pitch`, `gyro_yaw`
- Setpoint: `setpoint_roll`, `setpoint_pitch`, `setpoint_yaw`, `throttle`
- Motors: `motor_0`, `motor_1`, `motor_2`, `motor_3`
- PID: `pid_roll_p`, `pid_roll_d`, `pid_pitch_p`, `pid_pitch_d`
- Battery: `battery_voltage`

**Example Response:**
```json
{
  "filePath": "/Users/pilot/blackbox-logs/LOG00042.BFL",
  "channels": ["gyro_roll", "setpoint_roll"],
  "pointCount": 1000,
  "data": [
    { "t": 0.0, "values": { "gyro_roll": 12.5, "setpoint_roll": 15.0 } },
    { "t": 0.18, "values": { "gyro_roll": 14.2, "setpoint_roll": 14.8 } }
  ]
}
```

### `get_available_channels`

Get list of available channel names from a log file.

**Parameters:**
- `filePath` (required): Path to the log file

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `BLACKBOX_LOG_DIR` | Default directory for blackbox logs | `~/blackbox-logs` |
| `MAX_FILE_SIZE` | Maximum file size to process (bytes) | `104857600` (100MB) |
| `DEFAULT_MAX_POINTS` | Default max points for time-series | `1000` |

## Getting Blackbox Logs from Your Drone

### From SD Card
1. Remove the SD card from your flight controller
2. Mount it on your computer
3. Copy `.bbl` or `.bfl` files to your log directory

### From Onboard Flash
1. Connect to Betaflight Configurator
2. Go to Blackbox tab
3. Click "Save to File" to download logs

### Using the Betaflight MCP Server
If you have the Betaflight MCP server connected:
1. Use `get_dataflash_summary` to check available logs
2. Download logs through Betaflight Configurator

## Architecture

```
MCP Client (Claude/Cursor)
        │
        ▼
┌─────────────────────┐
│   MCP Server        │
│   (src/index.ts)    │
└────────┬────────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌─────────────┐
│ Parser │ │ Analysis    │
│  .bbl  │ │ Engine      │
└────────┘ └─────────────┘
```

## Extending the Parser

The blackbox parser (`src/blackbox/parser.ts`) is designed to be swappable. To use a more complete parser:

1. Implement the `parseBlackboxLog` function interface
2. Return a `BlackboxLog` object with header and samples
3. The analysis engine will work with any conforming data

## Limitations

- The current parser is a simplified implementation that handles common log formats
- Very large logs (>100MB) may be slow to process
- Some advanced Betaflight features (GPS, RSSI, etc.) may not be fully parsed

## License

MIT
