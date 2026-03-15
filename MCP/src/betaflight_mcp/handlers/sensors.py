"""
Sensor data tool handlers:
  get_attitude, get_imu_data, get_battery_status, get_motor_values,
  get_rc_channels
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


async def handle_get_attitude(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    att = conn.get_attitude()
    return (
        f"Aircraft Attitude:\n"
        f"  Roll:  {att.roll:+7.1f}\u00b0\n"
        f"  Pitch: {att.pitch:+7.1f}\u00b0\n"
        f"  Yaw:   {att.yaw:+7.1f}\u00b0 (heading)"
    )


async def handle_get_imu_data(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    imu = conn.get_imu_data()
    return (
        f"IMU Sensor Data:\n\n"
        f"Accelerometer:\n"
        f"  X: {imu.acc_x:6d}  Y: {imu.acc_y:6d}  Z: {imu.acc_z:6d}\n\n"
        f"Gyroscope:\n"
        f"  X: {imu.gyro_x:6d}  Y: {imu.gyro_y:6d}  Z: {imu.gyro_z:6d}\n\n"
        f"Magnetometer:\n"
        f"  X: {imu.mag_x:6d}  Y: {imu.mag_y:6d}  Z: {imu.mag_z:6d}"
    )


async def handle_get_battery_status(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    analog = conn.get_analog_data()
    return (
        f"Battery Status:\n"
        f"  Voltage:  {analog.voltage:.1f}V\n"
        f"  Current:  {analog.amperage:.2f}A\n"
        f"  Consumed: {analog.mah_drawn} mAh\n"
        f"  RSSI:     {analog.rssi}"
    )


async def handle_get_motor_values(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    motors = conn.get_motor_values()
    lines = ["Motor Output Values:"]
    for i, val in enumerate(motors.motors, 1):
        bar_len = (val - 1000) // 50  # 0-20 chars for 1000-2000
        bar = "\u2588" * bar_len + "\u2591" * (20 - bar_len)
        lines.append(f"  Motor {i}: {val:4d} [{bar}]")
    return "\n".join(lines)


async def handle_get_rc_channels(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    rc = conn.get_rc_channels()
    channel_names = ["Roll", "Pitch", "Yaw", "Throttle", "Aux1", "Aux2", "Aux3", "Aux4"]
    lines = ["RC Channel Values:"]
    for i, val in enumerate(rc.channels):
        ch_name = channel_names[i] if i < len(channel_names) else f"Ch{i+1}"
        deviation = val - 1500
        lines.append(f"  {ch_name:8s}: {val:4d} ({deviation:+4d})")
    return "\n".join(lines)


HANDLERS = {
    "get_attitude": handle_get_attitude,
    "get_imu_data": handle_get_imu_data,
    "get_battery_status": handle_get_battery_status,
    "get_motor_values": handle_get_motor_values,
    "get_rc_channels": handle_get_rc_channels,
}
