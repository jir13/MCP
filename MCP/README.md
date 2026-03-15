# FPV_MCP - Betaflight MCP Server

An MCP (Model Context Protocol) server that allows Claude AI to interact with Betaflight flight controllers for FPV drone configuration, tuning, and management.

## Overview

This MCP server enables natural language interaction with your FPV drone through Claude. Simply connect your drone via USB and ask Claude to read settings, adjust PIDs, manage blackbox logs, configure modes, and much more.

**Tested with:**
- Betaflight 4.5.0
- iFlight Blitz F722 (STM32F7)
- Works with any Betaflight-compatible flight controller

## Features

### Connection Management
- Auto-detect serial ports
- Connect/disconnect flight controllers
- Handle connection state properly

### Read Configuration
- Flight controller info (board, firmware, target)
- PID settings and rates
- Filter configuration
- Battery settings
- Motor configuration
- VTX settings
- OSD configuration
- Blackbox settings
- Feature flags

### Write Configuration
- Modify PIDs with validation (safe ranges 0-200)
- Change rates and expo
- Configure aux modes and switches
- Adjust VTX settings (band, channel, power, pit mode)
- Set failsafe configuration
- Toggle features on/off

### Sensor Data (Real-time)
- Attitude (roll, pitch, yaw angles)
- IMU data (gyro, accelerometer, magnetometer)
- Battery status (voltage, current, mAh)
- Motor output values
- RC channel values

### Safety Features
- PID values validated before applying
- Motor testing requires confirmation
- Calibration checks arming state
- Dangerous CLI commands blocked
- Motor values clamped to safe PWM range
- Changes require explicit save

### Blackbox Management
- Check blackbox storage status
- Enter mass storage mode for log download
- Erase blackbox logs
- Parse blackbox headers for flight info

## Installation

### Prerequisites

- Python 3.10 or higher
- A Betaflight flight controller connected via USB
- Claude Desktop or Claude Code

### Install from source

```bash
git clone https://github.com/jir13/MCP.git
cd MCP
pip install -e .
```

Or with uv (recommended):

```bash
git clone https://github.com/jir13/MCP.git
cd MCP
uv pip install -e .
```

### Using Virtual Environment

```bash
cd ~/FPV_MCP
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -e .
```

## Configuration

### Claude Desktop

