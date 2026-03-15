// ============================================================
// Template: Long Range 7" (iFlight Chimera 7)
// AETR - CH5:Arm, CH6:FlightMode, CH7:LaunchControl,
//        CH8:GPSRescue, CH9:Beeper, CH10:Cam control
// ============================================================

import type { EdgeTXModel } from '../types/edgetx.js';

export function createLongRangeTemplate(name: string = 'LongRange'): EdgeTXModel {
  return {
    header: {
      name,
      modelId: 0,
    },
    timers: [
      {
        mode: 'thrs' as const,
        start: 600, // 10 minutos (long range)
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
        weight: 100,
        curve: { type: 'expo', value: 40 },
        trim: true,
        name: 'Ail',
      },
      {
        chn: 1,
        srcRaw: 'Ele',
        weight: 100,
        curve: { type: 'expo', value: 40 },
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
        curve: { type: 'expo', value: 30 },
        trim: true,
        name: 'Rud',
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
      // CH6 (AUX2) - Flight Mode: Acro/Angle/Horizon (SWB 3pos)
      { destCh: 5, srcRaw: 'SB', weight: 100, name: 'FltMode' },
      // CH7 (AUX3) - Launch Control (SWC posición media o abajo)
      { destCh: 6, srcRaw: 'SC', weight: 100, name: 'Launch' },
      // CH8 (AUX4) - GPS Rescue (SD)
      { destCh: 7, srcRaw: 'SD', weight: 100, name: 'GPSResc' },
      // CH9 (AUX5) - Beeper (SE)
      { destCh: 8, srcRaw: 'SE', weight: 100, name: 'Beeper' },
      // CH10 (AUX6) - Control de cámara GoPro (SF)
      { destCh: 9, srcRaw: 'SF', weight: 100, name: 'GoPro' },
    ],
    limitData: [
      { min: -100, max: 100, name: 'Ail' },
      { min: -100, max: 100, name: 'Ele' },
      { min: -100, max: 100, name: 'Thr' },
      { min: -100, max: 100, name: 'Rud' },
      { min: -100, max: 100, name: 'Arm' },
      { min: -100, max: 100, name: 'FltMode' },
      { min: -100, max: 100, name: 'Launch' },
      { min: -100, max: 100, name: 'GPSResc' },
      { min: -100, max: 100, name: 'Beeper' },
      { min: -100, max: 100, name: 'GoPro' },
    ],
    logicalSw: [],
    curves: [],
    telemetrySensors: [],
    specialFunctions: [],
  };
}
