export interface Track {
  id: string;
  n: number;
  title: string;
  artist?: string;
  bpm: string;
  key: string;
  dur: string;
  file?: File;
}

export type autodjTransitionStyle = 'fade' | 'swap' | 'drop';

export interface AutoDJSettings {
  enabled: boolean;
  style: autodjTransitionStyle;
  duration: number; // in seconds
  autoGain: boolean;
}

export interface UserProfile {
  uid: string;
  preferences: {
    autodjTransitionStyle: autodjTransitionStyle;
    autodjTransitionDuration: number;
    crossfaderCurve: CrossfaderCurve;
  };
  cuePoints: Record<string, number[]>; // trackId -> positions
  trackZooms: Record<string, number>; // trackId -> zoom level
  history: Track[];
}

export interface SongRequest {
  id: string;
  title: string;
  artist: string;
  requestedBy: string;
  requestedAt: number;
  status: 'pending' | 'added' | 'rejected';
}

export interface WavePoint {
  amp: number;
  bass: number;
  mid: number;
  high: number;
  isBeat: boolean;
  isBar: boolean;
  isPhrase: boolean;
}

export interface DeckState {
  playing: boolean;
  elapsed: number;
  total: number;
  bpm: number;
  pitch: number;
  gain: number;
  looping: boolean;
  loopSize: number;
  loopIn: number;
  loopOut: number;
  cuePoints: { [key: number]: number };
  hotCues: (number | null)[]; // 1-3 hot cues
  eqKills: { hi: boolean; mid: boolean; low: boolean };
  eqCrossovers: { loMid: number; midHi: number };
  keyShift: number;
  bpmLocked: boolean;
  masterTempoLocked: boolean;
  vinylMode: boolean;
  slipMode: boolean;
  quantize: boolean;
  isAnalyzing: boolean;
  keyLock: boolean;
  preCue: boolean;
  pitchBend: number; // Current pitch bend offset (-0.1 to 0.1)
  pitchBendActive: boolean;
  zoomLevel: number;
  key?: string;
  activeTrack?: Track;
  buffer?: AudioBuffer;
  source?: AudioBufferSourceNode;
  lowNode?: BiquadFilterNode;
  midNode?: BiquadFilterNode;
  hiNode?: BiquadFilterNode;
  filterNode?: BiquadFilterNode;
  gainNode?: GainNode;
  fx?: {
    type: 'echo' | 'flanger' | 'reverb';
    enabled: boolean;
    val1: number;
    val2: number;
    node1?: any;
    node2?: any;
  };
  startTime: number;
  offset: number;
  pitchHistory: number[];
  waveform: WavePoint[];
  gridBpm?: number;
  gridOffset?: number;
  showGrid?: boolean;
}

export type CrossfaderCurve = 'linear' | 'log' | 'exp' | 'rev-exp' | 'cut' | 'custom';