Add to your Claude Desktop config file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "betaflight": {
      "command": "/path/to/FPV_MCP/venv/bin/python",
      "args": ["-m", "betaflight_mcp.server"],
      "env": {
        "PYTHONPATH": "/path/to/FPV_MCP/src"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add betaflight -- python -m betaflight_mcp.server
```

Or with a specific path:

```bash
claude mcp add betaflight --scope user -- uv run --directory ~/FPV_MCP betaflight-mcp
```

## Available Tools (45 total)

### Connection (3 tools)
| Tool | Description |
|------|-------------|
| `list_serial_ports` | List available serial ports |
| `connect_flight_controller` | Connect to a Betaflight FC |
| `disconnect_flight_controller` | Disconnect from FC |

### Flight Controller Info (2 tools)
| Tool | Description |
|------|-------------|
| `get_flight_controller_info` | Get firmware and board info |
| `get_flight_controller_status` | Get status, sensors, arming state |

### PID & Rates (3 tools)
| Tool | Description |
|------|-------------|
| `get_pid_settings` | Read current PID values |
| `set_pid_settings` | Modify PID values (with validation) |
| `get_rc_tuning` | Get rates and expo settings |

### Modes & Aux Channels (4 tools)
| Tool | Description |
|------|-------------|
| `get_available_modes` | List all flight modes (ARM, ANGLE, HORIZON, etc.) |
| `get_aux_modes` | Get aux channel to mode mappings |
| `set_aux_mode` | Map mode to aux channel range |
| `clear_aux_mode` | Remove a mode mapping |

### Profiles (4 tools)
| Tool | Description |
|------|-------------|
| `get_current_profile` | Get active PID/rate profile |
| `set_pid_profile` | Switch PID profile (1-3) |
| `set_rate_profile` | Switch rate profile (1-6) |
| `copy_pid_profile` | Copy profile to another |

### Failsafe & Safety (3 tools)
| Tool | Description |
|------|-------------|
| `get_failsafe_config` | Get failsafe settings |
| `set_failsafe_config` | Configure failsafe behavior |
| `get_arming_disable_flags` | Why can't I arm? |
| `preflight_check` | Comprehensive pre-flight checks |

### VTX Control (5 tools)
| Tool | Description |
|------|-------------|
| `get_vtx_config` | Get VTX settings |
| `set_vtx_channel` | Change VTX channel (1-8) |
| `set_vtx_band` | Change VTX band (A, B, E, F, R) |
| `set_vtx_power` | Change VTX power level |
| `set_vtx_pit_mode` | Toggle pit mode on/off |

### Sensor Data (5 tools)
| Tool | Description |
|------|-------------|
| `get_attitude` | Current roll/pitch/yaw angles |
| `get_imu_data` | Raw accelerometer/gyro/magnetometer |
| `get_battery_status` | Voltage, current, mAh consumed |
| `get_motor_values` | Current motor output values |
| `get_rc_channels` | RC receiver channel values |

### Configuration (8 tools)
| Tool | Description |
|------|-------------|
| `get_filter_config` | Gyro and D-term filter settings |
| `get_battery_config` | Battery voltage/capacity settings |
| `get_motor_config` | Motor protocol, throttle limits |
| `get_osd_config` | On-screen display settings |
| `get_blackbox_config` | Data logging configuration |
| `get_dataflash_summary` | Onboard flash memory status |
| `get_features` | Enabled/disabled features |
| `set_feature` | Toggle features on/off |

### Motor Testing (2 tools)
| Tool | Description |
|------|-------------|
| `test_motor` | Spin individual motor (REMOVE PROPS!) |
| `stop_motors` | Stop all motors immediately |

### Calibration (2 tools)
| Tool | Description |
|------|-------------|
| `calibrate_accelerometer` | Level calibration |
| `calibrate_magnetometer` | Compass calibration |

### Utilities (6 tools)
| Tool | Description |
|------|-------------|
| `beep` | Make the FC beep |
| `reboot_flight_controller` | Reboot the FC |
| `erase_blackbox_logs` | Clear onboard flash |
| `set_craft_name` | Set craft name |
| `save_settings` | Save changes to EEPROM |
| `backup_configuration` | Export config as CLI commands |
| `send_cli_command` | Send raw CLI commands |

## Usage Examples

### Connection & Info
```
"List the available serial ports and connect to my drone"
"What's the firmware version on my flight controller?"
"Is my drone armed? What sensors are detected?"
```

### Modes & Switches
```
"Show me my current aux mode mappings"
"Set ARM on AUX1 when the switch is high (1800-2100)"
"Map ANGLE mode to AUX2 middle position"
```

### Tuning
```
"Show me the current PID settings"
"Increase the roll P gain by 10"
"What are my current filter settings?"
```

### VTX Control
```
"Show me my VTX settings"
"Set VTX to band R channel 8"
"Enable pit mode"
```

### Safety
```
"Run a preflight check"
"Why can't my drone arm?"
"What's my failsafe configuration?"
```

### Blackbox
```
"Check blackbox storage"
"How much blackbox space is left?"
"Erase the blackbox logs"
```

### Motor Testing (REMOVE PROPS FIRST!)
```
"Test motor 1 at 5% throttle"
"Stop all motors"
```

### Backup & Restore
```
"Create a backup of my configuration"
"Run 'diff' to see changed settings"
```

## MSP Protocol

This server implements MSPv1 (MultiWii Serial Protocol) for communication with Betaflight. The protocol uses:
- Baud rate: 115200
- Message format: `$M< + length + command + data + checksum`

### Key MSP Codes Used
| Code | Name | Description |
|------|------|-------------|
| 100 | MSP_IDENT | Legacy identification |
| 101 | MSP_STATUS | FC status |
| 102 | MSP_RAW_IMU | Raw sensor data |
| 108 | MSP_ATTITUDE | Orientation |
| 110 | MSP_ANALOG | Battery/RSSI |
| 112 | MSP_PID | PID values |
| 202 | MSP_SET_PID | Write PIDs |
| 34 | MSP_MODE_RANGES | Aux mode mappings |
| 75 | MSP_FAILSAFE_CONFIG | Failsafe settings |
| 88 | MSP_VTX_CONFIG | VTX configuration |

## Project Structure

```
FPV_MCP/
├── src/
│   └── betaflight_mcp/
│       ├── __init__.py      # Package exports
│       ├── msp.py           # MSP protocol implementation
│       └── server.py        # MCP server & tools
├── pyproject.toml           # Package configuration
├── setup.py                 # Pip compatibility
└── README.md                # This file
```

## Troubleshooting

### Serial port not found
- Ensure FC is connected via USB
- Close Betaflight Configurator (it locks the port)
- On Linux: `sudo usermod -a -G dialout $USER`

### Connection timeout
- Check FC is powered and not in DFU mode
- Try unplugging and reconnecting USB
- Verify baud rate is 115200

### Permission denied
- macOS: Grant terminal access to serial port
- Linux: Check udev rules or add user to dialout group

### Port busy error
- Another application is using the serial port
- Close Betaflight Configurator or other serial monitors

## Safety Warnings

1. **REMOVE PROPS** before testing motors
2. **Never arm** indoors with props attached
3. **Test failsafe** before flying
4. **Verify settings** after making changes
5. **Backup config** before major changes

## Contributing

Contributions welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Submit a pull request

## License

MIT

## Acknowledgments

- [Betaflight](https://github.com/betaflight/betaflight) - Flight controller firmware
- [MCP Protocol](https://modelcontextprotocol.io/) - Model Context Protocol by Anthropic
- MultiWii Serial Protocol documentation

---

**Built for the FPV community**
