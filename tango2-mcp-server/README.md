# Tango 2 MCP Server

MCP Server para configurar el TBS Tango 2 (EdgeTX/FreedomTX) desde Claude o cualquier cliente MCP compatible.

## Setup

### 1. Instalar dependencias y compilar

```bash
cd tango2-mcp-server
npm install
npm run build
```

### 2. Configurar en Claude Desktop

Agregar a `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tango2": {
      "command": "node",
      "args": ["/Users/nra/Desktop/DRONE/tango2-mcp-server/dist/index.js"],
      "env": {}
    }
  }
}
```

### 3. Configurar en Claude Code

Agregar a `~/.claude/settings.json` bajo `mcpServers`:

```json
{
  "mcpServers": {
    "tango2": {
      "command": "node",
      "args": ["/Users/nra/Desktop/DRONE/tango2-mcp-server/dist/index.js"]
    }
  }
}
```

## Tools disponibles

| Tool | Descripción |
|------|-------------|
| `detect_radio` | Detectar si el Tango 2 está conectado por USB |
| `list_models` | Listar todos los modelos configurados |
| `read_model` | Leer configuración completa de un modelo |
| `read_radio_config` | Leer configuración global del radio |
| `set_mix` | Configurar/modificar un mix en un canal |
| `remove_mix` | Eliminar un mix de un canal |
| `set_input` | Configurar un input (expo/rate) |
| `assign_switch` | Asignar switch a canal AUX para modo de vuelo |
| `get_free_switches` | Ver switches libres en un modelo |
| `set_logical_switch` | Configurar switch lógico |
| `set_timer` | Configurar timer |
| `backup_model` | Hacer backup de un modelo (o "all") |
| `restore_model` | Restaurar modelo desde backup |
| `list_backups` | Listar backups disponibles |
| `validate_config` | Validar configuración de un modelo |
| `create_model` | Crear modelo nuevo (con template opcional) |
| `compare_models` | Comparar dos modelos |
| `export_model_summary` | Exportar resumen en markdown |
| `suggest_mode` | Sugerir config de switch para modo Betaflight |

## Resources MCP

- `edgetx://models` — Lista de modelos disponibles
- `edgetx://radio` — Configuración global del radio

## Templates predefinidos

- **freestyle_5inch** — Nazgûl Evoque F6: AETR, Arm(SA), FltMode(SB), Beeper(SC), AUX4(SD)
- **long_range_7inch** — Chimera 7: AETR, Arm(SA), FltMode(SB), Launch(SC), GPS(SD), Beeper(SE), GoPro(SF)
- **cinematic** — Cine con expo alto, rates duales, control GoPro

## Ejemplos de uso con Claude

- "Mostrá los modelos que tengo en mi Tango 2"
- "¿Qué switches tengo libres en el modelo de la Chimera 7?"
- "Asigná Launch Control al Switch C en el modelo Chimera7"
- "Compará la configuración de mi modelo freestyle con el de long range"
- "Creá un nuevo modelo para un drone de 5 pulgadas basado en el template freestyle"
- "Hacé backup de todos mis modelos"
- "Validá la configuración del modelo Freestyle"

## Seguridad

- Se crea backup automático antes de cualquier escritura
- Validación de configuración antes de guardar
- Manejo de errores en español
- Robusto ante archivos corruptos
