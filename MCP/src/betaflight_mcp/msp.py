"""
MSP (MultiWii Serial Protocol) implementation for Betaflight.

This module implements the MSPv1 and MSPv2 protocols used by Betaflight
flight controllers for configuration and telemetry.
"""

from __future__ import annotations

import struct
import time
from dataclasses import dataclass
from enum import IntEnum
from typing import Optional

import serial


class MSPCode(IntEnum):
    """MSP command codes for Betaflight."""
    # Informational
    MSP_API_VERSION = 1
    MSP_FC_VARIANT = 2
    MSP_FC_VERSION = 3
    MSP_BOARD_INFO = 4
    MSP_BUILD_INFO = 5
    MSP_NAME = 10
    MSP_STATUS = 101
    MSP_STATUS_EX = 150

    # Sensor data
    MSP_RAW_IMU = 102
    MSP_RAW_GPS = 106
    MSP_COMP_GPS = 107
    MSP_ATTITUDE = 108
    MSP_ALTITUDE = 109
    MSP_ANALOG = 110
    MSP_RC = 105
    MSP_MOTOR = 104
    MSP_SERVO = 103

    # Configuration read
    MSP_PID = 112
    MSP_PID_ADVANCED = 94
    MSP_RC_TUNING = 111
    MSP_FEATURE_CONFIG = 36
    MSP_BATTERY_CONFIG = 32
    MSP_MOTOR_CONFIG = 131
    MSP_FILTER_CONFIG = 92
    MSP_GPS_CONFIG = 132
    MSP_COMPASS_CONFIG = 133
    MSP_FAILSAFE_CONFIG = 75
    MSP_RXFAIL_CONFIG = 77
    MSP_RX_CONFIG = 44
    MSP_RX_MAP = 64
    MSP_RSSI_CONFIG = 50
    MSP_ADJUSTMENT_RANGES = 52
    MSP_MODE_RANGES = 34
    MSP_SET_MODE_RANGE = 35
    MSP_BOXNAMES = 116
    MSP_BOXIDS = 119
    MSP_MIXER_CONFIG = 42
    MSP_BEEPER_CONFIG = 54
    MSP_BOARD_ALIGNMENT_CONFIG = 38
    MSP_ARMING_CONFIG = 61
    MSP_ARMING_DISABLE = 99
    MSP_SENSOR_CONFIG = 96
    MSP_DATAFLASH_SUMMARY = 70
    MSP_BLACKBOX_CONFIG = 80
    MSP_SDCARD_SUMMARY = 79
    MSP_OSD_CONFIG = 84
    MSP_VTX_CONFIG = 88
    MSP_LED_STRIP_CONFIG = 48
    MSP_LED_COLORS = 46
    MSP_LED_STRIP_MODECOLOR = 127

    # Configuration write
    MSP_SET_PID = 202
    MSP_SET_PID_ADVANCED = 95
    MSP_SET_RC_TUNING = 204
    MSP_SET_NAME = 11
    MSP_SET_FEATURE_CONFIG = 37
    MSP_SET_BEEPER_CONFIG = 55
    MSP_SET_MOTOR_CONFIG = 222
    MSP_SET_FILTER_CONFIG = 93
    MSP_SET_ARMING_CONFIG = 62
    MSP_SET_RX_CONFIG = 45
    MSP_SET_FAILSAFE_CONFIG = 76
    MSP_SET_BLACKBOX_CONFIG = 81
    MSP_SET_OSD_CONFIG = 85
    MSP_SET_VTX_CONFIG = 89
    MSP_SET_MOTOR = 214

    # Profile selection
    MSP_SELECT_SETTING = 210
    MSP_COPY_PROFILE = 183
    MSP_SET_RXFAIL_CONFIG = 78

    # Commands
    MSP_EEPROM_WRITE = 250
    MSP_REBOOT = 68
    MSP_ACC_CALIBRATION = 205
    MSP_MAG_CALIBRATION = 206
    MSP_SET_BEEPER = 126
    MSP_DATAFLASH_ERASE = 72


@dataclass
class FCInfo:
    """Flight controller information."""
    variant: str
    version: str
    api_version: str
    board_name: str
    target_name: str
    craft_name: str


@dataclass
class PIDSettings:
    """PID controller settings."""
    roll_p: int
    roll_i: int
    roll_d: int
    pitch_p: int
    pitch_i: int
    pitch_d: int
    yaw_p: int
    yaw_i: int
    yaw_d: int


@dataclass
class RCTuning:
    """RC rates and expo settings."""
    rc_rate: float
    rc_expo: float
    roll_rate: float
    pitch_rate: float
    yaw_rate: float
    tpa_rate: float
    throttle_mid: float
    throttle_expo: float


@dataclass
class FCStatus:
    """Flight controller status."""
    cycle_time: int
    i2c_errors: int
    sensors: list[str]
    flight_mode: list[str]
    arming_disabled_flags: list[str]
    armed: bool
    cpu_load: int


@dataclass
class Attitude:
    """Aircraft attitude (orientation)."""
    roll: float  # degrees
    pitch: float  # degrees
    yaw: float  # degrees (heading)


@dataclass
class IMUData:
    """Raw IMU sensor data."""
    acc_x: int
    acc_y: int
    acc_z: int
    gyro_x: int
    gyro_y: int
    gyro_z: int
    mag_x: int
    mag_y: int
    mag_z: int


@dataclass
class AnalogData:
    """Analog sensor readings."""
    voltage: float  # Battery voltage
    mah_drawn: int  # mAh consumed
    rssi: int  # Signal strength 0-1023
    amperage: float  # Current draw in amps


@dataclass
class MotorData:
    """Motor output values."""
    motors: list[int]  # PWM values for each motor (typically 1000-2000)


@dataclass
class RCChannels:
    """RC channel values."""
    channels: list[int]  # Channel values (typically 1000-2000)


@dataclass
class FilterConfig:
    """Filter configuration settings."""
    gyro_lowpass_hz: int
    gyro_lowpass2_hz: int
    dterm_lowpass_hz: int
    dterm_lowpass2_hz: int
    gyro_notch_hz: int
    gyro_notch_cutoff: int
    dterm_notch_hz: int
    dterm_notch_cutoff: int
    gyro_lowpass_type: int
    gyro_lowpass2_type: int
    dterm_lowpass_type: int
    dterm_lowpass2_type: int


@dataclass
class BatteryConfig:
    """Battery configuration settings."""
    vbat_min_cell_voltage: float
    vbat_max_cell_voltage: float
    vbat_warning_cell_voltage: float
    capacity: int  # mAh
    voltage_meter_source: int
    current_meter_source: int


@dataclass
class MotorConfig:
    """Motor configuration settings."""
    min_throttle: int
    max_throttle: int
    min_command: int
    motor_poles: int
    use_dshot_telemetry: bool
    motor_pwm_protocol: int  # 0=OFF, 1=ONESHOT125, etc.


@dataclass
class VTXConfig:
    """VTX (Video Transmitter) configuration."""
    vtx_type: int
    band: int
    channel: int
    power: int
    pit_mode: bool
    frequency: int
    low_power_disarm: bool


@dataclass
class OSDConfig:
    """OSD (On Screen Display) configuration."""
    video_system: int  # 0=AUTO, 1=PAL, 2=NTSC
    units: int  # 0=IMPERIAL, 1=METRIC
    rssi_alarm: int
    cap_alarm: int
    alt_alarm: int
    warnings: int  # Bitmask of enabled warnings


