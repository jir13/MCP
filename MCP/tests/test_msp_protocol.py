"""
Tests for MSP protocol message building, checksum, and response parsing.
Uses known byte sequences — no serial connection needed.
"""

import struct
import pytest
from unittest.mock import MagicMock, patch, PropertyMock
from betaflight_mcp.msp import MSPConnection, MSPCode, MSPError


class TestChecksum:
    """Test XOR checksum calculation."""

    def test_empty_data(self):
        conn = MSPConnection.__new__(MSPConnection)
        assert conn._calculate_checksum(b'') == 0

    def test_single_byte(self):
        conn = MSPConnection.__new__(MSPConnection)
        assert conn._calculate_checksum(b'\x42') == 0x42

    def test_known_sequence(self):
        conn = MSPConnection.__new__(MSPConnection)
        # XOR of [0x01, 0x02, 0x03] = 0x01^0x02^0x03 = 0x00
        assert conn._calculate_checksum(b'\x01\x02\x03') == 0x00

    def test_xor_identity(self):
        conn = MSPConnection.__new__(MSPConnection)
        # XOR with itself yields 0
        assert conn._calculate_checksum(b'\xFF\xFF') == 0x00

    def test_msp_api_version_request(self):
        """Known checksum for MSP_API_VERSION (code=1, no data)."""
        conn = MSPConnection.__new__(MSPConnection)
        # length=0, code=1 → checksum = 0 ^ 1 = 1
        checksum_data = bytes([0, 1])
        assert conn._calculate_checksum(checksum_data) == 1


