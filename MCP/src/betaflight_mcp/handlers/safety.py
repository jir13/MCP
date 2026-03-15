"""
Safety tool handlers:
  preflight_check, stop_motors, test_motor, beep,
  calibrate_accelerometer, calibrate_magnetometer
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


async def handle_preflight_check(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    result = conn.run_preflight_check()

    lines = ["PREFLIGHT CHECK\n" + "=" * 40 + "\n"]

    for check in result.checks:
        status = "\u2713" if check.passed else "\u2717"
        lines.append(f"{status} {check.name}: {check.message}")

    lines.append("\n" + "=" * 40)
    if result.all_passed:
        lines.append("RESULT: ALL CHECKS PASSED - Ready to fly!")
    else:
        lines.append("RESULT: SOME CHECKS FAILED - Review issues above")

    return "\n".join(lines)


async def handle_stop_motors(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    conn.stop_all_motors()
    return "All motors stopped."


async def handle_test_motor(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    motor_num = arguments["motor"]
    throttle = arguments["throttle_percent"]

    # Safety check - verify not armed
    status = conn.get_status()
    if status.armed:
        return "ERROR: Cannot test motors while armed! Disarm first."

    motor_index = motor_num - 1
    pwm_value = 1000 + (throttle * 10)

    conn.set_motor(motor_index, pwm_value)
    return (
        f"Motor {motor_num} spinning at {throttle}% (PWM: {pwm_value})\n\n"
        "WARNING: Motor is now spinning! Use 'stop_motors' to stop.\n"
        "SAFETY: Ensure propellers are removed!"
    )


async def handle_beep(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    conn.beep()
    return "Beep! (If you didn't hear it, check the buzzer connection)"


async def handle_calibrate_accelerometer(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)

    status = conn.get_status()
    if status.armed:
        return "ERROR: Cannot calibrate while armed! Disarm first."

    conn.calibrate_accelerometer()
    return (
        "Accelerometer calibration complete!\n\n"
        "The drone should now read level when on a flat surface.\n"
        "Use 'save_settings' to persist the calibration."
    )


async def handle_calibrate_magnetometer(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)

    status = conn.get_status()
    if status.armed:
        return "ERROR: Cannot calibrate while armed! Disarm first."

    conn.calibrate_magnetometer()
    return (
        "Magnetometer calibration started!\n\n"
        "Rotate the drone through all orientations (360\u00b0 on each axis).\n"
        "Calibration will complete automatically after ~30 seconds."
    )


HANDLERS = {
    "preflight_check": handle_preflight_check,
    "stop_motors": handle_stop_motors,
    "test_motor": handle_test_motor,
    "beep": handle_beep,
    "calibrate_accelerometer": handle_calibrate_accelerometer,
    "calibrate_magnetometer": handle_calibrate_magnetometer,
}
