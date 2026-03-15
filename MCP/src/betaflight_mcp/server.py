"""
Betaflight MCP Server

An MCP server that provides tools for configuring Betaflight flight controllers
through Claude and other MCP-compatible AI assistants.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any, Optional

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import TextContent, Tool

from .msp import (
    MSPConnection,
    MSPError,
    FEATURE_FLAGS,
)

from .handlers import ALL_HANDLERS


# Global connection state
_connection: Optional[MSPConnection] = None

# Fleet management
_DRONE_HOME = os.path.join(os.path.expanduser("~"), ".drone")
FLEET_REGISTRY_PATH = os.environ.get(
    "BETAFLIGHT_FLEET_REGISTRY",
    os.path.join(_DRONE_HOME, "fleet.json"),
)
BACKUP_DIR = os.environ.get(
    "BETAFLIGHT_BACKUP_DIR",
    os.path.join(_DRONE_HOME, "backups", "betaflight"),
)


def _load_fleet() -> dict:
    """Load fleet registry from JSON file."""
    if not os.path.exists(FLEET_REGISTRY_PATH):
        return {"drones": []}
    with open(FLEET_REGISTRY_PATH, 'r') as f:
        return json.load(f)


def _save_fleet(data: dict) -> None:
    """Save fleet registry to JSON file."""
    os.makedirs(os.path.dirname(FLEET_REGISTRY_PATH), exist_ok=True)
    with open(FLEET_REGISTRY_PATH, 'w') as f:
        json.dump(data, f, indent=2)


def _set_connection(conn: Optional[MSPConnection]) -> None:
    """Update the global connection state (called from handlers)."""
    global _connection
    _connection = conn


# Create the MCP server
app = Server("betaflight-mcp")


@app.list_tools()
async def list_tools() -> list[Tool]:
    """List all available Betaflight tools."""
    return [
        Tool(
            name="list_serial_ports",
            description="List available serial ports for connecting to flight controllers",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="connect_flight_controller",
            description=(
                "Connect to a Betaflight flight controller via serial port. "
                "Must be called before using other flight controller tools."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "port": {
                        "type": "string",
                        "description": (
                            "Serial port path (e.g., '/dev/tty.usbmodem0001' on Mac, "
                            "'/dev/ttyACM0' on Linux, 'COM3' on Windows)"
                        ),
                    },
                    "baudrate": {
                        "type": "integer",
                        "description": "Serial baudrate (default: 115200)",
                        "default": 115200,
                    },
                },
                "required": ["port"],
            },
        ),
        Tool(
            name="disconnect_flight_controller",
            description="Disconnect from the flight controller",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="reconnect_flight_controller",
            description=(
                "Force-reconnect to the flight controller. Use this when the "
                "connection is stale (e.g. after backup/save caused a reboot). "
                "Automatically retries for up to 5 seconds while the FC reboots."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "port": {
                        "type": "string",
                        "description": (
                            "Serial port path. If not provided, uses the last "
                            "connected port."
                        ),
                    },
                },
                "required": [],
            },
        ),
        Tool(
            name="get_flight_controller_info",
            description=(
                "Get flight controller information including firmware version, "
                "board type, and craft name"
            ),
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="get_flight_controller_status",
            description=(
                "Get current flight controller status including arming state, "
                "sensors, CPU load, and error counts"
            ),
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="get_pid_settings",
            description="Get current PID controller settings for roll, pitch, and yaw",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="set_pid_settings",
            description=(
                "Set PID controller settings. Only specified values will be changed. "
                "Values are validated against safe ranges before applying. "
                "Use save_settings tool after to persist changes."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "roll_p": {"type": "integer", "description": "Roll P gain (0-200)"},
                    "roll_i": {"type": "integer", "description": "Roll I gain (0-200)"},
                    "roll_d": {"type": "integer", "description": "Roll D gain (0-200)"},
                    "pitch_p": {"type": "integer", "description": "Pitch P gain (0-200)"},
                    "pitch_i": {"type": "integer", "description": "Pitch I gain (0-200)"},
                    "pitch_d": {"type": "integer", "description": "Pitch D gain (0-200)"},
                    "yaw_p": {"type": "integer", "description": "Yaw P gain (0-200)"},
                    "yaw_i": {"type": "integer", "description": "Yaw I gain (0-200)"},
                    "yaw_d": {"type": "integer", "description": "Yaw D gain (0-200)"},
                },
                "required": [],
            },
        ),
        Tool(
            name="get_rc_tuning",
            description="Get RC rates, expo, and throttle settings",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="save_settings",
            description=(
                "Save current settings to EEPROM. Call this after making changes "
                "to persist them across power cycles."
            ),
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="backup_configuration",
            description=(
                "Backup flight controller configuration. Returns CLI commands "
                "that can be used to restore the configuration."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "mode": {
                        "type": "string",
                        "enum": ["diff", "dump"],
                        "description": (
                            "'diff' returns only changed settings (recommended), "
                            "'dump' returns all settings"
                        ),
                        "default": "diff",
                    },
                },
                "required": [],
            },
        ),
        Tool(
            name="send_cli_command",
            description=(
                "Send a raw CLI command to the flight controller. "
                "Use with caution - some commands can affect flight safety. "
                "The FC must not be armed."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "CLI command to send (e.g., 'get pid', 'status')",
                    },
                },
                "required": ["command"],
            },
        ),
        # Sensor Data Tools
        Tool(
            name="get_attitude",
            description="Get current aircraft attitude (roll, pitch, yaw angles in degrees)",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="get_imu_data",
            description="Get raw IMU sensor data (accelerometer, gyroscope, magnetometer)",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="get_battery_status",
            description="Get battery voltage, current draw, mAh consumed, and RSSI",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="get_motor_values",
            description="Get current motor output values (PWM/DSHOT values)",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="get_rc_channels",
            description="Get current RC channel values from the receiver",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        # Configuration Tools
        Tool(
            name="get_filter_config",
            description="Get gyro and D-term filter settings (lowpass, notch filters)",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="get_battery_config",
            description="Get battery configuration (voltage limits, capacity, meter sources)",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="get_motor_config",
            description="Get motor configuration (throttle limits, protocol, poles)",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="get_vtx_config",
            description="Get VTX (video transmitter) settings (band, channel, power)",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="get_osd_config",
            description="Get OSD (on-screen display) configuration",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="get_blackbox_config",
            description="Get blackbox data logging configuration",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="get_dataflash_summary",
            description="Get onboard dataflash memory status (used/total space for blackbox)",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="get_features",
            description="Get list of enabled/disabled features (AIRMODE, OSD, GPS, etc.)",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="set_feature",
            description=(
                "Enable or disable a feature. "
                f"Available features: {', '.join(FEATURE_FLAGS.values())}"
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "feature": {
                        "type": "string",
                        "description": "Feature name (e.g., 'AIRMODE', 'OSD', 'GPS')",
                    },
                    "enabled": {
                        "type": "boolean",
                        "description": "True to enable, False to disable",
                    },
                },
                "required": ["feature", "enabled"],
            },
        ),
        # Motor Testing Tools
        Tool(
            name="test_motor",
            description=(
                "DANGER: Spin a single motor for testing. REMOVE PROPS FIRST! "
                "Only works when disarmed. Motor will spin at specified throttle."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "motor": {
                        "type": "integer",
                        "description": "Motor number (1-8)",
                        "minimum": 1,
                        "maximum": 8,
                    },
                    "throttle_percent": {
                        "type": "integer",
                        "description": "Throttle percentage (0-100). Start low (5-10%)!",
                        "minimum": 0,
                        "maximum": 100,
                    },
                },
                "required": ["motor", "throttle_percent"],
            },
        ),
        Tool(
            name="stop_motors",
            description="Stop all motors immediately",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        # Calibration Tools
        Tool(
            name="calibrate_accelerometer",
            description=(
                "Calibrate the accelerometer. The drone must be on a level surface "
                "and completely still during calibration (~2 seconds)."
            ),
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="calibrate_magnetometer",
            description=(
                "Start magnetometer (compass) calibration. Rotate the drone through "
                "all orientations (360 degrees on each axis) during calibration."
            ),
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        # Utility Tools
        Tool(
            name="beep",
            description="Make the flight controller beep (useful for finding lost drone)",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="reboot_flight_controller",
            description="Reboot the flight controller. Connection will be lost.",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="erase_blackbox_logs",
            description="Erase all blackbox logs from onboard flash memory",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="set_craft_name",
            description="Set the craft name (max 16 characters)",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "New craft name (max 16 chars)",
                        "maxLength": 16,
                    },
                },
                "required": ["name"],
            },
        ),
        # ===== MODES & AUX CHANNELS =====
        Tool(
            name="get_available_modes",
            description="List all available flight modes that can be assigned to aux channels",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="get_aux_modes",
            description="Get all aux channel to flight mode mappings (which switch activates which mode)",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="set_aux_mode",
            description=(
                "Map a flight mode to an aux channel range. "
                "Example: ARM on AUX1 when switch is HIGH (1800-2100)"
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "mode": {
                        "type": "string",
                        "description": "Mode name (e.g., 'ARM', 'ANGLE', 'HORIZON', 'AIRMODE', 'BEEPERON')",
                    },
                    "aux_channel": {
                        "type": "integer",
                        "description": "Aux channel number (1-8)",
                        "minimum": 1,
                        "maximum": 8,
                    },
                    "range_start": {
                        "type": "integer",
                        "description": "Start of activation range (900-2100)",
                        "minimum": 900,
                        "maximum": 2100,
                    },
                    "range_end": {
                        "type": "integer",
                        "description": "End of activation range (900-2100)",
                        "minimum": 900,
                        "maximum": 2100,
                    },
                },
                "required": ["mode", "aux_channel", "range_start", "range_end"],
            },
        ),
        Tool(
            name="clear_aux_mode",
            description="Remove a mode mapping by its slot index",
            inputSchema={
                "type": "object",
                "properties": {
                    "index": {
                        "type": "integer",
                        "description": "Slot index to clear (from get_aux_modes)",
                    },
                },
                "required": ["index"],
            },
        ),
        # ===== PROFILES =====
        Tool(
            name="get_current_profile",
            description="Get current PID profile (1-3) and rate profile (1-6)",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="set_pid_profile",
            description="Switch to a different PID profile",
            inputSchema={
                "type": "object",
                "properties": {
                    "profile": {
                        "type": "integer",
                        "description": "Profile number (1-3)",
                        "minimum": 1,
                        "maximum": 3,
                    },
                },
                "required": ["profile"],
            },
        ),
        Tool(
            name="set_rate_profile",
            description="Switch to a different rate profile",
            inputSchema={
                "type": "object",
                "properties": {
                    "profile": {
                        "type": "integer",
                        "description": "Profile number (1-6)",
                        "minimum": 1,
                        "maximum": 6,
                    },
                },
                "required": ["profile"],
            },
        ),
        Tool(
            name="copy_pid_profile",
            description="Copy PID settings from one profile to another",
            inputSchema={
                "type": "object",
                "properties": {
                    "source": {
                        "type": "integer",
                        "description": "Source profile number (1-3)",
                        "minimum": 1,
                        "maximum": 3,
                    },
                    "destination": {
                        "type": "integer",
                        "description": "Destination profile number (1-3)",
                        "minimum": 1,
                        "maximum": 3,
                    },
                },
                "required": ["source", "destination"],
            },
        ),
        # ===== FAILSAFE & SAFETY =====
        Tool(
            name="get_failsafe_config",
            description="Get failsafe configuration (procedure, delays, throttle settings)",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="set_failsafe_config",
            description="Configure failsafe behavior",
            inputSchema={
                "type": "object",
                "properties": {
                    "procedure": {
                        "type": "string",
                        "enum": ["AUTO_LAND", "DROP", "GPS_RESCUE"],
                        "description": "Failsafe procedure",
                    },
                    "delay": {
                        "type": "number",
                        "description": "Delay before failsafe activates (seconds)",
                    },
                },
                "required": [],
            },
        ),
        Tool(
            name="get_arming_disable_flags",
            description="Get detailed reasons why the drone cannot arm",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="preflight_check",
            description=(
                "Run comprehensive preflight checks: battery, sensors, RC link, "
                "arming status, failsafe, CPU load"
            ),
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        # ===== VTX CONTROL =====
        Tool(
            name="set_vtx_channel",
            description="Change VTX channel (1-8)",
            inputSchema={
                "type": "object",
                "properties": {
                    "channel": {
                        "type": "integer",
                        "description": "Channel number (1-8)",
                        "minimum": 1,
                        "maximum": 8,
                    },
                },
                "required": ["channel"],
            },
        ),
        Tool(
            name="set_vtx_band",
            description="Change VTX band",
            inputSchema={
                "type": "object",
                "properties": {
                    "band": {
                        "type": "string",
                        "enum": ["A", "B", "E", "F", "R"],
                        "description": "Band letter",
                    },
                },
                "required": ["band"],
            },
        ),
        Tool(
            name="set_vtx_power",
            description="Change VTX power level",
            inputSchema={
                "type": "object",
                "properties": {
                    "power": {
                        "type": "integer",
                        "description": "Power level (0-4, varies by VTX)",
                        "minimum": 0,
                        "maximum": 4,
                    },
                },
                "required": ["power"],
            },
        ),
        Tool(
            name="set_vtx_pit_mode",
            description="Enable or disable VTX pit mode (low power when disarmed)",
            inputSchema={
                "type": "object",
                "properties": {
                    "enabled": {
                        "type": "boolean",
                        "description": "True to enable pit mode",
                    },
                },
                "required": ["enabled"],
            },
        ),
        # ===== FLEET MANAGEMENT =====
        Tool(
            name="fleet_register_drone",
            description="Register a drone in the fleet registry with name, port, board info, and notes",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Drone name (e.g., 'SHAKY', 'Chimera 7')",
                    },
                    "port": {
                        "type": "string",
                        "description": "Serial port when connected (e.g., '/dev/tty.usbmodem0001')",
                    },
                    "board": {
                        "type": "string",
                        "description": "FC board type (e.g., 'STM32F405', 'STM32H743')",
                    },
                    "notes": {
                        "type": "string",
                        "description": "Notes about the drone (frame, purpose, etc.)",
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Tags for categorization (e.g., ['freestyle', '5inch'])",
                    },
                },
                "required": ["name", "port"],
            },
        ),
        Tool(
            name="fleet_list_drones",
            description="List all registered drones with last backup date and status",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="fleet_remove_drone",
            description="Remove a drone from the fleet registry by name",
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Name of the drone to remove",
                    },
                },
                "required": ["name"],
            },
        ),
        Tool(
            name="fleet_compare_configs",
            description="Diff the backup configs of two drones to see differences",
            inputSchema={
                "type": "object",
                "properties": {
                    "drone_a": {
                        "type": "string",
                        "description": "Name of first drone",
                    },
                    "drone_b": {
                        "type": "string",
                        "description": "Name of second drone",
                    },
                },
                "required": ["drone_a", "drone_b"],
            },
        ),
        Tool(
            name="fleet_backup_all",
            description=(
                "Sequentially connect to each registered drone, backup its config, "
                "and disconnect. Drones must be connected to their registered ports."
            ),
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        # ===== GPS RESCUE =====
        Tool(
            name="get_gps_rescue_config",
            description=(
                "Get GPS rescue configuration: altitude, speed, min sats, "
                "sanity checks, throttle limits, etc."
            ),
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="set_gps_rescue_config",
            description=(
                "Set a GPS rescue parameter. Common params: min_sats, initial_alt, "
                "descent_dist, ground_speed, throttle_min, throttle_max, throttle_hover, "
                "sanity_checks, allow_arming_without_fix, altitude_mode"
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "param": {
                        "type": "string",
                        "description": "GPS rescue parameter name (e.g., 'min_sats')",
                    },
                    "value": {
                        "type": "string",
                        "description": "Value to set (e.g., '10', 'ON', 'OFF')",
                    },
                },
                "required": ["param", "value"],
            },
        ),
        Tool(
            name="get_gps_status",
            description="Get GPS fix type, satellite count, position (lat/lon), altitude, and HDOP",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        # ===== RATE & PID TUNING =====
        Tool(
            name="get_rc_tuning_full",
            description=(
                "Get full RC tuning: per-axis rates, expo, TPA, rates_type "
                "(Betaflight/Actual/KISS/Quick)"
            ),
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="set_rc_tuning",
            description=(
                "Set RC tuning parameter (rates, expo, TPA). "
                "Params: rates_type, roll_rc_rate, roll_srate, roll_expo, "
                "pitch_rc_rate, pitch_srate, pitch_expo, yaw_rc_rate, yaw_srate, "
                "yaw_expo, tpa_rate, tpa_breakpoint"
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "param": {
                        "type": "string",
                        "description": "Rate parameter name (e.g., 'roll_rc_rate', 'rates_type')",
                    },
                    "value": {
                        "type": "string",
                        "description": "Value to set",
                    },
                },
                "required": ["param", "value"],
            },
        ),
        Tool(
            name="calculate_max_rate",
            description=(
                "Pure math: calculate max rotation rate (deg/s) for given rate settings. "
                "No FC connection needed. Supports Betaflight, Actual, KISS, Quick rate types."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "rates_type": {
                        "type": "string",
                        "enum": ["betaflight", "actual", "kiss", "quick"],
                        "description": "Rate type",
                    },
                    "rc_rate": {
                        "type": "number",
                        "description": "RC rate value (as shown in configurator)",
                    },
                    "rate": {
                        "type": "number",
                        "description": "Super rate / max rate value",
                    },
                    "expo": {
                        "type": "number",
                        "description": "Expo value",
                    },
                },
                "required": ["rates_type", "rc_rate", "rate", "expo"],
            },
        ),
        Tool(
            name="analyze_pid_ratios",
            description=(
                "Analyze PID tuning ratios and provide recommendations. "
                "Checks P:D ratio, I relative to P, and overall balance."
            ),
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        # ===== OSD LAYOUT =====
        Tool(
            name="get_osd_layout",
            description="Get all OSD element positions in structured format with visibility status",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        Tool(
            name="set_osd_element",
            description="Position and toggle an individual OSD element",
            inputSchema={
                "type": "object",
                "properties": {
                    "element": {
                        "type": "string",
                        "description": "Element name (e.g., 'main_batt_voltage', 'gps_sats')",
                    },
                    "col": {
                        "type": "integer",
                        "description": "Column (x) position 0-29",
                        "minimum": 0,
                        "maximum": 29,
                    },
                    "row": {
                        "type": "integer",
                        "description": "Row (y) position 0-15",
                        "minimum": 0,
                        "maximum": 15,
                    },
                    "enabled": {
                        "type": "boolean",
                        "description": "True to show, False to hide",
                    },
                },
                "required": ["element", "col", "row", "enabled"],
            },
        ),
        Tool(
            name="apply_osd_preset",
            description=(
                "Apply a predefined OSD layout preset. "
                "Available: 'long_range' (GPS, distance, efficiency), "
                "'freestyle' (minimal, battery/timer focus), "
                "'race' (ultra minimal, battery/timer only)"
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "preset": {
                        "type": "string",
                        "enum": ["long_range", "freestyle", "race"],
                        "description": "Preset name",
                    },
                },
                "required": ["preset"],
            },
        ),
        Tool(
            name="list_osd_elements",
            description="List all known OSD element names with their current positions",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
    ]


@app.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> list[TextContent]:
    """Handle tool calls by dispatching to the appropriate handler module."""
    global _connection

    try:
        handler = ALL_HANDLERS.get(name)
        if handler is None:
            return [TextContent(type="text", text=f"Unknown tool: {name}")]

        result = await handler(
            _connection,
            arguments,
            set_connection=_set_connection,
            load_fleet=_load_fleet,
            save_fleet=_save_fleet,
            fleet_registry_path=FLEET_REGISTRY_PATH,
            backup_dir=BACKUP_DIR,
        )
        return [TextContent(type="text", text=result)]
    except MSPError as e:
        return [TextContent(type="text", text=f"Error: {e}")]
    except Exception as e:
        return [TextContent(type="text", text=f"Unexpected error: {type(e).__name__}: {e}")]


def main():
    """Main entry point for the MCP server."""
    async def run():
        async with stdio_server() as (read_stream, write_stream):
            await app.run(
                read_stream,
                write_stream,
                app.create_initialization_options(),
            )

    asyncio.run(run())


if __name__ == "__main__":
    main()
