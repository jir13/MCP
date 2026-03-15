"""
GPS tool handlers:
  get_gps_status, get_gps_rescue_config, set_gps_rescue_config
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


async def handle_get_gps_status(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    gps = conn.get_gps_status()

    fix_names = {0: "No Fix", 1: "2D Fix", 2: "3D Fix"}
    fix_quality = "Good" if gps.fix_type >= 2 and gps.num_sats >= 6 else "Poor" if gps.fix_type > 0 else "None"

    return (
        "GPS Status:\n\n"
        f"  Fix Type:     {fix_names.get(gps.fix_type, f'Unknown({gps.fix_type})')} ({fix_quality})\n"
        f"  Satellites:   {gps.num_sats}\n"
        f"  Latitude:     {gps.latitude:.7f}\u00b0\n"
        f"  Longitude:    {gps.longitude:.7f}\u00b0\n"
        f"  Altitude:     {gps.altitude_m} m\n"
        f"  Ground Speed: {gps.ground_speed_cm_s} cm/s ({gps.ground_speed_cm_s / 100:.1f} m/s)\n"
        f"  Course:       {gps.ground_course / 10:.1f}\u00b0\n"
        f"  HDOP:         {gps.hdop / 100:.2f}" if gps.hdop else
        "GPS Status:\n\n"
        f"  Fix Type:     {fix_names.get(gps.fix_type, f'Unknown({gps.fix_type})')} ({fix_quality})\n"
        f"  Satellites:   {gps.num_sats}\n"
        f"  Latitude:     {gps.latitude:.7f}\u00b0\n"
        f"  Longitude:    {gps.longitude:.7f}\u00b0\n"
        f"  Altitude:     {gps.altitude_m} m\n"
        f"  Ground Speed: {gps.ground_speed_cm_s} cm/s\n"
        f"  Course:       {gps.ground_course / 10:.1f}\u00b0"
    )


async def handle_get_gps_rescue_config(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    gps = conn.get_gps_rescue_config()

    # Reconnect after CLI
    try:
        conn.reconnect(max_retries=5, retry_delay=1.0)
    except Exception:
        pass

    return (
        "GPS Rescue Configuration:\n\n"
        f"  Min Satellites:     {gps.min_sats}\n"
        f"  Max Angle:          {gps.angle}\u00b0\n"
        f"  Initial Altitude:   {gps.initial_altitude_m} m\n"
        f"  Descent Distance:   {gps.descent_distance_m} m\n"
        f"  Ground Speed:       {gps.ground_speed_cm_s} cm/s ({gps.ground_speed_cm_s / 100:.1f} m/s)\n"
        f"  Throttle Min:       {gps.throttle_min}\n"
        f"  Throttle Max:       {gps.throttle_max}\n"
        f"  Throttle Hover:     {gps.throttle_hover}\n"
        f"  Sanity Checks:      {gps.sanity_checks}\n"
        f"  Min Rescue Distance: {gps.min_rescue_dth} m\n"
        f"  Arm Without Fix:    {'Yes' if gps.allow_arming_without_fix else 'No'}\n"
        f"  Altitude Mode:      {gps.altitude_mode}\n"
        f"  Ascend Rate:        {gps.ascend_rate} cm/s\n"
        f"  Descend Rate:       {gps.descend_rate} cm/s"
    )


async def handle_set_gps_rescue_config(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    param = arguments["param"]
    value = arguments["value"]

    response = conn.set_gps_rescue_config(param, value)

    return (
        f"GPS rescue '{param}' set to '{value}'.\n\n"
        f"CLI response: {response}\n\n"
        "Use 'save_settings' to persist changes."
    )


HANDLERS = {
    "get_gps_status": handle_get_gps_status,
    "get_gps_rescue_config": handle_get_gps_rescue_config,
    "set_gps_rescue_config": handle_set_gps_rescue_config,
}
