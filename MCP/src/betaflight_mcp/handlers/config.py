"""
Configuration tool handlers:
  get_pid_settings, set_pid_settings, get_rc_tuning, save_settings,
  backup_configuration, send_cli_command, get_filter_config, get_battery_config,
  get_motor_config, get_osd_config, get_blackbox_config, get_dataflash_summary,
  get_features, set_feature, set_craft_name, erase_blackbox_logs,
  reboot_flight_controller, get_available_modes, get_aux_modes, set_aux_mode,
  clear_aux_mode, get_current_profile, set_pid_profile, set_rate_profile,
  copy_pid_profile, get_failsafe_config, set_failsafe_config,
  get_arming_disable_flags, get_rc_tuning_full, set_rc_tuning,
  calculate_max_rate, analyze_pid_ratios
"""

from __future__ import annotations

import json
from dataclasses import asdict
from typing import Any, Optional

from ..msp import (
    MSPConnection,
    MSPError,
    PIDSettings,
    FEATURE_FLAGS,
    FLIGHT_MODES,
)


# PID validation ranges (Betaflight typical safe ranges)
PID_RANGES = {
    'p': (0, 200),
    'i': (0, 200),
    'd': (0, 200),
}

# Rate type names
RATE_TYPE_NAMES = {
    0: "Betaflight",
    1: "Raceflight",
    2: "KISS",
    3: "Actual",
    4: "Quick",
}


def _get_connection(connection: Optional[MSPConnection]) -> MSPConnection:
    if connection is None or not connection.is_connected():
        raise MSPError(
            "Not connected to flight controller. "
            "Use 'connect_flight_controller' tool first."
        )
    return connection


def validate_pid_value(name: str, value: int, component: str) -> None:
    """Validate a PID value is within safe range."""
    min_val, max_val = PID_RANGES[component.lower()]
    if not min_val <= value <= max_val:
        raise ValueError(
            f"{name} {component.upper()} value {value} is outside safe range "
            f"[{min_val}-{max_val}]"
        )


def calculate_betaflight_rate(rc_rate: float, super_rate: float, expo: float) -> float:
    """Calculate max deg/s for Betaflight rate type."""
    rc_command = 1.0
    rc_command_f = rc_command * abs(rc_command) ** 3 * expo + rc_command * (1.0 - expo)
    angle_rate = 200.0 * rc_rate * rc_command_f
    if super_rate > 0:
        angle_rate += 200.0 * rc_rate * rc_command_f * super_rate * abs(rc_command_f) / (1.0 - abs(rc_command_f) * super_rate)
    if super_rate < 1.0:
        return rc_rate * 200.0 / (1.0 - super_rate)
    else:
        return rc_rate * 200.0 * 100.0


def calculate_actual_rate(center_sensitivity: float, max_rate: float, expo: float) -> float:
    """Calculate max deg/s for Actual rate type. Max rate IS the max rate."""
    return max_rate * 10.0


def calculate_kiss_rate(rc_rate: float, rate: float, rc_curve: float) -> float:
    """Calculate max deg/s for KISS rate type."""
    return rc_rate * (1.0 + rate * 0.01) * 10.0


def calculate_quick_rate(rc_rate: float, max_rate: float, expo: float) -> float:
    """Calculate max deg/s for Quick rate type. Max rate IS the max."""
    return max_rate * 10.0


# ---------------------------------------------------------------------------
# Common keyword arguments that every handler receives (but not all use)
# ---------------------------------------------------------------------------
_COMMON_KW = dict(
    set_connection=None,
    load_fleet=None,
    save_fleet=None,
    fleet_registry_path="",
    backup_dir="",
)


