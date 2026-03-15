// ============================================================
// Template: Cinematográfico (basado en Chimera 7 + GoPro Hero 13)
// AETR suave con expo alto para movimientos fluidos
// Control de cámara GoPro integrado
// ============================================================

import type { EdgeTXModel } from '../types/edgetx.js';

export function createCinematicTemplate(name: string = 'Cinematic'): EdgeTXModel {
  return {
    header: {
      name,
      modelId: 0,
    },
    timers: [
      {
        mode: 'thrs' as const,
        start: 480, // 8 minutos
        switch: 'SA↓',
        countdownBeep: 'voice' as const,
        minuteBeep: true,
        persistent: false,
        name: 'Vuelo',
      },
      {
        mode: 'on' as const,
        start: 0,
        countdownBeep: 'silent' as const,
        minuteBeep: false,
        persistent: true,
        name: 'Total',
      },
    ],
    expoData: [
      {
        chn: 0,
        srcRaw: 'Ail',
        weight: 80,  // Rate reducido para suavidad
        curve: { type: 'expo', value: 55 }, // Expo alto para centro suave
        trim: true,
        name: 'Ail',
      },
      // Rate bajo para cine
      {
        chn: 0,
        srcRaw: 'Ail',
        weight: 50,
        switch: 'SB↑',  // Rate cine activado con SB arriba
        curve: { type: 'expo', value: 70 },
        trim: true,
        name: 'AilCine',
      },
      {
        chn: 1,
        srcRaw: 'Ele',
        weight: 80,
        curve: { type: 'expo', value: 55 },
        trim: true,
        name: 'Ele',
      },
      {
        chn: 1,
        srcRaw: 'Ele',
        weight: 50,
        switch: 'SB↑',
        curve: { type: 'expo', value: 70 },
        trim: true,
        name: 'EleCine',
      },
      {
        chn: 2,
        srcRaw: 'Thr',
        weight: 100,
        trim: false,
        name: 'Thr',
      },
      {
        chn: 3,
        srcRaw: 'Rud',
        weight: 70,
        curve: { type: 'expo', value: 45 },
        trim: true,
        name: 'Rud',
      },
      {
        chn: 3,
        srcRaw: 'Rud',
        weight: 40,
        switch: 'SB↑',
        curve: { type: 'expo', value: 65 },
        trim: true,
        name: 'RudCine',
      },
    ],
    mixData: [
      // CH1-4: AETR
      { destCh: 0, srcRaw: 'I[Ail]', weight: 100, name: 'Aileron' },
      { destCh: 1, srcRaw: 'I[Ele]', weight: 100, name: 'Elevator' },
      { destCh: 2, srcRaw: 'I[Thr]', weight: 100, name: 'Throttle' },
      { destCh: 3, srcRaw: 'I[Rud]', weight: 100, name: 'Rudder' },
      // CH5 (AUX1) - Arm (SWA)
      { destCh: 4, srcRaw: 'SA', weight: 100, name: 'Arm' },
      // CH6 (AUX2) - Flight Mode / Rate Profile (SWB 3pos)
      { destCh: 5, srcRaw: 'SB', weight: 100, name: 'FltMode' },
      // CH7 (AUX3) - GPS Rescue (SC - para seguridad en cine)
      { destCh: 6, srcRaw: 'SC', weight: 100, name: 'GPSResc' },
      // CH8 (AUX4) - Control GoPro Start/Stop (SD)
      { destCh: 7, srcRaw: 'SD', weight: 100, name: 'GoPro' },
      // CH9 (AUX5) - Beeper (SE)
      { destCh: 8, srcRaw: 'SE', weight: 100, name: 'Beeper' },
      // CH10 (AUX6) - Libre (SF)
      { destCh: 9, srcRaw: 'SF', weight: 100, name: 'AUX6' },
    ],
    limitData: [
      { min: -100, max: 100, name: 'Ail' },
      { min: -100, max: 100, name: 'Ele' },
      { min: -100, max: 100, name: 'Thr' },
      { min: -100, max: 100, name: 'Rud' },
      { min: -100, max: 100, name: 'Arm' },
      { min: -100, max: 100, name: 'FltMode' },
      { min: -100, max: 100, name: 'GPSResc' },
      { min: -100, max: 100, name: 'GoPro' },
      { min: -100, max: 100, name: 'Beeper' },
      { min: -100, max: 100, name: 'AUX6' },
    ],
    logicalSw: [],
    curves: [],
    telemetrySensors: [],
    specialFunctions: [
      // Función especial: Anuncio de voz del modo de vuelo al cambiar SB
      {
        switch: 'SB↑',
        func: 'Play Track',
        value: 'cine',
        active: true,
        name: 'Cine Mode',
      },
      {
        switch: 'SB-',
        func: 'Play Track',
        value: 'normal',
        active: true,
        name: 'Normal Mode',
      },
    ],
  };
}
