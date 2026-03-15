"""
Connection-related tool handlers:
  list_serial_ports, connect_flight_controller, disconnect_flight_controller,
  reconnect_flight_controller, get_flight_controller_info, get_flight_controller_status
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict
from datetime import datetime
from typing import Any, Optional

import serial.tools.list_ports

from ..msp import MSPConnection, MSPError


def _get_connection(connection: Optional[MSPConnection]) -> MSPConnection:
    if connection is None or not connection.is_connected():
        raise MSPError(
            "Not connected to flight controller. "
            "Use 'connect_flight_controller' tool first."
        )
    return connection


async def handle_list_serial_ports(
    connection: Optional[MSPConnection],
    arguments: dict[str, Any],
    *,
    set_connection,
    load_fleet,
    save_fleet,
    fleet_registry_path: str,
    backup_dir: str,
) -> str:
    ports = list(serial.tools.list_ports.comports())
    if not ports:
        return "No serial ports found."

    result = "Available serial ports:\n"
    for port in ports:
        result += f"\n- {port.device}"
        if port.description:
            result += f"\n  Description: {port.description}"
        if port.manufacturer:
            result += f"\n  Manufacturer: {port.manufacturer}"
        if port.vid and port.pid:
            result += f"\n  VID:PID: {port.vid:04X}:{port.pid:04X}"

    result += "\n\nTip: Betaflight FCs typically show as 'STM32' or contain 'usbmodem' in the name."
    return result


async def handle_connect_flight_controller(
    connection: Optional[MSPConnection],
    arguments: dict[str, Any],
    *,
    set_connection,
    load_fleet,
    save_fleet,
    fleet_registry_path: str,
    backup_dir: str,
) -> str:
    port = arguments["port"]
    baudrate = arguments.get("baudrate", 115200)

    # Force-close existing connection if any (handles stale/dead handles)
    if connection is not None:
        connection._force_close()

    connection = MSPConnection(port, baudrate)
    connection.connect()

    # Verify connection by reading FC info
    try:
        info = connection.get_fc_info()
    except Exception as e:
        connection._force_close()
        set_connection(None)
        raise MSPError(f"Connected but failed to read FC info: {e}")

    set_connection(connection)

    result = (
        f"Connected to flight controller!\n\n"
        f"Firmware: {info.variant} {info.version}\n"
        f"API Version: {info.api_version}\n"
        f"Board: {info.board_name}\n"
        f"Target: {info.target_name}\n"
        f"Craft Name: {info.craft_name or '(not set)'}"
    )

    # Auto-backup if drone is in fleet registry
    try:
        fleet = load_fleet()
        craft = info.craft_name or "unknown"
        matching = [d for d in fleet.get("drones", [])
                    if d["name"].lower() == craft.lower() or d.get("port") == port]
        if matching:
            drone_entry = matching[0]
            # Perform auto-backup
            try:
                config = connection.get_diff()
                os.makedirs(backup_dir, exist_ok=True)
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                safe_name = drone_entry["name"].replace(" ", "_")
                backup_path = os.path.join(backup_dir, f"{safe_name}_{timestamp}.txt")
                with open(backup_path, 'w') as f:
                    f.write(f"# Auto-backup of {drone_entry['name']}\n")
                    f.write(f"# Date: {datetime.now().isoformat()}\n")
                    f.write(f"# Port: {port}\n\n")
                    f.write(config)

                # Update fleet entry
                drone_entry["last_backup"] = datetime.now().isoformat()
                drone_entry["last_backup_file"] = backup_path
                save_fleet(fleet)

                # Reconnect after CLI exit
                try:
                    connection.reconnect(max_retries=5, retry_delay=1.0)
                except Exception:
                    connection._force_close()
                    connection = MSPConnection(port, baudrate)
                    connection.reconnect(max_retries=5, retry_delay=1.0)

                set_connection(connection)
                result += f"\n\nAuto-backup saved: {backup_path}"
            except Exception as e:
                result += f"\n\nAuto-backup failed: {e}"
    except Exception:
        pass  # Fleet registry not available, skip auto-backup

    return result


async def handle_disconnect_flight_controller(
    connection: Optional[MSPConnection],
    arguments: dict[str, Any],
    *,
    set_connection,
    load_fleet,
    save_fleet,
    fleet_registry_path: str,
    backup_dir: str,
) -> str:
    if connection is None:
        return "Not connected to any flight controller."

    connection._force_close()
    set_connection(None)
    return "Disconnected from flight controller."


async def handle_reconnect_flight_controller(
    connection: Optional[MSPConnection],
    arguments: dict[str, Any],
    *,
    set_connection,
    load_fleet,
    save_fleet,
    fleet_registry_path: str,
    backup_dir: str,
) -> str:
    port = arguments.get("port")

    # Use last known port if not specified
    if not port and connection is not None:
        port = connection.port
    if not port:
        raise MSPError(
            "No port specified and no previous connection. "
            "Use 'connect_flight_controller' with a port instead."
        )

    baudrate = 115200
    if connection is not None:
        baudrate = connection.baudrate
        connection._force_close()

    new_conn = MSPConnection(port, baudrate)
    new_conn.reconnect(max_retries=5, retry_delay=1.0)

    # Verify connection
    try:
        info = new_conn.get_fc_info()
        set_connection(new_conn)
        return (
            f"Reconnected to flight controller!\n\n"
            f"Firmware: {info.variant} {info.version}\n"
            f"API Version: {info.api_version}\n"
            f"Board: {info.board_name}\n"
            f"Craft Name: {info.craft_name or '(not set)'}"
        )
    except Exception as e:
        new_conn._force_close()
        set_connection(None)
        raise MSPError(f"Reconnected but failed to read FC info: {e}")


async def handle_get_flight_controller_info(
    connection: Optional[MSPConnection],
    arguments: dict[str, Any],
    *,
    set_connection,
    load_fleet,
    save_fleet,
    fleet_registry_path: str,
    backup_dir: str,
) -> str:
    conn = _get_connection(connection)
    info = conn.get_fc_info()
    return json.dumps(asdict(info), indent=2)


async def handle_get_flight_controller_status(
    connection: Optional[MSPConnection],
    arguments: dict[str, Any],
    *,
    set_connection,
    load_fleet,
    save_fleet,
    fleet_registry_path: str,
    backup_dir: str,
) -> str:
    conn = _get_connection(connection)
    status = conn.get_status()
    return json.dumps(asdict(status), indent=2)


HANDLERS = {
    "list_serial_ports": handle_list_serial_ports,
    "connect_flight_controller": handle_connect_flight_controller,
    "disconnect_flight_controller": handle_disconnect_flight_controller,
    "reconnect_flight_controller": handle_reconnect_flight_controller,
    "get_flight_controller_info": handle_get_flight_controller_info,
    "get_flight_controller_status": handle_get_flight_controller_status,
}
