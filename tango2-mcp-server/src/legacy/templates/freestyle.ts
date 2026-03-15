// ============================================================
// Template: Freestyle 5" (Nazgûl Evoque F6)
// AETR - CH5:Arm, CH6:FlightMode, CH7:Beeper, CH8:Libre
// ============================================================

import type { EdgeTXModel } from '../types/edgetx.js';

export function createFreestyleTemplate(name: string = 'Freestyle'): EdgeTXModel {
  return {
    header: {
      name,
      modelId: 0,
    },
    timers: [
      {
        mode: 'thrs' as const,
        start: 300, // 5 minutos
        switch: 'SA↓',
        countdownBeep: 'beeps' as const,
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
    // Inputs: mapeo directo de sticks con expo
    expoData: [
      {
        chn: 0,
        srcRaw: 'Ail',
        weight: 100,
        curve: { type: 'expo', value: 35 },
        trim: true,
        name: 'Ail',
      },
      {
        chn: 1,
        srcRaw: 'Ele',
        weight: 100,
        curve: { type: 'expo', value: 35 },
        trim: true,
        name: 'Ele',
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
        weight: 100,
        curve: { type: 'expo', value: 25 },
        trim: true,
        name: 'Rud',
      },
    ],
    // Mixes: AETR + AUX channels
    mixData: [
      // CH1 - Aileron
      {
        destCh: 0,
        srcRaw: 'I[Ail]',
        weight: 100,
        name: 'Aileron',
      },
      // CH2 - Elevator
      {
        destCh: 1,
        srcRaw: 'I[Ele]',
        weight: 100,
        name: 'Elevator',
      },
      // CH3 - Throttle
      {
        destCh: 2,
        srcRaw: 'I[Thr]',
        weight: 100,
        name: 'Throttle',
      },
      // CH4 - Rudder
      {
        destCh: 3,
        srcRaw: 'I[Rud]',
        weight: 100,
        name: 'Rudder',
      },
      // CH5 (AUX1) - Arm Switch (SWA)
      {
        destCh: 4,
        srcRaw: 'SA',
        weight: 100,
        name: 'Arm',
      },
      // CH6 (AUX2) - Flight Mode (SWB - 3 posiciones)
      {
        destCh: 5,
        srcRaw: 'SB',
        weight: 100,
        name: 'FltMode',
      },
      // CH7 (AUX3) - Beeper (SWC)
      {
        destCh: 6,
        srcRaw: 'SC',
        weight: 100,
        name: 'Beeper',
      },
      // CH8 (AUX4) - Libre (Launch Control, Turtle, etc.)
      {
        destCh: 7,
        srcRaw: 'SD',
        weight: 100,
        name: 'AUX4',
      },
    ],
    // Límites de canales
    limitData: [
      { min: -100, max: 100, name: 'Ail' },
      { min: -100, max: 100, name: 'Ele' },
      { min: -100, max: 100, name: 'Thr' },
      { min: -100, max: 100, name: 'Rud' },
      { min: -100, max: 100, name: 'Arm' },
      { min: -100, max: 100, name: 'FltMode' },
      { min: -100, max: 100, name: 'Beeper' },
      { min: -100, max: 100, name: 'AUX4' },
    ],
    logicalSw: [],
    curves: [],
    telemetrySensors: [],
    specialFunctions: [],
  };
}
