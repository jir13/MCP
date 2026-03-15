# FPV Drone MCP Platform

A suite of three [Model Context Protocol](https://modelcontextprotocol.io/) servers that give AI assistants (Claude, etc.) direct control over FPV drone hardware: radio transmitter configuration, flight controller tuning, and blackbox log analysis.

```
Claude ──MCP──┬── betaflight-mcp        ──USB/Serial──► Flight Controller
              ├── tango2-mcp-server     ──SD Card────► TBS Tango 2 Radio
              └── blackbox-mcp-server   ──Filesystem──► Blackbox Logs
```

## Architecture

| Server | Language | Tools | Purpose |
|--------|----------|-------|---------|
| **betaflight-mcp** | Python | 66 | Flight controller config via MSP protocol over serial |
| **tango2-mcp-server** | TypeScript | 17 | TBS Tango 2 radio binary model editor (FreedomTX `.bin`) |
| **blackbox-mcp-server** | TypeScript | 4 | Betaflight blackbox log parser and flight analyzer |

Total: **87 tools** across 3 servers, ~8,600 lines of code.

---

## betaflight-mcp

Communicates with Betaflight flight controllers over USB serial using the [MSP protocol](https://github.com/betaflight/betaflight/wiki/MSP-Protocol). Supports full configuration, telemetry, and fleet management.

**Location:** `MCP/`

### Capabilities

- **Connection**: Auto-detect FC, connect/disconnect/reconnect with retry
- **PID Tuning**: Read/write PID settings, RC rates, filter config
- **Modes & Switches**: Configure AUX modes (ARM, ANGLE, HORIZON, etc.)
- **OSD**: Full OSD layout editing with presets (freestyle, long range, racing)
- **VTX**: Band, channel, power, pit mode control
- **GPS**: GPS status monitoring, GPS Rescue configuration
- **Safety**: Preflight checks, motor test (individual), emergency stop, beeper
- **Fleet Management**: Register multiple drones, backup all configs, compare settings
- **Sensors**: Live IMU data, attitude, battery status, RC channels, motor values
- **CLI**: Send raw Betaflight CLI commands, backup/restore via `diff`

### Handler Modules

```
MCP/src/betaflight_mcp/
├── server.py          # MCP server + tool definitions + dispatch
├── msp.py             # MSP protocol implementation (v1)
└── handlers/
    ├── connection.py  # Serial port management
    ├── config.py      # PIDs, rates, filters, features, failsafe
    ├── sensors.py     # IMU, attitude, battery, RC, motors
    ├── safety.py      # Preflight, motor test, stop, calibration
    ├── fleet.py       # Multi-drone registry and bulk operations
    ├── osd.py         # OSD layout, elements, presets
    ├── vtx.py         # Video transmitter settings
    └── gps.py         # GPS status and rescue config
```

### Setup

```bash
cd MCP
python -m venv venv
source venv/bin/activate
pip install -e .
```

### MCP Config

```json
{
  "mcpServers": {
    "betaflight": {
      "command": "MCP/venv/bin/python",
      "args": ["-m", "betaflight_mcp"]
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BETAFLIGHT_FLEET_REGISTRY` | `~/.drone/fleet.json` | Fleet registry path |
| `BETAFLIGHT_BACKUP_DIR` | `~/.drone/backups/betaflight/` | CLI backup directory |

---

## tango2-mcp-server

Reads and writes TBS Tango 2 radio model files directly at the binary level. The radio mounts as a USB mass storage device, and this server edits the `.bin` model files on its SD card.

**Location:** `tango2-mcp-server/`

### Capabilities

- **Radio Detection**: Auto-detect Tango 2 mount point across macOS/Windows/Linux
- **Model Management**: List, read, create, compare, validate models
- **Mix Editor**: Set mixes, assign switches to AUX channels (SA-SF)
- **Timer Config**: Configure flight timers (countdown, throttle-triggered, etc.)
- **Templates**: Create models from presets (freestyle, long range, cinematic)
- **Backup/Restore**: Backup models with path traversal protection, restore from backup
- **Backup Rotation**: Auto-cleanup keeping last N backups per model
- **Raw Debug**: Hex dump any section of the binary file

### Binary Format (otx5)

The parser handles the FreedomTX/OpenTX 2.3 binary format:

```
Offset  Size  Field
0x00    4     Fourcc "otx5"
0x04    10    Model name (ASCII)
0x0E    1     Model ID (5 bits)
0x0F    48    3 timers x 16 bytes (bitpacked: mode, start, countdown, persistent)
0x43    1280  64 mixes x 20 bytes (weight, destCh, srcRaw, offset, switch, curves, name)
```

**MIXSRC Numbering**: I1-I32 (1-32), LUA (33-74), MAX (75), Sticks: Rud=79/Ele=80/Thr=81/Ail=82, Pots: S1=83/S2=84, Switches: SA=89..SF=94, Channels: Ch1=95+

### Setup

```bash
cd tango2-mcp-server
npm install
npm run build
```

### MCP Config

```json
{
  "mcpServers": {
    "tango2": {
      "command": "node",
      "args": ["tango2-mcp-server/dist/index.js"]
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TANGO2_BACKUP_DIR` | `~/.drone/backups/tango2/` | Model backup directory |

---

## blackbox-mcp-server

Parses Betaflight blackbox logs (`.bbl`, `.bfl`, `.txt`) and provides flight analysis with issue detection and tuning suggestions.

**Location:** `blackbox-mcp-server/`

### Capabilities

- **Log Discovery**: List blackbox files in any directory with size and date info
- **Flight Analysis**: Parse logs and detect vibration issues, PID problems, desync events
- **Time Series**: Extract channel data (gyro, setpoint, motor, RC) with downsampling
- **Channel Listing**: Discover available data channels in a log file

### Supported Formats

| Extension | Source | Typical Size |
|-----------|--------|-------------|
| `.bbl` | Onboard flash (BetaFPV, etc.) | 25 KB - 500 KB |
| `.bfl` | SD card logging | 1 MB - 50 MB |
| `.txt` | OpenLog/Blackbox Explorer export | 5 MB - 100 MB |

### Setup

```bash
cd blackbox-mcp-server
npm install
npm run build
```

### MCP Config

```json
{
  "mcpServers": {
    "blackbox": {
      "command": "node",
      "args": ["blackbox-mcp-server/dist/index.js"]
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BLACKBOX_LOG_DIR` | `~/blackbox-logs` | Default log search directory |
| `MAX_FILE_SIZE` | `104857600` (100 MB) | Maximum parseable file size |

---

## Unified Backup Structure

All three servers store backups under `~/.drone/`:

```
~/.drone/
├── backups/
│   ├── tango2/        # Radio model .bin backups (timestamped)
│   ├── betaflight/    # FC CLI diff backups (.txt)
│   ├── blackbox/      # Analyzed log archive
│   └── mcp-config/    # Claude MCP config snapshots
└── fleet.json         # Multi-drone fleet registry
```

---

## Standard Procedure

The recommended workflow when connecting a drone (per CLAUDE.md):

1. **Backup configuration** — `backup_configuration` (betaflight) + `backup_model` (tango2)
2. **Check logs and blackbox** — `analyze_blackbox_log` for recent flights
3. **Give feedback** — AI reviews PID tuning, filter settings, and flight data to suggest improvements

---

## Testing

```bash
# Tango2 binary parser — 75 tests (vitest)
cd tango2-mcp-server && npm test

# Betaflight MSP protocol — 18 tests (pytest)
cd MCP && source venv/bin/activate && python -m pytest tests/ -v
```

Test coverage:
- **FTXModelFile**: Constructor validation, name get/set, timer roundtrips, mix read/write, srcRaw mapping, dumpRaw bounds checking, save persistence
- **MSP Protocol**: Checksum calculation, message building, response parsing, error handling (timeout, bad header, wrong code, corrupt checksum)
- **Integration**: Full create → configure → backup → modify → restore → verify cycle

---

## Security

- **Path traversal protection** on `restore_model` — resolved paths validated against backup directory
- **ASCII input validation** on all binary writes — prevents corrupted model files from non-printable characters
- **Bounds checking** on raw memory reads — offset + length validated against file size
- **Protected backups** — backup failure throws before any modification to the original file

---

## Hardware

Tested with:
- **Radios**: TBS Tango 2 (FreedomTX firmware)
- **Flight Controllers**: iFlight Blitz F722, BetaFPV F722
- **Drones**: iFlight Chimera 7 Pro V2 (long range), iFlight Nazgul Evoque F6 (freestyle)
- **Protocol**: TBS Crossfire (CRSF)
- **Platform**: macOS ARM (Apple Silicon)

---

## License

MIT
