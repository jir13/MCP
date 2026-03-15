// ============================================================
// Tool: detect_radio
// Detecta si el TBS Tango 2 está conectado por USB
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
// Nombres comunes con los que se monta el Tango 2
const KNOWN_VOLUME_NAMES = [
  'NO NAME',     // Default FreedomTX SD card label
  'TANGO2',
  'Tango2',
  'tango2',
  'TARANIS',
  'EDGETX',
  'EdgeTX',
  'FPV',
];

// Archivos/carpetas que confirman que es un radio FreedomTX/EdgeTX
const RADIO_MARKERS = ['RADIO', 'MODELS', 'CROSSFIRE', 'SCRIPTS'];

export interface RadioDetectionResult {
  found: boolean;
  mountPoint?: string;
  modelsPath?: string;
  radioConfigPath?: string;
  firmware: 'freedomtx' | 'edgetx' | 'unknown';
  platform: 'macos' | 'windows' | 'linux';
  error?: string;
}

export function detectRadio(): RadioDetectionResult {
  const platform = os.platform();

  switch (platform) {
    case 'darwin':
      return detectMacOS();
    case 'win32':
      return detectWindows();
    case 'linux':
      return detectLinux();
    default:
      return {
        found: false,
        firmware: 'unknown',
        platform: 'linux',
        error: `Plataforma no soportada: ${platform}`,
      };
  }
}

function detectMacOS(): RadioDetectionResult {
  const volumesDir = '/Volumes';

  if (!fs.existsSync(volumesDir)) {
    return { found: false, firmware: 'unknown', platform: 'macos', error: 'No se encontró /Volumes' };
  }

  const volumes = fs.readdirSync(volumesDir);

  // Primero buscar por nombre conocido
  for (const vol of volumes) {
    if (KNOWN_VOLUME_NAMES.some(kn => vol.toUpperCase().includes(kn.toUpperCase()))) {
      const mountPoint = path.join(volumesDir, vol);
      const result = validateRadioMount(mountPoint);
      if (result) {
        return { ...result, platform: 'macos' };
      }
    }
  }

  // Si no se encontró por nombre, buscar por contenido
  for (const vol of volumes) {
    const mountPoint = path.join(volumesDir, vol);
    const result = validateRadioMount(mountPoint);
    if (result) {
      return { ...result, platform: 'macos' };
    }
  }

  return {
    found: false,
    firmware: 'unknown',
    platform: 'macos',
    error: 'No se detectó un TBS Tango 2 conectado. Asegurate de que el radio esté encendido y conectado por USB.',
  };
}

function detectWindows(): RadioDetectionResult {
  // Buscar en drives removibles (D: a Z:)
  for (let charCode = 68; charCode <= 90; charCode++) {
    const drive = `${String.fromCharCode(charCode)}:\\`;
    try {
      if (fs.existsSync(drive)) {
        const result = validateRadioMount(drive);
        if (result) {
          return { ...result, platform: 'windows' };
        }
      }
    } catch (err) {
      console.error(`Error checking drive ${drive}: ${(err as Error).message}`);
      continue;
    }
  }

  return {
    found: false,
    firmware: 'unknown',
    platform: 'windows',
    error: 'No se detectó un TBS Tango 2 conectado. Asegurate de que el radio esté encendido y conectado por USB.',
  };
}

function detectLinux(): RadioDetectionResult {
  const searchPaths = [
    '/media',
    `/media/${os.userInfo().username}`,
    '/mnt',
    '/run/media',
    `/run/media/${os.userInfo().username}`,
  ];

  for (const basePath of searchPaths) {
    if (!fs.existsSync(basePath)) continue;

    try {
      const entries = fs.readdirSync(basePath);
      for (const entry of entries) {
        const mountPoint = path.join(basePath, entry);

        // Verificar por nombre conocido primero
        if (KNOWN_VOLUME_NAMES.some(kn => entry.toUpperCase().includes(kn.toUpperCase()))) {
          const result = validateRadioMount(mountPoint);
          if (result) {
            return { ...result, platform: 'linux' };
          }
        }
      }

      // Segunda pasada: buscar por contenido
      for (const entry of entries) {
        const mountPoint = path.join(basePath, entry);
        const result = validateRadioMount(mountPoint);
        if (result) {
          return { ...result, platform: 'linux' };
        }
      }
    } catch (err) {
      console.error(`Error scanning ${basePath}: ${(err as Error).message}`);
      continue;
    }
  }

  return {
    found: false,
    firmware: 'unknown',
    platform: 'linux',
    error: 'No se detectó un TBS Tango 2 conectado. Asegurate de que el radio esté encendido y conectado por USB.',
  };
}

function validateRadioMount(mountPoint: string): Omit<RadioDetectionResult, 'platform'> | null {
  try {
    const stat = fs.statSync(mountPoint);
    if (!stat.isDirectory()) return null;

    const contents = fs.readdirSync(mountPoint);
    const upperContents = contents.map(c => c.toUpperCase());

    // Verificar que tenga al menos 2 de los marcadores
    const matchCount = RADIO_MARKERS.filter(marker =>
      upperContents.includes(marker)
    ).length;

    if (matchCount >= 2) {
      const modelsDir = contents.find(c => c.toUpperCase() === 'MODELS');
      const radioDir = contents.find(c => c.toUpperCase() === 'RADIO');

      const modelsPath = modelsDir ? path.join(mountPoint, modelsDir) : undefined;

      // Detectar firmware: FreedomTX usa radio.bin, EdgeTX usa radio.yml
      let radioConfigPath: string | undefined;
      let firmware: 'freedomtx' | 'edgetx' | 'unknown' = 'unknown';

      if (radioDir) {
        const binPath = path.join(mountPoint, radioDir, 'radio.bin');
        const ymlPath = path.join(mountPoint, radioDir, 'radio.yml');
        if (fs.existsSync(binPath)) {
          radioConfigPath = binPath;
          firmware = 'freedomtx';
        } else if (fs.existsSync(ymlPath)) {
          radioConfigPath = ymlPath;
          firmware = 'edgetx';
        }
      }

      // Verificar por archivo de versión
      const versionFile = path.join(mountPoint, 'opentx.sdcard.version');
      if (fs.existsSync(versionFile) && firmware === 'unknown') {
        firmware = 'freedomtx';
      }

      return {
        found: true,
        mountPoint,
        modelsPath,
        radioConfigPath,
        firmware,
      };
    }
  } catch (err) {
    console.error(`Error validating mount ${mountPoint}: ${(err as Error).message}`);
  }

  return null;
}

/**
 * Cache del punto de montaje para no re-detectar en cada operación
 */
let cachedDetection: RadioDetectionResult | null = null;

export function getCachedDetection(): RadioDetectionResult {
  if (!cachedDetection) {
    cachedDetection = detectRadio();
  }
  return cachedDetection;
}

export function clearDetectionCache(): void {
  cachedDetection = null;
}

export function getModelsPath(): string {
  const detection = getCachedDetection();
  if (!detection.found || !detection.modelsPath) {
    throw new Error(detection.error || 'Radio no conectado. Conectá el Tango 2 por USB e intentá de nuevo.');
  }
  return detection.modelsPath;
}

export function getRadioConfigPath(): string {
  const detection = getCachedDetection();
  if (!detection.found || !detection.radioConfigPath) {
    throw new Error('No se encontró el archivo de configuración del radio. Verificá que el radio esté correctamente montado.');
  }
  return detection.radioConfigPath;
}

export function getFirmwareType(): 'freedomtx' | 'edgetx' | 'unknown' {
  return getCachedDetection().firmware;
}