@dataclass
class BlackboxConfig:
    """Blackbox data logging configuration."""
    device: int  # 0=NONE, 1=FLASH, 2=SDCARD, 3=SERIAL
    rate_num: int
    rate_denom: int
    p_ratio: int


@dataclass
class DataflashSummary:
    """Dataflash (onboard logging) summary."""
    ready: bool
    supported: bool
    sectors: int
    total_size: int
    used_size: int


@dataclass
class Features:
    """Enabled features bitmask."""
    features: dict[str, bool]  # Feature name -> enabled


@dataclass
class ModeRange:
    """Aux channel to mode mapping."""
    index: int           # Slot index (0-19)
    mode_id: int         # Mode ID
    aux_channel: int     # Aux channel (0=AUX1, 1=AUX2, etc.)
    range_start: int     # Start of activation range (900-2100)
    range_end: int       # End of activation range (900-2100)


@dataclass
class FailsafeConfig:
    """Failsafe configuration settings."""
    delay: int                    # Delay before failsafe activates (0.1s units)
    off_delay: int               # Delay before motors off (0.1s units)
    throttle: int                # Throttle value during failsafe
    switch_mode: int             # 0=STAGE1, 1=STAGE2
    throttle_low_delay: int      # Low throttle delay
    procedure: int               # 0=AUTO_LAND, 1=DROP, 2=GPS_RESCUE


@dataclass
class RxFailChannel:
    """Per-channel failsafe configuration."""
    channel: int
    mode: int      # 0=AUTO, 1=HOLD, 2=SET
    value: int     # Value when mode=SET


@dataclass
class PreflightCheck:
    """Result of a preflight check."""
    name: str
    passed: bool
    message: str


@dataclass
class PreflightResult:
    """Overall preflight check result."""
    all_passed: bool
    checks: list[PreflightCheck]


@dataclass
class GPSRescueConfig:
    """GPS Rescue configuration parameters."""
    min_sats: int
    angle: int
    initial_altitude_m: int
    descent_distance_m: int
    ground_speed_cm_s: int
    throttle_min: int
    throttle_max: int
    throttle_hover: int
    sanity_checks: str
    min_rescue_dth: int
    allow_arming_without_fix: bool
    altitude_mode: str
    ascend_rate: int
    descend_rate: int


@dataclass
class GPSStatus:
    """GPS fix and position data."""
    fix_type: int  # 0=no fix, 1=2D, 2=3D
    num_sats: int
    latitude: float  # degrees
    longitude: float  # degrees
    altitude_m: int
    ground_speed_cm_s: int
    ground_course: int  # decidegrees
    hdop: int


@dataclass
class RCTuningFull:
    """Full RC tuning with per-axis rates and rate type."""
    rates_type: int  # 0=Betaflight, 1=Raceflight, 2=KISS, 3=Actual, 4=Quick
    roll_rc_rate: int
    roll_rate: int
    roll_expo: int
    pitch_rc_rate: int
    pitch_rate: int
    pitch_expo: int
    yaw_rc_rate: int
    yaw_rate: int
    yaw_expo: int
    tpa_rate: int
    tpa_breakpoint: int
    throttle_mid: int
    throttle_expo: int


@dataclass
class OSDElement:
    """Single OSD element with position and visibility."""
    name: str
    index: int
    enabled: bool
    col: int  # 0-29 (x position)
    row: int  # 0-15 (y position)
    raw_value: int


@dataclass
class OSDLayout:
    """Full OSD element layout."""
    video_system: int
    elements: list[OSDElement]


# Flight mode definitions
FLIGHT_MODES = {
    0: "ARM",
    1: "ANGLE",
    2: "HORIZON",
    3: "MAG",
    4: "HEADFREE",
    5: "PASSTHRU",
    6: "FAILSAFE",
    7: "GPSRESCUE",
    8: "ANTIGRAVITY",
    9: "HEADADJ",
    10: "CAMSTAB",
    11: "BEEPERON",
    12: "LEDLOW",
    13: "CALIB",
    14: "OSD",
    15: "TELEMETRY",
    16: "SERVO1",
    17: "SERVO2",
    18: "SERVO3",
    19: "BLACKBOX",
    20: "AIRMODE",
    21: "3D",
    22: "FPVANGLEMIX",
    23: "BLACKBOXERASE",
    24: "CAMERA1",
    25: "CAMERA2",
    26: "CAMERA3",
    27: "FLIPOVERAFTERCRASH",
    28: "PREARM",
    29: "BEEPGPSCOUNT",
    30: "VTXPITMODE",
    31: "PARALYZE",
    32: "USER1",
    33: "USER2",
    34: "USER3",
    35: "USER4",
    36: "PIDAUDIO",
    37: "ACROTRAINER",
    38: "VTXCONTROLDISABLE",
    39: "LAUNCHCONTROL",
}


# Feature flag definitions
FEATURE_FLAGS = {
    0: "RX_PPM",
    2: "INFLIGHT_ACC_CAL",
    3: "RX_SERIAL",
    4: "MOTOR_STOP",
    5: "SERVO_TILT",
    6: "SOFTSERIAL",
    7: "GPS",
    9: "SONAR",
    10: "TELEMETRY",
    12: "3D",
    13: "RX_PARALLEL_PWM",
    14: "RX_MSP",
    15: "RSSI_ADC",
    16: "LED_STRIP",
    17: "DISPLAY",
    18: "OSD",
    20: "CHANNEL_FORWARDING",
    21: "TRANSPONDER",
    22: "AIRMODE",
    25: "RX_SPI",
    27: "ESC_SENSOR",
    28: "ANTI_GRAVITY",
}


class MSPError(Exception):
    """MSP communication error."""
    pass


