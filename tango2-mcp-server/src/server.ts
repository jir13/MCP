// ============================================================
// MCP Server para TBS Tango 2 (FreedomTX / OpenTX 2.3)
// Trabaja con archivos .bin binarios directamente
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { detectRadio, clearDetectionCache, getModelsPath, getRadioConfigPath, getCachedDetection } from './tools/detect.js';
import {
  FTXModelFile, listBinModels, findBinModel, createEmptyModel,
  getNextBinModelFileName, srcRawToName, nameToSrcRaw, MIXSRC,
  type FTXTimerData,
} from './parsers/freedomtx-bin.js';

// Directorio de backups local (en la Mac, no en la SD)
const BACKUP_BASE = process.env.TANGO2_BACKUP_DIR
  || path.join(os.homedir(), '.drone', 'backups', 'tango2');

function ensureBackupDir(): string {
  if (!fs.existsSync(BACKUP_BASE)) {
    fs.mkdirSync(BACKUP_BASE, { recursive: true });
  }
  return BACKUP_BASE;
}

function backupFile(filePath: string): string {
  const backupDir = ensureBackupDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const baseName = path.basename(filePath, path.extname(filePath));
  const backupName = `${baseName}_${timestamp}${path.extname(filePath)}`;
  const backupPath = path.join(backupDir, backupName);
  try {
    fs.copyFileSync(filePath, backupPath);
  } catch (err) {
    throw new Error(`Backup falló para "${path.basename(filePath)}": ${(err as Error).message}. No se modificó el archivo original.`);
  }
  return backupPath;
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'tango2-freedomtx',
    version: '2.0.0',
  });

  // ====================================================
  // TOOLS
  // ====================================================

  // --- detect_radio ---
  server.tool(
    'detect_radio',
    'Detectar si el TBS Tango 2 está conectado por USB y encontrar el punto de montaje.',
    {},
    async () => {
      try {
        clearDetectionCache();
        const result = detectRadio();
        return {
          content: [{
            type: 'text',
            text: result.found
              ? `Radio detectado!\n- Punto de montaje: ${result.mountPoint}\n- Modelos: ${result.modelsPath}\n- Config: ${result.radioConfigPath || 'no encontrado'}\n- Firmware: ${result.firmware}\n- Plataforma: ${result.platform}`
              : `Radio no detectado.\n${result.error}`,
          }],
        };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  // --- list_models ---
  server.tool(
    'list_models',
    'Listar todos los modelos del radio con mixes, canales y configuración.',
    {},
    async () => {
      try {
        const modelsPath = getModelsPath();
        const models = listBinModels(modelsPath);
        if (models.length === 0) {
          return { content: [{ type: 'text', text: 'No se encontraron modelos en el radio.' }] };
        }

        const lines = ['# Modelos en el Tango 2\n'];
        for (const m of models) {
          lines.push(`## ${m.name} (${m.fileName}) — ID: ${m.modelId}`);
          lines.push(`Mixes: ${m.mixCount} | Canales activos: ${m.channelCount}\n`);

          if (m.mixes.length > 0) {
            lines.push('| Canal | Fuente | Peso | Nombre |');
            lines.push('|-------|--------|------|--------|');
            for (const mix of m.mixes) {
              lines.push(`| CH${mix.destCh + 1} | ${mix.srcName} (${mix.srcRaw}) | ${mix.weight}% | ${mix.name || '-'} |`);
            }
            lines.push('');
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  // --- read_model ---
  server.tool(
    'read_model',
    'Leer configuración completa de un modelo (mixes, timers, canales).',
    { model_name: z.string().describe('Nombre del modelo o archivo (ej: "model1")') },
    async ({ model_name }) => {
      try {
        const modelsPath = getModelsPath();
        const model = findBinModel(modelsPath, model_name);
        if (!model) throw new Error(`Modelo "${model_name}" no encontrado.`);

        const summary = model.getSummary();
        const lines = [`# Modelo: ${summary.name} (${summary.fileName})`];
        lines.push(`Model ID: ${summary.modelId}\n`);

        // Timers
        lines.push('## Timers');
        for (let i = 0; i < 3; i++) {
          const t = summary.timers[i];
          const mins = Math.floor(t.start / 60);
          const secs = t.start % 60;
          lines.push(`- Timer ${i + 1}: ${t.name || '-'} | ${mins}:${String(secs).padStart(2, '0')} | modo=${t.mode} | persistent=${t.persistent}`);
        }
        lines.push('');

        // Mixes
        lines.push('## Mixes');
        lines.push('| # | Canal | Fuente | srcRaw | Peso | Switch | Offset | Nombre |');
        lines.push('|---|-------|--------|--------|------|--------|--------|--------|');
        for (const [i, mix] of summary.mixes.entries()) {
          lines.push(`| ${i} | CH${mix.destCh + 1} | ${mix.srcName} | ${mix.srcRaw} | ${mix.weight}% | ${mix.swtch || '-'} | ${mix.offset} | ${mix.name || '-'} |`);
        }
        lines.push('');

        // AUX summary
        const auxMixes = summary.mixes.filter(m => m.destCh >= 4);
        if (auxMixes.length > 0) {
          lines.push('## Canales AUX');
          for (const mix of auxMixes) {
            lines.push(`- **AUX${mix.destCh - 3}** (CH${mix.destCh + 1}): ${mix.srcName}`);
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  // --- read_radio_config ---
  server.tool(
    'read_radio_config',
    'Leer información de la configuración del radio.',
    {},
    async () => {
      try {
        const configPath = getRadioConfigPath();
        const detection = getCachedDetection();
        const stat = fs.statSync(configPath);

        const lines = ['# Configuración del Radio\n'];
        lines.push(`- Firmware: ${detection.firmware}`);
        lines.push(`- Archivo: ${configPath}`);
        lines.push(`- Tamaño: ${stat.size} bytes`);
        lines.push(`- Formato: binario (radio.bin)`);
        lines.push(`- Mount: ${detection.mountPoint}`);

        // List other interesting files
        if (detection.mountPoint) {
          const versionFile = path.join(detection.mountPoint, 'opentx.sdcard.version');
          if (fs.existsSync(versionFile)) {
            const version = fs.readFileSync(versionFile, 'utf-8').trim();
            lines.push(`- Versión SD: ${version}`);
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  // --- set_mix ---
  server.tool(
    'set_mix',
    'Configurar o modificar un mix en un canal. Fuentes válidas: SA-SF (switches), Ail/Ele/Thr/Rud (sticks), I1-I32 (inputs), S1/S2 (pots), MAX.',
    {
      model_name: z.string().describe('Nombre del modelo'),
      channel: z.number().min(1).max(32).describe('Canal destino (1-32)'),
      source: z.string().describe('Fuente: SA, SB, SC, SD, SE, SF, Ail, Ele, Thr, Rud, I1-I4, S1, S2, MAX'),
      weight: z.number().min(-125).max(125).describe('Peso (-125 a 125)'),
      name: z.string().optional().describe('Nombre del mix (max 6 chars)'),
    },
    async ({ model_name, channel, source, weight, name }) => {
      try {
        const modelsPath = getModelsPath();
        const model = findBinModel(modelsPath, model_name);
        if (!model) throw new Error(`Modelo "${model_name}" no encontrado.`);

        const srcRaw = nameToSrcRaw(source);
        if (srcRaw === null) throw new Error(`Fuente "${source}" no reconocida. Usá: SA-SF, Ail, Ele, Thr, Rud, I1-I4, S1, S2, MAX.`);

        // Backup
        backupFile(model.filePath);

        const destCh = channel - 1;

        // Buscar mix existente en el canal
        let targetSlot = -1;
        for (let i = 0; i < 64; i++) {
          const mix = model.getMix(i);
          if (mix && mix.destCh === destCh) {
            targetSlot = i;
            break;
          }
        }

        if (targetSlot === -1) {
          targetSlot = model.findMixSlotForChannel(destCh);
          if (targetSlot === -1) throw new Error('No hay slots de mix disponibles.');
        }

        model.setMix(targetSlot, {
          weight,
          destCh,
          srcRaw,
          name: name || '',
        });

        model.save();

        return { content: [{ type: 'text', text: `Mix configurado en CH${channel}: ${source} (srcRaw=${srcRaw}) al ${weight}%. Slot #${targetSlot}.` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  // --- assign_switch ---
  server.tool(
    'assign_switch',
    'Asignar un switch (SA-SF) a un canal AUX para un modo de vuelo.',
    {
      model_name: z.string().describe('Nombre del modelo'),
      channel: z.number().min(5).max(16).describe('Canal AUX (5-16, donde CH5=AUX1)'),
      switch_id: z.string().describe('Switch: SA, SB, SC, SD, SE, SF'),
      mode_name: z.string().optional().describe('Nombre del modo (ej: "Arm", "FltMode", "Beeper")'),
    },
    async ({ model_name, channel, switch_id, mode_name }) => {
      try {
        const modelsPath = getModelsPath();
        const model = findBinModel(modelsPath, model_name);
        if (!model) throw new Error(`Modelo "${model_name}" no encontrado.`);

        const srcRaw = nameToSrcRaw(switch_id);
        if (srcRaw === null || srcRaw < MIXSRC.SW_SA || srcRaw > MIXSRC.SW_SF) {
          throw new Error(`Switch "${switch_id}" inválido. Usá: SA, SB, SC, SD, SE, SF.`);
        }

        backupFile(model.filePath);

        const destCh = channel - 1;
        let targetSlot = -1;
        for (let i = 0; i < 64; i++) {
          const mix = model.getMix(i);
          if (mix && mix.destCh === destCh) { targetSlot = i; break; }
        }
        if (targetSlot === -1) {
          targetSlot = model.findMixSlotForChannel(destCh);
          if (targetSlot === -1) throw new Error('No hay slots de mix disponibles.');
        }

        model.setMix(targetSlot, {
          weight: 100,
          destCh,
          srcRaw,
          name: (mode_name || switch_id).substring(0, 6),
        });

        model.save();
        const auxNum = channel - 4;

        return { content: [{ type: 'text', text: `${switch_id} asignado a CH${channel} (AUX${auxNum}) del modelo "${model_name}"${mode_name ? ` para "${mode_name}"` : ''}.` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  // --- get_free_switches ---
  server.tool(
    'get_free_switches',
    'Ver qué switches están libres/usados en un modelo.',
    { model_name: z.string().describe('Nombre del modelo') },
    async ({ model_name }) => {
      try {
        const modelsPath = getModelsPath();
        const model = findBinModel(modelsPath, model_name);
        if (!model) throw new Error(`Modelo "${model_name}" no encontrado.`);

        const mixes = model.getAllMixes();
        const usedSwitches = new Map<string, { channel: number; name: string }>();
        const allSwitches = ['SA', 'SB', 'SC', 'SD', 'SE', 'SF'];
        const switchSrcMap: Record<string, number> = {
          SA: MIXSRC.SW_SA, SB: MIXSRC.SW_SB, SC: MIXSRC.SW_SC,
          SD: MIXSRC.SW_SD, SE: MIXSRC.SW_SE, SF: MIXSRC.SW_SF,
        };

        for (const mix of mixes) {
          for (const [sw, src] of Object.entries(switchSrcMap)) {
            if (mix.srcRaw === src) {
              usedSwitches.set(sw, { channel: mix.destCh + 1, name: mix.name || srcRawToName(mix.srcRaw) });
            }
          }
        }

        const lines = [`# Switches del modelo "${model_name}"\n`];

        const used = Array.from(usedSwitches.entries());
        if (used.length > 0) {
          lines.push('## En uso:');
          for (const [sw, info] of used) {
            lines.push(`- **${sw}** → CH${info.channel} (${info.name})`);
          }
          lines.push('');
        }

        const free = allSwitches.filter(s => !usedSwitches.has(s));
        if (free.length > 0) {
          lines.push('## Libres:');
          for (const sw of free) {
            const positions = ['SA', 'SD', 'SE', 'SF'].includes(sw) ? '2 posiciones' : '3 posiciones';
            lines.push(`- **${sw}** (${positions})`);
          }
        } else {
          lines.push('Todos los switches están en uso.');
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  // --- set_timer ---
  server.tool(
    'set_timer',
    'Configurar un timer.',
    {
      model_name: z.string().describe('Nombre del modelo'),
      timer_number: z.number().min(1).max(3).describe('Timer 1, 2 o 3'),
      start_seconds: z.number().min(0).max(35999).describe('Valor en segundos'),
      mode: z.number().min(0).max(5).optional().describe('Modo (0=off, 1=on, 2=strt, 3=thrs, 4=th%, 5=thst)'),
      name: z.string().optional().describe('Nombre del timer (max 8 chars)'),
    },
    async ({ model_name, timer_number, start_seconds, mode, name }) => {
      try {
        const modelsPath = getModelsPath();
        const model = findBinModel(modelsPath, model_name);
        if (!model) throw new Error(`Modelo "${model_name}" no encontrado.`);

        backupFile(model.filePath);

        const updates: Partial<FTXTimerData> = { start: start_seconds };
        if (mode !== undefined) updates.mode = mode;
        if (name !== undefined) updates.name = name;

        model.setTimer(timer_number - 1, updates);
        model.save();

        const mins = Math.floor(start_seconds / 60);
        const secs = start_seconds % 60;
        return { content: [{ type: 'text', text: `Timer ${timer_number} configurado: ${mins}:${String(secs).padStart(2, '0')}${name ? ` "${name}"` : ''}.` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  // --- backup_model ---
  server.tool(
    'backup_model',
    'Hacer backup de un modelo (o "all" para todos).',
    { model_name: z.string().describe('Nombre del modelo o "all"') },
    async ({ model_name }) => {
      try {
        const modelsPath = getModelsPath();

        if (model_name.toLowerCase() === 'all') {
          const files = fs.readdirSync(modelsPath).filter(f => f.endsWith('.bin'));
          const backups: string[] = [];
          for (const f of files) {
            const bp = backupFile(path.join(modelsPath, f));
            backups.push(bp);
          }
          // Also backup radio config and models.txt
          const radioPath = path.join(modelsPath, '..', 'RADIO', 'radio.bin');
          if (fs.existsSync(radioPath)) backupFile(radioPath);
          const modelsTxt = path.join(modelsPath, '..', 'RADIO', 'models.txt');
          if (fs.existsSync(modelsTxt)) backupFile(modelsTxt);

          return { content: [{ type: 'text', text: `Backup completo: ${backups.length} modelos + radio.bin guardados en ${BACKUP_BASE}` }] };
        }

        const model = findBinModel(modelsPath, model_name);
        if (!model) throw new Error(`Modelo "${model_name}" no encontrado.`);
        const bp = backupFile(model.filePath);
        return { content: [{ type: 'text', text: `Backup creado: ${path.basename(bp)}` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  // --- restore_model ---
  server.tool(
    'restore_model',
    'Restaurar un modelo desde un backup.',
    {
      model_name: z.string().describe('Nombre del modelo a restaurar'),
      backup_file: z.string().describe('Nombre del archivo de backup'),
    },
    async ({ model_name, backup_file }) => {
      try {
        const modelsPath = getModelsPath();
        const model = findBinModel(modelsPath, model_name);
        if (!model) throw new Error(`Modelo "${model_name}" no encontrado.`);

        const backupPath = path.resolve(BACKUP_BASE, backup_file);
        if (!backupPath.startsWith(path.resolve(BACKUP_BASE))) {
          throw new Error(`Ruta de backup inválida: "${backup_file}" intenta salir del directorio de backups.`);
        }
        if (!fs.existsSync(backupPath)) throw new Error(`Backup no encontrado: ${backup_file}`);

        // Backup del estado actual antes de restaurar
        backupFile(model.filePath);

        fs.copyFileSync(backupPath, model.filePath);
        return { content: [{ type: 'text', text: `Modelo "${model_name}" restaurado desde ${backup_file}. Se creó backup del estado anterior.` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  // --- list_backups ---
  server.tool(
    'list_backups',
    'Listar backups disponibles.',
    {},
    async () => {
      try {
        if (!fs.existsSync(BACKUP_BASE)) return { content: [{ type: 'text', text: 'No hay backups.' }] };
        const files = fs.readdirSync(BACKUP_BASE).filter(f => f.endsWith('.bin') || f.endsWith('.txt')).sort().reverse();
        if (files.length === 0) return { content: [{ type: 'text', text: 'No hay backups.' }] };

        const lines = ['# Backups disponibles\n'];
        for (const f of files) {
          const stat = fs.statSync(path.join(BACKUP_BASE, f));
          lines.push(`- **${f}** (${(stat.size / 1024).toFixed(1)} KB) — ${stat.mtime.toLocaleString()}`);
        }
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  // --- cleanup_backups ---
  server.tool(
    'cleanup_backups',
    'Limpiar backups antiguos, manteniendo los últimos N por modelo.',
    {
      keep: z.number().min(1).max(100).optional().describe('Número de backups a mantener por modelo (default: 10)'),
    },
    async ({ keep }) => {
      try {
        const maxKeep = keep || 10;
        if (!fs.existsSync(BACKUP_BASE)) return { content: [{ type: 'text', text: 'No hay backups.' }] };

        const files = fs.readdirSync(BACKUP_BASE).filter(f => f.endsWith('.bin') || f.endsWith('.txt'));

        // Group by base model name (everything before the timestamp)
        const groups = new Map<string, string[]>();
        for (const f of files) {
          // Pattern: modelName_YYYY-MM-DDTHH-MM-SS.ext
          const match = f.match(/^(.+?)_\d{4}-\d{2}-\d{2}T/);
          const key = match ? match[1] : f;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(f);
        }

        let totalDeleted = 0;
        const details: string[] = [];

        for (const [model, modelFiles] of groups) {
          // Sort by name (which includes timestamp) descending = newest first
          modelFiles.sort().reverse();
          if (modelFiles.length > maxKeep) {
            const toDelete = modelFiles.slice(maxKeep);
            for (const f of toDelete) {
              fs.unlinkSync(path.join(BACKUP_BASE, f));
              totalDeleted++;
            }
            details.push(`${model}: eliminados ${toDelete.length}, conservados ${maxKeep}`);
          } else {
            details.push(`${model}: ${modelFiles.length} backups (OK)`);
          }
        }

        const lines = [`# Limpieza de backups (mantener últimos ${maxKeep})\n`];
        lines.push(...details.map(d => `- ${d}`));
        lines.push(`\nTotal eliminados: ${totalDeleted}`);

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  // --- validate_config ---
  server.tool(
    'validate_config',
    'Validar la configuración de un modelo.',
    { model_name: z.string().describe('Nombre del modelo') },
    async ({ model_name }) => {
      try {
        const modelsPath = getModelsPath();
        const model = findBinModel(modelsPath, model_name);
        if (!model) throw new Error(`Modelo "${model_name}" no encontrado.`);

        const summary = model.getSummary();
        const lines = [`# Validación: ${summary.name}\n`];
        const errors: string[] = [];
        const warnings: string[] = [];
        const info: string[] = [];

        // Check AETR channels
        const chSet = new Set(summary.mixes.map(m => m.destCh));
        for (let ch = 0; ch < 4; ch++) {
          if (!chSet.has(ch)) errors.push(`CH${ch + 1} (${['Ail', 'Ele', 'Thr', 'Rud'][ch]}) no tiene mix.`);
        }

        // Check ARM switch
        const hasArm = summary.mixes.some(m => m.destCh >= 4 && (
          m.srcRaw === MIXSRC.SW_SA || (m.name || '').toLowerCase().includes('arm')
        ));
        if (!hasArm) warnings.push('No se detectó un switch ARM. Se recomienda tener SA como Arm en CH5.');

        // Check weight values
        for (const mix of summary.mixes) {
          if (Math.abs(mix.weight) > 100) warnings.push(`CH${mix.destCh + 1}: peso ${mix.weight}% fuera del rango normal.`);
        }

        // Check mix count
        info.push(`${summary.mixCount} mixes en ${summary.channelCount} canales.`);

        // Report
        if (errors.length === 0) lines.push('La configuración es válida.\n');
        else lines.push('Se encontraron errores.\n');

        if (errors.length > 0) { lines.push('### Errores'); errors.forEach(e => lines.push(`- ${e}`)); lines.push(''); }
        if (warnings.length > 0) { lines.push('### Advertencias'); warnings.forEach(w => lines.push(`- ${w}`)); lines.push(''); }
        if (info.length > 0) { lines.push('### Info'); info.forEach(i => lines.push(`- ${i}`)); }

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  // --- compare_models ---
  server.tool(
    'compare_models',
    'Comparar dos modelos y mostrar diferencias.',
    {
      model_a: z.string().describe('Primer modelo'),
      model_b: z.string().describe('Segundo modelo'),
    },
    async ({ model_a, model_b }) => {
      try {
        const modelsPath = getModelsPath();
        const a = findBinModel(modelsPath, model_a);
        const b = findBinModel(modelsPath, model_b);
        if (!a) throw new Error(`Modelo "${model_a}" no encontrado.`);
        if (!b) throw new Error(`Modelo "${model_b}" no encontrado.`);

        const sa = a.getSummary();
        const sb = b.getSummary();
        const lines = [`# Comparación: ${sa.name} vs ${sb.name}\n`];

        // Compare mixes
        const maxMixes = Math.max(sa.mixes.length, sb.mixes.length);
        let diffs = 0;
        lines.push('## Mixes');
        lines.push(`| Campo | ${sa.name} | ${sb.name} |`);
        lines.push('|-------|' + '-'.repeat(sa.name.length + 2) + '|' + '-'.repeat(sb.name.length + 2) + '|');

        // Compare by channel
        const allChannels = new Set([...sa.mixes.map(m => m.destCh), ...sb.mixes.map(m => m.destCh)]);
        for (const ch of [...allChannels].sort((a, b) => a - b)) {
          const mixA = sa.mixes.find(m => m.destCh === ch);
          const mixB = sb.mixes.find(m => m.destCh === ch);
          const srcA = mixA ? `${mixA.srcName} (${mixA.weight}%)` : '-';
          const srcB = mixB ? `${mixB.srcName} (${mixB.weight}%)` : '-';
          if (srcA !== srcB) {
            lines.push(`| CH${ch + 1} | ${srcA} | ${srcB} |`);
            diffs++;
          }
        }

        if (diffs === 0) lines.push('| (idénticos) | - | - |');
        lines.push(`\n${diffs} diferencia(s) encontrada(s).`);

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  // --- create_model ---
  server.tool(
    'create_model',
    'Crear un nuevo modelo con configuración base para drone FPV.',
    {
      model_name: z.string().describe('Nombre (max 10 chars)'),
      template: z.enum(['freestyle', 'longrange', 'cinematic', 'empty']).optional().describe('Template base'),
    },
    async ({ model_name, template }) => {
      try {
        const modelsPath = getModelsPath();
        const fileName = getNextBinModelFileName(modelsPath);
        const filePath = path.join(modelsPath, fileName);

        // Create empty model
        const model = createEmptyModel(filePath, model_name);

        // Apply template
        if (template && template !== 'empty') {
          // AETR base (all templates share this)
          model.setMix(0, { weight: 100, destCh: 0, srcRaw: 1, name: 'Ail' }); // CH1 = Input 1 (Ail)
          model.setMix(1, { weight: 100, destCh: 1, srcRaw: 2, name: 'Ele' }); // CH2 = Input 2 (Ele)
          model.setMix(2, { weight: 100, destCh: 2, srcRaw: 3, name: 'Thr' }); // CH3 = Input 3 (Thr)
          model.setMix(3, { weight: 100, destCh: 3, srcRaw: 4, name: 'Rud' }); // CH4 = Input 4 (Rud)
          model.setMix(4, { weight: 100, destCh: 4, srcRaw: MIXSRC.SW_SA, name: 'Arm' });   // CH5 = SA (Arm)
          model.setMix(5, { weight: 100, destCh: 5, srcRaw: MIXSRC.SW_SB, name: 'FltMod' }); // CH6 = SB (Flight Mode)

          if (template === 'freestyle') {
            model.setMix(6, { weight: 100, destCh: 6, srcRaw: MIXSRC.SW_SC, name: 'Beep' });  // CH7 = SC (Beeper)
            model.setMix(7, { weight: 100, destCh: 7, srcRaw: MIXSRC.SW_SD, name: 'AUX4' });  // CH8 = SD
            model.setTimer(0, { mode: 3, start: 300, name: 'Vuelo' }); // 5 min, throttle mode
          } else if (template === 'longrange') {
            model.setMix(6, { weight: 100, destCh: 6, srcRaw: MIXSRC.SW_SC, name: 'Launch' }); // CH7 = SC (Launch)
            model.setMix(7, { weight: 100, destCh: 7, srcRaw: MIXSRC.SW_SD, name: 'GPS' });    // CH8 = SD (GPS Rescue)
            model.setMix(8, { weight: 100, destCh: 8, srcRaw: MIXSRC.SW_SE, name: 'Beep' });   // CH9 = SE (Beeper)
            model.setMix(9, { weight: 100, destCh: 9, srcRaw: MIXSRC.SW_SF, name: 'GoPro' });  // CH10 = SF (GoPro)
            model.setTimer(0, { mode: 3, start: 600, name: 'Vuelo' }); // 10 min
          } else if (template === 'cinematic') {
            model.setMix(6, { weight: 100, destCh: 6, srcRaw: MIXSRC.SW_SC, name: 'GPS' });    // CH7 = SC (GPS Rescue)
            model.setMix(7, { weight: 100, destCh: 7, srcRaw: MIXSRC.SW_SD, name: 'GoPro' });  // CH8 = SD (GoPro)
            model.setMix(8, { weight: 100, destCh: 8, srcRaw: MIXSRC.SW_SE, name: 'Beep' });   // CH9 = SE (Beeper)
            model.setTimer(0, { mode: 3, start: 480, name: 'Vuelo' }); // 8 min
          }
        }

        model.save();

        // Update models.txt
        const modelsTxt = path.join(modelsPath, '..', 'RADIO', 'models.txt');
        if (fs.existsSync(modelsTxt)) {
          const content = fs.readFileSync(modelsTxt, 'utf-8');
          if (!content.includes(fileName)) {
            fs.appendFileSync(modelsTxt, `${fileName}\n`);
          }
        }

        return { content: [{ type: 'text', text: `Modelo "${model_name}" creado en ${fileName}${template ? ` con template ${template}` : ''}.` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  // --- export_model_summary ---
  server.tool(
    'export_model_summary',
    'Exportar resumen completo del modelo en markdown.',
    { model_name: z.string().describe('Nombre del modelo') },
    async ({ model_name }) => {
      try {
        const modelsPath = getModelsPath();
        const model = findBinModel(modelsPath, model_name);
        if (!model) throw new Error(`Modelo "${model_name}" no encontrado.`);

        const s = model.getSummary();
        const lines = [
          `# ${s.name}`,
          `Archivo: ${s.fileName} | ID: ${s.modelId} | Mixes: ${s.mixCount} | Canales: ${s.channelCount}`,
          '',
          '## Mixes',
          '| Canal | Fuente | Peso | Nombre |',
          '|-------|--------|------|--------|',
          ...s.mixes.map(m => `| CH${m.destCh + 1} | ${m.srcName} | ${m.weight}% | ${m.name || '-'} |`),
          '',
          '## Timers',
          ...s.timers.map((t, i) => {
            const mins = Math.floor(t.start / 60);
            const secs = t.start % 60;
            return `- Timer ${i + 1}: ${mins}:${String(secs).padStart(2, '0')} (${t.name || '-'})`;
          }),
          '',
          '## Source Map',
          '| srcRaw | Nombre |',
          '|--------|--------|',
          `| 1-4 | Inputs (I1-I4 = sticks AETR) |`,
          `| 83-84 | Pots (S1, S2) |`,
          `| 85-88 | Trims (TrmR, TrmE, TrmT, TrmA) |`,
          `| 89-94 | Switches (SA=89, SB=90, SC=91, SD=92, SE=93, SF=94) |`,
          `| 95+ | Channel outputs (Ch1=95, Ch2=96, ...) |`,
        ];

        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  // --- dump_raw ---
  server.tool(
    'dump_raw',
    'Ver los bytes raw de una sección del archivo binario (para debug/análisis).',
    {
      model_name: z.string().describe('Nombre del modelo'),
      offset: z.number().min(0).describe('Offset en bytes desde inicio del archivo'),
      length: z.number().min(1).max(256).describe('Cantidad de bytes a leer'),
    },
    async ({ model_name, offset, length }) => {
      try {
        const modelsPath = getModelsPath();
        const model = findBinModel(modelsPath, model_name);
        if (!model) throw new Error(`Modelo "${model_name}" no encontrado.`);

        const hex = model.dumpRaw(offset, length);
        return { content: [{ type: 'text', text: `Raw bytes @0x${offset.toString(16)} (${length} bytes):\n\`${hex}\`` }] };
      } catch (error) {
        return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
      }
    }
  );

  // ====================================================
  // RESOURCES
  // ====================================================

  server.resource(
    'models-list',
    'tango2://models',
    async () => {
      try {
        const modelsPath = getModelsPath();
        const models = listBinModels(modelsPath);
        return {
          contents: [{
            uri: 'tango2://models',
            mimeType: 'application/json',
            text: JSON.stringify(models, null, 2),
          }],
        };
      } catch (error) {
        return {
          contents: [{
            uri: 'tango2://models',
            mimeType: 'text/plain',
            text: `Error: ${(error as Error).message}`,
          }],
        };
      }
    }
  );

  server.resource(
    'radio-config',
    'tango2://radio',
    async () => {
      try {
        const detection = getCachedDetection();
        return {
          contents: [{
            uri: 'tango2://radio',
            mimeType: 'application/json',
            text: JSON.stringify(detection, null, 2),
          }],
        };
      } catch (error) {
        return {
          contents: [{
            uri: 'tango2://radio',
            mimeType: 'text/plain',
            text: `Error: ${(error as Error).message}`,
          }],
        };
      }
    }
  );

  return server;
}
