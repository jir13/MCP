"""
OSD tool handlers:
  get_osd_layout, set_osd_element, apply_osd_preset, list_osd_elements
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


# OSD presets: element_name -> (col, row, enabled)
OSD_PRESETS = {
    "long_range": {
        "main_batt_voltage": (1, 0, True),
        "avg_cell_voltage": (1, 1, True),
        "current_draw": (22, 0, True),
        "mah_drawn": (22, 1, True),
        "gps_speed": (1, 2, True),
        "gps_sats": (22, 2, True),
        "gps_lon": (1, 12, True),
        "gps_lat": (1, 13, True),
        "altitude": (22, 3, True),
        "home_dist": (1, 3, True),
        "home_dir": (12, 3, True),
        "flymode": (13, 12, True),
        "rssi_value": (22, 12, True),
        "link_quality": (22, 13, True),
        "craft_name": (10, 0, True),
        "warnings": (10, 14, True),
        "item_timer_1": (1, 14, True),
        "remaining_time_estimate": (22, 14, True),
        "crosshairs": (14, 6, True),
        "throttle_pos": (1, 8, False),
        "efficiency": (22, 4, True),
    },
    "freestyle": {
        "main_batt_voltage": (1, 0, True),
        "avg_cell_voltage": (1, 1, True),
        "current_draw": (22, 0, True),
        "mah_drawn": (22, 1, True),
        "flymode": (13, 12, True),
        "craft_name": (10, 0, True),
        "warnings": (10, 14, True),
        "item_timer_1": (1, 14, True),
        "item_timer_2": (22, 14, True),
        "throttle_pos": (1, 8, True),
        "crosshairs": (14, 6, False),
        "rssi_value": (22, 12, True),
        "link_quality": (22, 13, True),
        "gps_speed": (1, 2, False),
        "gps_sats": (22, 2, False),
        "altitude": (1, 2, False),
        "home_dist": (1, 3, False),
        "gps_lon": (1, 12, False),
        "gps_lat": (1, 13, False),
    },
    "race": {
        "main_batt_voltage": (1, 14, True),
        "warnings": (10, 14, True),
        "item_timer_1": (22, 14, True),
        "rssi_value": (1, 0, True),
        "link_quality": (22, 0, True),
        "flymode": (13, 12, True),
        "craft_name": (10, 0, True),
        "current_draw": (22, 14, False),
        "mah_drawn": (22, 14, False),
        "gps_speed": (1, 2, False),
        "gps_sats": (22, 2, False),
        "altitude": (1, 2, False),
        "home_dist": (1, 3, False),
        "throttle_pos": (1, 8, False),
        "crosshairs": (14, 6, False),
        "gps_lon": (1, 12, False),
        "gps_lat": (1, 13, False),
    },
}


async def handle_get_osd_layout(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    layout = conn.get_osd_layout()

    # Reconnect after CLI
    try:
        conn.reconnect(max_retries=5, retry_delay=1.0)
    except Exception:
        pass

    video_systems = {0: "AUTO", 1: "PAL", 2: "NTSC", 3: "HD"}
    lines = [f"OSD Layout (Video: {video_systems.get(layout.video_system, 'Unknown')}):\n"]

    enabled_elems = [e for e in layout.elements if e.enabled]
    disabled_elems = [e for e in layout.elements if not e.enabled]

    if enabled_elems:
        lines.append("Visible Elements:")
        lines.append(f"  {'Element':<30} {'Col':>3} {'Row':>3}")
        lines.append("  " + "-" * 40)
        for elem in sorted(enabled_elems, key=lambda e: (e.row, e.col)):
            lines.append(f"  {elem.name:<30} {elem.col:>3} {elem.row:>3}")

    if disabled_elems:
        lines.append(f"\nHidden Elements ({len(disabled_elems)}):")
        hidden_names = sorted([e.name for e in disabled_elems])
        lines.append("  " + ", ".join(hidden_names))

    return "\n".join(lines)


async def handle_set_osd_element(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    element = arguments["element"]
    col = arguments["col"]
    row = arguments["row"]
    enabled = arguments["enabled"]

    conn.set_osd_element(element, col, row, enabled)

    status = "visible" if enabled else "hidden"
    return (
        f"OSD element '{element}' set to ({col}, {row}), {status}.\n\n"
        "Use 'save_settings' to persist changes."
    )


async def handle_apply_osd_preset(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    preset_name = arguments["preset"]

    if preset_name not in OSD_PRESETS:
        return f"Unknown preset: {preset_name}. Available: {', '.join(OSD_PRESETS.keys())}"

    preset = OSD_PRESETS[preset_name]
    applied = []
    errors = []

    for elem_name, (col, row, enabled) in preset.items():
        try:
            conn.set_osd_element(elem_name, col, row, enabled)
            status = "ON" if enabled else "OFF"
            applied.append(f"  {elem_name:<30} ({col:>2},{row:>2}) {status}")
        except Exception as e:
            errors.append(f"  {elem_name}: {e}")

    result = f"OSD Preset '{preset_name}' applied:\n\n"
    result += "\n".join(applied)
    if errors:
        result += "\n\nErrors:\n" + "\n".join(errors)
    result += "\n\nUse 'save_settings' to persist changes."
    return result


async def handle_list_osd_elements(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    layout = conn.get_osd_layout()

    # Reconnect after CLI
    try:
        conn.reconnect(max_retries=5, retry_delay=1.0)
    except Exception:
        pass

    lines = ["Known OSD Elements:\n"]
    lines.append(f"  {'Name':<30} {'Status':<8} {'Col':>3} {'Row':>3}")
    lines.append("  " + "-" * 50)

    for elem in sorted(layout.elements, key=lambda e: e.name):
        status = "ON" if elem.enabled else "OFF"
        lines.append(f"  {elem.name:<30} {status:<8} {elem.col:>3} {elem.row:>3}")

    found_names = {e.name for e in layout.elements}
    missing = [name for name in sorted(conn.OSD_ELEMENTS.values()) if name not in found_names]
    if missing:
        lines.append(f"\nNot found in config ({len(missing)}):")
        lines.append("  " + ", ".join(missing))

    return "\n".join(lines)


HANDLERS = {
    "get_osd_layout": handle_get_osd_layout,
    "set_osd_element": handle_set_osd_element,
    "apply_osd_preset": handle_apply_osd_preset,
    "list_osd_elements": handle_list_osd_elements,
}