class TestBuildMessage:
    """Test MSP message construction."""

    def setup_method(self):
        self.conn = MSPConnection.__new__(MSPConnection)
        self.conn._serial = None
        self.conn._port = "/dev/ttyUSB0"
        self.conn._baudrate = 115200

    def test_api_version_request(self):
        """MSP_API_VERSION request: $M< + len(0) + code(1) + checksum(1)."""
        msg = self.conn._build_msp_message(MSPCode.MSP_API_VERSION)
        assert msg[:3] == b'$M<'  # header + direction
        assert msg[3] == 0        # data length = 0
        assert msg[4] == 1        # MSP_API_VERSION = 1
        assert msg[5] == 1        # checksum: 0 ^ 1 = 1
        assert len(msg) == 6

    def test_message_with_data(self):
        """Message with payload should include data and correct checksum."""
        data = bytes([0x10, 0x20])
        msg = self.conn._build_msp_message(MSPCode.MSP_SET_PID, data)
        assert msg[:3] == b'$M<'
        assert msg[3] == 2       # data length
        assert msg[4] == 202     # MSP_SET_PID
        assert msg[5:7] == data
        # checksum = 2 ^ 202 ^ 0x10 ^ 0x20
        expected_cs = 2 ^ 202 ^ 0x10 ^ 0x20
        assert msg[7] == expected_cs

    def test_set_name_message(self):
        """MSP_SET_NAME should encode craft name as ASCII bytes."""
        name = b'RAWY'
        msg = self.conn._build_msp_message(MSPCode.MSP_SET_NAME, name)
        assert msg[:3] == b'$M<'
        assert msg[3] == 4        # length of "RAWY"
        assert msg[4] == 11       # MSP_SET_NAME = 11
        assert msg[5:9] == name
        # Verify checksum
        cs_data = bytes([4, 11]) + name
        expected_cs = self.conn._calculate_checksum(cs_data)
        assert msg[9] == expected_cs

    def test_message_length_matches(self):
        """Total message length should be header(3) + 1(len) + 1(code) + data_len + 1(cs)."""
        for data_len in [0, 1, 10, 50]:
            data = bytes(range(data_len % 256)) * (data_len // 256 + 1)
            data = data[:data_len]
            msg = self.conn._build_msp_message(100, data)
            assert len(msg) == 6 + data_len


class TestReadResponse:
    """Test MSP response parsing with mock serial."""

    def setup_method(self):
        self.conn = MSPConnection.__new__(MSPConnection)
        self.conn._serial = MagicMock()
        self.conn._port = "/dev/ttyUSB0"
        self.conn._baudrate = 115200

    def _build_response(self, code: int, data: bytes) -> bytes:
        """Build a valid MSP response for mocking."""
        checksum_data = bytes([len(data), code]) + data
        cs = 0
        for b in checksum_data:
            cs ^= b
        return b'$M>' + bytes([len(data), code]) + data + bytes([cs])

    def test_parse_api_version_response(self):
        """Parse MSP_API_VERSION response: 3 bytes (proto, major, minor)."""
        data = bytes([0, 1, 46])  # protocol=0, API 1.46
        response = self._build_response(MSPCode.MSP_API_VERSION, data)

        # Mock serial reads
        self.conn._serial.read = MagicMock(side_effect=[
            response[:3],   # header ($M>)
            response[3:5],  # length + code
            response[5:],   # data + checksum
        ])

        result = self.conn._read_msp_response(MSPCode.MSP_API_VERSION)
        assert result == data

    def test_parse_attitude_response(self):
        """Parse MSP_ATTITUDE response: roll, pitch, yaw as int16."""
        # roll=50 (0.5deg), pitch=-30, yaw=1800 (180deg)
        data = struct.pack('<hhh', 50, -30, 1800)
        response = self._build_response(MSPCode.MSP_ATTITUDE, data)

        self.conn._serial.read = MagicMock(side_effect=[
            response[:3], response[3:5], response[5:],
        ])

        result = self.conn._read_msp_response(MSPCode.MSP_ATTITUDE)
        roll, pitch, yaw = struct.unpack('<hhh', result)
        assert roll == 50
        assert pitch == -30
        assert yaw == 1800

    def test_timeout_on_header(self):
        """Should raise MSPError on short header."""
        self.conn._serial.read = MagicMock(return_value=b'$M')
        with pytest.raises(MSPError, match="Timeout"):
            self.conn._read_msp_response(MSPCode.MSP_STATUS)

    def test_invalid_header(self):
        """Should raise MSPError on invalid header bytes."""
        self.conn._serial.read = MagicMock(return_value=b'XXX')
        with pytest.raises(MSPError, match="Invalid MSP header"):
            self.conn._read_msp_response(MSPCode.MSP_STATUS)

    def test_msp_error_direction(self):
        """Should raise MSPError when FC returns error direction byte."""
        self.conn._serial.read = MagicMock(return_value=b'$M!')
        with pytest.raises(MSPError, match="MSP error"):
            self.conn._read_msp_response(MSPCode.MSP_STATUS)

    def test_wrong_code(self):
        """Should raise MSPError when response code doesn't match expected."""
        data = bytes([1, 2, 3])
        response = self._build_response(99, data)  # wrong code

        self.conn._serial.read = MagicMock(side_effect=[
            response[:3], response[3:5], response[5:],
        ])

        with pytest.raises(MSPError, match="Unexpected MSP code"):
            self.conn._read_msp_response(MSPCode.MSP_STATUS)

    def test_checksum_validation(self):
        """Should raise MSPError on bad checksum."""
        data = bytes([1, 2, 3])
        response = self._build_response(MSPCode.MSP_STATUS, data)
        # Corrupt the checksum
        corrupted = response[:-1] + bytes([(response[-1] ^ 0xFF)])

        self.conn._serial.read = MagicMock(side_effect=[
            corrupted[:3], corrupted[3:5], corrupted[5:],
        ])

        with pytest.raises(MSPError, match="[Cc]hecksum"):
            self.conn._read_msp_response(MSPCode.MSP_STATUS)

    def test_parse_pid_response(self):
        """Parse MSP_PID response: 9 bytes (3 axes x P,I,D)."""
        # Roll: P=45, I=80, D=40 | Pitch: P=47, I=84, D=46 | Yaw: P=45, I=80, D=0
        data = bytes([45, 80, 40, 47, 84, 46, 45, 80, 0])
        response = self._build_response(MSPCode.MSP_PID, data)

        self.conn._serial.read = MagicMock(side_effect=[
            response[:3], response[3:5], response[5:],
        ])

        result = self.conn._read_msp_response(MSPCode.MSP_PID)
        assert result[0] == 45   # roll_p
        assert result[1] == 80   # roll_i
        assert result[2] == 40   # roll_d
        assert result[6] == 45   # yaw_p


class TestPIDDataclass:
    """Test PID settings dataclass."""

    def test_pid_from_bytes(self):
        from betaflight_mcp.msp import PIDSettings
        pid = PIDSettings(
            roll_p=45, roll_i=80, roll_d=40,
            pitch_p=47, pitch_i=84, pitch_d=46,
            yaw_p=45, yaw_i=80, yaw_d=0,
        )
        assert pid.roll_p == 45
        assert pid.yaw_d == 0