async def handle_get_pid_settings(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    pids = conn.get_pid_settings()
    return (
        "Current PID Settings:\n\n"
        "        P     I     D\n"
        f"Roll:   {pids.roll_p:3d}   {pids.roll_i:3d}   {pids.roll_d:3d}\n"
        f"Pitch:  {pids.pitch_p:3d}   {pids.pitch_i:3d}   {pids.pitch_d:3d}\n"
        f"Yaw:    {pids.yaw_p:3d}   {pids.yaw_i:3d}   {pids.yaw_d:3d}"
    )


async def handle_set_pid_settings(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    current = conn.get_pid_settings()

    new_pids = PIDSettings(
        roll_p=arguments.get("roll_p", current.roll_p),
        roll_i=arguments.get("roll_i", current.roll_i),
        roll_d=arguments.get("roll_d", current.roll_d),
        pitch_p=arguments.get("pitch_p", current.pitch_p),
        pitch_i=arguments.get("pitch_i", current.pitch_i),
        pitch_d=arguments.get("pitch_d", current.pitch_d),
        yaw_p=arguments.get("yaw_p", current.yaw_p),
        yaw_i=arguments.get("yaw_i", current.yaw_i),
        yaw_d=arguments.get("yaw_d", current.yaw_d),
    )

    validate_pid_value("Roll", new_pids.roll_p, "p")
    validate_pid_value("Roll", new_pids.roll_i, "i")
    validate_pid_value("Roll", new_pids.roll_d, "d")
    validate_pid_value("Pitch", new_pids.pitch_p, "p")
    validate_pid_value("Pitch", new_pids.pitch_i, "i")
    validate_pid_value("Pitch", new_pids.pitch_d, "d")
    validate_pid_value("Yaw", new_pids.yaw_p, "p")
    validate_pid_value("Yaw", new_pids.yaw_i, "i")
    validate_pid_value("Yaw", new_pids.yaw_d, "d")

    conn.set_pid_settings(new_pids)

    changes = []
    for axis in ['roll', 'pitch', 'yaw']:
        for comp in ['p', 'i', 'd']:
            old_val = getattr(current, f"{axis}_{comp}")
            new_val = getattr(new_pids, f"{axis}_{comp}")
            if old_val != new_val:
                changes.append(f"  {axis.capitalize()} {comp.upper()}: {old_val} -> {new_val}")

    if changes:
        return (
            "PID settings updated:\n" +
            "\n".join(changes) +
            "\n\nNote: Use 'save_settings' to persist changes to EEPROM."
        )
    else:
        return "No changes made (all values already match)."


async def handle_get_rc_tuning(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    tuning = conn.get_rc_tuning()
    return json.dumps(asdict(tuning), indent=2)


async def handle_save_settings(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    conn.save_settings()
    return "Settings saved to EEPROM successfully."


async def handle_backup_configuration(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    mode = arguments.get("mode", "diff")

    if mode == "diff":
        config = conn.get_diff()
        header = "Configuration Diff (changes from defaults)"
    else:
        config = conn.get_dump()
        header = "Full Configuration Dump"

    # CLI mode exit reboots the FC -- auto-reconnect
    try:
        conn.reconnect(max_retries=5, retry_delay=1.0)
        reconnect_status = "\n\n(Auto-reconnected after CLI exit)"
    except Exception:
        reconnect_status = (
            "\n\n\u26a0 Connection lost after backup (FC rebooted). "
            "Use 'reconnect_flight_controller' or unplug/replug USB."
        )
        conn._force_close()

    return f"{header}:\n\n{config}{reconnect_status}"


async def handle_send_cli_command(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    command = arguments["command"]

    dangerous_commands = ['bl', 'dfu', 'exit']
    cmd_lower = command.lower().split()[0] if command.split() else ""
    if cmd_lower in dangerous_commands:
        return (
            f"Command '{cmd_lower}' is blocked for safety. "
            "This command could put the FC in an unrecoverable state."
        )

    response = conn.send_cli_command(command)
    return f"CLI Response:\n{response}"


async def handle_get_filter_config(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    filt = conn.get_filter_config()
    filter_types = {0: "PT1", 1: "BIQUAD", 2: "PT2", 3: "PT3"}
    return (
        f"Filter Configuration:\n\n"
        f"Gyro Lowpass:\n"
        f"  Lowpass 1: {filt.gyro_lowpass_hz} Hz ({filter_types.get(filt.gyro_lowpass_type, 'Unknown')})\n"
        f"  Lowpass 2: {filt.gyro_lowpass2_hz} Hz ({filter_types.get(filt.gyro_lowpass2_type, 'Unknown')})\n\n"
        f"Gyro Notch:\n"
        f"  Center: {filt.gyro_notch_hz} Hz, Cutoff: {filt.gyro_notch_cutoff} Hz\n\n"
        f"D-Term Lowpass:\n"
        f"  Lowpass 1: {filt.dterm_lowpass_hz} Hz ({filter_types.get(filt.dterm_lowpass_type, 'Unknown')})\n"
        f"  Lowpass 2: {filt.dterm_lowpass2_hz} Hz ({filter_types.get(filt.dterm_lowpass2_type, 'Unknown')})\n\n"
        f"D-Term Notch:\n"
        f"  Center: {filt.dterm_notch_hz} Hz, Cutoff: {filt.dterm_notch_cutoff} Hz"
    )


async def handle_get_battery_config(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    batt = conn.get_battery_config()
    meter_sources = {0: "None", 1: "ADC", 2: "ESC"}
    return (
        f"Battery Configuration:\n"
        f"  Min Cell Voltage:     {batt.vbat_min_cell_voltage:.1f}V\n"
        f"  Max Cell Voltage:     {batt.vbat_max_cell_voltage:.1f}V\n"
        f"  Warning Cell Voltage: {batt.vbat_warning_cell_voltage:.1f}V\n"
        f"  Capacity:             {batt.capacity} mAh\n"
        f"  Voltage Meter:        {meter_sources.get(batt.voltage_meter_source, 'Unknown')}\n"
        f"  Current Meter:        {meter_sources.get(batt.current_meter_source, 'Unknown')}"
    )


async def handle_get_motor_config(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    motor = conn.get_motor_config()
    protocols = {
        0: "PWM", 1: "ONESHOT125", 2: "ONESHOT42", 3: "MULTISHOT",
        4: "BRUSHED", 5: "DSHOT150", 6: "DSHOT300", 7: "DSHOT600",
        8: "DSHOT1200", 9: "PROSHOT1000"
    }
    return (
        f"Motor Configuration:\n"
        f"  Min Throttle: {motor.min_throttle}\n"
        f"  Max Throttle: {motor.max_throttle}\n"
        f"  Min Command:  {motor.min_command}\n"
        f"  Motor Poles:  {motor.motor_poles}\n"
        f"  Protocol:     {protocols.get(motor.motor_pwm_protocol, 'Unknown')}\n"
        f"  DSHOT Telemetry: {'Enabled' if motor.use_dshot_telemetry else 'Disabled'}"
    )


async def handle_get_osd_config(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    osd = conn.get_osd_config()
    video_systems = {0: "AUTO", 1: "PAL", 2: "NTSC", 3: "HD"}
    units = {0: "Imperial", 1: "Metric"}
    return (
        f"OSD Configuration:\n"
        f"  Video System: {video_systems.get(osd.video_system, 'Unknown')}\n"
        f"  Units:        {units.get(osd.units, 'Unknown')}\n"
        f"  RSSI Alarm:   {osd.rssi_alarm}%\n"
        f"  Capacity Alarm: {osd.cap_alarm} mAh"
    )


async def handle_get_blackbox_config(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    bb = conn.get_blackbox_config()
    devices = {0: "None", 1: "Flash", 2: "SD Card", 3: "Serial"}
    return (
        f"Blackbox Configuration:\n"
        f"  Device:     {devices.get(bb.device, 'Unknown')}\n"
        f"  Rate:       1/{bb.rate_denom} ({100/bb.rate_denom:.0f}%)\n"
        f"  P Ratio:    {bb.p_ratio}"
    )


async def handle_get_dataflash_summary(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    df = conn.get_dataflash_summary()
    if not df.supported:
        return "Dataflash not supported on this board."

    used_pct = (df.used_size / df.total_size * 100) if df.total_size > 0 else 0
    return (
        f"Dataflash Summary:\n"
        f"  Status:     {'Ready' if df.ready else 'Not Ready'}\n"
        f"  Sectors:    {df.sectors}\n"
        f"  Total Size: {df.total_size / 1024:.0f} KB\n"
        f"  Used:       {df.used_size / 1024:.0f} KB ({used_pct:.1f}%)\n"
        f"  Free:       {(df.total_size - df.used_size) / 1024:.0f} KB"
    )


async def handle_get_features(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    features = conn.get_features()
    enabled = [name for name, on in features.features.items() if on]
    disabled = [name for name, on in features.features.items() if not on]
    return (
        f"Enabled Features:\n  " +
        (", ".join(sorted(enabled)) if enabled else "(none)") +
        f"\n\nDisabled Features:\n  " +
        (", ".join(sorted(disabled)) if disabled else "(none)")
    )


async def handle_set_feature(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    feature = arguments["feature"]
    enabled = arguments["enabled"]

    conn.set_feature(feature, enabled)
    action = "enabled" if enabled else "disabled"
    return (
        f"Feature '{feature}' {action}.\n\n"
        "Note: Use 'save_settings' to persist changes to EEPROM."
    )


async def handle_set_craft_name(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    new_name = arguments["name"]
    conn.set_name(new_name)
    return (
        f"Craft name set to: {new_name}\n\n"
        "Note: Use 'save_settings' to persist changes to EEPROM."
    )


async def handle_erase_blackbox_logs(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    conn.erase_dataflash()
    return (
        "Blackbox logs erased!\n\n"
        "The onboard flash memory has been cleared."
    )


async def handle_reboot_flight_controller(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    conn.reboot()
    conn._force_close()
    return (
        "Flight controller is rebooting...\n\n"
        "Connection has been closed. Use 'reconnect_flight_controller' "
        "to reconnect after the FC finishes booting (~3-5 seconds)."
    )


async def handle_get_available_modes(connection, arguments, **_kw) -> str:
    modes = [(mid, mname) for mid, mname in FLIGHT_MODES.items()]
    lines = ["Available Flight Modes:\n"]
    for mode_id, mode_name in sorted(modes):
        lines.append(f"  {mode_id:2d}: {mode_name}")
    lines.append("\nCommon modes: ARM, ANGLE, HORIZON, AIRMODE, BEEPERON, FLIP_OVER_AFTER_CRASH")
    return "\n".join(lines)


async def handle_get_aux_modes(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    ranges = conn.get_mode_ranges()

    if not ranges:
        return "No aux mode mappings configured."

    lines = ["Aux Channel Mode Mappings:\n"]
    lines.append("Slot  Mode            AUX    Range")
    lines.append("-" * 40)
    for r in ranges:
        mode_name = FLIGHT_MODES.get(r.mode_id, f"Unknown({r.mode_id})")
        lines.append(
            f"{r.index:3d}   {mode_name:15s} AUX{r.aux_channel+1}   {r.range_start}-{r.range_end}"
        )
    return "\n".join(lines)


async def handle_set_aux_mode(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    mode_name = arguments["mode"].upper()
    aux_channel = arguments["aux_channel"] - 1  # Convert to 0-indexed
    range_start = arguments["range_start"]
    range_end = arguments["range_end"]

    # Find mode ID
    mode_id = None
    for mid, mname in FLIGHT_MODES.items():
        if mname == mode_name:
            mode_id = mid
            break

    if mode_id is None:
        return f"Unknown mode: {mode_name}. Use 'get_available_modes' to see valid modes."

    # Find empty slot or slot with same mode
    ranges = conn.get_mode_ranges()
    slot_index = None

    for r in ranges:
        if r.mode_id == mode_id:
            slot_index = r.index
            break

    if slot_index is None:
        used_slots = {r.index for r in ranges}
        for i in range(20):
            if i not in used_slots:
                slot_index = i
                break

    if slot_index is None:
        return "No empty mode slots available (max 20 mappings)."

    conn.set_mode_range(slot_index, mode_id, aux_channel, range_start, range_end)
    return (
        f"Mode '{mode_name}' mapped to AUX{aux_channel+1} range {range_start}-{range_end}\n\n"
        "Note: Use 'save_settings' to persist changes."
    )


async def handle_clear_aux_mode(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    index = arguments["index"]
    conn.clear_mode_range(index)
    return f"Mode mapping in slot {index} cleared.\n\nUse 'save_settings' to persist."


async def handle_get_current_profile(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    pid_profile, rate_profile = conn.get_current_profile()
    return (
        f"Current Profiles:\n"
        f"  PID Profile:  {pid_profile + 1} (of 3)\n"
        f"  Rate Profile: {rate_profile + 1} (of 6)"
    )


async def handle_set_pid_profile(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    profile = arguments["profile"] - 1
    conn.set_pid_profile(profile)
    return (
        f"Switched to PID profile {profile + 1}.\n\n"
        "Note: Profile change is temporary. Use 'save_settings' to make it default."
    )


async def handle_set_rate_profile(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    profile = arguments["profile"] - 1
    conn.set_rate_profile(profile)
    return (
        f"Switched to rate profile {profile + 1}.\n\n"
        "Note: Profile change is temporary. Use 'save_settings' to make it default."
    )


async def handle_copy_pid_profile(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    source = arguments["source"] - 1
    destination = arguments["destination"] - 1
    conn.copy_profile(source, destination)
    return (
        f"Copied PID settings from profile {source + 1} to profile {destination + 1}.\n\n"
        "Use 'save_settings' to persist."
    )


async def handle_get_failsafe_config(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    fs = conn.get_failsafe_config()
    procedures = {0: "AUTO_LAND", 1: "DROP", 2: "GPS_RESCUE"}
    return (
        f"Failsafe Configuration:\n"
        f"  Procedure:        {procedures.get(fs.procedure, 'Unknown')}\n"
        f"  Delay:            {fs.delay * 0.1:.1f} seconds\n"
        f"  Motor Off Delay:  {fs.off_delay * 0.1:.1f} seconds\n"
        f"  Throttle:         {fs.throttle}\n"
        f"  Switch Mode:      {'Stage 2' if fs.switch_mode else 'Stage 1'}"
    )


async def handle_set_failsafe_config(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)

    procedure = arguments.get("procedure")
    delay = arguments.get("delay")

    proc_map = {"AUTO_LAND": 0, "DROP": 1, "GPS_RESCUE": 2}
    proc_int = proc_map.get(procedure) if procedure else None
    delay_int = int(delay * 10) if delay else None

    conn.set_failsafe_config(
        procedure=proc_int,
        delay=delay_int,
    )
    return (
        "Failsafe configuration updated.\n\n"
        "Use 'save_settings' to persist changes."
    )


async def handle_get_arming_disable_flags(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    flags = conn.get_arming_disable_flags()

    if not flags:
        return "No arming disable flags - drone is ready to arm!"

    lines = ["Arming is blocked by:\n"]
    for flag in flags:
        lines.append(f"  - {flag}")

    hints = {
        "RXLOSS": "Radio receiver not connected or no signal",
        "FAILSAFE": "Failsafe is active",
        "BOXFAILSAFE": "Failsafe switch is on",
        "THROTTLE": "Throttle is not at minimum",
        "ANGLE": "Drone is not level",
        "BOOT_GRACE_TIME": "Wait a few seconds after boot",
        "NOPREARM": "PREARM switch not activated",
        "LOAD": "CPU load too high",
        "CALIB": "Calibration in progress",
        "CLI": "Currently in CLI mode",
        "MSP": "MSP connection preventing arm",
        "PARALYZE": "Paralyze mode active",
        "RPMFILTER": "RPM filter not ready",
    }

    lines.append("\nHints:")
    for flag in flags:
        if flag in hints:
            lines.append(f"  {flag}: {hints[flag]}")

    return "\n".join(lines)


async def handle_get_rc_tuning_full(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    tuning = conn.get_rc_tuning_full()

    # Reconnect after CLI
    try:
        conn.reconnect(max_retries=5, retry_delay=1.0)
    except Exception:
        pass

    rate_type_name = RATE_TYPE_NAMES.get(tuning.rates_type, f"Unknown({tuning.rates_type})")

    return (
        f"RC Tuning (Rate Type: {rate_type_name}):\n\n"
        f"         RC Rate  Super Rate  Expo\n"
        f"Roll:    {tuning.roll_rc_rate:>6}    {tuning.roll_rate:>9}  {tuning.roll_expo:>4}\n"
        f"Pitch:   {tuning.pitch_rc_rate:>6}    {tuning.pitch_rate:>9}  {tuning.pitch_expo:>4}\n"
        f"Yaw:     {tuning.yaw_rc_rate:>6}    {tuning.yaw_rate:>9}  {tuning.yaw_expo:>4}\n\n"
        f"TPA:           {tuning.tpa_rate} (breakpoint: {tuning.tpa_breakpoint})\n"
        f"Throttle Mid:  {tuning.throttle_mid}\n"
        f"Throttle Expo: {tuning.throttle_expo}"
    )


async def handle_set_rc_tuning(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    param = arguments["param"]
    value = arguments["value"]

    response = conn.set_rc_tuning(param, value)

    return (
        f"RC tuning '{param}' set to '{value}'.\n\n"
        f"CLI response: {response}\n\n"
        "Use 'save_settings' to persist changes."
    )


async def handle_calculate_max_rate(connection, arguments, **_kw) -> str:
    rates_type = arguments["rates_type"].lower()
    rc_rate = arguments["rc_rate"]
    rate = arguments["rate"]
    expo = arguments["expo"]

    if rates_type == "betaflight":
        max_dps = calculate_betaflight_rate(rc_rate / 100.0, rate / 100.0, expo / 100.0)
        formula = f"BF formula: rcRate={rc_rate/100:.2f}, superRate={rate/100:.2f}, expo={expo/100:.2f}"
    elif rates_type == "actual":
        max_dps = calculate_actual_rate(rc_rate, rate, expo)
        formula = f"Actual: centerSens={rc_rate}, maxRate={rate}, expo={expo}"
    elif rates_type == "kiss":
        max_dps = calculate_kiss_rate(rc_rate, rate, expo)
        formula = f"KISS: rcRate={rc_rate}, rate={rate}, rcCurve={expo}"
    elif rates_type == "quick":
        max_dps = calculate_quick_rate(rc_rate, rate, expo)
        formula = f"Quick: rcRate={rc_rate}, maxRate={rate}, expo={expo}"
    else:
        return f"Unknown rate type: {rates_type}. Use betaflight, actual, kiss, or quick."

    return (
        f"Max Rate Calculation ({rates_type.capitalize()}):\n\n"
        f"  {formula}\n"
        f"  Max rotation: {max_dps:.0f} deg/s\n\n"
        f"  Reference: freestyle ~700-900, racing ~600-800, cinematic ~200-400"
    )


async def handle_analyze_pid_ratios(connection, arguments, **_kw) -> str:
    conn = _get_connection(connection)
    pids = conn.get_pid_settings()

    lines = ["PID Tuning Analysis:\n"]
    lines.append(f"Current PIDs:\n"
                 f"        P     I     D\n"
                 f"Roll:   {pids.roll_p:3d}   {pids.roll_i:3d}   {pids.roll_d:3d}\n"
                 f"Pitch:  {pids.pitch_p:3d}   {pids.pitch_i:3d}   {pids.pitch_d:3d}\n"
                 f"Yaw:    {pids.yaw_p:3d}   {pids.yaw_i:3d}   {pids.yaw_d:3d}\n")

    recommendations = []

    for axis, p, d, axis_name in [
        ("Roll", pids.roll_p, pids.roll_d, "roll"),
        ("Pitch", pids.pitch_p, pids.pitch_d, "pitch"),
    ]:
        if d > 0:
            pd_ratio = p / d
            ratio_str = f"{pd_ratio:.1f}:1"
            if pd_ratio < 1.2:
                recommendations.append(f"  {axis} P:D ratio ({ratio_str}) is low. D may cause motor heat. Try reducing D or increasing P.")
            elif pd_ratio > 3.5:
                recommendations.append(f"  {axis} P:D ratio ({ratio_str}) is high. May oscillate on quick moves. Try increasing D.")
            else:
                recommendations.append(f"  {axis} P:D ratio ({ratio_str}) - Good range.")
        else:
            recommendations.append(f"  {axis} D is 0 - D-term provides damping, consider adding some.")

    for axis, p, i in [
        ("Roll", pids.roll_p, pids.roll_i),
        ("Pitch", pids.pitch_p, pids.pitch_i),
    ]:
        if p > 0:
            ip_ratio = i / p
            if ip_ratio < 0.5:
                recommendations.append(f"  {axis} I is low relative to P ({i} vs {p}). May drift in sustained turns.")
            elif ip_ratio > 2.0:
                recommendations.append(f"  {axis} I is high relative to P ({i} vs {p}). May feel bouncy/sluggish.")

    if pids.yaw_p < 20:
        recommendations.append("  Yaw P is very low. May feel loose on yaw axis.")
    if pids.yaw_d > 0:
        recommendations.append("  Yaw D > 0. Some pilots prefer yaw_d = 0 to reduce noise.")

    if abs(pids.roll_p - pids.pitch_p) > 15:
        recommendations.append(f"  Roll P ({pids.roll_p}) and Pitch P ({pids.pitch_p}) differ significantly. Typically similar unless frame is asymmetric.")

    lines.append("Recommendations:\n")
    lines.extend(recommendations)

    return "\n".join(lines)


HANDLERS = {
    "get_pid_settings": handle_get_pid_settings,
    "set_pid_settings": handle_set_pid_settings,
    "get_rc_tuning": handle_get_rc_tuning,
    "save_settings": handle_save_settings,
    "backup_configuration": handle_backup_configuration,
    "send_cli_command": handle_send_cli_command,
    "get_filter_config": handle_get_filter_config,
    "get_battery_config": handle_get_battery_config,
    "get_motor_config": handle_get_motor_config,
    "get_osd_config": handle_get_osd_config,
    "get_blackbox_config": handle_get_blackbox_config,
    "get_dataflash_summary": handle_get_dataflash_summary,
    "get_features": handle_get_features,
    "set_feature": handle_set_feature,
    "set_craft_name": handle_set_craft_name,
    "erase_blackbox_logs": handle_erase_blackbox_logs,
    "reboot_flight_controller": handle_reboot_flight_controller,
    "get_available_modes": handle_get_available_modes,
    "get_aux_modes": handle_get_aux_modes,
    "set_aux_mode": handle_set_aux_mode,
    "clear_aux_mode": handle_clear_aux_mode,
    "get_current_profile": handle_get_current_profile,
    "set_pid_profile": handle_set_pid_profile,
    "set_rate_profile": handle_set_rate_profile,
    "copy_pid_profile": handle_copy_pid_profile,
    "get_failsafe_config": handle_get_failsafe_config,
    "set_failsafe_config": handle_set_failsafe_config,
    "get_arming_disable_flags": handle_get_arming_disable_flags,
    "get_rc_tuning_full": handle_get_rc_tuning_full,
    "set_rc_tuning": handle_set_rc_tuning,
    "calculate_max_rate": handle_calculate_max_rate,
    "analyze_pid_ratios": handle_analyze_pid_ratios,
}
