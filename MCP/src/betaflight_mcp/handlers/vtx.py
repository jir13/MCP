"""
VTX tool handlers:
  get_vtx_config, set_vtx_channel, set_vtx_band, set_vtx_power, set_vtx_pit_mode
"""

from __future__ import annotations

from typing import Any, Optional

from ..msp import MSPConnection, MSPError


def _get_connection(connection: Optional[MSPConnection]) -> MSPConnection:
    if connection is None or not connection.is_connected():
        raise MSPError(
            "Not connected to flight controller. "
            "Use 'connect_flight_controller' tool first."
        )
    return connection


async def handle_get_vtx_config(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    vtx = conn.get_vtx_config()
    bands = {0: "N/A", 1: "A", 2: "B", 3: "E", 4: "F", 5: "R"}
    vtx_types = {0: "None", 1: "RTC6705", 2: "SmartAudio", 3: "Tramp", 4: "Table"}
    return (
        f"VTX Configuration:\n"
        f"  Type:      {vtx_types.get(vtx.vtx_type, 'Unknown')}\n"
        f"  Band:      {bands.get(vtx.band, 'Unknown')}\n"
        f"  Channel:   {vtx.channel}\n"
        f"  Power:     {vtx.power}\n"
        f"  Frequency: {vtx.frequency} MHz\n"
        f"  Pit Mode:  {'On' if vtx.pit_mode else 'Off'}\n"
        f"  Low Power Disarm: {'On' if vtx.low_power_disarm else 'Off'}"
    )


async def handle_set_vtx_channel(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    channel = arguments["channel"]

    vtx = conn.get_vtx_config()
    conn.set_vtx_band_channel(vtx.band, channel)
    return (
        f"VTX channel set to {channel}.\n\n"
        "Use 'save_settings' to persist."
    )


async def handle_set_vtx_band(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    band_letter = arguments["band"].upper()
    band_map = {"A": 1, "B": 2, "E": 3, "F": 4, "R": 5}
    band = band_map.get(band_letter, 1)

    vtx = conn.get_vtx_config()
    conn.set_vtx_band_channel(band, vtx.channel)
    return (
        f"VTX band set to {band_letter}.\n\n"
        "Use 'save_settings' to persist."
    )


async def handle_set_vtx_power(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    power = arguments["power"]
    conn.set_vtx_power(power)
    return (
        f"VTX power set to level {power}.\n\n"
        "Use 'save_settings' to persist."
    )


async def handle_set_vtx_pit_mode(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    enabled = arguments["enabled"]
    conn.set_vtx_pit_mode(enabled)
    status = "enabled" if enabled else "disabled"
    return (
        f"VTX pit mode {status}.\n\n"
        "Use 'save_settings' to persist."
    )


HANDLERS = {
    "get_vtx_config": handle_get_vtx_config,
    "set_vtx_channel": handle_set_vtx_channel,
    "set_vtx_band": handle_set_vtx_band,
    "set_vtx_power": handle_set_vtx_power,
    "set_vtx_pit_mode": handle_set_vtx_pit_mode,
}
