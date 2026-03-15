"""
Handler modules for the Betaflight MCP server.

Each module groups related tool handlers and exposes a `HANDLERS` dict
mapping tool-name -> async handler function.  The central dispatch dict
in server.py is built by merging all of them.
"""

from .connection import HANDLERS as CONNECTION_HANDLERS
from .config import HANDLERS as CONFIG_HANDLERS
from .sensors import HANDLERS as SENSOR_HANDLERS
from .safety import HANDLERS as SAFETY_HANDLERS
from .fleet import HANDLERS as FLEET_HANDLERS
from .osd import HANDLERS as OSD_HANDLERS
from .vtx import HANDLERS as VTX_HANDLERS
from .gps import HANDLERS as GPS_HANDLERS

ALL_HANDLERS: dict = {}
ALL_HANDLERS.update(CONNECTION_HANDLERS)
ALL_HANDLERS.update(CONFIG_HANDLERS)
ALL_HANDLERS.update(SENSOR_HANDLERS)
ALL_HANDLERS.update(SAFETY_HANDLERS)
ALL_HANDLERS.update(FLEET_HANDLERS)
ALL_HANDLERS.update(OSD_HANDLERS)
ALL_HANDLERS.update(VTX_HANDLERS)
ALL_HANDLERS.update(GPS_HANDLERS)

__all__ = ["ALL_HANDLERS"]