class MSPConnection:
    """
    Manages serial connection and MSP protocol communication with Betaflight.
    """

    # MSP protocol constants
    MSP_HEADER = b'$M'
    MSP_DIRECTION_TO_FC = b'<'
    MSP_DIRECTION_FROM_FC = b'>'
    MSP_ERROR = b'!'

    # Timeout settings
    READ_TIMEOUT = 1.0
    WRITE_TIMEOUT = 1.0

    def __init__(self, port: str, baudrate: int = 115200):
        """
        Initialize MSP connection.

        Args:
            port: Serial port path (e.g., '/dev/tty.usbmodem0001' or 'COM3')
            baudrate: Serial baudrate (default 115200 for Betaflight)
        """
        self.port = port
        self.baudrate = baudrate
        self._serial: Optional[serial.Serial] = None
        self._in_cli_mode = False

    def connect(self) -> None:
        """Open serial connection to flight controller."""
        if self._serial and self._serial.is_open:
            return

        # Force-close any stale handle before opening a new one
        self._force_close()

        try:
            self._serial = serial.Serial(
                port=self.port,
                baudrate=self.baudrate,
                timeout=self.READ_TIMEOUT,
                write_timeout=self.WRITE_TIMEOUT,
                bytesize=serial.EIGHTBITS,
                parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_ONE,
            )
            # Give the FC time to initialize
            time.sleep(0.1)
            # Clear any pending data
            self._serial.reset_input_buffer()
            self._serial.reset_output_buffer()
        except serial.SerialException as e:
            self._serial = None
            raise MSPError(f"Failed to connect to {self.port}: {e}")

    def _force_close(self) -> None:
        """Force-close the serial handle, ignoring all errors."""
        if self._serial is not None:
            try:
                self._serial.close()
            except Exception:
                pass
            self._serial = None
        self._in_cli_mode = False

    def disconnect(self) -> None:
        """Close serial connection."""
        if self._serial and self._serial.is_open:
            try:
                if self._in_cli_mode:
                    self._exit_cli_mode()
                self._serial.close()
            except Exception:
                # Serial may already be dead (e.g. FC rebooted)
                try:
                    self._serial.close()
                except Exception:
                    pass
        self._serial = None
        self._in_cli_mode = False

    def is_connected(self) -> bool:
        """Check if connection is active."""
        if self._serial is None:
            return False
        try:
            return self._serial.is_open
        except Exception:
            self._force_close()
            return False

    def reconnect(self, max_retries: int = 5, retry_delay: float = 1.0) -> None:
        """
        Force-close and reconnect, with retries for FC reboot scenarios.

        Args:
            max_retries: Number of connection attempts
            retry_delay: Seconds between retries
        """
        self._force_close()

        for attempt in range(max_retries):
            try:
                self.connect()
                return
            except MSPError:
                if attempt < max_retries - 1:
                    time.sleep(retry_delay)
                else:
                    raise MSPError(
                        f"Failed to reconnect after {max_retries} attempts. "
                        f"Try unplugging and replugging the USB cable."
                    )

    def _calculate_checksum(self, data: bytes) -> int:
        """Calculate XOR checksum for MSP message."""
        checksum = 0
        for byte in data:
            checksum ^= byte
        return checksum

    def _build_msp_message(self, code: int, data: bytes = b'') -> bytes:
        """
        Build an MSPv1 message.

        Format: $M< + data_length + command + data + checksum
        """
        data_length = len(data)
        # Checksum covers: length + command + data
        checksum_data = bytes([data_length, code]) + data
        checksum = self._calculate_checksum(checksum_data)

        message = (
            self.MSP_HEADER +
            self.MSP_DIRECTION_TO_FC +
            bytes([data_length, code]) +
            data +
            bytes([checksum])
        )
        return message

    def _read_msp_response(self, expected_code: int) -> bytes:
        """
        Read and parse MSP response from flight controller.

        Returns:
            Response data payload
        """
        if not self._serial:
            raise MSPError("Not connected")

        # Read header
        header = self._serial.read(3)
        if len(header) < 3:
            raise MSPError("Timeout reading MSP header")

        if header[:2] != self.MSP_HEADER:
            raise MSPError(f"Invalid MSP header: {header.hex()}")

        direction = bytes([header[2]])
        if direction == self.MSP_ERROR:
            raise MSPError("FC returned MSP error")

        if direction != self.MSP_DIRECTION_FROM_FC:
            raise MSPError(f"Unexpected direction byte: {direction.hex()}")

        # Read length and code
        length_code = self._serial.read(2)
        if len(length_code) < 2:
            raise MSPError("Timeout reading MSP length/code")

        data_length = length_code[0]
        code = length_code[1]

        if code != expected_code:
            raise MSPError(f"Unexpected MSP code: {code}, expected {expected_code}")

        # Read data and checksum
        remaining = self._serial.read(data_length + 1)
        if len(remaining) < data_length + 1:
            raise MSPError("Timeout reading MSP data")

        data = remaining[:data_length]
        received_checksum = remaining[data_length]

        # Verify checksum
        expected_checksum = self._calculate_checksum(bytes([data_length, code]) + data)
        if received_checksum != expected_checksum:
            raise MSPError(f"Checksum mismatch: {received_checksum} != {expected_checksum}")

        return data

    def send_command(self, code: MSPCode, data: bytes = b'') -> bytes:
        """
        Send MSP command and receive response.

        Args:
            code: MSP command code
            data: Optional data payload

        Returns:
            Response data payload
        """
        if not self._serial:
            raise MSPError("Not connected")

        if self._in_cli_mode:
            self._exit_cli_mode()

        message = self._build_msp_message(code, data)
        self._serial.write(message)
        self._serial.flush()

        return self._read_msp_response(code)

    # ----- CLI Mode Methods -----

    def _enter_cli_mode(self) -> None:
        """Enter Betaflight CLI mode."""
        if self._in_cli_mode:
            return

        if not self._serial:
            raise MSPError("Not connected")

        # Send '#' to enter CLI
        self._serial.write(b'#')
        self._serial.flush()
        time.sleep(0.2)

        # Read until we get the CLI prompt
        self._read_until_prompt()
        self._in_cli_mode = True

    def _exit_cli_mode(self) -> None:
        """Exit CLI mode and return to MSP mode.

        Note: In Betaflight, 'exit' from CLI reboots the FC.
        This method handles the resulting serial disconnection gracefully.
        """
        if not self._in_cli_mode:
            return

        if self._serial:
            try:
                self._serial.write(b'exit\r\n')
                self._serial.flush()
                time.sleep(0.5)
                self._serial.reset_input_buffer()
            except (serial.SerialException, OSError):
                # FC likely rebooted and serial died — expected behavior
                pass

        self._in_cli_mode = False

    def _read_until_prompt(self, timeout: float = 2.0) -> str:
        """Read CLI output until prompt appears."""
        if not self._serial:
            raise MSPError("Not connected")

        output = b''
        start_time = time.time()

        while time.time() - start_time < timeout:
            if self._serial.in_waiting:
                output += self._serial.read(self._serial.in_waiting)
                # Check for CLI prompt (usually ends with '# ')
                if output.endswith(b'# ') or output.endswith(b'#'):
                    break
            else:
                time.sleep(0.01)

        return output.decode('utf-8', errors='replace')

    def send_cli_command(self, command: str, timeout: float = 5.0) -> str:
        """
        Send a CLI command and return the response.

        Args:
            command: CLI command to send
            timeout: Response timeout in seconds

        Returns:
            Command output as string
        """
        if not self._serial:
            raise MSPError("Not connected")

        self._enter_cli_mode()

        # Send command
        self._serial.write(f'{command}\r\n'.encode())
        self._serial.flush()

        # Read response
        response = self._read_until_prompt(timeout)

        # Clean up response (remove echo and prompt)
        lines = response.split('\n')
        # Remove first line (command echo) and last line (prompt)
        if lines and lines[0].strip() == command:
            lines = lines[1:]
        if lines and lines[-1].strip().endswith('#'):
            lines = lines[:-1]

        return '\n'.join(lines).strip()

    # ----- High-level API -----

    def get_fc_info(self) -> FCInfo:
        """Get flight controller information."""
        # Get FC variant (e.g., "BTFL")
        variant_data = self.send_command(MSPCode.MSP_FC_VARIANT)
        variant = variant_data[:4].decode('utf-8').strip('\x00')

        # Get FC version
        version_data = self.send_command(MSPCode.MSP_FC_VERSION)
        version = f"{version_data[0]}.{version_data[1]}.{version_data[2]}"

        # Get API version
        api_data = self.send_command(MSPCode.MSP_API_VERSION)
        api_version = f"{api_data[1]}.{api_data[2]}"

        # Get board info
        board_data = self.send_command(MSPCode.MSP_BOARD_INFO)
        # First 4 bytes are board identifier
        board_name = board_data[:4].decode('utf-8').strip('\x00')
        # Parse target name (variable length string after fixed data)
        target_name = ""
        if len(board_data) > 9:
            target_len = board_data[9] if len(board_data) > 9 else 0
            if len(board_data) > 10 + target_len:
                target_name = board_data[10:10+target_len].decode('utf-8', errors='replace')

        # Get craft name
        name_data = self.send_command(MSPCode.MSP_NAME)
        craft_name = name_data.decode('utf-8').strip('\x00')

        return FCInfo(
            variant=variant,
            version=version,
            api_version=api_version,
            board_name=board_name,
            target_name=target_name,
            craft_name=craft_name,
        )

    def get_pid_settings(self) -> PIDSettings:
        """Get current PID settings."""
        data = self.send_command(MSPCode.MSP_PID)

        # PID data is 3 bytes per axis: P, I, D
        # Order: Roll, Pitch, Yaw (+ additional PIDs we don't need)
        return PIDSettings(
            roll_p=data[0], roll_i=data[1], roll_d=data[2],
            pitch_p=data[3], pitch_i=data[4], pitch_d=data[5],
            yaw_p=data[6], yaw_i=data[7], yaw_d=data[8],
        )

    def set_pid_settings(self, pids: PIDSettings) -> None:
        """
        Set PID settings.

        Note: Call save_settings() after to persist to EEPROM.
        """
        # First get current PID data to preserve other values
        current_data = bytearray(self.send_command(MSPCode.MSP_PID))

        # Update roll, pitch, yaw PIDs
        current_data[0] = pids.roll_p
        current_data[1] = pids.roll_i
        current_data[2] = pids.roll_d
        current_data[3] = pids.pitch_p
        current_data[4] = pids.pitch_i
        current_data[5] = pids.pitch_d
        current_data[6] = pids.yaw_p
        current_data[7] = pids.yaw_i
        current_data[8] = pids.yaw_d

        self.send_command(MSPCode.MSP_SET_PID, bytes(current_data))

    def get_rc_tuning(self) -> RCTuning:
        """Get RC rates and expo settings."""
        data = self.send_command(MSPCode.MSP_RC_TUNING)

        # Values are stored as 0-100 or 0-255, need scaling
        return RCTuning(
            rc_rate=data[0] / 100.0,
            rc_expo=data[1] / 100.0,
            roll_rate=data[2] / 100.0,
            pitch_rate=data[3] / 100.0,
            yaw_rate=data[4] / 100.0,
            tpa_rate=data[5] / 100.0 if len(data) > 5 else 0,
            throttle_mid=data[6] / 100.0 if len(data) > 6 else 0.5,
            throttle_expo=data[7] / 100.0 if len(data) > 7 else 0,
        )

    def get_status(self) -> FCStatus:
        """Get flight controller status."""
        data = self.send_command(MSPCode.MSP_STATUS)

        # Parse status data
        cycle_time = struct.unpack('<H', data[0:2])[0]
        i2c_errors = struct.unpack('<H', data[2:4])[0]
        sensors_raw = struct.unpack('<H', data[4:6])[0]
        flight_mode_raw = struct.unpack('<I', data[6:10])[0]

        # Decode sensors
        sensors = []
        sensor_names = ['ACC', 'BARO', 'MAG', 'GPS', 'SONAR', 'GYRO']
        for i, name in enumerate(sensor_names):
            if sensors_raw & (1 << i):
                sensors.append(name)

        # Decode flight mode flags
        flight_modes = []
        mode_names = ['ARM', 'ANGLE', 'HORIZON', 'NAV_ALTHOLD', 'HEADFREE', 'PASSTHRU']
        for i, name in enumerate(mode_names):
            if flight_mode_raw & (1 << i):
                flight_modes.append(name)

        armed = 'ARM' in flight_modes

        # CPU load (if available in extended status)
        cpu_load = 0
        if len(data) > 10:
            cpu_load = data[10]

        return FCStatus(
            cycle_time=cycle_time,
            i2c_errors=i2c_errors,
            sensors=sensors,
            flight_mode=flight_modes,
            arming_disabled_flags=[],
            armed=armed,
            cpu_load=cpu_load,
        )

    def save_settings(self) -> None:
        """Save current settings to EEPROM."""
        self.send_command(MSPCode.MSP_EEPROM_WRITE)
        # Give FC time to write to EEPROM
        time.sleep(0.1)

    def get_diff(self) -> str:
        """Get configuration diff (changes from defaults)."""
        return self.send_cli_command('diff all', timeout=10.0)

    def get_dump(self) -> str:
        """Get full configuration dump."""
        return self.send_cli_command('dump all', timeout=15.0)

    def get_attitude(self) -> Attitude:
        """Get current aircraft attitude (roll, pitch, yaw)."""
        data = self.send_command(MSPCode.MSP_ATTITUDE)
        # Values are in decidegrees (1/10 degree)
        roll = struct.unpack('<h', data[0:2])[0] / 10.0
        pitch = struct.unpack('<h', data[2:4])[0] / 10.0
        yaw = struct.unpack('<h', data[4:6])[0]  # Heading in degrees
        return Attitude(roll=roll, pitch=pitch, yaw=yaw)

    def get_imu_data(self) -> IMUData:
        """Get raw IMU sensor data."""
        data = self.send_command(MSPCode.MSP_RAW_IMU)
        return IMUData(
            acc_x=struct.unpack('<h', data[0:2])[0],
            acc_y=struct.unpack('<h', data[2:4])[0],
            acc_z=struct.unpack('<h', data[4:6])[0],
            gyro_x=struct.unpack('<h', data[6:8])[0],
            gyro_y=struct.unpack('<h', data[8:10])[0],
            gyro_z=struct.unpack('<h', data[10:12])[0],
            mag_x=struct.unpack('<h', data[12:14])[0] if len(data) > 12 else 0,
            mag_y=struct.unpack('<h', data[14:16])[0] if len(data) > 14 else 0,
            mag_z=struct.unpack('<h', data[16:18])[0] if len(data) > 16 else 0,
        )

    def get_analog_data(self) -> AnalogData:
        """Get analog sensor readings (battery, RSSI, etc.)."""
        data = self.send_command(MSPCode.MSP_ANALOG)
        voltage = data[0] / 10.0  # Stored as decivolts
        mah_drawn = struct.unpack('<H', data[1:3])[0]
        rssi = struct.unpack('<H', data[3:5])[0]
        amperage = struct.unpack('<h', data[5:7])[0] / 100.0 if len(data) > 5 else 0
        return AnalogData(
            voltage=voltage,
            mah_drawn=mah_drawn,
            rssi=rssi,
            amperage=amperage,
        )

    def get_motor_values(self) -> MotorData:
        """Get current motor output values."""
        data = self.send_command(MSPCode.MSP_MOTOR)
        # Each motor is 2 bytes (uint16), typically 8 motors max
        motors = []
        for i in range(0, len(data), 2):
            if i + 2 <= len(data):
                motors.append(struct.unpack('<H', data[i:i+2])[0])
        return MotorData(motors=motors)

    def get_rc_channels(self) -> RCChannels:
        """Get current RC channel values."""
        data = self.send_command(MSPCode.MSP_RC)
        # Each channel is 2 bytes (uint16)
        channels = []
        for i in range(0, len(data), 2):
            if i + 2 <= len(data):
                channels.append(struct.unpack('<H', data[i:i+2])[0])
        return RCChannels(channels=channels)

    def get_filter_config(self) -> FilterConfig:
        """Get filter configuration settings."""
        data = self.send_command(MSPCode.MSP_FILTER_CONFIG)
        return FilterConfig(
            gyro_lowpass_hz=data[0],
            dterm_lowpass_hz=struct.unpack('<H', data[1:3])[0],
            gyro_notch_hz=struct.unpack('<H', data[3:5])[0],
            gyro_notch_cutoff=struct.unpack('<H', data[5:7])[0],
            dterm_notch_hz=struct.unpack('<H', data[7:9])[0],
            dterm_notch_cutoff=struct.unpack('<H', data[9:11])[0],
            gyro_lowpass2_hz=struct.unpack('<H', data[11:13])[0] if len(data) > 11 else 0,
            dterm_lowpass2_hz=struct.unpack('<H', data[13:15])[0] if len(data) > 13 else 0,
            gyro_lowpass_type=data[15] if len(data) > 15 else 0,
            gyro_lowpass2_type=data[16] if len(data) > 16 else 0,
            dterm_lowpass_type=data[17] if len(data) > 17 else 0,
            dterm_lowpass2_type=data[18] if len(data) > 18 else 0,
        )

    def get_battery_config(self) -> BatteryConfig:
        """Get battery configuration settings."""
        data = self.send_command(MSPCode.MSP_BATTERY_CONFIG)
        return BatteryConfig(
            vbat_min_cell_voltage=data[0] / 10.0,
            vbat_max_cell_voltage=data[1] / 10.0,
            vbat_warning_cell_voltage=data[2] / 10.0,
            capacity=struct.unpack('<H', data[3:5])[0],
            voltage_meter_source=data[5] if len(data) > 5 else 0,
            current_meter_source=data[6] if len(data) > 6 else 0,
        )

    def get_motor_config(self) -> MotorConfig:
        """Get motor configuration settings."""
        data = self.send_command(MSPCode.MSP_MOTOR_CONFIG)
        return MotorConfig(
            min_throttle=struct.unpack('<H', data[0:2])[0],
            max_throttle=struct.unpack('<H', data[2:4])[0],
            min_command=struct.unpack('<H', data[4:6])[0],
            motor_poles=data[6] if len(data) > 6 else 14,
            use_dshot_telemetry=bool(data[7]) if len(data) > 7 else False,
            motor_pwm_protocol=data[8] if len(data) > 8 else 0,
        )

    def get_vtx_config(self) -> VTXConfig:
        """Get VTX (video transmitter) configuration."""
        data = self.send_command(MSPCode.MSP_VTX_CONFIG)
        return VTXConfig(
            vtx_type=data[0],
            band=data[1],
            channel=data[2],
            power=data[3],
            pit_mode=bool(data[4]),
            frequency=struct.unpack('<H', data[5:7])[0] if len(data) > 5 else 0,
            low_power_disarm=bool(data[7]) if len(data) > 7 else False,
        )

    def get_osd_config(self) -> OSDConfig:
        """Get OSD configuration."""
        data = self.send_command(MSPCode.MSP_OSD_CONFIG)
        # OSD config format varies by version, parse basic fields
        return OSDConfig(
            video_system=data[0] if len(data) > 0 else 0,
            units=data[1] if len(data) > 1 else 0,
            rssi_alarm=data[2] if len(data) > 2 else 0,
            cap_alarm=struct.unpack('<H', data[3:5])[0] if len(data) > 4 else 0,
            alt_alarm=0,  # Variable position in different versions
            warnings=0,
        )

    def get_blackbox_config(self) -> BlackboxConfig:
        """Get blackbox logging configuration."""
        data = self.send_command(MSPCode.MSP_BLACKBOX_CONFIG)
        return BlackboxConfig(
            device=data[0],
            rate_num=data[1],
            rate_denom=data[2],
            p_ratio=struct.unpack('<H', data[3:5])[0] if len(data) > 4 else 32,
        )

    def get_dataflash_summary(self) -> DataflashSummary:
        """Get dataflash (onboard logging memory) summary."""
        data = self.send_command(MSPCode.MSP_DATAFLASH_SUMMARY)
        flags = data[0]
        return DataflashSummary(
            ready=bool(flags & 0x01),
            supported=bool(flags & 0x02),
            sectors=struct.unpack('<I', data[1:5])[0],
            total_size=struct.unpack('<I', data[5:9])[0],
            used_size=struct.unpack('<I', data[9:13])[0],
        )

    def get_features(self) -> Features:
        """Get enabled features."""
        data = self.send_command(MSPCode.MSP_FEATURE_CONFIG)
        feature_bits = struct.unpack('<I', data[0:4])[0]

        features = {}
        for bit, name in FEATURE_FLAGS.items():
            features[name] = bool(feature_bits & (1 << bit))

        return Features(features=features)

    def set_feature(self, feature_name: str, enabled: bool) -> None:
        """
        Enable or disable a feature.

        Note: Call save_settings() after to persist to EEPROM.
        """
        # Get current features
        data = self.send_command(MSPCode.MSP_FEATURE_CONFIG)
        feature_bits = struct.unpack('<I', data[0:4])[0]

        # Find the bit for this feature
        feature_bit = None
        for bit, name in FEATURE_FLAGS.items():
            if name.upper() == feature_name.upper():
                feature_bit = bit
                break

        if feature_bit is None:
            raise MSPError(f"Unknown feature: {feature_name}")

        # Set or clear the bit
        if enabled:
            feature_bits |= (1 << feature_bit)
        else:
            feature_bits &= ~(1 << feature_bit)

        # Send updated features
        new_data = struct.pack('<I', feature_bits)
        self.send_command(MSPCode.MSP_SET_FEATURE_CONFIG, new_data)

    def set_motor(self, motor_index: int, value: int) -> None:
        """
        Set a single motor to a specific value (for testing).

        SAFETY WARNING: This will spin the motor! Remove props first!

        Args:
            motor_index: Motor number (0-7)
            value: PWM value (typically 1000-2000, 1000 = stopped for DSHOT)
        """
        if not 0 <= motor_index <= 7:
            raise MSPError("Motor index must be 0-7")
        if not 1000 <= value <= 2000:
            raise MSPError("Motor value must be 1000-2000")

        # Build motor data array (8 motors x 2 bytes each)
        motor_data = bytearray(16)
        # Set all motors to minimum except the one we're testing
        for i in range(8):
            if i == motor_index:
                struct.pack_into('<H', motor_data, i * 2, value)
            else:
                struct.pack_into('<H', motor_data, i * 2, 1000)

        self.send_command(MSPCode.MSP_SET_MOTOR, bytes(motor_data))

    def stop_all_motors(self) -> None:
        """Stop all motors (set to minimum throttle)."""
        motor_data = struct.pack('<' + 'H' * 8, *([1000] * 8))
        self.send_command(MSPCode.MSP_SET_MOTOR, motor_data)

    def calibrate_accelerometer(self) -> None:
        """
        Calibrate the accelerometer.

        The aircraft must be level and stationary during calibration.
        """
        self.send_command(MSPCode.MSP_ACC_CALIBRATION)
        # Calibration takes about 2 seconds
        time.sleep(2.5)

    def calibrate_magnetometer(self) -> None:
        """
        Start magnetometer calibration.

        Rotate the aircraft through all orientations during calibration.
        """
        self.send_command(MSPCode.MSP_MAG_CALIBRATION)

    def beep(self) -> None:
        """Make the FC beep (useful for finding the drone)."""
        # Using CLI command as it's more reliable across versions
        self.send_cli_command('beeper on')
        time.sleep(0.5)
        self.send_cli_command('beeper off')

    def reboot(self) -> None:
        """Reboot the flight controller."""
        try:
            self.send_command(MSPCode.MSP_REBOOT)
        except MSPError:
            # Reboot won't send a response, so timeout is expected
            pass
        self._serial = None

    def erase_dataflash(self) -> None:
        """Erase onboard dataflash (blackbox logs)."""
        self.send_command(MSPCode.MSP_DATAFLASH_ERASE)

    def set_name(self, name: str) -> None:
        """
        Set the craft name.

        Note: Call save_settings() after to persist to EEPROM.
        """
        if len(name) > 16:
            raise MSPError("Craft name must be 16 characters or less")
        name_data = name.encode('utf-8')
        self.send_command(MSPCode.MSP_SET_NAME, name_data)

    # ----- Modes & Aux Channels -----

    def get_available_modes(self) -> list[tuple[int, str]]:
        """Get list of available flight modes."""
        # Return from our static definition as it's more reliable
        return [(id, name) for id, name in FLIGHT_MODES.items()]

    def get_mode_ranges(self) -> list[ModeRange]:
        """Get all aux channel to mode mappings."""
        data = self.send_command(MSPCode.MSP_MODE_RANGES)
        ranges = []

        # Each mode range is 4 bytes: mode_id, aux_channel, range_start, range_end
        # range values are stored as (actual - 900) / 25
        for i in range(0, len(data), 4):
            if i + 4 > len(data):
                break

            mode_id = data[i]
            aux_channel = data[i + 1]
            range_start = 900 + data[i + 2] * 25
            range_end = 900 + data[i + 3] * 25

            # Skip empty slots (mode_id 0 with no range)
            if mode_id == 0 and range_start == 900 and range_end == 900:
                continue

            ranges.append(ModeRange(
                index=i // 4,
                mode_id=mode_id,
                aux_channel=aux_channel,
                range_start=range_start,
                range_end=range_end,
            ))

        return ranges

    def set_mode_range(
        self,
        index: int,
        mode_id: int,
        aux_channel: int,
        range_start: int,
        range_end: int
    ) -> None:
        """
        Set a mode range (aux channel to mode mapping).

        Args:
            index: Slot index (0-19)
            mode_id: Mode ID from FLIGHT_MODES
            aux_channel: Aux channel (0=AUX1, 1=AUX2, etc.)
            range_start: Start of activation range (900-2100)
            range_end: End of activation range (900-2100)
        """
        if not 0 <= index <= 19:
            raise MSPError("Mode range index must be 0-19")
        if not 0 <= aux_channel <= 7:
            raise MSPError("Aux channel must be 0-7 (AUX1-AUX8)")
        if not 900 <= range_start <= 2100:
            raise MSPError("Range start must be 900-2100")
        if not 900 <= range_end <= 2100:
            raise MSPError("Range end must be 900-2100")
        if range_start >= range_end:
            raise MSPError("Range start must be less than range end")

        # Convert ranges to stored format
        start_stored = (range_start - 900) // 25
        end_stored = (range_end - 900) // 25

        data = bytes([index, mode_id, aux_channel, start_stored, end_stored])
        self.send_command(MSPCode.MSP_SET_MODE_RANGE, data)

    def clear_mode_range(self, index: int) -> None:
        """Clear a mode range slot."""
        # Setting all zeros clears the slot
        data = bytes([index, 0, 0, 0, 0])
        self.send_command(MSPCode.MSP_SET_MODE_RANGE, data)

    # ----- Profile Management -----

    def get_current_profile(self) -> tuple[int, int]:
        """
        Get current PID and rate profile numbers.

        Returns:
            Tuple of (pid_profile, rate_profile) - 0-indexed
        """
        # Use status to get current profile
        data = self.send_command(MSPCode.MSP_STATUS)
        # Profile is at byte 10 (pid profile) and usually CLI for rate profile
        pid_profile = data[10] if len(data) > 10 else 0

        # Get rate profile from CLI
        response = self.send_cli_command('get profile')
        rate_profile = 0
        for line in response.split('\n'):
            if 'rate_profile' in line.lower():
                try:
                    rate_profile = int(line.split('=')[-1].strip())
                except ValueError:
                    pass

        return (pid_profile, rate_profile)

    def set_pid_profile(self, profile: int) -> None:
        """
        Switch to a different PID profile.

        Args:
            profile: Profile number (0-2 for profiles 1-3)
        """
        if not 0 <= profile <= 2:
            raise MSPError("PID profile must be 0-2")

        # Use CLI for reliable profile switching
        self.send_cli_command(f'profile {profile}')

    def set_rate_profile(self, profile: int) -> None:
        """
        Switch to a different rate profile.

        Args:
            profile: Profile number (0-5 for profiles 1-6)
        """
        if not 0 <= profile <= 5:
            raise MSPError("Rate profile must be 0-5")

        self.send_cli_command(f'rateprofile {profile}')

    def copy_profile(self, source: int, destination: int) -> None:
        """
        Copy PID profile from source to destination.

        Args:
            source: Source profile (0-2)
            destination: Destination profile (0-2)
        """
        if not 0 <= source <= 2:
            raise MSPError("Source profile must be 0-2")
        if not 0 <= destination <= 2:
            raise MSPError("Destination profile must be 0-2")
        if source == destination:
            raise MSPError("Source and destination must be different")

        # Use MSP_COPY_PROFILE
        data = bytes([0, destination, source])  # 0 = PID profile type
        self.send_command(MSPCode.MSP_COPY_PROFILE, data)

    # ----- Failsafe Configuration -----

    def get_failsafe_config(self) -> FailsafeConfig:
        """Get failsafe configuration."""
        data = self.send_command(MSPCode.MSP_FAILSAFE_CONFIG)

        return FailsafeConfig(
            delay=data[0],
            off_delay=data[1],
            throttle=struct.unpack('<H', data[2:4])[0],
            switch_mode=data[4] if len(data) > 4 else 0,
            throttle_low_delay=struct.unpack('<H', data[5:7])[0] if len(data) > 6 else 0,
            procedure=data[7] if len(data) > 7 else 0,
        )

    def set_failsafe_config(
        self,
        procedure: Optional[int] = None,
        delay: Optional[int] = None,
        off_delay: Optional[int] = None,
        throttle: Optional[int] = None,
    ) -> None:
        """
        Set failsafe configuration.

        Args:
            procedure: 0=AUTO_LAND, 1=DROP, 2=GPS_RESCUE
            delay: Delay before failsafe (0.1s units)
            off_delay: Delay before motors off (0.1s units)
            throttle: Throttle value during failsafe
        """
        # Get current config first
        current = self.get_failsafe_config()

        # Use CLI for reliable setting
        if procedure is not None:
            procedures = {0: 'AUTO-LAND', 1: 'DROP', 2: 'GPS-RESCUE'}
            proc_name = procedures.get(procedure, 'AUTO-LAND')
            self.send_cli_command(f'set failsafe_procedure = {proc_name}')

        if delay is not None:
            self.send_cli_command(f'set failsafe_delay = {delay}')

        if off_delay is not None:
            self.send_cli_command(f'set failsafe_off_delay = {off_delay}')

        if throttle is not None:
            self.send_cli_command(f'set failsafe_throttle = {throttle}')

    def get_rxfail_config(self) -> list[RxFailChannel]:
        """Get per-channel failsafe configuration."""
        data = self.send_command(MSPCode.MSP_RXFAIL_CONFIG)
        channels = []

        # Each channel is 3 bytes: mode (1 byte) + value (2 bytes)
        for i in range(0, len(data), 3):
            if i + 3 > len(data):
                break

            mode = data[i]
            value = struct.unpack('<H', data[i+1:i+3])[0]
            channels.append(RxFailChannel(
                channel=i // 3,
                mode=mode,
                value=value,
            ))

        return channels

    def set_rxfail_channel(self, channel: int, mode: int, value: int = 1500) -> None:
        """
        Set failsafe mode for a specific channel.

        Args:
            channel: Channel number (0-based)
            mode: 0=AUTO, 1=HOLD, 2=SET
            value: Value when mode=SET (900-2100)
        """
        if not 0 <= channel <= 17:
            raise MSPError("Channel must be 0-17")
        if not 0 <= mode <= 2:
            raise MSPError("Mode must be 0 (AUTO), 1 (HOLD), or 2 (SET)")
        if not 900 <= value <= 2100:
            raise MSPError("Value must be 900-2100")

        data = bytes([channel, mode]) + struct.pack('<H', value)
        self.send_command(MSPCode.MSP_SET_RXFAIL_CONFIG, data)

    def get_arming_disable_flags(self) -> list[str]:
        """Get detailed list of reasons why arming is disabled."""
        # Use CLI for comprehensive info
        response = self.send_cli_command('status')

        flags = []
        for line in response.split('\n'):
            if 'Arming disable flags:' in line:
                # Parse flags from the line
                parts = line.split(':')
                if len(parts) > 1:
                    flag_str = parts[1].strip()
                    flags = [f.strip() for f in flag_str.split() if f.strip()]
                break

        return flags

    # ----- VTX Control -----

    def set_vtx_band_channel(self, band: int, channel: int) -> None:
        """
        Set VTX band and channel.

        Args:
            band: 1-5 (A, B, E, F, R)
            channel: 1-8
        """
        if not 1 <= band <= 5:
            raise MSPError("Band must be 1-5")
        if not 1 <= channel <= 8:
            raise MSPError("Channel must be 1-8")

        # Get current config first
        current = self.get_vtx_config()

        # Build new config - format varies by VTX type, use CLI for reliability
        self.send_cli_command(f'set vtx_band = {band}')
        self.send_cli_command(f'set vtx_channel = {channel}')

    def set_vtx_power(self, power: int) -> None:
        """
        Set VTX power level.

        Args:
            power: Power level (1-5, varies by VTX)
        """
        if not 0 <= power <= 5:
            raise MSPError("Power must be 0-5")

        self.send_cli_command(f'set vtx_power = {power}')

    def set_vtx_pit_mode(self, enabled: bool) -> None:
        """Enable or disable VTX pit mode."""
        value = 'ON' if enabled else 'OFF'
        self.send_cli_command(f'set vtx_low_power_disarm = {value}')

    # ----- GPS Rescue -----

    def get_gps_rescue_config(self) -> GPSRescueConfig:
        """Get GPS rescue configuration via CLI."""
        response = self.send_cli_command('get gps_rescue', timeout=5.0)

        params = {}
        for line in response.split('\n'):
            line = line.strip()
            if '=' in line and line.startswith('gps_rescue_'):
                key, _, val = line.partition('=')
                key = key.strip().replace('gps_rescue_', '')
                val = val.strip()
                # Remove trailing comments/status
                if ' ' in val:
                    val = val.split()[0]
                params[key] = val

        return GPSRescueConfig(
            min_sats=int(params.get('min_sats', '8')),
            angle=int(params.get('angle', '32')),
            initial_altitude_m=int(params.get('initial_alt', '50')),
            descent_distance_m=int(params.get('descent_dist', '200')),
            ground_speed_cm_s=int(params.get('ground_speed', '750')),
            throttle_min=int(params.get('throttle_min', '1200')),
            throttle_max=int(params.get('throttle_max', '1600')),
            throttle_hover=int(params.get('throttle_hover', '1280')),
            sanity_checks=params.get('sanity_checks', 'RESCUE_SANITY_ON'),
            min_rescue_dth=int(params.get('min_dth', '100')),
            allow_arming_without_fix=params.get('allow_arming_without_fix', 'OFF') == 'ON',
            altitude_mode=params.get('altitude_mode', 'MAX_ALT'),
            ascend_rate=int(params.get('ascend_rate', '500')),
            descend_rate=int(params.get('descend_rate', '150')),
        )

    def set_gps_rescue_config(self, param: str, value: str) -> str:
        """
        Set a GPS rescue parameter via CLI.

        Args:
            param: Parameter name (e.g., 'min_sats', 'initial_alt')
            value: Value to set
        Returns:
            CLI response
        """
        return self.send_cli_command(f'set gps_rescue_{param} = {value}')

    def get_gps_status(self) -> GPSStatus:
        """Get GPS fix status and position via MSP."""
        try:
            data = self.send_command(MSPCode.MSP_RAW_GPS)
            fix_type = data[0]
            num_sats = data[1]
            latitude = struct.unpack('<i', data[2:6])[0] / 10000000.0
            longitude = struct.unpack('<i', data[6:10])[0] / 10000000.0
            altitude_m = struct.unpack('<h', data[10:12])[0]
            ground_speed = struct.unpack('<H', data[12:14])[0]
            ground_course = struct.unpack('<H', data[14:16])[0]
            hdop = struct.unpack('<H', data[16:18])[0] if len(data) > 16 else 0
            return GPSStatus(
                fix_type=fix_type,
                num_sats=num_sats,
                latitude=latitude,
                longitude=longitude,
                altitude_m=altitude_m,
                ground_speed_cm_s=ground_speed,
                ground_course=ground_course,
                hdop=hdop,
            )
        except MSPError:
            # GPS not available or not enabled, try CLI
            response = self.send_cli_command('status')
            gps_info = GPSStatus(
                fix_type=0, num_sats=0, latitude=0.0, longitude=0.0,
                altitude_m=0, ground_speed_cm_s=0, ground_course=0, hdop=0,
            )
            for line in response.split('\n'):
                if 'GPS' in line.upper():
                    if 'fix' in line.lower():
                        try:
                            parts = line.split(':')
                            if len(parts) > 1:
                                gps_info.fix_type = int(parts[1].strip().split()[0])
                        except (ValueError, IndexError):
                            pass
            return gps_info

    # ----- Full RC Tuning -----

    def get_rc_tuning_full(self) -> RCTuningFull:
        """Get full RC tuning with per-axis rates via CLI."""
        response = self.send_cli_command('get rates', timeout=5.0)

        params = {}
        for line in response.split('\n'):
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                key, _, val = line.partition('=')
                key = key.strip()
                val = val.strip()
                if ' ' in val:
                    val = val.split()[0]
                params[key] = val

        return RCTuningFull(
            rates_type=int(params.get('rates_type', '3')),
            roll_rc_rate=int(params.get('roll_rc_rate', '1')),
            roll_rate=int(params.get('roll_srate', params.get('roll_rate', '67'))),
            roll_expo=int(params.get('roll_expo', '0')),
            pitch_rc_rate=int(params.get('pitch_rc_rate', '1')),
            pitch_rate=int(params.get('pitch_srate', params.get('pitch_rate', '67'))),
            pitch_expo=int(params.get('pitch_expo', '0')),
            yaw_rc_rate=int(params.get('yaw_rc_rate', '1')),
            yaw_rate=int(params.get('yaw_srate', params.get('yaw_rate', '67'))),
            yaw_expo=int(params.get('yaw_expo', '0')),
            tpa_rate=int(params.get('tpa_rate', '65')),
            tpa_breakpoint=int(params.get('tpa_breakpoint', '1350')),
            throttle_mid=int(params.get('thr_mid', '50')),
            throttle_expo=int(params.get('thr_expo', '0')),
        )

    def set_rc_tuning(self, param: str, value: str) -> str:
        """
        Set an RC tuning parameter via CLI.

        Args:
            param: Parameter name (e.g., 'roll_rc_rate', 'roll_srate', 'rates_type')
            value: Value to set
        Returns:
            CLI response
        """
        return self.send_cli_command(f'set {param} = {value}')

    def get_pid_advanced(self) -> dict:
        """Get PID advanced settings (TPA, anti-gravity, etc.) via CLI."""
        response = self.send_cli_command('get pid', timeout=5.0)

        params = {}
        for line in response.split('\n'):
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                key, _, val = line.partition('=')
                key = key.strip()
                val = val.strip()
                if ' ' in val:
                    val = val.split()[0]
                params[key] = val

        return params

    # ----- OSD Layout -----

    # Known OSD elements (index -> CLI name mapping)
    OSD_ELEMENTS = {
        0: 'rssi_value', 1: 'main_batt_voltage', 2: 'crosshairs',
        3: 'artificial_horizon', 4: 'horizon_sidebars', 5: 'item_timer_1',
        6: 'item_timer_2', 7: 'flymode', 8: 'craft_name', 9: 'throttle_pos',
        10: 'vtx_channel', 11: 'current_draw', 12: 'mah_drawn',
        13: 'gps_speed', 14: 'gps_sats', 15: 'altitude', 16: 'pid_roll',
        17: 'pid_pitch', 18: 'pid_yaw', 19: 'power', 20: 'pid_rate_profile',
        21: 'warnings', 22: 'debug', 23: 'flip_arrow', 24: 'link_quality',
        25: 'flight_dist', 26: 'numerical_heading', 27: 'numerical_vario',
        28: 'compass_bar', 29: 'esc_tmp', 30: 'esc_rpm',
        31: 'remaining_time_estimate', 32: 'rtc_datetime', 33: 'adjustment_range',
        34: 'core_temperature', 35: 'anti_gravity', 36: 'g_force',
        37: 'motor_diag', 38: 'log_status', 39: 'avg_cell_voltage',
        40: 'gps_lon', 41: 'gps_lat', 42: 'home_dir', 43: 'home_dist',
        44: 'efficiency', 45: 'total_flights', 46: 'up_down_reference',
    }

    def get_osd_layout(self) -> OSDLayout:
        """Get OSD element positions and visibility via CLI."""
        response = self.send_cli_command('get osd', timeout=8.0)

        elements = []
        video_system = 0

        for line in response.split('\n'):
            line = line.strip()
            if '=' not in line:
                continue

            key, _, val = line.partition('=')
            key = key.strip()
            val = val.strip()
            if ' ' in val:
                val = val.split()[0]

            if key == 'osd_video_system':
                try:
                    video_system = int(val)
                except ValueError:
                    pass
                continue

            # Match osd_*_pos entries
            if key.startswith('osd_') and key.endswith('_pos'):
                elem_name = key[4:-4]  # strip 'osd_' and '_pos'
                try:
                    raw = int(val)
                except ValueError:
                    continue

                # Decode position: bit 11 = visible, bits 5-8 = row (y), bits 0-4 = col (x)
                enabled = bool(raw & (1 << 11))  # bit 11 = visible
                col = raw & 0x1F  # bits 0-4
                row = (raw >> 5) & 0x3F  # bits 5-10 (6 bits for row in newer BF)

                # Find index
                idx = -1
                for i, name in self.OSD_ELEMENTS.items():
                    if name == elem_name:
                        idx = i
                        break

                elements.append(OSDElement(
                    name=elem_name,
                    index=idx,
                    enabled=enabled,
                    col=col,
                    row=row,
                    raw_value=raw,
                ))

        return OSDLayout(video_system=video_system, elements=elements)

    def set_osd_element(self, element_name: str, col: int, row: int, enabled: bool) -> str:
        """
        Set OSD element position and visibility.

        Args:
            element_name: Element name (e.g., 'main_batt_voltage')
            col: Column (x) position 0-29
            row: Row (y) position 0-15
            enabled: Whether to show the element
        """
        if not 0 <= col <= 29:
            raise MSPError("Column must be 0-29")
        if not 0 <= row <= 15:
            raise MSPError("Row must be 0-15")

        # Encode: bit 11 = visible, bits 5-10 = row, bits 0-4 = col
        raw = col | (row << 5)
        if enabled:
            raw |= (1 << 11)

        return self.send_cli_command(f'set osd_{element_name}_pos = {raw}')

    # ----- Preflight Check -----

    def run_preflight_check(self) -> PreflightResult:
        """
        Run comprehensive preflight checks.

        Returns:
            PreflightResult with all checks and overall status
        """
        checks = []

        # Check 1: Battery voltage
        try:
            analog = self.get_analog_data()
            battery_config = self.get_battery_config()
            if analog.voltage < battery_config.vbat_warning_cell_voltage * 3:
                checks.append(PreflightCheck(
                    "Battery Voltage",
                    False,
                    f"Low voltage: {analog.voltage:.1f}V"
                ))
            else:
                checks.append(PreflightCheck(
                    "Battery Voltage",
                    True,
                    f"OK: {analog.voltage:.1f}V"
                ))
        except Exception as e:
            checks.append(PreflightCheck("Battery Voltage", False, str(e)))

        # Check 2: Gyro/Accelerometer
        try:
            status = self.get_status()
            has_gyro = 'GYRO' in status.sensors
            has_acc = 'ACC' in status.sensors
            if has_gyro:
                checks.append(PreflightCheck("Gyroscope", True, "Detected"))
            else:
                checks.append(PreflightCheck("Gyroscope", False, "Not detected"))

            if has_acc:
                checks.append(PreflightCheck("Accelerometer", True, "Detected"))
            else:
                checks.append(PreflightCheck("Accelerometer", False, "Not detected"))
        except Exception as e:
            checks.append(PreflightCheck("Sensors", False, str(e)))

        # Check 3: RC Link
        try:
            rc = self.get_rc_channels()
            # Check if we're getting valid RC data (not all zeros or 1500)
            valid_rc = any(900 < ch < 2100 and ch != 1500 for ch in rc.channels[:4])
            if valid_rc:
                checks.append(PreflightCheck("RC Link", True, "Receiving"))
            else:
                checks.append(PreflightCheck("RC Link", False, "No signal or all centered"))
        except Exception as e:
            checks.append(PreflightCheck("RC Link", False, str(e)))

        # Check 4: Arming flags
        try:
            arming_flags = self.get_arming_disable_flags()
            # Filter out acceptable flags
            acceptable = ['RXLOSS', 'CLI']
            blocking_flags = [f for f in arming_flags if f not in acceptable]

            if not blocking_flags:
                checks.append(PreflightCheck("Arming Status", True, "Ready to arm"))
            else:
                checks.append(PreflightCheck(
                    "Arming Status",
                    False,
                    f"Blocked: {', '.join(blocking_flags)}"
                ))
        except Exception as e:
            checks.append(PreflightCheck("Arming Status", False, str(e)))

        # Check 5: Failsafe configured
        try:
            failsafe = self.get_failsafe_config()
            if failsafe.procedure > 0:
                proc_names = {0: 'Auto-land', 1: 'Drop', 2: 'GPS Rescue'}
                checks.append(PreflightCheck(
                    "Failsafe",
                    True,
                    f"Configured: {proc_names.get(failsafe.procedure, 'Unknown')}"
                ))
            else:
                checks.append(PreflightCheck(
                    "Failsafe",
                    True,
                    "Configured: Auto-land (default)"
                ))
        except Exception as e:
            checks.append(PreflightCheck("Failsafe", False, str(e)))

        # Check 6: CPU load
        try:
            status = self.get_status()
            if status.cpu_load < 50:
                checks.append(PreflightCheck("CPU Load", True, f"{status.cpu_load}%"))
            elif status.cpu_load < 80:
                checks.append(PreflightCheck("CPU Load", True, f"Warning: {status.cpu_load}%"))
            else:
                checks.append(PreflightCheck("CPU Load", False, f"High: {status.cpu_load}%"))
        except Exception as e:
            checks.append(PreflightCheck("CPU Load", False, str(e)))

        all_passed = all(c.passed for c in checks)
        return PreflightResult(all_passed=all_passed, checks=checks)
