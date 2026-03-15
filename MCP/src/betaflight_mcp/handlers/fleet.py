"""
Fleet management tool handlers:
  fleet_register_drone, fleet_list_drones, fleet_remove_drone,
  fleet_backup_all, fleet_compare_configs
"""

from __future__ import annotations

import difflib
import json
import os
from datetime import datetime
from typing import Any, Optional

from ..msp import MSPConnection, MSPError


def _load_fleet(fleet_registry_path: str) -> dict:
    """Load fleet registry from JSON file."""
    if not os.path.exists(fleet_registry_path):
        return {"drones": []}
    with open(fleet_registry_path, 'r') as f:
        return json.load(f)


def _save_fleet(data: dict, fleet_registry_path: str) -> None:
    """Save fleet registry to JSON file."""
    os.makedirs(os.path.dirname(fleet_registry_path), exist_ok=True)
    with open(fleet_registry_path, 'w') as f:
        json.dump(data, f, indent=2)


async def handle_fleet_register_drone(
    connection, arguments, *,
    set_connection, load_fleet, save_fleet,
    fleet_registry_path: str, backup_dir: str,
) -> str:
    fleet = load_fleet()
    drone_name = arguments["name"]

    existing = [d for d in fleet["drones"] if d["name"].lower() == drone_name.lower()]
    if existing:
        return f"Drone '{drone_name}' already registered. Remove it first to re-register."

    entry = {
        "name": drone_name,
        "port": arguments["port"],
        "board": arguments.get("board", ""),
        "notes": arguments.get("notes", ""),
        "tags": arguments.get("tags", []),
        "registered": datetime.now().isoformat(),
        "last_backup": None,
        "last_backup_file": None,
    }
    fleet["drones"].append(entry)
    save_fleet(fleet)
    return (
        f"Drone '{drone_name}' registered!\n\n"
        f"  Port:  {entry['port']}\n"
        f"  Board: {entry['board'] or '(not set)'}\n"
        f"  Notes: {entry['notes'] or '(none)'}\n"
        f"  Tags:  {', '.join(entry['tags']) if entry['tags'] else '(none)'}"
    )


async def handle_fleet_list_drones(
    connection, arguments, *,
    set_connection, load_fleet, save_fleet,
    fleet_registry_path: str, backup_dir: str,
) -> str:
    fleet = load_fleet()
    drones = fleet.get("drones", [])
    if not drones:
        return "No drones registered. Use 'fleet_register_drone' to add one."

    lines = [f"Fleet Registry ({len(drones)} drones):\n"]
    lines.append(f"{'Name':<15} {'Port':<30} {'Board':<12} {'Last Backup':<20} {'Tags'}")
    lines.append("-" * 95)
    for d in drones:
        backup_str = d.get("last_backup", "")
        if backup_str:
            try:
                dt = datetime.fromisoformat(backup_str)
                backup_str = dt.strftime("%Y-%m-%d %H:%M")
            except (ValueError, TypeError):
                backup_str = str(backup_str)[:16]
        else:
            backup_str = "Never"
        tags = ", ".join(d.get("tags", []))
        lines.append(
            f"{d['name']:<15} {d.get('port', ''):<30} {d.get('board', ''):<12} {backup_str:<20} {tags}"
        )
    return "\n".join(lines)


async def handle_fleet_remove_drone(
    connection, arguments, *,
    set_connection, load_fleet, save_fleet,
    fleet_registry_path: str, backup_dir: str,
) -> str:
    fleet = load_fleet()
    drone_name = arguments["name"]
    original_count = len(fleet["drones"])
    fleet["drones"] = [d for d in fleet["drones"] if d["name"].lower() != drone_name.lower()]

    if len(fleet["drones"]) == original_count:
        return f"Drone '{drone_name}' not found in registry."

    save_fleet(fleet)
    return f"Drone '{drone_name}' removed from fleet registry."


async def handle_fleet_compare_configs(
    connection, arguments, *,
    set_connection, load_fleet, save_fleet,
    fleet_registry_path: str, backup_dir: str,
) -> str:
    drone_a_name = arguments["drone_a"]
    drone_b_name = arguments["drone_b"]
    fleet = load_fleet()

    def find_backup(name):
        for d in fleet.get("drones", []):
            if d["name"].lower() == name.lower():
                return d.get("last_backup_file")
        return None

    file_a = find_backup(drone_a_name)
    file_b = find_backup(drone_b_name)

    if not file_a:
        return f"No backup found for '{drone_a_name}'. Connect and backup first."
    if not file_b:
        return f"No backup found for '{drone_b_name}'. Connect and backup first."
    if not os.path.exists(file_a):
        return f"Backup file not found: {file_a}"
    if not os.path.exists(file_b):
        return f"Backup file not found: {file_b}"

    with open(file_a, 'r') as f:
        lines_a = f.readlines()
    with open(file_b, 'r') as f:
        lines_b = f.readlines()

    lines_a_clean = [l for l in lines_a if not l.startswith('#')]
    lines_b_clean = [l for l in lines_b if not l.startswith('#')]

    diff = list(difflib.unified_diff(
        lines_a_clean, lines_b_clean,
        fromfile=drone_a_name, tofile=drone_b_name,
        lineterm='',
    ))

    if not diff:
        return f"No differences between '{drone_a_name}' and '{drone_b_name}'."

    return (
        f"Config differences: {drone_a_name} vs {drone_b_name}\n\n" +
        "\n".join(diff)
    )


async def handle_fleet_backup_all(
    connection, arguments, *,
    set_connection, load_fleet, save_fleet,
    fleet_registry_path: str, backup_dir: str,
) -> str:
    fleet = load_fleet()
    drones = fleet.get("drones", [])
    if not drones:
        return "No drones registered."

    results = []
    for drone in drones:
        drone_name = drone["name"]
        port = drone.get("port", "")
        if not port:
            results.append(f"  {drone_name}: SKIPPED (no port configured)")
            continue

        try:
            # Connect
            if connection is not None:
                connection._force_close()
            conn = MSPConnection(port)
            conn.connect()

            # Verify
            info = conn.get_fc_info()

            # Backup
            config = conn.get_diff()
            os.makedirs(backup_dir, exist_ok=True)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            safe_name = drone_name.replace(" ", "_")
            backup_path = os.path.join(backup_dir, f"{safe_name}_{timestamp}.txt")
            with open(backup_path, 'w') as f:
                f.write(f"# Fleet backup of {drone_name}\n")
                f.write(f"# Date: {datetime.now().isoformat()}\n")
                f.write(f"# Firmware: {info.variant} {info.version}\n\n")
                f.write(config)

            # Update fleet entry
            drone["last_backup"] = datetime.now().isoformat()
            drone["last_backup_file"] = backup_path

            # Reconnect and disconnect cleanly
            try:
                conn.reconnect(max_retries=3, retry_delay=1.0)
                conn.disconnect()
            except Exception:
                conn._force_close()

            results.append(f"  {drone_name}: OK -> {backup_path}")
        except Exception as e:
            results.append(f"  {drone_name}: FAILED ({e})")

    save_fleet(fleet)

    # Reset global connection state
    set_connection(None)

    return "Fleet Backup Results:\n\n" + "\n".join(results)


HANDLERS = {
    "fleet_register_drone": handle_fleet_register_drone,
    "fleet_list_drones": handle_fleet_list_drones,
    "fleet_remove_drone": handle_fleet_remove_drone,
    "fleet_compare_configs": handle_fleet_compare_configs,
    "fleet_backup_all": handle_fleet_backup_all,
}
