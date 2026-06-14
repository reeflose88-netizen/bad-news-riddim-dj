import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { doc, onSnapshot, updateDoc, setDoc, serverTimestamp, collection, query, orderBy, limit } from 'firebase/firestore';
import { db, auth, loginWithGoogle, logout, getUserProfile, saveUserProfile, submitSongRequest } from './lib/firebase.ts';
import { 
  Settings, Home, HelpCircle, Search, Folder, Plus, Music, 
  Play, Pause, Square, SkipBack, Lock, Unlock, 
  Volume2, FastForward, Activity, Mic, Disc,
  Sparkles, Users, Share2, MessageSquare,
  Radio, RotateCcw, Zap, Download, Layout, LayoutPanelTop, Upload,
  User, LogOut, Trash2
} from 'lucide-react';
import { Track, WavePoint, DeckState, CrossfaderCurve, AutoDJSettings, SongRequest } from './types.ts';
import { Knob } from './components/Knob.tsx';
import { Waveform } from './components/Waveform.tsx';
import { JogWheel } from './components/JogWheel.tsx';
import { Visualizer } from './components/Visualizer.tsx';
import { PitchCurve } from './components/PitchCurve.tsx';

// --- UTILS ---
function parseCamelot(keyStr: string): string {
  // Minor Keys
  if (keyStr === 'Am') return '8A';
  if (keyStr === 'Em') return '9A';
  if (keyStr === 'Bm') return '10A';
  if (keyStr === 'F#m') return '11A';
  if (keyStr === 'C#m') return '12A';
  if (keyStr === 'G#m') return '1A';
  if (keyStr === 'D#m' || keyStr === 'Ebm') return '2A';
  if (keyStr === 'Bbm' || keyStr === 'A#m') return '3A';
  if (keyStr === 'Fm') return '4A';
  if (keyStr === 'Cm') return '5A';
  if (keyStr === 'Gm') return '6A';
  if (keyStr === 'Dm') return '7A';

  // Major Keys
  if (keyStr === 'C') return '8B';
  if (keyStr === 'G') return '9B';
  if (keyStr === 'D') return '10B';
  if (keyStr === 'A') return '11B';
  if (keyStr === 'E') return '12B';
  if (keyStr === 'B') return '1B';
  if (keyStr === 'F#' || keyStr === 'Gb') return '2B';
  if (keyStr === 'Db' || keyStr === 'C#') return '3B';
  if (keyStr === 'Ab' || keyStr === 'G#') return '4B';
  if (keyStr === 'Eb' || keyStr === 'D#') return '5B';
  if (keyStr === 'Bb' || keyStr === 'A#') return '6B';
  if (keyStr === 'F') return '7B';

  return '';
}

function keysAreCompatible(keyA: string, keyB: string): boolean {
  const codeA = parseCamelot(keyA);
  const codeB = parseCamelot(keyB);
  if (!codeA || !codeB) return false;
  
  const numA = parseInt(codeA);
  const numB = parseInt(codeB);
  const letterA = codeA.slice(-1);
  const letterB = codeB.slice(-1);

  // Same key code
  if (codeA === codeB) return true;
  // Relative major/minor (same number, different letter)
  if (numA === numB && letterA !== letterB) return true;
  // Adjacent on circle of fifths (same letter, +/- 1 hour segment)
  if (letterA === letterB) {
    const diff = Math.abs(numA - numB);
    if (diff === 1 || diff === 11) return true;
  }
  return false;
}

function isEnergyBoostCompatible(keyA: string, keyB: string): boolean {
  const codeA = parseCamelot(keyA);
  const codeB = parseCamelot(keyB);
  if (!codeA || !codeB) return false;
  
  const numA = parseInt(codeA);
  const numB = parseInt(codeB);
  const letterA = codeA.slice(-1);
  const letterB = codeB.slice(-1);

  // Must be same major/minor mode
  if (letterA !== letterB) return false;
  
  // Energy boost is +1 or +2 on the Camelot segments wheel (modulo 12)
  const diff = (numB - numA + 12) % 12;
  return diff === 1 || diff === 2;
}

function applyFilterNode(node: BiquadFilterNode, val: number) {
  if (!node) return;
  if (val === 0) {
    node.type = 'lowpass';
    node.frequency.setValueAtTime(22000, 0);
    node.Q.setValueAtTime(0.0001, 0);
  } else if (val < 0) {
    node.type = 'lowpass';
    const pct = (val + 100) / 100;
    const freq = 80 * Math.pow(22000 / 80, pct);
    node.frequency.setValueAtTime(freq, 0);
    node.Q.setValueAtTime(2.0, 0);
  } else {
    node.type = 'highpass';
    const pct = val / 100;
    const freq = 20 * Math.pow(15000 / 20, pct);
    node.frequency.setValueAtTime(freq, 0);
    node.Q.setValueAtTime(2.0, 0);
  }
}

function CircularPhaseMeter({ 
  deck, 
  masterPhase, 
  deckPhase, 
  bpm, 
  masterBpm 
}: { 
  deck: 'A' | 'B'; 
  masterPhase: number; 
  deckPhase: number; 
  bpm: number; 
  masterBpm: number; 
}) {
  const deckColor = deck === 'A' ? '#00bcff' : '#ff2255';
  
  const getCoordinatesForPercent = (percent: number, radius: number) => {
    const x = 32 + radius * Math.cos(2 * Math.PI * percent - Math.PI / 2);
    const y = 32 + radius * Math.sin(2 * Math.PI * percent - Math.PI / 2);
    return { x, y };
  };

  const masterCoord = getCoordinatesForPercent(masterPhase, 24);
  const deckCoord = getCoordinatesForPercent(deckPhase, 16);

  const angleDiffDeg = ((deckPhase - masterPhase) * 360 + 180) % 360 - 180;
  const isAligned = Math.abs(angleDiffDeg) < 5;

  const alignStyles = isAligned 
    ? (deck === 'A' ? 'border-[#00bcff]/50 shadow-[0_0_10px_rgba(0,188,255,0.3),inset_0_2px_4px_rgba(0,0,0,0.8)]' : 'border-[#ff2255]/50 shadow-[0_0_10px_rgba(255,34,85,0.3),inset_0_2px_4px_rgba(0,0,0,0.8)]') 
    : 'border-[#212330]/60 shadow-[inset_0_2px_5px_rgba(0,0,0,0.85),0_1px_3px_rgba(0,0,0,0.45)]';

  const rotationAngle = deckPhase * 360;

  return (
    <div className={`w-18 h-18 bg-[#090a0d] rounded-full border flex items-center justify-center relative group mb-2 shrink-0 select-none transition-all duration-300 ${alignStyles}`}>
      <svg className="w-full h-full" viewBox="0 0 64 64">
        {/* Background track rings */}
        <circle cx={32} cy={32} r={24} fill="none" stroke="rgba(255,255,255,0.015)" strokeWidth={2} />
        <circle cx={32} cy={32} r={16} fill="none" stroke="rgba(255,255,255,0.015)" strokeWidth={2} />
        
        {/* Alignment Grid Ticks */}
        <line x1={32} y1={4} x2={32} y2={8} stroke="#3b3d4f" strokeWidth={1} />
        <line x1={32} y1={56} x2={32} y2={60} stroke="#3b3d4f" strokeWidth={1} />
        <line x1={4} y1={32} x2={8} y2={32} stroke="#3b3d4f" strokeWidth={1} />
        <line x1={56} y1={32} x2={60} y2={32} stroke="#3b3d4f" strokeWidth={1} />

        {/* Dynamic Rotational Alignment Needle */}
        <g style={{ transform: `rotate(${rotationAngle}deg)`, transformOrigin: '32px 32px' }} className="transition-transform duration-75">
          <line 
            x1={32} 
            y1={12} 
            x2={32} 
            y2={20} 
            stroke={isAligned ? '#10b981' : deckColor} 
            strokeWidth={1.5} 
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 1px ${isAligned ? '#10b981' : deckColor})` }}
          />
        </g>

        {/* Master Phase Track (Outer ring dotted circle) */}
        <circle 
          cx={32} 
          cy={32} 
          r={24} 
          fill="none" 
          stroke="#f59e0b" 
          strokeWidth={1} 
          strokeDasharray="2,4" 
          className="opacity-20"
        />
        
        {/* Master Indicator (Amber dot with subtle shadow-glow) */}
        <circle 
          cx={masterCoord.x} 
          cy={masterCoord.y} 
          r={3} 
          fill="#f59e0b" 
          style={{ filter: 'drop-shadow(0 0 2.5px #f59e0b)' }} 
        />

        {/* Deck Indicator (A: Cyan, B: Red dot with glow) */}
        <circle 
          cx={deckCoord.x} 
          cy={deckCoord.y} 
          r={3} 
          fill={deckColor} 
          style={{ filter: `drop-shadow(0 0 2.5px ${deckColor})` }} 
        />

        {/* Connective Guide Line */}
        {isAligned ? (
          <line 
            x1={deckCoord.x} 
            y1={deckCoord.y} 
            x2={masterCoord.x} 
            y2={masterCoord.y} 
            stroke="#10b981" 
            strokeWidth={1.5} 
            className="animate-pulse"
          />
        ) : (
          <line 
            x1={deckCoord.x} 
            y1={deckCoord.y} 
            x2={masterCoord.x} 
            y2={masterCoord.y} 
            stroke="rgba(255,255,255,0.12)" 
            strokeWidth={0.5} 
            strokeDasharray="1,1"
          />
        )}
      </svg>
      {/* Centered Align Status Label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
        <span className="text-[5.5px] font-black text-[#5c5f7d] uppercase tracking-widest scale-[0.8] mb-[1px]">PHASE</span>
        <span className={`text-[6.5px] font-black font-mono tracking-tighter ${isAligned ? 'text-[#10b981] drop-shadow-[0_0_2px_#10b981] scale-110' : 'text-[#7e849e]'}`}>
          {isAligned ? 'MATCH' : 'ALIGN'}
        </span>
      </div>
    </div>
  );
}

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const x = (s % 60).toFixed(1);
  return `${m.toString().padStart(2, '0')}:${x.padStart(4, '0')}`;
};

const generateDummyWaveform = (len = 4000, seedString = ''): WavePoint[] => {
  const d: WavePoint[] = [];
  let hash = 0;
  if (seedString) {
    for (let j = 0; j < seedString.length; j++) {
      hash = (hash << 5) - hash + seedString.charCodeAt(j);
      hash |= 0;
    }
  }
  let seed = Math.abs(hash) || 12345;
  const pseudoRandom = () => {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
  };

  let energy = 0.3;
  for (let i = 0; i < len; i++) {
    const isBeat = i % 64 < 3;
    const isBar = i % 256 < 3;
    const isPhrase = i % 1024 < 3;
    energy = energy * 0.88 + pseudoRandom() * 0.12;
    let amp = energy;
    if (isBeat) amp = Math.min(1, amp + 0.45);
    if (isBar) amp = Math.min(1, amp + 0.15);
    if (isPhrase) amp = Math.min(1, amp + 0.25);
    d.push({
      amp: Math.max(0.04, amp),
      bass: amp * 0.9 + pseudoRandom() * 0.1,
      mid: amp * 0.6 + pseudoRandom() * 0.25,
      high: amp * 0.3 + pseudoRandom() * 0.5,
      isBeat, isBar, isPhrase
    });
  }
  return d;
};

// --- MUSIC LIBRARY ---
const STATIC_LIBRARY_TRACKS: Track[] = [
  { id: 't1', n: 1, title: 'Riddim Anthem', artist: 'VirtualDJ Elite Artist', bpm: '140', key: 'Am', dur: '05:22' },
  { id: 't2', n: 2, title: 'Deep Cyber Bass', artist: 'Shogun Sound', bpm: '128', key: 'F#m', dur: '04:15' },
  { id: 't3', n: 3, title: 'Hyper Drive', artist: 'Neon Wanderer', bpm: '174', key: 'Gm', dur: '03:45' },
  { id: 't4', n: 4, title: 'Cosmic Drift', artist: 'Lumina Science', bpm: '150', key: 'C#m', dur: '06:10' },
  { id: 't5', n: 5, title: 'Acid Storm', artist: 'Overdrive Node', bpm: '140', key: 'Dm', dur: '04:55' },
  { id: 't6', n: 6, title: 'Future Grooves', artist: 'Chroma Key', bpm: '128', key: 'Bm', dur: '05:01' },
  { id: 't7', n: 7, title: 'Bassline Ripper', artist: 'Sub Shock System', bpm: '142', key: 'Em', dur: '03:30' },
  { id: 't8', n: 8, title: 'Echoes of Dub', artist: 'Echo Laboratory', bpm: '160', key: 'C', dur: '04:47' },
  { id: 't9', n: 9, title: 'Liquid Sunset', artist: 'Solaris Blue', bpm: '172', key: 'F', dur: '05:58' },
  { id: 't10', n: 10, title: 'Cybernetic Heart', artist: 'Volt Signal', bpm: '130', key: 'G#m', dur: '04:12' },
  { id: 't11', n: 11, title: 'Tokyo Neon Glow', artist: 'Akihabara Beat', bpm: '125', key: 'D#m', dur: '03:52' },
  { id: 't12', n: 12, title: 'Glitch in Time', artist: 'Vector Waveform', bpm: '140', key: 'A', dur: '04:24' }
];

// --- REVERB IMPULSE GENERATOR ---
function createReverbBuffer(ctx: AudioContext, decay: number) {
  const rate = ctx.sampleRate;
  const len = rate * Math.max(0.1, decay);
  const buffer = ctx.createBuffer(2, len, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.8);
    }
  }
  return buffer;
}

// --- INITIAL STATE ---
const INITIAL_DECK = (id: 'A' | 'B'): DeckState => ({
  playing: false,
  elapsed: 0,
  total: 694,
  bpm: 160,
  pitch: 0,
  gain: 0.8,
  looping: false,
  loopSize: id === 'A' ? 4 : 8,
  loopIn: -1,
  loopOut: -1,
  cuePoints: {},
  hotCues: [null, null, null, null, null, null, null, null],
  eqKills: { hi: false, mid: false, low: false },
  eqLevels: { hi: 0, mid: 0, low: 0 },
  filterValue: 0,
  keyShift: 0,
  bpmLocked: false,
  masterTempoLocked: false,
  vinylMode: true,
  slipMode: false,
  scratchFriction: 0.95,
  quantize: true,
  isAnalyzing: false,
  keyLock: true,
  preCue: false,
  pitchBend: 0,
  pitchBendActive: false,
  zoomLevel: 2,
  eqCrossovers: { loMid: 250, midHi: 2500 },
  fx: { type: 'echo', enabled: false, val1: 50, val2: 50 },
  pitchHistory: [],
  startTime: 0,
  offset: 0,
  waveform: generateDummyWaveform(),
  gridBpm: 160, // Default baseline BPM for initialization
  gridOffset: 0,
  showGrid: true
});

function calculatePerceivedGain(audioBuffer: AudioBuffer): number {
  if (audioBuffer.numberOfChannels === 0) return 1.0;
  const data = audioBuffer.getChannelData(0);
  const length = data.length;
  const step = Math.max(1, Math.floor(length / 10000));
  let sumSquares = 0;
  let count = 0;
  for (let i = 0; i < length; i += step) {
    const val = data[i];
    sumSquares += val * val;
    count++;
  }
  const rms = Math.sqrt(sumSquares / (count || 1));
  const targetRMS = 0.12;
  if (rms < 0.001) return 1.0;
  const calculatedGain = targetRMS / rms;
  return Math.round(Math.max(0.35, Math.min(1.5, calculatedGain)) * 100) / 100;
}

function estimateBpm(audioBuffer: AudioBuffer): number {
  if (audioBuffer.numberOfChannels === 0) return 128;
  const data = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  
  // Step 1: Compute energy envelope of the audio buffer
  const blockSize = Math.round(sampleRate * 0.02);
  const energyMap: number[] = [];
  
  // Avoid lag on long tracks: cap to 60 seconds
  const maxSamplesToProcess = Math.min(data.length, sampleRate * 60);
  
  for (let i = 0; i < maxSamplesToProcess; i += blockSize) {
    let maxVal = 0;
    const end = Math.min(maxSamplesToProcess, i + blockSize);
    for (let j = i; j < end; j++) {
      const abs = Math.abs(data[j]);
      if (abs > maxVal) maxVal = abs;
    }
    energyMap.push(maxVal);
  }
  
  // Step 2: Detect peaks in the energy map
  let maxEnergy = 0;
  for (let i = 0; i < energyMap.length; i++) {
    if (energyMap[i] > maxEnergy) maxEnergy = energyMap[i];
  }
  
  const peakThreshold = maxEnergy * 0.45;
  const peakIndices: number[] = [];
  for (let i = 1; i < energyMap.length - 1; i++) {
    if (energyMap[i] > energyMap[i - 1] && energyMap[i] > energyMap[i + 1] && energyMap[i] > peakThreshold) {
      if (peakIndices.length === 0 || (i - peakIndices[peakIndices.length - 1]) * (blockSize / sampleRate) > 0.25) {
        peakIndices.push(i);
      }
    }
  }
  
  if (peakIndices.length < 2) {
    return 128; // standard fallback
  }
  
  // Step 3: Count the intervals between peaks (tempo candidacies)
  const intervalCounts: { [seconds: string]: number } = {};
  const secondsPerIndex = blockSize / sampleRate;
  
  for (let i = 0; i < peakIndices.length; i++) {
    for (let j = i + 1; j < Math.min(peakIndices.length, i + 8); j++) {
      const diffIndices = peakIndices[j] - peakIndices[i];
      const diffSeconds = diffIndices * secondsPerIndex;
      
      let possibleBpm = 60 / diffSeconds;
      
      // Normalize tempo to 90 to 180 BPM
      while (possibleBpm < 90) possibleBpm *= 2;
      while (possibleBpm > 180) possibleBpm /= 2;
      
      const bpmKey = Math.round(possibleBpm);
      if (bpmKey >= 90 && bpmKey <= 180) {
        intervalCounts[bpmKey] = (intervalCounts[bpmKey] || 0) + 1;
      }
    }
  }
  
  // Step 4: Find the BPM with the highest consensus count
  let bestBpm = 120;
  let maxCount = 0;
  
  Object.entries(intervalCounts).forEach(([bpm, count]) => {
    if (count > maxCount) {
      maxCount = count;
      bestBpm = parseInt(bpm);
    }
  });
  
  return bestBpm;
}

function synthesizeAudioTrack(buffer: AudioBuffer, bpm: number, keyStr: string, trackTitle: string) {
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  const beatLen = (60 / bpm) * sampleRate;
  const barLen = beatLen * 4;

  let baseFreq = 55.0; // Default A1
  const keyUpper = keyStr.toUpperCase();
  if (keyUpper.startsWith('C')) baseFreq = 65.41;
  else if (keyUpper.startsWith('D')) baseFreq = 73.42;
  else if (keyUpper.startsWith('E')) baseFreq = 82.41;
  else if (keyUpper.startsWith('F')) baseFreq = 43.65;
  else if (keyUpper.startsWith('G')) baseFreq = 49.00;
  else if (keyUpper.startsWith('A')) baseFreq = 55.00;
  else if (keyUpper.startsWith('B')) baseFreq = 61.74;

  if (keyUpper.includes('#') || keyUpper.includes('S')) {
    baseFreq *= 1.059463;
  } else if (keyUpper.includes('B') && keyUpper.length > 2) {
    baseFreq /= 1.059463;
  }

  const minorScale = [1.0, 1.2, 1.3348, 1.5, 1.782]; 
  const melodyScale = [1.0, 1.122, 1.201, 1.348, 1.498, 1.587, 1.782, 2.0];

  let seedHash = 0;
  for (let j = 0; j < trackTitle.length; j++) {
    seedHash += trackTitle.charCodeAt(j);
  }

  const melodyPattern = [0, 2, 4, 3, 0, 7, 5, 4, 3, 0, 2, 0, 4, 7, 0, 3];
  const bassPattern = [1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0];

  const mathSin = Math.sin;
  const mathCos = Math.cos;
  const mathExp = Math.exp;
  const mathMin = Math.min;
  const mathMax = Math.max;
  const TWO_PI = 2 * Math.PI;

  for (let i = 0; i < numSamples; i++) {
    const beatIndex = Math.floor(i / beatLen);
    const sampleInBeat = i % Math.round(beatLen);
    const barIndex = Math.floor(i / barLen);
    const beatInBar = beatIndex % 4;

    const sixteenthLen = beatLen / 4;
    const sixteenthIndex = Math.floor(i / sixteenthLen);
    const stepInBar = sixteenthIndex % 16;
    const sampleInSixteenth = i % Math.round(sixteenthLen);

    // KICK DRUM
    let kick = 0;
    const kickTime = sampleInBeat / sampleRate;
    if (kickTime < 0.16) {
      const freqSweep = 130 * mathExp(-kickTime * 40) + 38;
      const phase = TWO_PI * freqSweep * kickTime;
      const ampEnvelope = mathExp(-kickTime * 14);
      kick = mathSin(phase) * ampEnvelope * 0.42;
    }

    // SNARE / CLAP
    let snare = 0;
    if (beatInBar === 1 || beatInBar === 3) {
      const snareTime = sampleInBeat / sampleRate;
      if (snareTime < 0.22) {
        const pseudoNoise = (mathSin(i * 0.456) + mathCos(i * 0.789)) / 2;
        const noiseEnvelope = mathExp(-snareTime * 15);
        const snareBody = mathSin(TWO_PI * 170 * snareTime) * mathExp(-snareTime * 28) * 0.22;
        snare = (pseudoNoise * noiseEnvelope * 0.2) + snareBody;
      }
    }

    // HI-HAT
    let hat = 0;
    const eighthIndex = Math.floor(i / (beatLen / 2)) % 8;
    const isOffbeat = eighthIndex % 2 === 1;
    const sampleInEighth = i % Math.round(beatLen / 2);
    if (isOffbeat) {
      const hatTime = sampleInEighth / sampleRate;
      if (hatTime < 0.06) {
        const pseudoNoise = (mathSin(i * 1.23) + mathCos(i * 3.45)) / 2;
        const hatEnvelope = mathExp(-hatTime * 85);
        hat = pseudoNoise * hatEnvelope * 0.07;
      }
    }
    if (stepInBar % 2 === 1) {
      const sixteenthTime = sampleInSixteenth / sampleRate;
      if (sixteenthTime < 0.02) {
        const pseudoNoise = (mathSin(i * 5.67) + mathCos(i * 8.91)) / 2;
        const shakerEnvelope = mathExp(-sixteenthTime * 140);
        hat += pseudoNoise * shakerEnvelope * 0.035;
      }
    }

    // BASSLINE
    let bass = 0;
    const hasNote = bassPattern[(stepInBar + seedHash) % 16];
    const melodyIndex = (stepInBar + seedHash) % 16;
    const scaleOffset = minorScale[melodyPattern[melodyIndex] % minorScale.length];
    const chordShift = (barIndex % 4 === 1) ? 1.2 : (barIndex % 4 === 2) ? 1.5 : (barIndex % 4 === 3) ? 0.75 : 1.0;
    const noteFreq = baseFreq * scaleOffset * chordShift;

    if (hasNote) {
      const tInNote = sampleInSixteenth / sampleRate;
      if (tInNote < 0.18) {
        const synthEnv = mathExp(-tInNote * 10);
        const triPhase = (tInNote * noteFreq) % 1;
        const triVal = triPhase < 0.25 ? (triPhase * 4) : triPhase < 0.75 ? (2 - triPhase * 4) : (triPhase * 4 - 4);
        const sqVal = mathSin(TWO_PI * noteFreq * tInNote) > 0 ? 0.25 : -0.25;
        bass = (triVal * 0.55 + sqVal) * synthEnv * 0.15;
      }
    }

    // MELODY ARPEGGIATOR / PLUCK
    let pluck = 0;
    const blockIndex = Math.floor(barIndex / 4);
    if (blockIndex % 2 === 1 || blockIndex % 4 === 3) {
      const playPluck = [1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1][(stepInBar + seedHash * 2) % 16];
      if (playPluck) {
        const pluckNoteIndex = (stepInBar * 2 + seedHash * 3) % melodyScale.length;
        const pluckFreq = baseFreq * 4 * melodyScale[pluckNoteIndex];
        const tInPluck = sampleInSixteenth / sampleRate;
        if (tInPluck < 0.14) {
          const pluckEnv = mathExp(-tInPluck * 20);
          pluck = mathSin(TWO_PI * pluckFreq * tInPluck) * pluckEnv * 0.06;
        }
      }
    }

    let mixL = kick + snare + hat + bass + pluck;
    let mixR = kick + snare - hat + bass - pluck;

    mixL = mathMax(-0.95, mathMin(0.95, mixL));
    mixR = mathMax(-0.95, mathMin(0.95, mixR));

    left[i] = mixL;
    right[i] = mixR;
  }
}

function getDummyTrackNormalizedGain(trackTitle: string): number {
  let hash = 0;
  for (let i = 0; i < trackTitle.length; i++) {
    hash += trackTitle.charCodeAt(i);
  }
  const normalized = 0.75 + ((hash % 100) / 100) * 0.5;
  return Math.round(normalized * 100) / 100;
}

export default function App() {
  const [deckA, setDeckA] = useState<DeckState>(INITIAL_DECK('A'));
  const [deckB, setDeckB] = useState<DeckState>(INITIAL_DECK('B'));
  const [deckView, setDeckView] = useState<'both' | 'A' | 'B'>('both');

  useEffect(() => {
    const handleResize = () => {
      // Auto-toggle view if screen is too narrow (< 960px) to prevent layout break or hiding Deck B!
      if (window.innerWidth < 960) {
        setDeckView(prev => prev === 'both' ? 'A' : prev);
      } else {
        setDeckView(prev => (prev === 'A' || prev === 'B') ? 'both' : prev);
      }
    };
    handleResize(); // trigger initially
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [activePanel, setActivePanel] = useState<'brow' | 'samp' | 'fx' | 'rec' | 'ai' | 'conf' | 'help'>('brow');
  const [jogAngles, setJogAngles] = useState({ A: 0, B: 0 });
  const [search, setSearch] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [visMode, setVisMode] = useState<'bars' | 'wave' | 'particles'>('bars');
  const [queueTab, setQueueTab] = useState<'files' | 'queue' | 'requests'>('files');
  const [crossfaderPos, setCrossfaderPos] = useState(50);
  const [masterFx, setMasterFx] = useState(50);
  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [zoomA, setZoomA] = useState(2);
  const [zoomB, setZoomB] = useState(2);
  const [masterTempoLock, setMasterTempoLock] = useState(false);
  const [masterBpm, setMasterBpm] = useState(160);
  const [libraryTracks, setLibraryTracks] = useState<Track[]>(STATIC_LIBRARY_TRACKS);
  const [queue, setQueue] = useState<Track[]>([]);
  const [showBrowser, setShowBrowser] = useState(true);
  const [crossfaderCurve, setCrossfaderCurve] = useState<CrossfaderCurve>('linear');
  const [autoDJ, setAutoDJ] = useState<AutoDJSettings>({
    enabled: false,
    style: 'fade',
    duration: 8,
    autoGain: true
  });
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [requests, setRequests] = useState<SongRequest[]>([]);
  const [masterEq, setMasterEq] = useState({ low: 0, mid: 0, high: 0 });
  const [samplerBuffers, setSamplerBuffers] = useState<Record<number, AudioBuffer>>({});
  const [samplerVolume, setSamplerVolume] = useState(60);
  const [samplerNames, setSamplerNames] = useState<string[]>([
    'SIREN', 'SAXO', 'HANDS UP', 'PUSH IT', 'PUMP IT', 'THIS THIS',
    'KICK', 'SNARE', 'HAT', 'VOX', 'RISE', 'LASER'
  ]);
  
  const [limiterThreshold, setLimiterThreshold] = useState(() => {
    try {
      const saved = localStorage.getItem('limiter_threshold_v1');
      if (saved) return parseFloat(saved);
    } catch (e) {}
    return -0.5;
  });

  const [keyboardMappings, setKeyboardMappings] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem('keyboard_mappings_v2');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {
      playA: 'Space',
      playB: 'Enter',
      syncA: 'KeyS',
      syncB: 'KeyD',
      loopA: 'KeyQ',
      loopB: 'KeyW',
      filterResetA: 'KeyX',
      filterResetB: 'KeyN',
    };
  });
  const [learningKeyAction, setLearningKeyAction] = useState<string | null>(null);
  const [mappingTab, setMappingTab] = useState<'midi' | 'keyboard'>('midi');

  const learningKeyActionRef = useRef<string | null>(null);
  useEffect(() => {
    learningKeyActionRef.current = learningKeyAction;
  }, [learningKeyAction]);

  const keyboardMappingsRef = useRef(keyboardMappings);
  useEffect(() => {
    keyboardMappingsRef.current = keyboardMappings;
    localStorage.setItem('keyboard_mappings_v2', JSON.stringify(keyboardMappings));
  }, [keyboardMappings]);

  useEffect(() => {
    localStorage.setItem('limiter_threshold_v1', limiterThreshold.toString());
    if (masterLimiterRef.current && audioCtxRef.current) {
      masterLimiterRef.current.threshold.setValueAtTime(limiterThreshold, audioCtxRef.current.currentTime);
    }
  }, [limiterThreshold]);
  
  const [dragOverDeckA, setDragOverDeckA] = useState(false);
  const [dragOverDeckB, setDragOverDeckB] = useState(false);
  const [dragOverQueue, setDragOverQueue] = useState(false);

  const [selectedFolderId, setSelectedFolderId] = useState<string>('all');
  const [midiMappings, setMidiMappings] = useState<Record<string, { type: 'cc' | 'note', number: number }>>(() => {
    try {
      const saved = localStorage.getItem('midi_mappings_v1');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {
      playA: { type: 'note', number: 60 },
      playB: { type: 'note', number: 62 },
      gainA: { type: 'cc', number: 7 },
      gainB: { type: 'cc', number: 8 },
      crossfader: { type: 'cc', number: 1 },
    };
  });
  const [learningAction, setLearningAction] = useState<string | null>(null);
  const [xyActiveDeck, setXyActiveDeck] = useState<'A' | 'B'>('A');
  const [xyLocked, setXyLocked] = useState(true);
  const xyPadRef = useRef<HTMLDivElement>(null);
  const [isDraggingXy, setIsDraggingXy] = useState(false);

  const scratchVelocityRef = useRef<{ A: number, B: number }>({ A: 0, B: 0 });
  const scratchFrictionRef = useRef<{ A: number, B: number }>({ A: 0.95, B: 0.95 });
  const isScratchingRef = useRef<{ A: boolean, B: boolean }>({ A: false, B: false });
  const slipSessionRef = useRef<{
    A: { startPosition: number; startTime: number } | null;
    B: { startPosition: number; startTime: number } | null;
  }>({ A: null, B: null });

  const getTrackFolderFilter = (folderId: string) => {
    return (t: Track) => {
      if (folderId === 'all') return true;
      if (folderId === 'bpm_slow') return parseFloat(t.bpm) < 120;
      if (folderId === 'bpm_mid') return parseFloat(t.bpm) >= 120 && parseFloat(t.bpm) <= 140;
      if (folderId === 'bpm_fast') return parseFloat(t.bpm) > 140;
      
      if (folderId.startsWith('key_')) {
        const targetKey = folderId.replace('key_', '');
        if (targetKey === 'minor') return t.key.endsWith('m');
        if (targetKey === 'major') return !t.key.endsWith('m');
        return t.key === targetKey;
      }
      
      if (folderId === 'harmony_A' || folderId === 'smart_transition_A') {
        if (!deckA.activeTrack) return false;
        const compKey = keysAreCompatible(deckA.activeTrack.key, t.key);
        if (folderId === 'harmony_A') {
          return compKey && t.id !== deckA.activeTrack.id;
        }
        // smart_transition_A: Key compatible AND BPM within 12 BPM (approx. ±8%)
        const originalBpm = parseFloat(deckA.activeTrack.bpm) || 128;
        const targetBpm = parseFloat(t.bpm) || 128;
        const bpmDiff = Math.abs(originalBpm - targetBpm);
        return compKey && bpmDiff <= 12 && t.id !== deckA.activeTrack.id;
      }
      
      if (folderId === 'harmony_B' || folderId === 'smart_transition_B') {
        if (!deckB.activeTrack) return false;
        const compKey = keysAreCompatible(deckB.activeTrack.key, t.key);
        if (folderId === 'harmony_B') {
          return compKey && t.id !== deckB.activeTrack.id;
        }
        // smart_transition_B
        const originalBpm = parseFloat(deckB.activeTrack.bpm) || 128;
        const targetBpm = parseFloat(t.bpm) || 128;
        const bpmDiff = Math.abs(originalBpm - targetBpm);
        return compKey && bpmDiff <= 12 && t.id !== deckB.activeTrack.id;
      }

      if (folderId === 'smart_energy_A') {
        if (!deckA.activeTrack) return false;
        return isEnergyBoostCompatible(deckA.activeTrack.key, t.key) && t.id !== deckA.activeTrack.id;
      }

      if (folderId === 'smart_energy_B') {
        if (!deckB.activeTrack) return false;
        return isEnergyBoostCompatible(deckB.activeTrack.key, t.key) && t.id !== deckB.activeTrack.id;
      }
      
      return true;
    };
  };

  // Filter track list based on search (by title, artist, or BPM)
  const filteredTracks = libraryTracks.filter(track => {
    const folderFilter = getTrackFolderFilter(selectedFolderId);
    if (!folderFilter(track)) return false;

    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      track.title.toLowerCase().includes(q) ||
      (track.artist && track.artist.toLowerCase().includes(q)) ||
      track.bpm.includes(q)
    );
  });

  const handleDragStart = (e: React.DragEvent, track: Track) => {
    e.dataTransfer.setData('application/json', JSON.stringify(track));
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const masterLimiterRef = useRef<DynamicsCompressorNode | null>(null);
  const masterEqNodes = useRef<{ low: BiquadFilterNode, mid: BiquadFilterNode, high: BiquadFilterNode } | null>(null);
  const recDestRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const lastTimeRef = useRef<number>(0);
  const analyserARef = useRef<AnalyserNode | null>(null);
  const analyserBRef = useRef<AnalyserNode | null>(null);
  const samplerGainNodeRef = useRef<GainNode | null>(null);

  const playToggleRef = useRef<any>(null);
  useEffect(() => {
    playToggleRef.current = (id: 'A' | 'B') => handlePlayToggle(id);
  }, []);

  const midiMappingsRef = useRef(midiMappings);
  useEffect(() => {
    midiMappingsRef.current = midiMappings;
    localStorage.setItem('midi_mappings_v1', JSON.stringify(midiMappings));
  }, [midiMappings]);

  const learningActionRef = useRef<string | null>(null);
  useEffect(() => {
    learningActionRef.current = learningAction;
  }, [learningAction]);

  // --- MIDI SUPPORT ---
  useEffect(() => {
    if (!navigator.requestMIDIAccess) return;

    const onMIDIMessage = (msg: any) => {
      const [status, data1, data2] = msg.data;
      const type = status & 0xf0;
      const isCC = type === 0xb0;
      const isNoteOn = type === 0x90 && data2 > 0;

      // Handle custom MIDI learning mode
      if (learningActionRef.current) {
        const action = learningActionRef.current;
        if (isCC) {
          setMidiMappings(prev => ({
            ...prev,
            [action]: { type: 'cc', number: data1 }
          }));
          setLearningAction(null);
        } else if (isNoteOn) {
          setMidiMappings(prev => ({
            ...prev,
            [action]: { type: 'note', number: data1 }
          }));
          setLearningAction(null);
        }
        return;
      }

      // Handle interactive mapping triggers
      const currentMap = midiMappingsRef.current;
      for (const [actionName, map] of Object.entries(currentMap)) {
        const typedMap = map as { type: 'cc' | 'note', number: number };
        if (typedMap.type === 'cc' && isCC && data1 === typedMap.number) {
          if (actionName === 'crossfader') {
            setCrossfaderPos((data2 / 127) * 100);
          } else if (actionName === 'gainA') {
            setDeckA(prev => ({ ...prev, gain: data2 / 127 }));
          } else if (actionName === 'gainB') {
            setDeckB(prev => ({ ...prev, gain: data2 / 127 }));
          }
        } else if (typedMap.type === 'note' && isNoteOn && data1 === typedMap.number) {
          if (actionName === 'playA') {
            if (playToggleRef.current) playToggleRef.current('A');
          } else if (actionName === 'playB') {
            if (playToggleRef.current) playToggleRef.current('B');
          }
        }
      }
    };

    navigator.requestMIDIAccess().then(access => {
      for (const input of access.inputs.values()) {
        input.onmidimessage = onMIDIMessage;
      }
    });
  }, []);

  // --- RECORDING LOGIC ---
  const startRecording = () => {
    const ctx = initAudio();
    if (!recDestRef.current) {
      recDestRef.current = ctx.createMediaStreamDestination();
      if (masterLimiterRef.current) {
        masterLimiterRef.current.connect(recDestRef.current);
      } else {
        masterGainRef.current?.connect(recDestRef.current);
      }
    }
    
    chunksRef.current = [];
    mediaRecorderRef.current = new MediaRecorder(recDestRef.current.stream);
    mediaRecorderRef.current.ondataavailable = (e) => chunksRef.current.push(e.data);
    mediaRecorderRef.current.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `BAD_N3WS_MIX_${new Date().toISOString().replace(/[:.]/g, '-')}.wav`;
      a.click();
    };
    mediaRecorderRef.current.start();
    setIsRecording(true);
    setRecordDuration(0);
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  useEffect(() => {
    let iv: any;
    if (isRecording) {
      iv = setInterval(() => setRecordDuration(prev => prev + 1), 1000);
    }
    return () => clearInterval(iv);
  }, [isRecording]);

  // --- COLLABORATION SYNC ---
  useEffect(() => {
    if (!sessionId) return;
    const unsub = onSnapshot(doc(db, 'sessions', sessionId), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.updatedBy === auth.currentUser?.uid) return; // Ignore own updates
        setDeckA(prev => ({ ...prev, ...data.deckA }));
        setDeckB(prev => ({ ...prev, ...data.deckB }));
      }
    });
    return () => unsub();
  }, [sessionId]);

  const syncState = useCallback((newDeckA?: any, newDeckB?: any) => {
    if (!sessionId) return;
    updateDoc(doc(db, 'sessions', sessionId), {
      deckA: newDeckA || deckA,
      deckB: newDeckB || deckB,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser?.uid
    });
  }, [sessionId, deckA, deckB]);

  const createSession = async () => {
    try {
      const { signInAnonymously } = await import('firebase/auth');
      await signInAnonymously(auth);
    } catch (e) {
      console.error("Auth restricted:", e);
    }
    const id = Math.random().toString(36).substring(2, 8).toUpperCase();
    await setDoc(doc(db, 'sessions', id), {
      id,
      deckA: INITIAL_DECK('A'),
      deckB: INITIAL_DECK('B'),
      crossfader: 50,
      updatedAt: serverTimestamp(),
      updatedBy: auth.currentUser?.uid
    });
    setSessionId(id);
  };

  const fetchSuggestions = async () => {
    setIsSuggesting(true);
    try {
      const resp = await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentTrack: deckA.activeTrack?.title || deckB.activeTrack?.title || 'Heavy Dubstep',
          history: 'Riddim, Dubstep, Bass',
          crowdFeedback: 'Hyped'
        })
      });
      const data = await resp.json();
      setSuggestions(data);
      setActivePanel('ai');
    } catch (err) {
      console.error(err);
    } finally {
      setIsSuggesting(false);
    }
  };

  // --- AUDIO LOGIC ---
  const initAudio = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      const low = audioCtxRef.current.createBiquadFilter();
      low.type = 'lowshelf';
      low.frequency.value = 320;
      
      const mid = audioCtxRef.current.createBiquadFilter();
      mid.type = 'peaking';
      mid.frequency.value = 1000;
      mid.Q.value = 0.5;
      
      const high = audioCtxRef.current.createBiquadFilter();
      high.type = 'highshelf';
      high.frequency.value = 3200;

      masterEqNodes.current = { low, mid, high };
      
      masterGainRef.current = audioCtxRef.current.createGain();
      
      // Peak Limiter Node
      masterLimiterRef.current = audioCtxRef.current.createDynamicsCompressor();
      masterLimiterRef.current.threshold.setValueAtTime(limiterThreshold, audioCtxRef.current.currentTime);
      masterLimiterRef.current.knee.setValueAtTime(0, audioCtxRef.current.currentTime);
      masterLimiterRef.current.ratio.setValueAtTime(20, audioCtxRef.current.currentTime);
      masterLimiterRef.current.attack.setValueAtTime(0.003, audioCtxRef.current.currentTime); // 3ms fast attack
      masterLimiterRef.current.release.setValueAtTime(0.08, audioCtxRef.current.currentTime); // 80ms fallback release

      // Chain: masterEq -> masterGain -> limiter -> destination
      low.connect(mid);
      mid.connect(high);
      high.connect(masterGainRef.current);
      masterGainRef.current.connect(masterLimiterRef.current);
      masterLimiterRef.current.connect(audioCtxRef.current.destination);

      analyserARef.current = audioCtxRef.current.createAnalyser();
      analyserBRef.current = audioCtxRef.current.createAnalyser();
    }
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
    return audioCtxRef.current;
  };

  const loadFile = async (id: 'A' | 'B', file: File) => {
    const ctx = initAudio();
    const setDeck = id === 'A' ? setDeckA : setDeckB;
    
    setDeck(prev => ({ ...prev, isAnalyzing: true }));
    
    const buf = await file.arrayBuffer();
    const audioBuf = await ctx.decodeAudioData(buf);
    
    // Perceived Auto-Gain Normalization (RMS)
    const calculatedGain = calculatePerceivedGain(audioBuf);
    
    // Real smart audio analysis of the uploaded audio track!
    const detectedBpm = estimateBpm(audioBuf);
    const keys = ['Am', 'Bm', 'Cm', 'Dm', 'Em', 'Fm', 'Gm', 'C#m', 'Eb', 'F', 'G#m', 'F#m', 'D#m', 'A#m', 'C', 'D', 'G', 'A', 'E'];
    const hash = file.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const detectedKey = keys[hash % keys.length];
    
    // Update global master BPM if the other deck is inactive
    const otherDeck = id === 'A' ? deckB : deckA;
    if (!otherDeck.playing) {
      setMasterBpm(detectedBpm);
    }
    
    const trackTitle = file.name.replace(/\.[^.]+$/, '');
    const trackObj: Track = {
      id: 'local_' + Math.random().toString(36).substring(2, 9),
      n: libraryTracks.length + 1,
      title: trackTitle,
      artist: 'Local Upload',
      bpm: detectedBpm.toString(),
      key: detectedKey,
      dur: fmtTime(audioBuf.duration),
      file: file
    };

    setLibraryTracks(prev => {
      if (prev.some(t => t.title === trackTitle)) return prev;
      return [trackObj, ...prev];
    });

    setDeck(prev => {
      return {
        ...prev,
        buffer: audioBuf,
        total: audioBuf.duration,
        bpm: detectedBpm,
        key: detectedKey,
        gain: calculatedGain, // <-- Auto Gain applied!
        isAnalyzing: false,
        activeTrack: trackObj,
        waveform: generateDummyWaveform(4000, file.name),
        gridBpm: detectedBpm,
        gridOffset: 0,
        showGrid: true
      };
    });
  };

  const stopDeck = (id: 'A' | 'B') => {
    const deck = id === 'A' ? deckA : deckB;
    if (deck.source) {
      try { deck.source.stop(); } catch(e) {}
      deck.source.disconnect();
    }
  };

  const playDeck = (id: 'A' | 'B', offset?: number, crossfadeMs = 0) => {
    const ctx = initAudio();
    const deck = id === 'A' ? deckA : deckB;
    const setDeck = id === 'A' ? setDeckA : setDeckB;
    const analyser = id === 'A' ? analyserARef.current : analyserBRef.current;

    const oldSource = deck.source;
    const oldGainNode = deck.gainNode;

    if (crossfadeMs > 0 && oldSource && oldGainNode) {
      // Graceful crossfade transition: fade out old source and fade in new source
      const fadeTime = crossfadeMs / 1000;
      const now = ctx.currentTime;
      try {
        oldGainNode.gain.cancelScheduledValues(now);
        oldGainNode.gain.setValueAtTime(oldGainNode.gain.value, now);
        oldGainNode.gain.linearRampToValueAtTime(0, now + fadeTime);
        oldSource.stop(now + fadeTime + 0.1);
        
        setTimeout(() => {
          try {
            oldSource.disconnect();
            oldGainNode.disconnect();
          } catch (e) {}
        }, (fadeTime + 0.2) * 1000);
      } catch (err) {
        console.error("Error crossfading old loop source:", err);
      }
    } else {
      stopDeck(id);
    }

    if (!deck.buffer) return;

    const source = ctx.createBufferSource();
    source.buffer = deck.buffer;
    const originalBpm = deck.activeTrack ? (parseInt(deck.activeTrack.bpm) || 160) : 160;
    const targetRate = (deck.bpm / originalBpm) * (1 + deck.pitchBend / 100);
    
    if (deck.vinylMode) {
      source.playbackRate.setValueAtTime(0.001, ctx.currentTime);
      source.playbackRate.linearRampToValueAtTime(targetRate, ctx.currentTime + 0.45);
    } else {
      source.playbackRate.setValueAtTime(targetRate, ctx.currentTime);
    }
    
    // EQ Filters
    const lowNode = ctx.createBiquadFilter();
    lowNode.type = 'lowshelf';
    lowNode.frequency.value = deck.eqCrossovers.loMid;
    lowNode.gain.value = deck.eqKills.low ? -40 : (deck.eqLevels?.low ?? 0);

    const midNode = ctx.createBiquadFilter();
    midNode.type = 'peaking';
    midNode.frequency.value = (deck.eqCrossovers.loMid + deck.eqCrossovers.midHi) / 2;
    midNode.Q.value = 0.8;
    midNode.gain.value = deck.eqKills.mid ? -40 : (deck.eqLevels?.mid ?? 0);

    const hiNode = ctx.createBiquadFilter();
    hiNode.type = 'highshelf';
    hiNode.frequency.value = deck.eqCrossovers.midHi;
    hiNode.gain.value = deck.eqKills.hi ? -40 : (deck.eqLevels?.hi ?? 0);

    const filterNode = ctx.createBiquadFilter();
    applyFilterNode(filterNode, deck.filterValue ?? 0);

    // FX Nodes
    let node1: any = undefined;
    let node2: any = undefined;

    const gainNode = ctx.createGain();
    const targetGain = deck.gain;
    if (crossfadeMs > 0) {
      gainNode.gain.setValueAtTime(0, ctx.currentTime);
      gainNode.gain.linearRampToValueAtTime(targetGain, ctx.currentTime + crossfadeMs / 1000);
    } else {
      gainNode.gain.value = targetGain;
    }

    source.connect(lowNode);
    lowNode.connect(midNode);
    midNode.connect(hiNode);
    hiNode.connect(filterNode);
    
    // Dry signal path
    filterNode.connect(gainNode);

    if (deck.fx?.enabled) {
      if (deck.fx.type === 'echo') {
        const delayVal = (deck.fx.val1 ?? 50) / 100; // 0s - 1s delay
        const feedbackVal = ((deck.fx.val2 ?? 50) / 100) * 0.85; // up to 0.85 feedback

        const delayNode = ctx.createDelay(2.0);
        delayNode.delayTime.value = delayVal;

        const feedbackNode = ctx.createGain();
        feedbackNode.gain.value = feedbackVal;

        const wetNode = ctx.createGain();
        wetNode.gain.value = 0.5; // Steady wet mix

        // Feedback Loop
        delayNode.connect(feedbackNode);
        feedbackNode.connect(delayNode);

        filterNode.connect(delayNode);
        delayNode.connect(wetNode);
        wetNode.connect(gainNode);

        node1 = delayNode;       // Used to adjust delayTime live
        node2 = feedbackNode;    // Used to adjust loop gain live
      } else if (deck.fx.type === 'flanger') {
        const rateVal = ((deck.fx.val1 ?? 50) / 100) * 5 + 0.1; // 0.1Hz - 5.1Hz LFO
        const depthVal = ((deck.fx.val2 ?? 50) / 100) * 0.005 + 0.001; // 1ms - 6ms modulation amplitude

        const delayNode = ctx.createDelay(1.0);
        delayNode.delayTime.value = 0.005; // 5ms baseline

        const lfo = ctx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.value = rateVal;

        const lfoGain = ctx.createGain();
        lfoGain.gain.value = depthVal;

        const wetNode = ctx.createGain();
        wetNode.gain.value = 0.6; // Flanger blend

        lfo.connect(lfoGain);
        lfoGain.connect(delayNode.delayTime);

        filterNode.connect(delayNode);
        delayNode.connect(wetNode);
        wetNode.connect(gainNode);

        lfo.start(0);

        node1 = lfo;        // Used to adjust frequency live
        node2 = lfoGain;    // Used to adjust sweep depth live
      } else if (deck.fx.type === 'reverb') {
        const decayVal = ((deck.fx.val1 ?? 50) / 100) * 3.5 + 0.5; // 0.5s - 4.0s reverb time
        const wetVal = ((deck.fx.val2 ?? 50) / 100) * 0.9; // Wet decay percentage

        const convolver = ctx.createConvolver();
        try {
          convolver.buffer = createReverbBuffer(ctx, decayVal);
        } catch (err) {
          console.error('[Web Audio] Reverb Convolver Error:', err);
        }

        const wetGain = ctx.createGain();
        wetGain.gain.value = wetVal;

        filterNode.connect(convolver);
        convolver.connect(wetGain);
        wetGain.connect(gainNode);

        node1 = convolver;  // Reverb node (regenerated on decay size change)
        node2 = wetGain;   // Used to adjust wet gain live
      }
    }

    if (analyser) gainNode.connect(analyser);
    if (masterGainRef.current) gainNode.connect(masterGainRef.current);

    const off = offset ?? deck.elapsed;
    source.start(0, off);

    setDeck(prev => ({
      ...prev,
      playing: true,
      source,
      lowNode,
      midNode,
      hiNode,
      filterNode,
      gainNode,
      node1,
      node2,
      startTime: ctx.currentTime,
      offset: off,
      elapsed: off
    }));
  };

  const toggleEqKill = (id: 'A' | 'B', band: 'hi' | 'mid' | 'low') => {
    const deck = id === 'A' ? deckA : deckB;
    const setDeck = id === 'A' ? setDeckA : setDeckB;
    const newVal = !deck.eqKills[band];
    
    setDeck(prev => ({
      ...prev,
      eqKills: { ...prev.eqKills, [band]: newVal }
    }));

    const node = band === 'low' ? deck.lowNode : band === 'mid' ? deck.midNode : deck.hiNode;
    if (node) {
      const normalGain = band === 'low' ? (deck.eqLevels?.low ?? 0) : band === 'mid' ? (deck.eqLevels?.mid ?? 0) : (deck.eqLevels?.hi ?? 0);
      node.gain.setTargetAtTime(newVal ? -40 : normalGain, audioCtxRef.current!.currentTime, 0.01);
    }
  };

  const handleEqChange = (id: 'A' | 'B', band: 'hi' | 'mid' | 'low', val: number) => {
    const deck = id === 'A' ? deckA : deckB;
    const setDeck = id === 'A' ? setDeckA : setDeckB;

    setDeck(prev => {
      const currentEq = prev.eqLevels ?? { hi: 0, mid: 0, low: 0 };
      const nextEqLevels = { ...currentEq, [band]: val };
      return {
        ...prev,
        eqLevels: nextEqLevels
      };
    });

    const node = band === 'low' ? deck.lowNode : band === 'mid' ? deck.midNode : deck.hiNode;
    if (node && !deck.eqKills[band]) {
      node.gain.setTargetAtTime(val, audioCtxRef.current?.currentTime || 0, 0.05);
    }
  };

  const handleFilterChange = (id: 'A' | 'B', val: number) => {
    const deck = id === 'A' ? deckA : deckB;
    const setDeck = id === 'A' ? setDeckA : setDeckB;

    setDeck(prev => ({
      ...prev,
      filterValue: val
    }));

    if (deck.filterNode) {
      applyFilterNode(deck.filterNode, val);
    }
  };

  const handleKeySync = (id: 'A' | 'B') => {
    const otherDeck = id === 'A' ? deckB : deckA;
    const setDeck = id === 'A' ? setDeckA : setDeckB;
    setDeck(prev => ({ ...prev, keyShift: otherDeck.keyShift }));
  };

  const handleHotCue = (id: 'A' | 'B', index: number) => {
    const deck = id === 'A' ? deckA : deckB;
    const setDeck = id === 'A' ? setDeckA : setDeckB;
    
    if (deck.hotCues[index] === null) {
      // Set cue
      let setPos = deck.elapsed;
      if (deck.quantize && deck.gridBpm) {
        const beatInterval = 60 / deck.gridBpm;
        const offset = deck.gridOffset || 0;
        const k = Math.round((setPos - offset) / beatInterval);
        const nearestBeatTime = offset + k * beatInterval;
        if (nearestBeatTime >= 0 && nearestBeatTime <= deck.total) {
          setPos = nearestBeatTime;
        }
      }
      const newCues = [...deck.hotCues];
      newCues[index] = setPos;
      setDeck(prev => ({ ...prev, hotCues: newCues }));
    } else {
      // Jump to cue
      let pos = deck.hotCues[index]!;
      if (deck.quantize && deck.gridBpm) {
        const beatInterval = 60 / deck.gridBpm;
        const offset = deck.gridOffset || 0;
        const k = Math.round((pos - offset) / beatInterval);
        const nearestBeatTime = offset + k * beatInterval;
        if (nearestBeatTime >= 0 && nearestBeatTime <= deck.total) {
          pos = nearestBeatTime;
        }
      }
      if (deck.playing) {
        playDeck(id, pos);
      } else {
        setDeck(prev => ({ ...prev, elapsed: pos, offset: pos }));
      }
    }
  };

  const clearHotCue = (id: 'A' | 'B', index: number) => {
    const setDeck = id === 'A' ? setDeckA : setDeckB;
    setDeck(prev => {
      const newCues = [...prev.hotCues];
      newCues[index] = null;
      return { ...prev, hotCues: newCues };
    });
  };

  const toggleFx = (id: 'A' | 'B') => {
    const deck = id === 'A' ? deckA : deckB;
    const setDeck = id === 'A' ? setDeckA : setDeckB;
    const newState = !deck.fx?.enabled;
    setDeck(prev => ({ ...prev, fx: { ...prev.fx!, enabled: newState } }));
    
    if (deck.playing) {
      setTimeout(() => playDeck(id), 0);
    }
  };

  const handleFxType = (id: 'A' | 'B', type: 'echo' | 'flanger' | 'reverb') => {
    const deck = id === 'A' ? deckA : deckB;
    const setDeck = id === 'A' ? setDeckA : setDeckB;
    setDeck(prev => ({ ...prev, fx: { ...prev.fx!, type } }));
    
    if (deck.playing) {
      setTimeout(() => playDeck(id), 0);
    }
  };

  const handleFxParamChange = (id: 'A' | 'B', paramIndex: 1 | 2, value: number) => {
    const deck = id === 'A' ? deckA : deckB;
    const setDeck = id === 'A' ? setDeckA : setDeckB;

    setDeck(prev => {
      const nextFx = { ...prev.fx!, [paramIndex === 1 ? 'val1' : 'val2']: value };
      return { ...prev, fx: nextFx };
    });

    if (deck.playing && deck.fx?.enabled) {
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      const t = ctx.currentTime;

      if (deck.fx.type === 'echo') {
        if (paramIndex === 1 && deck.node1) {
          const delayNode = deck.node1 as DelayNode;
          if (delayNode.delayTime) {
            delayNode.delayTime.setTargetAtTime(value / 100, t, 0.05);
          }
        } else if (paramIndex === 2 && deck.node2) {
          const feedbackGain = deck.node2 as GainNode;
          if (feedbackGain.gain) {
            feedbackGain.gain.setTargetAtTime((value / 100) * 0.85, t, 0.05);
          }
        }
      } else if (deck.fx.type === 'flanger') {
        if (paramIndex === 1 && deck.node1) {
          const lfoNode = deck.node1 as OscillatorNode;
          if (lfoNode.frequency) {
            lfoNode.frequency.setTargetAtTime((value / 100) * 5 + 0.1, t, 0.05);
          }
        } else if (paramIndex === 2 && deck.node2) {
          const depthGain = deck.node2 as GainNode;
          if (depthGain.gain) {
            depthGain.gain.setTargetAtTime((value / 100) * 0.005 + 0.001, t, 0.05);
          }
        }
      } else if (deck.fx.type === 'reverb') {
        if (paramIndex === 1 && deck.node1) {
          const convNode = deck.node1 as ConvolverNode;
          const decayVal = (value / 100) * 3.5 + 0.5;
          try {
            convNode.buffer = createReverbBuffer(ctx, decayVal);
          } catch (e) {
            console.error(e);
          }
        } else if (paramIndex === 2 && deck.node2) {
          const wetGain = deck.node2 as GainNode;
          if (wetGain.gain) {
            wetGain.gain.setTargetAtTime((value / 100) * 0.9, t, 0.01);
          }
        }
      }
    }
  };

  const updateXyFromEvent = (e: React.PointerEvent | PointerEvent) => {
    if (!xyPadRef.current) return;
    const rect = xyPadRef.current.getBoundingClientRect();
    const xPercent = Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
    const yPercent = Math.max(0, Math.min(100, Math.round((1 - (e.clientY - rect.top) / rect.height) * 100)));
    
    // We pass xyActiveDeck directly which uses correct active deck context
    handleFxParamChange(xyActiveDeck, 1, xPercent);
    handleFxParamChange(xyActiveDeck, 2, yPercent);
  };

  const handleXyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!xyPadRef.current) return;
    xyPadRef.current.setPointerCapture(e.pointerId);
    setIsDraggingXy(true);
    
    // Inline values update
    const rect = xyPadRef.current.getBoundingClientRect();
    const xPercent = Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
    const yPercent = Math.max(0, Math.min(100, Math.round((1 - (e.clientY - rect.top) / rect.height) * 100)));
    handleFxParamChange(xyActiveDeck, 1, xPercent);
    handleFxParamChange(xyActiveDeck, 2, yPercent);
  };

  const handleXyPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingXy) {
      updateXyFromEvent(e);
    }
  };

  const handleXyPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!xyPadRef.current) return;
    setIsDraggingXy(false);
    try {
      xyPadRef.current.releasePointerCapture(e.pointerId);
    } catch (err) {}
    
    if (!xyLocked) {
      handleFxParamChange(xyActiveDeck, 1, 50);
      handleFxParamChange(xyActiveDeck, 2, 50);
    }
  };

  const handleLoop = (id: 'A' | 'B', action: 'in' | 'out' | 'size' | 'toggle', val?: number) => {
    const deck = id === 'A' ? deckA : deckB;
    const setDeck = id === 'A' ? setDeckA : setDeckB;
    
    if (action === 'in') {
      setDeck(prev => ({ ...prev, loopIn: (prev.elapsed / prev.total) * 4000, looping: false }));
    } else if (action === 'out') {
      const cur = (deck.elapsed / deck.total) * 4000;
      if (cur > deck.loopIn) {
        setDeck(prev => {
          if (prev.slipMode && !slipSessionRef.current[id]) {
            slipSessionRef.current[id] = {
              startPosition: prev.elapsed,
              startTime: audioCtxRef.current ? audioCtxRef.current.currentTime : Date.now() / 1000
            };
          }
          return { ...prev, loopOut: cur, looping: true };
        });
      }
    } else if (action === 'size' && val) {
      setDeck(prev => {
        const bpm = prev.gridBpm || prev.bpm || 128;
        const beatDur = 60 / bpm;
        const loopDur = val * beatDur;
        
        // If we are already looping, adjust the loop endpoint from the loop start
        if (prev.looping && prev.loopIn >= 0) {
          const startSec = (prev.loopIn / 4000) * prev.total;
          const endSec = Math.min(prev.total, startSec + loopDur);
          return {
            ...prev,
            loopSize: val,
            loopOut: (endSec / prev.total) * 4000
          };
        } else {
          // Trigger a new auto-loop from current position
          if (prev.slipMode && !slipSessionRef.current[id]) {
            slipSessionRef.current[id] = {
              startPosition: prev.elapsed,
              startTime: audioCtxRef.current ? audioCtxRef.current.currentTime : Date.now() / 1000
            };
          }
          const loopInVal = (prev.elapsed / prev.total) * 4000;
          const loopOutVal = Math.min(prev.total, prev.elapsed + loopDur) / prev.total * 4000;
          return {
            ...prev,
            loopSize: val,
            loopIn: loopInVal,
            loopOut: loopOutVal,
            looping: true
          };
        }
      });
    } else if (action === 'toggle') {
      setDeck(prev => {
        const nextLooping = !prev.looping;
        
        if (nextLooping) {
          if (prev.slipMode && !slipSessionRef.current[id]) {
            slipSessionRef.current[id] = {
              startPosition: prev.elapsed,
              startTime: audioCtxRef.current ? audioCtxRef.current.currentTime : Date.now() / 1000
            };
          }
        } else {
          if (prev.slipMode && slipSessionRef.current[id]) {
            const session = slipSessionRef.current[id]!;
            const now = audioCtxRef.current ? audioCtxRef.current.currentTime : Date.now() / 1000;
            const dur = now - session.startTime;
            const originalBpm = prev.activeTrack ? (parseInt(prev.activeTrack.bpm) || 160) : 160;
            const speed = prev.bpm / originalBpm;
            const nextElapsed = Math.min(prev.total, session.startPosition + dur * speed);
            slipSessionRef.current[id] = null;
            
            if (prev.playing) {
              setTimeout(() => {
                playDeck(id, nextElapsed, 80);
              }, 0);
            }
            return {
              ...prev,
              looping: false,
              elapsed: nextElapsed,
              offset: nextElapsed
            };
          }
        }

        // If we have no valid loop points, set a default auto loop of loopSize
        if (nextLooping && (prev.loopIn < 0 || prev.loopOut <= prev.loopIn)) {
          const bpm = prev.gridBpm || prev.bpm || 128;
          const beatDur = 60 / bpm;
          const loopDur = prev.loopSize * beatDur;
          const loopInVal = (prev.elapsed / prev.total) * 4000;
          const loopOutVal = Math.min(prev.total, prev.elapsed + loopDur) / prev.total * 4000;
          return {
            ...prev,
            loopIn: loopInVal,
            loopOut: loopOutVal,
            looping: nextLooping
          };
        }
        return { ...prev, looping: nextLooping };
      });
    }
  };

  const handleSamplerTrigger = async (index: number) => {
    const ctx = initAudio();
    
    // Synthesize a unique high-quality instrument sound if no buffer exists
    if (!samplerBuffers[index]) {
      let duration = 0.5;
      if (index === 0) duration = 1.0; // SIREN
      else if (index === 1) duration = 0.8; // SAXO
      else if (index === 2) duration = 0.8; // HANDS UP
      else if (index === 3) duration = 0.6; // PUSH IT
      else if (index === 4) duration = 0.5; // PUMP IT
      else if (index === 5) duration = 0.6; // THIS THIS
      else if (index === 6) duration = 0.4; // KICK
      else if (index === 7) duration = 0.4; // SNARE
      else if (index === 8) duration = 0.15; // HAT
      else if (index === 9) duration = 0.5; // VOX
      else if (index === 10) duration = 1.5; // RISE
      else if (index === 11) duration = 0.5; // LASER

      const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * duration), ctx.sampleRate);
      const data = buf.getChannelData(0);
      const limit = buf.length;
      const sr = ctx.sampleRate;

      for (let i = 0; i < limit; i++) {
        const t = i / sr;
        if (index === 0) {
          // SIREN
          const lfo = Math.sin(2 * Math.PI * 6 * t);
          const pitch = 600 + lfo * 200;
          const val = Math.sin(2 * Math.PI * pitch * t);
          const env = Math.exp(-1.5 * t);
          data[i] = val * env * 0.35;
        } else if (index === 1) {
          // SAXO / HORN
          const vibrato = 1 + 0.03 * Math.sin(2 * Math.PI * 8 * t);
          const freq = 220 * vibrato;
          const saw1 = ((t * freq) % 1) * 2 - 1;
          const saw2 = ((t * freq * 1.5) % 1) * 2 - 1;
          const saw3 = ((t * freq * 2.0) % 1) * 2 - 1;
          const noise = (Math.random() * 2 - 1) * 0.1;
          const raw = saw1 * 0.5 + saw2 * 0.35 + saw3 * 0.15 + noise;
          const env = Math.min(1.0, t / 0.05) * Math.exp(-3 * t);
          data[i] = raw * env * 0.28;
        } else if (index === 2) {
          // HANDS UP rave chord stab (G major triad + seventh)
          const freqs = [196.0, 246.94, 293.66, 392.0];
          let val = 0;
          for (const f of freqs) {
            const saw = ((t * f) % 1) * 2 - 1;
            const sub = Math.sin(2 * Math.PI * f * 2.005 * t);
            val += saw * 0.5 + sub * 0.5;
          }
          const env = Math.exp(-4 * t);
          data[i] = (val / freqs.length) * env * 0.35;
        } else if (index === 3) {
          // PUSH IT voice formant Sweep
          const carrier = Math.sin(2 * Math.PI * 140 * t);
          const modulator = Math.sin(2 * Math.PI * 300 * t + Math.sin(2 * Math.PI * 340 * t) * (1 - t));
          const raw = carrier * 0.6 + modulator * 0.4;
          const env = Math.min(1.0, t / 0.1) * Math.exp(-4.5 * t);
          data[i] = raw * env * 0.3;
        } else if (index === 4) {
          // PUMP IT bass stab
          const sweepFreq = 65.41 * Math.exp(-t * 8) + 35;
          const rawSig = ((t * sweepFreq) % 1) < 0.5 ? -0.4 : 0.4;
          const env = Math.exp(-7.5 * t);
          data[i] = rawSig * env * 0.4;
        } else if (index === 5) {
          // THIS THIS glitch repeater
          const sliceT = t % 0.125;
          const scratchPitch = 120 + Math.sin(2 * Math.PI * 4 * sliceT) * 40;
          const val = Math.sin(2 * Math.PI * scratchPitch * sliceT);
          const env = Math.exp(-15 * sliceT);
          data[i] = val * env * 0.28;
        } else if (index === 6) {
          // KICK
          const sweepFreq = 150 * Math.exp(-t * 28) + 42;
          const phase = 2 * Math.PI * sweepFreq * t;
          const raw = Math.sin(phase);
          const distorted = Math.tanh(raw * 1.4);
          const env = Math.exp(-11 * t);
          data[i] = distorted * env * 0.45;
        } else if (index === 7) {
          // SNARE
          const tone = Math.sin(2 * Math.PI * 180 * t) * Math.exp(-25 * t) * 0.4;
          const noise = (Math.random() * 2 - 1) * Math.exp(-14 * t) * 0.35;
          const env = Math.exp(-2 * t);
          data[i] = (tone + noise) * env;
        } else if (index === 8) {
          // HAT
          const noise = Math.random() * 2 - 1;
          const bandWave = Math.sin(2 * Math.PI * 10000 * t) + Math.sin(2 * Math.PI * 14000 * t);
          const raw = noise * 0.7 + bandWave * 0.3;
          const env = Math.exp(-80 * t);
          data[i] = raw * env * 0.18;
        } else if (index === 9) {
          // VOX
          const f1 = 261.63;
          const form1 = Math.sin(2 * Math.PI * f1 * t);
          const form2 = Math.sin(2 * Math.PI * f1 * 1.5 * t);
          const form3 = Math.sin(2 * Math.PI * f1 * 2.0 * t);
          const raw = (form1 + form2 * 0.55 + form3 * 0.3) * (1.0 + 0.15 * Math.sin(2 * Math.PI * 10 * t));
          const env = Math.min(1.0, t / 0.05) * Math.exp(-6 * t);
          data[i] = raw * env * 0.32;
        } else if (index === 10) {
          // RISE
          const sweepFreq = 100 + (1200 * (t / 1.5) * (t / 1.5));
          const noise = (Math.random() * 2 - 1) * 0.22;
          const sine = Math.sin(2 * Math.PI * sweepFreq * t);
          const val = sine * 0.75 + noise * 0.25;
          const env = (t / 1.5) * Math.exp(-0.8 * (1.5 - t));
          data[i] = val * env * 0.3;
        } else if (index === 11) {
          // LASER
          const laserFreq = 3000 * Math.exp(-40 * t) + 120;
          const val = Math.sin(2 * Math.PI * laserFreq * t);
          const env = Math.exp(-12 * t);
          data[i] = val * env * 0.32;
        } else {
          // Fallback
          data[i] = Math.sin(2 * Math.PI * 440 * t) * Math.exp(-10 * t) * 0.25;
        }
      }

      setSamplerBuffers(prev => ({ ...prev, [index]: buf }));
      playBuffer(buf);
    } else {
      playBuffer(samplerBuffers[index]);
    }

    function playBuffer(buf: AudioBuffer) {
      const source = ctx.createBufferSource();
      source.buffer = buf;
      
      if (!samplerGainNodeRef.current) {
        samplerGainNodeRef.current = ctx.createGain();
        samplerGainNodeRef.current.connect(masterGainRef.current || ctx.destination);
      }
      samplerGainNodeRef.current.gain.value = samplerVolume / 100;
      
      source.connect(samplerGainNodeRef.current);
      source.start();
    }

    // Visual feedback
    const pads = document.querySelectorAll('.sampler-pad');
    const pad = pads[index] as HTMLElement;
    if (pad) {
      pad.classList.add('btn-glow-accent');
      setTimeout(() => pad.classList.remove('btn-glow-accent'), 200);
    }
  };

  const handleSamplerUpload = async (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ctx = initAudio();
    try {
      const arrayBuf = await file.arrayBuffer();
      const audioBuf = await ctx.decodeAudioData(arrayBuf);
      
      setSamplerBuffers(prev => ({ ...prev, [index]: audioBuf }));
      
      const cleanName = file.name.replace(/\.[^.]+$/, '').substring(0, 12).toUpperCase();
      setSamplerNames(prev => {
        const next = [...prev];
        next[index] = cleanName;
        return next;
      });
    } catch (err) {
      console.error("Error decoding custom sampler audio:", err);
    }
  };

  const updateMasterEq = (band: 'low' | 'mid' | 'high', val: number) => {
    setMasterEq(prev => {
      const next = { ...prev, [band]: val };
      if (currentUser) {
        saveUserProfile(currentUser.uid, {
          [`masterEq_${band}`]: val
        });
      }
      return next;
    });
    if (masterEqNodes.current) {
      masterEqNodes.current[band].gain.setTargetAtTime(val, audioCtxRef.current!.currentTime, 0.1);
    }
  };

  const getCrossfadeGains = (pos: number, curve: CrossfaderCurve) => {
    const x = pos / 100;
    if (curve === 'linear') {
      return { a: 1 - x, b: x };
    } else if (curve === 'exp') {
      return { a: Math.pow(1 - x, 2), b: Math.pow(x, 2) };
    } else if (curve === 'rev-exp') {
      return { a: 1 - Math.pow(x, 2), b: 1 - Math.pow(1 - x, 2) };
    } else if (curve === 'cut') {
      if (pos < 5) return { a: 1, b: 0 };
      if (pos > 95) return { a: 0, b: 1 };
      return { a: 1, b: 1 };
    } else if (curve === 'custom') {
      // S-Curve logic
      const val = 0.5 * (1 - Math.cos(x * Math.PI));
      return { a: 1 - val, b: val };
    } else {
      // Logarithmic / Equal Power curve
      return { 
        a: Math.cos(x * 0.5 * Math.PI), 
        b: Math.sin(x * 0.5 * Math.PI) 
      };
    }
  };

  const handlePitchBend = (id: 'A' | 'B', amount: number) => {
    const deck = id === 'A' ? deckA : deckB;
    const setDeck = id === 'A' ? setDeckA : setDeckB;
    setDeck(prev => ({ ...prev, pitchBend: amount }));
    if (deck.source) {
       const originalBpm = deck.activeTrack ? (parseInt(deck.activeTrack.bpm) || 160) : 160;
       deck.source.playbackRate.setTargetAtTime((deck.bpm / originalBpm) * (1 + amount / 100), audioCtxRef.current!.currentTime, 0.05);
    }
  };

  const updateEqCrossover = (id: 'A' | 'B', band: 'loMid' | 'midHi', freq: number) => {
    const setDeck = id === 'A' ? setDeckA : setDeckB;
    setDeck(prev => {
      const next = { ...prev, eqCrossovers: { ...prev.eqCrossovers, [band]: freq } };
      if (band === 'loMid' && next.lowNode) next.lowNode.frequency.setTargetAtTime(freq, audioCtxRef.current!.currentTime, 0.1);
      if (band === 'midHi' && next.hiNode) next.hiNode.frequency.setTargetAtTime(freq, audioCtxRef.current!.currentTime, 0.1);
      return next;
    });
    if (currentUser) {
      saveUserProfile(currentUser.uid, {
        [`eqCrossovers_${id}_${band}`]: freq
      });
    }
  };


  useEffect(() => {
    const gains = getCrossfadeGains(crossfaderPos, crossfaderCurve);
    if (deckA.gainNode) {
      deckA.gainNode.gain.setTargetAtTime(deckA.gain * gains.a, audioCtxRef.current!.currentTime, 0.05);
    }
    if (deckB.gainNode) {
      deckB.gainNode.gain.setTargetAtTime(deckB.gain * gains.b, audioCtxRef.current!.currentTime, 0.05);
    }
  }, [crossfaderPos, crossfaderCurve, deckA.gain, deckB.gain, deckA.gainNode, deckB.gainNode]);

  const loadDummyTrack = async (id: 'A' | 'B', track: Track) => {
    const ctx = initAudio();
    const setDeck = id === 'A' ? setDeckA : setDeckB;
    
    setDeck(prev => ({ ...prev, isAnalyzing: true }));
    
    if (track.file) {
      try {
        const buf = await track.file.arrayBuffer();
        const audioBuf = await ctx.decodeAudioData(buf);
        const calculatedGain = calculatePerceivedGain(audioBuf);
        const trackBpm = parseInt(track.bpm) || 128;
        
        const otherDeck = id === 'A' ? deckB : deckA;
        if (!otherDeck.playing) {
          setMasterBpm(trackBpm);
        }
        
        setDeck(prev => ({
          ...prev,
          buffer: audioBuf,
          total: audioBuf.duration,
          bpm: trackBpm,
          key: track.key,
          gain: calculatedGain, // <-- Auto Gain applied!
          isAnalyzing: false,
          activeTrack: track,
          waveform: generateDummyWaveform(4000, track.title),
          gridBpm: trackBpm,
          gridOffset: 0,
          showGrid: true
        }));
        return;
      } catch (err) {
        console.error("Error loading real file in loadDummyTrack:", err);
      }
    }
    
    // Simulate thinking/fetching
    await new Promise(r => setTimeout(r, 1200));

    // Synthesize a beautiful realistic music track dynamically in the audio buffer!
    const trackBpm = parseInt(track.bpm) || 128;
    const buf = ctx.createBuffer(2, ctx.sampleRate * 180, ctx.sampleRate); // 3 min stereo buffer
    synthesizeAudioTrack(buf, trackBpm, track.key, track.title);
    
    // Perceived Auto-Gain Normalization (RMS mockup)
    const normalizedGain = getDummyTrackNormalizedGain(track.title);
    
    // Update global master BPM if the other deck is inactive
    const otherDeck = id === 'A' ? deckB : deckA;
    if (!otherDeck.playing) {
      setMasterBpm(trackBpm);
    }
    
    setDeck(prev => ({
      ...prev,
      buffer: buf,
      total: buf.duration,
      bpm: trackBpm,
      key: track.key,
      gain: normalizedGain, // <-- Auto Gain applied!
      isAnalyzing: false,
      activeTrack: track,
      waveform: generateDummyWaveform(4000, track.title),
      gridBpm: trackBpm,
      gridOffset: 0,
      showGrid: true
    }));
  };

  const addToQueue = (track: Track) => {
    setQueue(prev => [...prev, track]);
  };
  
  const removeFromQueue = (id: string) => {
    setQueue(prev => prev.filter(t => t.id !== id));
  };

  const performAutomix = () => {
    if (queue.length === 0) return;
    
    const transitionMs = autoDJ.duration * 1000;
    const start = Date.now();
    const startPos = crossfaderPos;
    const targetPos = crossfaderPos < 50 ? 100 : 0;
    const activeDeckId = targetPos === 100 ? 'B' : 'A';
    
    // Load next track if possible
    const nextTrack = queue[0];
    loadDummyTrack(activeDeckId, nextTrack);
    setQueue(prev => prev.slice(1));
    
    setAutoDJ(prev => ({ ...prev, enabled: true }));
    
    const interval = setInterval(() => {
      const now = Date.now();
      const pct = Math.min(1, (now - start) / transitionMs);
      
      // Calculate position based on style
      let currentPos = startPos + (targetPos - startPos) * pct;
      
      if (autoDJ.style === 'drop') {
        currentPos = pct < 0.95 ? startPos : targetPos;
      }
      
      setCrossfaderPos(currentPos);
      
      // Smart EQ / Mixing logic
      if (autoDJ.style === 'fade' || autoDJ.style === 'swap') {
        if (pct > 0.2 && pct < 0.8) {
          if (targetPos === 100) { // A -> B
            setDeckA(prev => ({ ...prev, eqKills: { ...prev.eqKills, low: pct > 0.4 } }));
            if (autoDJ.style === 'swap') setDeckB(prev => ({ ...prev, eqKills: { ...prev.eqKills, low: pct < 0.6 } }));
          } else { // B -> A
            setDeckB(prev => ({ ...prev, eqKills: { ...prev.eqKills, low: pct > 0.4 } }));
            if (autoDJ.style === 'swap') setDeckA(prev => ({ ...prev, eqKills: { ...prev.eqKills, low: pct < 0.6 } }));
          }
        }
      }
      
      if (pct >= 1) {
        clearInterval(interval);
        setAutoDJ(prev => ({ ...prev, enabled: false }));
        // Reset EQ
        setDeckA(prev => ({ ...prev, eqKills: { hi: false, mid: false, low: false } }));
        setDeckB(prev => ({ ...prev, eqKills: { hi: false, mid: false, low: false } }));
      }
    }, 32);
  };

  const moveQueueItem = (index: number, direction: 'up' | 'down') => {
    setQueue(prev => {
      const next = [...prev];
      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const handleSync = (id: 'A' | 'B') => {
    const setDeck = id === 'A' ? setDeckA : setDeckB;
    const isLocking = id === 'A' ? !deckA.bpmLocked : !deckB.bpmLocked;
    
    setDeck(prev => {
      const nextBpm = isLocking ? masterBpm : prev.bpm;
      const original = prev.activeTrack ? (parseInt(prev.activeTrack.bpm) || 160) : 160;
      const nextPitch = isLocking ? (((masterBpm / original) - 1) * 100) : prev.pitch;
      
      if (prev.source) {
        try {
          const currentCtx = audioCtxRef.current;
          if (currentCtx) {
            prev.source.playbackRate.setTargetAtTime(
              (nextBpm / original) * (1 + prev.pitchBend / 100),
              currentCtx.currentTime,
              0.02
            );
          }
        } catch (e) {
          console.error(`[Audio] Failed to set playbackRate for Deck ${id} on Sync toggle:`, e);
        }
      }
      return {
        ...prev,
        bpmLocked: isLocking,
        bpm: nextBpm,
        pitch: nextPitch
      };
    });
  };

  const handleUpdateDeck = useCallback((id: 'A' | 'B', updates: Partial<DeckState>) => {
    const setDeck = id === 'A' ? setDeckA : setDeckB;
    setDeck(prev => {
      const merged = { ...prev, ...updates };
      // If bpm or pitchBend changed, and source is playing, update its playbackRate
      if (prev.source && ('bpm' in updates || 'pitchBend' in updates)) {
        try {
          const currentCtx = audioCtxRef.current;
          const original = merged.activeTrack ? (parseInt(merged.activeTrack.bpm) || 160) : 160;
          if (currentCtx) {
            prev.source.playbackRate.setTargetAtTime(
              (merged.bpm / original) * (1 + merged.pitchBend / 100),
              currentCtx.currentTime,
              0.02
            );
          } else {
            prev.source.playbackRate.value = (merged.bpm / original) * (1 + merged.pitchBend / 100);
          }
        } catch (e) {
          console.error(`[Audio] Failed to update playbackRate for Deck ${id}:`, e);
        }
      }
      return merged;
    });
  }, []);

  // --- AUTO-SYNC ENGINE FOR MASTER BPM & DECK TIMING ---
  useEffect(() => {
    if (deckA.bpmLocked && deckA.bpm !== masterBpm) {
      const original = deckA.activeTrack ? (parseInt(deckA.activeTrack.bpm) || 160) : 160;
      handleUpdateDeck('A', {
        bpm: masterBpm,
        pitch: ((masterBpm / original) - 1) * 100
      });
    }
  }, [masterBpm, deckA.bpmLocked, deckA.bpm, deckA.activeTrack, handleUpdateDeck]);

  useEffect(() => {
    if (deckB.bpmLocked && deckB.bpm !== masterBpm) {
      const original = deckB.activeTrack ? (parseInt(deckB.activeTrack.bpm) || 160) : 160;
      handleUpdateDeck('B', {
        bpm: masterBpm,
        pitch: ((masterBpm / original) - 1) * 100
      });
    }
  }, [masterBpm, deckB.bpmLocked, deckB.bpm, deckB.activeTrack, handleUpdateDeck]);

  const toggleDeckSetting = (id: 'A' | 'B', setting: 'vinylMode' | 'quantize' | 'slipMode') => {
    const setDeck = id === 'A' ? setDeckA : setDeckB;
    setDeck(prev => ({ ...prev, [setting]: !prev[setting] }));
  };

  const handlePlayToggle = (id: 'A' | 'B') => {
    const deck = id === 'A' ? deckA : deckB;
    const setDeck = id === 'A' ? setDeckA : setDeckB;
    if (deck.playing) {
      if (deck.vinylMode && deck.source && audioCtxRef.current) {
        const original = deck.activeTrack ? (parseInt(deck.activeTrack.bpm) || 160) : 160;
        const initialRate = (deck.bpm / original) * (1 + deck.pitchBend / 100);
        try {
          const now = audioCtxRef.current.currentTime;
          deck.source.playbackRate.cancelScheduledValues(now);
          deck.source.playbackRate.setValueAtTime(initialRate, now);
          deck.source.playbackRate.linearRampToValueAtTime(0.001, now + 0.85);
          
          const sourceToStop = deck.source;
          setTimeout(() => {
            try {
              sourceToStop.stop();
            } catch(e) {}
          }, 850);
        } catch (e) {}
        
        const distanceMoved = 0.85 * initialRate * 0.5;
        const endElapsed = Math.min(deck.total, deck.elapsed + distanceMoved);
        setDeck(prev => ({ ...prev, playing: false, elapsed: endElapsed, offset: endElapsed }));
      } else {
        const elapsed = deck.elapsed;
        stopDeck(id);
        setDeck(prev => ({ ...prev, playing: false, elapsed }));
      }
    } else {
      playDeck(id);
    }
  };

  const handleSeek = (id: 'A' | 'B', newPos: number) => {
    const setDeck = id === 'A' ? setDeckA : setDeckB;
    const deck = id === 'A' ? deckA : deckB;
    let newElapsed = (newPos / 4000) * deck.total;

    if (deck.quantize && deck.gridBpm) {
      const beatInterval = 60 / deck.gridBpm;
      const offset = deck.gridOffset || 0;
      const k = Math.round((newElapsed - offset) / beatInterval);
      const nearestBeatTime = offset + k * beatInterval;
      if (nearestBeatTime >= 0 && nearestBeatTime <= deck.total) {
        newElapsed = nearestBeatTime;
      }
    }

    if (deck.playing) {
      playDeck(id, newElapsed);
    } else {
      setDeck(prev => ({ ...prev, elapsed: newElapsed, offset: newElapsed }));
    }
  };

  const handleScratch = (id: 'A' | 'B', delta: number, isDragging = true, friction = 0.95) => {
    isScratchingRef.current[id] = isDragging;
    scratchFrictionRef.current[id] = friction;
    const deck = id === 'A' ? deckA : deckB;
    const setDeck = id === 'A' ? setDeckA : setDeckB;

    if (isDragging) {
      if (deck.slipMode && !slipSessionRef.current[id]) {
        slipSessionRef.current[id] = {
          startPosition: deck.elapsed,
          startTime: audioCtxRef.current ? audioCtxRef.current.currentTime : Date.now() / 1000
        };
      }
      scratchVelocityRef.current[id] = delta;
      setJogAngles(prev => ({ ...prev, [id]: prev[id] + delta * 0.015 }));
      setDeck(prev => {
        const move = delta * 0.5;
        const newPos = Math.max(0, Math.min(3999, (prev.elapsed / prev.total) * 4000 + move));
        const newElapsed = (newPos / 4000) * prev.total;

        if (prev.playing && prev.source) {
          const original = prev.activeTrack ? (parseInt(prev.activeTrack.bpm) || 160) : 160;
          const scratchPitchBend = delta * 12;
          const rate = (prev.bpm / original) * (1 + (prev.pitchBend + scratchPitchBend) / 100);
          try {
            prev.source.playbackRate.setValueAtTime(Math.max(0.1, Math.min(4.0, rate)), audioCtxRef.current?.currentTime || 0);
          } catch(e) {}
        }
        return { ...prev, elapsed: newElapsed };
      });
    } else {
      if (deck.slipMode && slipSessionRef.current[id]) {
        const session = slipSessionRef.current[id]!;
        const now = audioCtxRef.current ? audioCtxRef.current.currentTime : Date.now() / 1000;
        const dur = now - session.startTime;
        const originalBpm = deck.activeTrack ? (parseInt(deck.activeTrack.bpm) || 160) : 160;
        const speed = deck.bpm / originalBpm;
        const nextElapsed = Math.min(deck.total, session.startPosition + dur * speed);
        
        slipSessionRef.current[id] = null;
        scratchVelocityRef.current[id] = 0;
        
        setDeck(prev => ({ ...prev, elapsed: nextElapsed, offset: nextElapsed }));
        if (deck.playing) {
          setTimeout(() => {
            playDeck(id, nextElapsed);
          }, 0);
        }
      }
    }
  };

  // --- REFINED AUTO DJ ---
  useEffect(() => {
    if (!autoDJ.enabled) return;
    
    const checkTransition = () => {
      const activeDeck = crossfaderPos < 50 ? deckA : deckB;
      const otherDeck = crossfaderPos < 50 ? deckB : deckA;
      
      // If active track is near end, trigger automix
      if (activeDeck.playing && activeDeck.elapsed > activeDeck.total - (autoDJ.duration + 5)) {
        if (queue.length > 0 && !otherDeck.playing) {
          performAutomix();
        }
      }
    };

    const iv = setInterval(checkTransition, 1000);
    return () => clearInterval(iv);
  }, [autoDJ.enabled, deckA.playing, deckA.elapsed, deckB.playing, deckB.elapsed, crossfaderPos, queue, autoDJ.duration]);

  // --- FIREBASE SYNC ---
  useEffect(() => {
    const unsubAuth = auth.onAuthStateChanged(async (user) => {
      if (user) {
        setCurrentUser(user);
        getUserProfile(user.uid).then(profile => {
          if (profile) {
            if (profile.preferences) {
              setAutoDJ(prev => ({ ...prev, ...profile.preferences }));
              if (profile.preferences.crossfaderCurve) setCrossfaderCurve(profile.preferences.crossfaderCurve);
            }
            
            // Load custom EQ crossover frequencies
            if (profile.eqCrossovers_A_loMid !== undefined && profile.eqCrossovers_A_midHi !== undefined) {
              const loMid = profile.eqCrossovers_A_loMid;
              const midHi = profile.eqCrossovers_A_midHi;
              setDeckA(prev => {
                const next = { ...prev, eqCrossovers: { loMid, midHi } };
                if (next.lowNode) next.lowNode.frequency.setValueAtTime(loMid, audioCtxRef.current?.currentTime || 0);
                if (next.hiNode) next.hiNode.frequency.setValueAtTime(midHi, audioCtxRef.current?.currentTime || 0);
                return next;
              });
            }
            if (profile.eqCrossovers_B_loMid !== undefined && profile.eqCrossovers_B_midHi !== undefined) {
              const loMid = profile.eqCrossovers_B_loMid;
              const midHi = profile.eqCrossovers_B_midHi;
              setDeckB(prev => {
                const next = { ...prev, eqCrossovers: { loMid, midHi } };
                if (next.lowNode) next.lowNode.frequency.setValueAtTime(loMid, audioCtxRef.current?.currentTime || 0);
                if (next.hiNode) next.hiNode.frequency.setValueAtTime(midHi, audioCtxRef.current?.currentTime || 0);
                return next;
              });
            }
            
            // Load custom master EQ levels
            if (profile.masterEq_low !== undefined || profile.masterEq_mid !== undefined || profile.masterEq_high !== undefined) {
              const low = profile.masterEq_low ?? 0;
              const mid = profile.masterEq_mid ?? 0;
              const high = profile.masterEq_high ?? 0;
              setMasterEq({ low, mid, high });
              if (masterEqNodes.current) {
                masterEqNodes.current.low.gain.setValueAtTime(low, audioCtxRef.current?.currentTime || 0);
                masterEqNodes.current.mid.gain.setValueAtTime(mid, audioCtxRef.current?.currentTime || 0);
                masterEqNodes.current.high.gain.setValueAtTime(high, audioCtxRef.current?.currentTime || 0);
              }
            }
          }
        });
      } else {
        setCurrentUser(null);
      }
    });

    const q = query(collection(db, 'songRequests'), orderBy('requestedAt', 'desc'), limit(20));
    const unsubRequests = onSnapshot(q, (snapshot) => {
      setRequests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SongRequest)));
    });

    return () => {
      unsubAuth();
      unsubRequests();
    };
  }, []);

  // --- KEYBOARD SHORTCUTS ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is inside an input, textarea, or contentEditable element
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl && (
        activeEl.tagName === 'INPUT' || 
        activeEl.tagName === 'TEXTAREA' || 
        activeEl.isContentEditable ||
        activeEl.getAttribute('role') === 'textbox'
      )) {
        return;
      }

      // 1. Check if we are in Keyboard Learn Mode
      if (learningKeyActionRef.current) {
        e.preventDefault();
        e.stopPropagation();
        const action = learningKeyActionRef.current;
        if (e.key === 'Escape') {
          setKeyboardMappings(prev => {
            const next = { ...prev };
            delete next[action];
            return next;
          });
        } else {
          const keyVal = e.code || e.key;
          setKeyboardMappings(prev => ({
            ...prev,
            [action]: keyVal
          }));
        }
        setLearningKeyAction(null);
        return;
      }

      // 2. Custom keyboard shortcut triggers
      const currentKeys = keyboardMappingsRef.current as Record<string, string>;
      const pressedCode = e.code;
      const pressedKey = e.key;

      let customTriggered = false;
      for (const [actionName, mappedKey] of Object.entries(currentKeys)) {
        if (mappedKey && (
          pressedCode.toLowerCase() === mappedKey.toLowerCase() || 
          pressedKey.toLowerCase() === mappedKey.toLowerCase() ||
          (mappedKey === 'Space' && pressedKey === ' ') ||
          (mappedKey === 'Enter' && pressedKey === 'Enter')
        )) {
          e.preventDefault();
          customTriggered = true;
          if (actionName === 'playA') {
            handlePlayToggle('A');
          } else if (actionName === 'playB') {
            handlePlayToggle('B');
          } else if (actionName === 'syncA') {
            handleSync('A');
          } else if (actionName === 'syncB') {
            handleSync('B');
          } else if (actionName === 'loopA') {
            handleLoop('A', 'toggle');
          } else if (actionName === 'loopB') {
            handleLoop('B', 'toggle');
          } else if (actionName === 'filterResetA') {
            handleFilterChange('A', 0);
          } else if (actionName === 'filterResetB') {
            handleFilterChange('B', 0);
          }
          break;
        }
      }

      if (customTriggered) return;

      const key = e.key;

      // Spacebar toggles Play/Pause for Deck A, Shift + Spacebar (or Enter) for Deck B
      if (key === ' ') {
        e.preventDefault();
        if (e.shiftKey) {
          handlePlayToggle('B');
        } else {
          handlePlayToggle('A');
        }
      } else if (key === 'Enter') {
        e.preventDefault();
        handlePlayToggle('B');
      }

      // Loops: Q/W keys
      if (key.toLowerCase() === 'q') {
        e.preventDefault();
        handleLoop('A', 'toggle');
      } else if (key.toLowerCase() === 'w') {
        e.preventDefault();
        handleLoop('B', 'toggle');
      }

      // Hot Cues: 1-8
      if (/^[1-8]$/.test(key)) {
        e.preventDefault();
        const index = parseInt(key) - 1;
        if (e.shiftKey) {
          handleHotCue('B', index);
        } else {
          handleHotCue('A', index);
        }
      }

      // Filter sweeps (Z, X, C for Deck A / B, N, M for Deck B)
      const keyLower = key.toLowerCase();
      if (keyLower === 'z') {
        e.preventDefault();
        handleFilterChange('A', Math.max(-100, (deckA.filterValue ?? 0) - 20));
      } else if (keyLower === 'x') {
        e.preventDefault();
        handleFilterChange('A', 0);
      } else if (keyLower === 'c') {
        e.preventDefault();
        handleFilterChange('A', Math.min(100, (deckA.filterValue ?? 0) + 20));
      } else if (keyLower === 'b') {
        e.preventDefault();
        handleFilterChange('B', Math.max(-100, (deckB.filterValue ?? 0) - 20));
      } else if (keyLower === 'n') {
        e.preventDefault();
        handleFilterChange('B', 0);
      } else if (keyLower === 'm') {
        e.preventDefault();
        handleFilterChange('B', Math.min(100, (deckB.filterValue ?? 0) + 20));
      }

      // Sampler key triggers: U, I, O, P, H, J, K, L, Y, G, F, D
      const samplerKeys = ['u', 'i', 'o', 'p', 'h', 'j', 'k', 'l', 'y', 'g', 'f', 'd'];
      const sIdx = samplerKeys.indexOf(keyLower);
      if (sIdx !== -1) {
        e.preventDefault();
        handleSamplerTrigger(sIdx);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [deckA.playing, deckB.playing, deckA.hotCues, deckB.hotCues, deckA.filterValue, deckB.filterValue]);

  // --- ANIMATION LOOP ---
  useEffect(() => {
    lastTimeRef.current = 0; // Reset lastTimeRef so next frame calculates dt from 0/now!
    let frameId: number;

    const loop = (ts: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = ts;
      const dt = (ts - lastTimeRef.current) / 1000;
      lastTimeRef.current = ts;

      // --- JOG WHEEL INERTIA / COLD SPIN-DOWN DECAY ---
      if (!isScratchingRef.current.A && Math.abs(scratchVelocityRef.current.A) > 0.05) {
        const vel = scratchVelocityRef.current.A;
        const friction = scratchFrictionRef.current.A || 0.95;
        const nextVel = vel * friction; // simulated physical friction (custom retention per frame)
        scratchVelocityRef.current.A = nextVel;

        setJogAngles(prev => ({ ...prev, A: prev.A + nextVel * 0.015 }));
        setDeckA(prev => {
          const move = nextVel * 0.5;
          const newPos = Math.max(0, Math.min(3999, (prev.elapsed / prev.total) * 4000 + move));
          const newElapsed = (newPos / 4000) * prev.total;

          if (prev.playing && prev.source) {
            const original = prev.activeTrack ? (parseInt(prev.activeTrack.bpm) || 160) : 160;
            const scratchPitchBend = nextVel * 12;
            const rate = (prev.bpm / original) * (1 + (prev.pitchBend + scratchPitchBend) / 100);
            try {
              prev.source.playbackRate.setValueAtTime(Math.max(0.1, Math.min(4.0, rate)), audioCtxRef.current?.currentTime || 0);
            } catch(e) {}
          }
          return { ...prev, elapsed: newElapsed, offset: newElapsed };
        });
      } else if (!isScratchingRef.current.A && scratchVelocityRef.current.A !== 0) {
        scratchVelocityRef.current.A = 0;
        setDeckA(prev => {
          if (prev.playing && prev.source) {
            const original = prev.activeTrack ? (parseInt(prev.activeTrack.bpm) || 160) : 160;
            const rate = (prev.bpm / original) * (1 + prev.pitchBend / 100);
            try {
              prev.source.playbackRate.setValueAtTime(rate, audioCtxRef.current?.currentTime || 0);
            } catch(e) {}
            setTimeout(() => {
              playDeck('A', prev.elapsed);
            }, 0);
          }
          return prev;
        });
      }

      if (!isScratchingRef.current.B && Math.abs(scratchVelocityRef.current.B) > 0.05) {
        const vel = scratchVelocityRef.current.B;
        const friction = scratchFrictionRef.current.B || 0.95;
        const nextVel = vel * friction;
        scratchVelocityRef.current.B = nextVel;

        setJogAngles(prev => ({ ...prev, B: prev.B + nextVel * 0.015 }));
        setDeckB(prev => {
          const move = nextVel * 0.5;
          const newPos = Math.max(0, Math.min(3999, (prev.elapsed / prev.total) * 4000 + move));
          const newElapsed = (newPos / 4000) * prev.total;

          if (prev.playing && prev.source) {
            const original = prev.activeTrack ? (parseInt(prev.activeTrack.bpm) || 160) : 160;
            const scratchPitchBend = nextVel * 12;
            const rate = (prev.bpm / original) * (1 + (prev.pitchBend + scratchPitchBend) / 100);
            try {
              prev.source.playbackRate.setValueAtTime(Math.max(0.1, Math.min(4.0, rate)), audioCtxRef.current?.currentTime || 0);
            } catch(e) {}
          }
          return { ...prev, elapsed: newElapsed, offset: newElapsed };
        });
      } else if (!isScratchingRef.current.B && scratchVelocityRef.current.B !== 0) {
        scratchVelocityRef.current.B = 0;
        setDeckB(prev => {
          if (prev.playing && prev.source) {
            const original = prev.activeTrack ? (parseInt(prev.activeTrack.bpm) || 160) : 160;
            const rate = (prev.bpm / original) * (1 + prev.pitchBend / 100);
            try {
              prev.source.playbackRate.setValueAtTime(rate, audioCtxRef.current?.currentTime || 0);
            } catch(e) {}
            setTimeout(() => {
              playDeck('B', prev.elapsed);
            }, 0);
          }
          return prev;
        });
      }

      if (deckA.playing && !isScratchingRef.current.A && Math.abs(scratchVelocityRef.current.A) <= 0.05) {
        setDeckA(prev => {
          const originalBpm = prev.activeTrack ? (parseInt(prev.activeTrack.bpm) || 160) : 160;
          const rate = (prev.bpm / originalBpm) * (1 + prev.pitchBend / 100);
          const next = Math.min(prev.total, prev.elapsed + dt * rate);
          
          if (prev.looping && prev.loopIn >= 0 && prev.loopOut > prev.loopIn) {
             const curPos = (next / prev.total) * 4000;
             if (curPos >= prev.loopOut) {
                const retryOffset = (prev.loopIn / 4000) * prev.total;
                setTimeout(() => {
                  playDeck('A', retryOffset, 80);
                }, 0);
                return { 
                  ...prev, 
                  elapsed: retryOffset,
                  offset: retryOffset,
                  startTime: audioCtxRef.current ? audioCtxRef.current.currentTime : 0
                };
             }
          }
          return { 
            ...prev, 
            elapsed: next,
            offset: next,
            startTime: audioCtxRef.current ? audioCtxRef.current.currentTime : 0,
            pitchHistory: [...prev.pitchHistory.slice(-99), prev.pitch]
          };
        });
        setJogAngles(prev => ({ ...prev, A: prev.A + dt * (deckA.bpm / 60) * 2 * Math.PI * 0.25 }));
      }

      if (deckB.playing && !isScratchingRef.current.B && Math.abs(scratchVelocityRef.current.B) <= 0.05) {
        setDeckB(prev => {
          const originalBpm = prev.activeTrack ? (parseInt(prev.activeTrack.bpm) || 160) : 160;
          const rate = (prev.bpm / originalBpm) * (1 + prev.pitchBend / 100);
          const next = Math.min(prev.total, prev.elapsed + dt * rate);
          
          if (prev.looping && prev.loopIn >= 0 && prev.loopOut > prev.loopIn) {
             const curPos = (next / prev.total) * 4000;
             if (curPos >= prev.loopOut) {
                const retryOffset = (prev.loopIn / 4000) * prev.total;
                setTimeout(() => {
                  playDeck('B', retryOffset, 80);
                }, 0);
                return { 
                  ...prev, 
                  elapsed: retryOffset,
                  offset: retryOffset,
                  startTime: audioCtxRef.current ? audioCtxRef.current.currentTime : 0
                };
             }
          }
          return { 
            ...prev, 
            elapsed: next,
            offset: next,
            startTime: audioCtxRef.current ? audioCtxRef.current.currentTime : 0,
            pitchHistory: [...prev.pitchHistory.slice(-99), prev.pitch]
          };
        });
        setJogAngles(prev => ({ ...prev, B: prev.B + dt * (deckB.bpm / 60) * 2 * Math.PI * 0.25 }));
      }

      frameId = requestAnimationFrame(loop);
    };

    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [deckA.playing, deckB.playing, deckA.bpm, deckB.bpm]);

  // Calculate relative phase matching offset between Deck A and Deck B
  const bpmA = deckA.gridBpm || deckA.bpm || 128;
  const beatDurA = 60 / bpmA;
  const elapsedRelA = deckA.elapsed - (deckA.gridOffset || 0);
  const phaseA = beatDurA > 0 ? ((elapsedRelA % beatDurA) + beatDurA) % beatDurA : 0;
  
  const bpmB = deckB.gridBpm || deckB.bpm || 128;
  const beatDurB = 60 / bpmB;
  const elapsedRelB = deckB.elapsed - (deckB.gridOffset || 0);
  const phaseB = beatDurB > 0 ? ((elapsedRelB % beatDurB) + beatDurB) % beatDurB : 0;

  const phasePctA = beatDurA > 0 ? phaseA / beatDurA : 0;
  const phasePctB = beatDurB > 0 ? phaseB / beatDurB : 0;
  
  let phaseDiff = phasePctA - phasePctB;
  if (phaseDiff > 0.5) phaseDiff -= 1;
  if (phaseDiff < -0.5) phaseDiff += 1;

  return (
    <div className="h-screen w-screen flex flex-col font-sans select-none overflow-hidden bg-[#0d0d0d] text-[#bbb]">
      {/* MENU BAR */}
      <div className="h-[21px] bg-gradient-to-b from-[#181a24] to-[#0a0b10] border-b border-[#212435] flex items-center px-1.5 shrink-0 z-50">
        <button 
          onClick={() => { setActivePanel('conf'); setShowBrowser(true); }}
          className={`bg-gradient-to-b border rounded-sm text-[9px] font-bold px-2 py-px flex items-center gap-1 transition-all cursor-pointer ${
            activePanel === 'conf' && showBrowser ? 'from-[#f59e0b] to-[#b45309] border-[#f59e0b] text-black font-extrabold shadow-[0_0_8px_rgba(245,158,11,0.35)]' : 'from-[#2e3146] to-[#171926] border-[#373b54] border-b-[#0e0f17] text-[#c3cadb] hover:text-white hover:brightness-110'
          }`}
        >
          <Settings size={9} /> CONFIG
        </button>
        <div className="vj-logo px-2 py-0.5 text-[9px] font-black tracking-widest mx-2 rounded-sm border-[#eab308]/30 border uppercase select-none">
          BAD N3WS RIDDIM DJ
        </div>
        <div className="flex gap-4">
          <span 
            onClick={() => { setActivePanel('brow'); setShowBrowser(true); }}
            className={`flex items-center gap-1 text-[10px] cursor-pointer px-2 py-0.5 rounded-sm transition-all select-none ${
              activePanel === 'brow' && showBrowser ? 'bg-[#eab308]/20 text-[#eab308] border border-[#eab308]/30 font-bold' : 'text-[#94a3b8] hover:bg-white/5 hover:text-[#eee]'
            }`}
          >
            <Home size={9} /> Home
          </span>
          <span 
            onClick={() => { setActivePanel('help'); setShowBrowser(true); }}
            className={`flex items-center gap-1 text-[10px] cursor-pointer px-2 py-0.5 rounded-sm transition-all select-none ${
              activePanel === 'help' && showBrowser ? 'bg-amber-500/20 text-[#eab308] border border-amber-500/30 font-bold' : 'text-[#94a3b8] hover:bg-white/5 hover:text-[#eee]'
            }`}
          >
            <HelpCircle size={9} /> Help
          </span>
        </div>
      </div>

      {/* HEADER WITH SPECTRUM (edjing style) */}
      <div className="h-9 bg-gradient-to-b from-[#0a0b10] to-[#121319] border-b border-amber-500/15 flex items-center px-3 gap-4 shrink-0 relative overflow-hidden">
        <div className="flex items-center gap-2">
           <Disc className="text-[#eab308] animate-[spin_4s_linear_infinite]" size={18} />
           <h1 className="text-sm font-black tracking-tighter text-white font-display">BAD N3WS <span className="text-[#eab308]">RIDDIM DJ</span> <span className="text-[8.5px] font-mono tracking-[0.25em] text-[#ca8a04] ml-1.5 uppercase">AMBER SERIES</span></h1>
        </div>

        <div className="flex-1 h-full mx-8 flex items-center justify-center gap-px opacity-20">
           {[...Array(32)].map((_, i) => (
             <motion.div 
               key={i}
               style={{ height: `${Math.random() * 80}%` }}
               animate={{ height: [`${Math.random() * 40}%`, `${Math.random() * 90}%`, `${Math.random() * 30}%`] }}
               transition={{ duration: 0.5 + Math.random(), repeat: Infinity, ease: "easeInOut" }}
               className="w-1 bg-gradient-to-t from-[#ca8a04]/40 to-[#eab308]/40 rounded-t-sm"
             />
           ))}
        </div>

        {/* BEATMATCHING ALIGNMENT DISPLAY PANEL */}
        <div className="flex items-center gap-3 px-3 py-1 bg-black/60 border border-white/5 rounded-md h-[26px] z-10 shrink-0 font-mono select-none mr-4">
          {/* Phase Meter Bar */}
          <div className="flex flex-col gap-0.5 items-center">
            <div className="flex items-center gap-1.5 text-[7px] text-[#888] tracking-widest font-bold font-sans">
              <span>PHASE ALIGN</span>
              <span className={Math.abs(phaseDiff) < 0.05 ? "text-[#4c4] font-black animate-pulse" : "text-[#ca8a04]"}>
                {Math.abs(phaseDiff) < 0.05 ? "SYNCED" : `${(phaseDiff * 100).toFixed(1)}%`}
              </span>
            </div>
            <div className="w-24 h-1 bg-[#121215] rounded border border-white/5 relative overflow-hidden flex items-center justify-center">
              <div className="absolute w-px h-full bg-white/20 left-1/2 -translate-x-1/2" />
              <div 
                className={`absolute h-full rounded-xs transition-all duration-75 ${
                  Math.abs(phaseDiff) < 0.05 
                    ? "bg-[#4c4] shadow-[0_0_6px_#4c4]" 
                    : phaseDiff > 0 
                      ? "bg-[#ee2255]" 
                      : "bg-[#00bcff]"
                }`}
                style={{
                  width: `${Math.min(50, Math.abs(phaseDiff) * 100)}%`,
                  left: phaseDiff > 0 ? '50%' : 'auto',
                  right: phaseDiff < 0 ? '50%' : 'auto',
                }}
              />
            </div>
          </div>

          <div className="h-full w-px bg-white/5" />

          {/* Tempo Difference */}
          <div className="flex flex-col items-center justify-center leading-none">
            <span className="text-[7px] text-[#888] font-bold font-sans tracking-widest uppercase">TEMPO DIFF</span>
            <span className={`text-[9.5px] font-black mt-0.5 ${Math.abs(bpmA - bpmB) < 0.01 ? "text-[#4c4]" : "text-[#caac04]"}`}>
              {Math.abs(bpmA - bpmB) < 0.01 ? "0.00%" : `${(((bpmB - bpmA) / bpmA) * 100).toFixed(2)}%`}
            </span>
          </div>

          <div className="h-full w-px bg-white/5" />

          {/* Grid Sync Delta */}
          <div className="flex flex-col items-center justify-center leading-none">
            <span className="text-[7px] text-[#888] font-bold font-sans tracking-widest uppercase">DELTA</span>
            <span className="text-[9.5px] text-[#aaa] font-bold mt-0.5 font-mono">
              {Math.abs(bpmA - bpmB).toFixed(2)} BPM
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
           {currentUser ? (
             <div className="flex items-center gap-2 bg-white/5 border border-white/10 pl-1 pr-2 py-0.5 rounded-full">
               {currentUser.photoURL ? (
                 <img src={currentUser.photoURL} alt="" className="w-5 h-5 rounded-full" />
               ) : (
                 <div className="w-5 h-5 rounded-full bg-[#eab308] flex items-center justify-center text-[10px] text-black font-extrabold">
                  {currentUser.displayName?.[0] || 'U'}
                </div>
              )}
              <span className="text-[10px] font-bold text-[#eee] max-w-[80px] truncate">{currentUser.displayName || 'DJ'}</span>
              <button onClick={logout} className="text-[#666] hover:text-[#f44] transition-colors" title="Logout">
                <LogOut size={10} />
              </button>
            </div>
          ) : (
            <button 
              onClick={loginWithGoogle}
              className="flex items-center gap-1.5 text-[9px] font-bold px-2 py-1 rounded-sm bg-white/5 border border-white/10 text-[#eee] hover:bg-white/10"
            >
              <User size={10} /> LOGIN
            </button>
          )}

          {/* VIEW SELECTOR */}
          <div className="flex bg-[#121319] border border-white/10 rounded-sm h-[22px] overflow-hidden p-[1px] items-center">
            <button 
              onClick={() => setDeckView('both')}
              className={`px-2 h-full rounded-xs text-[8px] font-bold transition-all cursor-pointer ${
                deckView === 'both' 
                  ? 'bg-[#eab308] text-black font-extrabold' 
                  : 'text-[#888] hover:text-white'
              }`}
              title="Show Side-by-Side Decks"
            >
              DUAL
            </button>
            <button 
              onClick={() => setDeckView('A')}
              className={`px-2 h-full rounded-xs text-[8px] font-bold transition-all cursor-pointer ${
                deckView === 'A' 
                  ? 'bg-[#4af] text-black font-extrabold' 
                  : 'text-[#888] hover:text-white'
              }`}
              title="Focus on Deck A"
            >
              DECK A
            </button>
            <button 
              onClick={() => setDeckView('B')}
              className={`px-2 h-full rounded-xs text-[8px] font-bold transition-all cursor-pointer ${
                deckView === 'B' 
                  ? 'bg-[#ef4444] text-white font-extrabold' 
                  : 'text-[#888] hover:text-white'
              }`}
              title="Focus on Deck B"
            >
              DECK B
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={() => setShowBrowser(!showBrowser)}
              className={`flex items-center gap-1.5 text-[9px] font-bold px-2 py-1 rounded-sm border transition-all cursor-pointer ${
                !showBrowser ? 'bg-[#eab308] border-[#eab308] text-black shadow-[0_0_8px_rgba(234,179,8,0.3)]' : 'bg-white/5 border-white/10 text-[#eee] hover:bg-white/10'
              }`}
            >
              <Layout size={9} /> {showBrowser ? 'HIDE BROWSER' : 'SHOW BROWSER'}
            </button>
          </div>

          <button 
            onClick={isRecording ? stopRecording : startRecording}
            className={`flex items-center gap-1.5 text-[9px] font-bold px-2.5 py-1 rounded-sm border transition-all cursor-pointer ${
              isRecording 
                ? 'bg-red-950/80 border-red-500 text-red-400 font-extrabold shadow-[0_0_8px_rgba(239,68,68,0.5)] animate-pulse' 
                : 'bg-white/5 border-white/10 text-[#eee] hover:bg-white/10'
            }`}
          >
            <div className={`w-1.5 h-1.5 rounded-full ${isRecording ? 'bg-red-500 shadow-[0_0_5px_#ef4444]' : 'bg-red-500'}`} />
            {isRecording ? `STOP REC [${recordDuration ? fmtTime(recordDuration) : '00:00.0'}]` : 'RECORD MIX'}
          </button>
          
          <div className="flex items-center gap-2 bg-black/40 border border-white/10 px-3 py-1 rounded-full shadow-inner">
             <div className={`w-1.5 h-1.5 rounded-full ${masterTempoLock ? 'bg-[#ffcc00] shadow-[0_0_8px_#ffcc00]' : 'bg-[#4af]'} animate-pulse`} />
             <span className="text-[10px] font-mono font-bold text-[#4af] mr-0.5">MASTER BPM:</span>
             <div className="flex items-center gap-1">
               <button 
                 onClick={() => setMasterBpm(p => Math.max(40, Math.round((p - 0.5) * 10) / 10))}
                 onDoubleClick={() => setMasterBpm(160)}
                 title="Slow Down Master Tempo (Double-click to reset to 160)"
                 className="w-3.5 h-3.5 bg-[#191920] active:bg-[#333] border border-white/10 hover:border-white/20 text-[#888] hover:text-white rounded flex items-center justify-center text-[7px] font-black cursor-pointer select-none active:scale-95"
               >
                 -
               </button>
               <input
                 type="text"
                 value={masterBpm.toFixed(1)}
                 onChange={(e) => {
                   const val = parseFloat(e.target.value);
                   if (!isNaN(val) && val > 20 && val < 300) {
                     setMasterBpm(val);
                   }
                 }}
                 title="Drag or enter tempo manually"
                 className="w-10 bg-transparent text-center font-mono font-black text-[10px] text-white tracking-widest outline-none border border-transparent hover:border-white/5 focus:border-[#4af]/30 focus:bg-black/40 rounded py-0.5"
               />
               <button 
                 onClick={() => setMasterBpm(p => Math.min(280, Math.round((p + 0.5) * 10) / 10))}
                 onDoubleClick={() => setMasterBpm(160)}
                 title="Speed Up Master Tempo (Double-click to reset to 160)"
                 className="w-3.5 h-3.5 bg-[#191920] active:bg-[#333] border border-white/10 hover:border-white/20 text-[#888] hover:text-white rounded flex items-center justify-center text-[7px] font-black cursor-pointer select-none active:scale-95"
               >
                 +
               </button>
             </div>
             <button 
                onClick={() => setMasterTempoLock(!masterTempoLock)}
                className={`ml-2 px-1.5 py-0.5 rounded-sm border text-[8px] font-bold transition-all ${
                  masterTempoLock ? 'bg-[#ffcc00] border-[#ffcc00] text-[#102]' : 'bg-[#1a1a1a] border-white/10 text-[#666]'
                }`}
             >MT LOCK</button>
          </div>

          <div className="text-[13px] font-bold text-[#eee] font-mono tracking-widest min-w-[70px]">
            {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
          </div>

          <div className="flex gap-1 border-l border-white/10 pl-4 ml-2">
            {!sessionId ? (
              <button onClick={createSession} className="text-[7px] font-bold text-[#888] bg-white/5 border border-white/10 px-2 py-1 rounded-sm hover:bg-white/10 flex items-center gap-1 transition-all">
                <Users size={8} /> COLLAB
              </button>
            ) : (
              <div className="flex items-center gap-1.5 bg-[#1a3a1a] px-2 py-1 rounded-sm border border-[#2a6a2a] text-[#4c4] text-[7px] font-bold font-mono">
                ROOM: {sessionId}
              </div>
            )}
            <button 
              onClick={fetchSuggestions}
              disabled={isSuggesting}
              className={`flex items-center gap-1 text-[7px] font-bold px-2 py-1 rounded-sm border transition-all ${
                isSuggesting 
                  ? 'bg-[#333] border-white/5 text-white/30' 
                  : 'bg-linear-to-b from-[#331144] to-[#110022] border-[#a8f]/30 text-[#a8f] hover:brightness-125'
              }`}
            >
              <Sparkles size={8} className={isSuggesting ? 'animate-spin' : ''} /> 
              {isSuggesting ? 'AI...' : 'SUGGEST'}
            </button>
          </div>
        </div>
      </div>

      {/* DECKS AREA */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* DECK A */}
        {(deckView === 'both' || deckView === 'A') && (
          <div 
            className={`flex-1 flex transition-all relative ${
              dragOverDeckA 
                ? 'ring-4 ring-[#4af] shadow-[0_0_25px_rgba(75,195,255,0.6)] brightness-110 border-2 border-dashed border-[#44aaff] z-10' 
                : ''
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverDeckA(true);
            }}
            onDragLeave={() => setDragOverDeckA(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverDeckA(false);
              try {
                const raw = e.dataTransfer.getData('application/json');
                if (raw) {
                  const track = JSON.parse(raw);
                  loadDummyTrack('A', track);
                }
              } catch (err) {
                console.error("Error dropping on deck A:", err);
              }
            }}
          >
            {dragOverDeckA && (
              <div className="absolute inset-0 bg-[#4af]/10 backdrop-blur-xs flex flex-col items-center justify-center z-50 pointer-events-none">
                <Plus size={36} className="text-[#4af] animate-bounce" />
                <div className="text-[#4af] font-black text-[12px] tracking-widest mt-2 bg-[#000]/80 px-3 py-1 rounded">DROP TO LOAD ON DECK A</div>
              </div>
            )}
            {
              (() => {
                const masterTimeSec = audioCtxRef.current ? audioCtxRef.current.currentTime : 0;
                const masterBeatDur = 60 / masterBpm;
                const masterPhasePct = masterBeatDur > 0 ? (masterTimeSec % masterBeatDur) / masterBeatDur : 0;
                return (
                  <Deck 
                    id="A" 
                    state={deckA} 
                    angle={jogAngles.A} 
                    zoom={zoomA}
                    onZoomChange={(z) => {
                      setZoomA(z);
                      if (currentUser && deckA.activeTrack) {
                        saveUserProfile(currentUser.uid, {
                          trackZooms: { [deckA.activeTrack.id]: z }
                        });
                      }
                    }}
                    analyser={analyserARef.current || undefined}
                    visMode={visMode}
                    onToggle={() => handlePlayToggle('A')} 
                    onSeek={(pos) => handleSeek('A', pos)}
                    onScratch={(delta, isDragging) => handleScratch('A', delta, isDragging)}
                    onSync={() => handleSync('A')}
                    onKeySync={() => handleKeySync('A')}
                    onHotCue={(idx) => handleHotCue('A', idx)}
                    onClearHotCue={(idx) => clearHotCue('A', idx)}
                    onFxToggle={() => toggleFx('A')}
                    onFxType={(t) => handleFxType('A', t as any)}
                    onFxParamChange={(paramIndex, val) => handleFxParamChange('A', paramIndex, val)}
                    onLoop={(act, val) => handleLoop('A', act as any, val)}
                    onKeyLock={() => setDeckA(prev => ({ ...prev, keyLock: !prev.keyLock }))}
                    onPreCue={() => setDeckA(prev => ({ ...prev, preCue: !prev.preCue }))}
                    onLoad={(file) => loadFile('A', file)}
                    onPitchBend={(dir) => handlePitchBend('A', dir)}
                    onEqCrossover={(band, freq) => updateEqCrossover('A', band, freq)}
                    onUpdateDeck={handleUpdateDeck}
                    onFilterChange={(v) => handleFilterChange('A', v)}
                    phaseOffset={phaseDiff}
                    masterPhase={masterPhasePct}
                    deckPhase={phasePctA}
                    masterBpm={masterBpm}
                    showBrowser={showBrowser}
                  />
                );
              })()
            }
          </div>
        )}
        
        {/* MIXER */}
        {deckView === 'both' && (
          <Mixer 
            analyserA={analyserARef.current || undefined}
            analyserB={analyserBRef.current || undefined}
            crossfaderPos={crossfaderPos} 
            onCrossfadeChange={(val) => {
              setCrossfaderPos(val);
            }}
            masterFx={masterFx}
            onMasterFxChange={(v) => {
              setMasterFx(v);
              if (masterGainRef.current) {
                 masterGainRef.current.gain.setTargetAtTime((v / 100) * 1.5, audioCtxRef.current!.currentTime, 0.1);
              }
            }}
            onEqKill={toggleEqKill}
            onAutomix={performAutomix}
            masterEq={masterEq}
            onMasterEqChange={updateMasterEq}
            onEqCrossoverChange={updateEqCrossover}
            crossfaderCurve={crossfaderCurve}
            onCurveChange={setCrossfaderCurve}
            deckA={deckA}
            deckB={deckB}
            masterTempoLock={masterTempoLock}
            onMasterTempoToggle={() => setMasterTempoLock(!masterTempoLock)}
            onGainChange={(id, val) => {
              const setDeck = id === 'A' ? setDeckA : setDeckB;
              setDeck(prev => ({ ...prev, gain: val }));
            }}
            onEqChange={handleEqChange}
            onFilterChange={handleFilterChange}
            showBrowser={showBrowser}
          />
        )}
 
        {/* DECK B */}
        {(deckView === 'both' || deckView === 'B') && (
          <div 
            className={`flex-1 flex transition-all relative ${
              dragOverDeckB 
                ? 'ring-4 ring-red-500 shadow-[0_0_25px_rgba(239,68,68,0.6)] brightness-110 border-2 border-dashed border-red-500 z-10' 
                : ''
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverDeckB(true);
            }}
            onDragLeave={() => setDragOverDeckB(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverDeckB(false);
              try {
                const raw = e.dataTransfer.getData('application/json');
                if (raw) {
                  const track = JSON.parse(raw);
                  loadDummyTrack('B', track);
                }
              } catch (err) {
                console.error("Error dropping on deck B:", err);
              }
            }}
          >
            {dragOverDeckB && (
              <div className="absolute inset-0 bg-red-400/10 backdrop-blur-xs flex flex-col items-center justify-center z-50 pointer-events-none">
                <Plus size={36} className="text-red-500 animate-bounce" />
                <div className="text-red-500 font-black text-[12px] tracking-widest mt-2 bg-[#000]/80 px-3 py-1 rounded">DROP TO LOAD ON DECK B</div>
              </div>
            )}
            {
              (() => {
                const masterTimeSec = audioCtxRef.current ? audioCtxRef.current.currentTime : 0;
                const masterBeatDur = 60 / masterBpm;
                const masterPhasePct = masterBeatDur > 0 ? (masterTimeSec % masterBeatDur) / masterBeatDur : 0;
                return (
                  <Deck 
                    id="B" 
                    state={deckB} 
                    angle={jogAngles.B} 
                    zoom={zoomB}
                    onZoomChange={(z) => {
                      setZoomB(z);
                      if (currentUser && deckB.activeTrack) {
                        saveUserProfile(currentUser.uid, {
                          trackZooms: { [deckB.activeTrack.id]: z }
                        });
                      }
                    }}
                    analyser={analyserBRef.current || undefined}
                    visMode={visMode}
                    onToggle={() => handlePlayToggle('B')} 
                    onSeek={(pos) => handleSeek('B', pos)}
                    onScratch={(delta, isDragging) => handleScratch('B', delta, isDragging)}
                    onSync={() => handleSync('B')}
                    onKeySync={() => handleKeySync('B')}
                    onHotCue={(idx) => handleHotCue('B', idx)}
                    onClearHotCue={(idx) => clearHotCue('B', idx)}
                    onFxToggle={() => toggleFx('B')}
                    onFxType={(t) => handleFxType('B', t as any)}
                    onFxParamChange={(paramIndex, val) => handleFxParamChange('B', paramIndex, val)}
                    onLoop={(act, val) => handleLoop('B', act as any, val)}
                    onKeyLock={() => setDeckB(prev => ({ ...prev, keyLock: !prev.keyLock }))}
                    onPreCue={() => setDeckB(prev => ({ ...prev, preCue: !prev.preCue }))}
                    onLoad={(file) => loadFile('B', file)}
                    onPitchBend={(dir) => handlePitchBend('B', dir)}
                    onEqCrossover={(band, freq) => updateEqCrossover('B', band, freq)}
                    onUpdateDeck={handleUpdateDeck}
                    onFilterChange={(v) => handleFilterChange('B', v)}
                    phaseOffset={-phaseDiff}
                    masterPhase={masterPhasePct}
                    deckPhase={phasePctB}
                    masterBpm={masterBpm}
                    showBrowser={showBrowser}
                  />
                );
              })()
            }
          </div>
        )}
      </div>

      {/* BOTTOM SECTIONS */}
      {showBrowser && (
        <>
          {/* BOTTOM TABS */}
          <div className="h-[22px] bg-linear-to-b from-[#252525] to-[#1a1a1a] border-t-2 border-[#333] border-b border-[#2a2a2a] flex items-center px-1.5 gap-1 shrink-0 z-20 w-full select-none">
            <Tab on={activePanel === 'brow'} onClick={() => setActivePanel('brow')}>BROWSER</Tab>
            <Tab on={activePanel === 'samp'} onClick={() => setActivePanel('samp')}>SAMPLER</Tab>
            <Tab on={activePanel === 'fx'} onClick={() => setActivePanel('fx')}>EFFECTS</Tab>
            <Tab on={activePanel === 'rec'} onClick={() => setActivePanel('rec')}>RECORD</Tab>
          </div>

          {/* PANELS */}
          <div className="h-[145px] relative overflow-hidden bg-[#0a0b0e] border-t border-white/5 shrink-0 z-20 w-full shadow-2xl">
            <AnimatePresence mode="wait">
              {activePanel === 'ai' && (
                <motion.div 
                  key="ai"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 p-3 flex flex-col bg-gradient-to-b from-[#12131a] to-[#06070a]"
                >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-[#eab308] font-bold text-[10px] uppercase tracking-widest animate-pulse">
                  <Sparkles size={12} className="text-[#eab308]" /> AI MIX RECOMMENDATIONS
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setVisMode('bars')} className={`text-[8px] px-2 py-0.5 rounded-sm border cursor-pointer ${visMode === 'bars' ? 'bg-[#eab308] text-black font-extrabold border-[#eab308]' : 'border-white/10 text-[#666]'}`}>BARS</button>
                  <button onClick={() => setVisMode('wave')} className={`text-[8px] px-2 py-0.5 rounded-sm border cursor-pointer ${visMode === 'wave' ? 'bg-[#eab308] text-black font-extrabold border-[#eab308]' : 'border-white/10 text-[#666]'}`}>WAVE</button>
                  <button onClick={() => setVisMode('particles')} className={`text-[8px] px-2 py-0.5 rounded-sm border cursor-pointer ${visMode === 'particles' ? 'bg-[#eab308] text-black font-extrabold border-[#eab308]' : 'border-white/10 text-[#666]'}`}>PULSE</button>
                </div>
              </div>
              <div className="flex-1 flex gap-3 overflow-x-auto pb-1 custom-scrollbar">
                {suggestions.map((s, i) => (
                  <div key={i} className="min-w-[180px] bg-white/5 border border-white/10 rounded-md p-2 flex flex-col gap-1.5 hover:border-[#eab308]/50 transition-all group">
                    <div className="flex justify-between items-start">
                      <div className="font-bold text-[10px] text-[#eee] truncate w-full">{s.title}</div>
                    </div>
                    <div className="text-[8px] text-[#eab308] uppercase font-display font-medium">{s.artist}</div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-mono text-[#10b981]">{s.bpm} BPM</span>
                      <div className="h-px flex-1 bg-white/10" />
                    </div>
                    <div className="text-[7.5px] text-[#8892b0] italic leading-tight bg-black/30 p-1.5 rounded-sm border border-white/5 group-hover:text-white transition-colors">
                      "{s.mixingTip}"
                    </div>
                    <div className="mt-auto flex gap-1 pt-1 border-t border-white/5">
                      <button 
                        onClick={() => loadDummyTrack('A', {
                          id: 'ai_' + Math.random().toString(36).substring(2, 7),
                          title: s.title,
                          artist: s.artist,
                          bpm: String(s.bpm),
                          key: 'Am',
                          dur: '04:15',
                          n: i + 1
                        })}
                        className="flex-1 bg-blue-950/40 border border-blue-500/30 text-blue-400 text-[7.5px] font-bold py-1 rounded-sm hover:brightness-125 hover:bg-blue-900/60 transition-all cursor-pointer"
                      >
                        LOAD A
                      </button>
                      <button 
                        onClick={() => loadDummyTrack('B', {
                          id: 'ai_' + Math.random().toString(36).substring(2, 7),
                          title: s.title,
                          artist: s.artist,
                          bpm: String(s.bpm),
                          key: 'Am',
                          dur: '04:15',
                          n: i + 1
                        })}
                        className="flex-1 bg-red-950/40 border border-red-500/30 text-red-400 text-[7.5px] font-bold py-1 rounded-sm hover:brightness-125 hover:bg-red-900/60 transition-all cursor-pointer"
                      >
                        LOAD B
                      </button>
                    </div>
                  </div>
                ))}
                {suggestions.length === 0 && !isSuggesting && (
                  <div className="flex-1 flex flex-col items-center justify-center text-[#444] gap-2">
                    <Sparkles size={24} className="opacity-20" />
                    <div className="text-[9px] uppercase tracking-tighter">Click AI SUGGEST to analyze current mix</div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
          {activePanel === 'conf' && (
             <motion.div 
               key="conf"
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               className="absolute inset-0 p-3 bg-[#0a0a0a]/95 backdrop-blur-md flex flex-col z-30"
             >
               <div className="flex items-center justify-between border-b border-white/10 pb-1.5 mb-2.5 shrink-0">
                 <div className="flex items-center gap-1.5">
                   <Settings size={12} className="text-[#a8f]" />
                   <span className="text-[10px] font-black text-[#a8f] uppercase tracking-wider">Preferences & MIDI Settings</span>
                 </div>
                 <button 
                   onClick={() => setActivePanel('brow')}
                   className="text-[9.5px] font-bold text-[#888] hover:text-white hover:bg-white/5 border border-white/15 px-2.5 py-0.5 rounded-sm uppercase transition-all cursor-pointer active:scale-95"
                 >
                   CLOSE SETTINGS
                 </button>
               </div>
               
               <div className="flex-1 grid grid-cols-3 gap-4 min-h-0 min-w-0 pb-1">
                 <div className="flex flex-col gap-2.5 overflow-y-auto custom-scrollbar pr-1">
                 <h3 className="text-[10px] font-bold text-[#a8f] border-b border-[#a8f]/20 pb-1">PERFORMANCE</h3>
                 <div className="flex items-center justify-between">
                   <span className="text-[9px]">Deck A Vinyl</span>
                   <button 
                    onClick={() => toggleDeckSetting('A', 'vinylMode')}
                    className={`w-8 h-4 rounded-full relative transition-colors ${deckA.vinylMode ? 'bg-[#3c3]' : 'bg-[#444]'}`}
                   >
                     <motion.div animate={{ x: deckA.vinylMode ? 16 : 0 }} className="absolute left-1 top-1 w-2 h-2 bg-white rounded-full"/>
                   </button>
                 </div>
                 <div className="flex items-center justify-between">
                   <span className="text-[9px]">Deck A Quantize</span>
                   <button 
                    onClick={() => toggleDeckSetting('A', 'quantize')}
                    className={`w-8 h-4 rounded-full relative transition-colors ${deckA.quantize ? 'bg-[#3c3]' : 'bg-[#444]'}`}
                   >
                     <motion.div animate={{ x: deckA.quantize ? 16 : 0 }} className="absolute left-1 top-1 w-2 h-2 bg-white rounded-full"/>
                   </button>
                 </div>
                 <div className="h-px bg-white/5 my-1" />
                 <div className="flex items-center justify-between">
                   <span className="text-[9px]">Deck B Vinyl</span>
                   <button 
                    onClick={() => toggleDeckSetting('B', 'vinylMode')}
                    className={`w-8 h-4 rounded-full relative transition-colors ${deckB.vinylMode ? 'bg-[#3c3]' : 'bg-[#444]'}`}
                   >
                     <motion.div animate={{ x: deckB.vinylMode ? 16 : 0 }} className="absolute left-1 top-1 w-2 h-2 bg-white rounded-full"/>
                   </button>
                 </div>
                 <div className="flex items-center justify-between">
                   <span className="text-[9px]">Auto-Gain</span>
                   <button className="w-8 h-4 bg-[#3c3] rounded-full relative"><div className="absolute right-1 top-1 w-2 h-2 bg-white rounded-full"/></button>
                 </div>
                 <div className="flex items-center justify-between">
                   <span className="text-[9px]">Eco Mode</span>
                   <button className="w-8 h-4 bg-[#444] rounded-full relative"><div className="absolute left-1 top-1 w-2 h-2 bg-white rounded-full"/></button>
                 </div>
               </div>
               <div className="flex flex-col gap-2.5 overflow-y-auto custom-scrollbar pr-1">
                 <h3 className="text-[10px] font-bold text-[#4af] border-b border-[#4af]/20 pb-1">AUDIO ENGINE</h3>
                 <div className="flex flex-col gap-1">
                   <span className="text-[8px] text-[#666]">Buffer Size (ms)</span>
                   <select className="bg-black border border-[#333] text-[9px] p-1 rounded" defaultValue="5.0 ms (Optimal)">
                     <option>2.5 ms (Ultra Low)</option>
                     <option>5.0 ms (Optimal)</option>
                     <option>10.0 ms (Safe)</option>
                   </select>
                 </div>
                 <div className="flex flex-col gap-1">
                   <span className="text-[8px] text-[#666]">Sample Rate</span>
                   <select className="bg-black border border-[#333] text-[9px] p-1 rounded" defaultValue="48000 Hz">
                     <option>44100 Hz</option>
                     <option>48000 Hz</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1 mt-1 p-2 bg-[#111] rounded border border-white/5 shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)]">
                    <div className="flex items-center justify-between text-[8px] text-[#888]">
                      <span className="font-bold text-white uppercase tracking-wider">LIMITER THRESHOLD</span>
                      <span className="font-mono text-[#a8f] px-1 py-0.2 bg-[#161616] rounded border border-[#a8f]/10 shadow-sm">{limiterThreshold.toFixed(1)} dB</span>
                    </div>
                    <input 
                      type="range"
                      min="-12.0"
                      max="0.0"
                      step="0.5"
                      value={limiterThreshold}
                      onChange={(e) => setLimiterThreshold(parseFloat(e.target.value))}
                      className="w-full accent-[#a8f] h-1.5 bg-[#222] rounded-lg appearance-none cursor-pointer my-1 text-[#a8f]"
                    />
                    <span className="text-[7px] text-[#555] leading-normal font-mono uppercase">
                      Sets the ceiling of the master hard limiter. Lower threshold increases performance loudness and prevents clipping.
                    </span>
                 </div>
               </div>
               <div className="flex flex-col gap-2.5 overflow-y-auto custom-scrollbar pr-1">
                 <h3 className="text-[10px] font-bold text-[#4c4] border-b border-[#4c4]/20 pb-1 flex items-center justify-between shrink-0">
                    <span className="flex items-center gap-1.5">
                      <button 
                        onClick={() => setMappingTab('midi')}
                        className={`hover:text-[#4c4] transition-all cursor-pointer ${mappingTab === 'midi' ? 'text-[#4c4] font-black' : 'text-neutral-500 font-bold'}`}
                      >
                        MIDI
                      </button>
                      <span className="text-neutral-700">/</span>
                      <button 
                        onClick={() => setMappingTab('keyboard')}
                        className={`hover:text-[#a8f] transition-all cursor-pointer ${mappingTab === 'keyboard' ? 'text-[#a8f] font-black' : 'text-neutral-500 font-bold'}`}
                      >
                        KEYBOARD MAPPING
                      </button>
                    </span>
                    <button
                      onClick={() => setMidiMappings({
                        playA: { type: 'note', number: 60 },
                        playB: { type: 'note', number: 62 },
                        gainA: { type: 'cc', number: 7 },
                        gainB: { type: 'cc', number: 8 },
                        crossfader: { type: 'cc', number: 1 },
                      })}
                      className="text-[7.5px] text-[#888] font-mono hover:text-[#4c4] uppercase cursor-pointer"
                    >
                      Reset Defaults
                    </button>
                  </h3>
                  
                  {mappingTab === 'midi' ? (
                    <>
                      <div className="bg-[#111] p-2 rounded border border-white/5 flex flex-col gap-1.5 shrink-0">
                    <div className="flex items-center gap-2 justify-between">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-[#4c4] animate-pulse"/>
                        <span className="text-[9px] font-bold text-white">MIDI ACCESS READY</span>
                      </div>
                      <span className="text-[7px] text-[#666] font-mono font-black">CH: ALL</span>
                    </div>
                    <div className="text-[7.5px] text-[#888] leading-normal font-mono uppercase">
                      Rotate CC knob or press MIDI trigger key.
                    </div>
                  </div>

                  {/* List of assignable controls */}
                  <div className="flex flex-col gap-1.5 min-h-0 pb-2">
                    {Object.entries({
                      playA: { label: 'Play/Pause Deck A', desc: 'Note or CC button' },
                      playB: { label: 'Play/Pause Deck B', desc: 'Note or CC button' },
                      gainA: { label: 'Gain Deck A Fader', desc: 'CC continuous knob' },
                      gainB: { label: 'Gain Deck B Fader', desc: 'CC continuous knob' },
                      crossfader: { label: 'Crossfader Slider', desc: 'CC fader knob' },
                    }).map(([actionKey, info]) => {
                      const map = midiMappings[actionKey];
                      const isLearning = learningAction === actionKey;

                      return (
                        <div key={actionKey} className="bg-[#151515] p-1.5 rounded border border-white/5 flex flex-col gap-1 transition-all hover:bg-[#1a1a1a]">
                          <div className="flex items-center justify-between">
                            <div className="flex flex-col">
                              <span className="text-[8.5px] font-bold text-[#eee]">{info.label}</span>
                              <span className="text-[7px] text-[#555] font-mono leading-none">{info.desc}</span>
                            </div>
                            
                            <button
                              onClick={() => setLearningAction(isLearning ? null : actionKey)}
                              className={`text-[8px] font-bold px-1.5 py-0.5 rounded transition-all uppercase cursor-pointer ${
                                isLearning
                                  ? 'bg-amber-500/20 text-amber-400 border border-amber-400/30 animate-pulse'
                                  : 'bg-[#222] text-[#aaa] border border-[#333] hover:border-[#4c4] hover:text-[#4c4]'
                              }`}
                            >
                              {isLearning ? '🟢 MAPPING...' : 'LEARN'}
                            </button>
                          </div>

                          <div className="flex items-center gap-2 justify-between mt-0.5 pt-1 border-t border-white/5 select-none text-[8px]">
                            <div className="flex items-center gap-1">
                              <span className="text-[7px] text-[#555] font-black font-mono">TYPE:</span>
                              <select
                                value={map?.type || 'cc'}
                                onChange={(e) => {
                                  const val = e.target.value as 'cc' | 'note';
                                  setMidiMappings(prev => ({
                                    ...prev,
                                    [actionKey]: { ...prev[actionKey], type: val }
                                  }));
                                }}
                                className="bg-[#111] border border-[#222] text-[8px] text-[#999] py-0.2 px-1 focus:outline-none focus:border-[#4c4] rounded"
                              >
                                <option value="cc">CC (continuous)</option>
                                <option value="note">Note (trigger)</option>
                              </select>
                            </div>

                            <div className="flex items-center gap-1 font-mono">
                              <span className="text-[7px] text-[#555] uppercase font-bold">VAL:</span>
                              <input
                                type="number"
                                min="0"
                                max="127"
                                value={map?.number ?? 0}
                                onChange={(e) => {
                                  const val = Math.max(0, Math.min(127, parseInt(e.target.value) || 0));
                                  setMidiMappings(prev => ({
                                    ...prev,
                                    [actionKey]: { ...prev[actionKey], number: val }
                                  }));
                                }}
                                className="bg-[#111] border border-[#222] text-[8.5px] text-[#aaa] w-9 text-center rounded py-0.2 focus:outline-none focus:border-[#4c4]"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                 <div className="bg-black/40 p-2 rounded border border-white/5 flex flex-col gap-2 hidden">
                   <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#4c4] animate-pulse"/>
                      <span className="text-[9px]">MIDI CONTROLLER DETECTED</span>
                   </div>
                   <button className="text-[8px] bg-white/5 border border-white/10 py-1 rounded hover:bg-white/10 uppercase font-bold">Rescan Bus</button>
                  </div>
                    </>
                  ) : (
                    <div className="flex flex-col gap-1.5 min-h-0 pb-2">
                      <div className="bg-[#111] p-1.5 rounded border border-[#a8f]/10 text-[7.5px] text-[#aaa] font-mono leading-normal uppercase">
                        Click (LEARN), then press any key to map it. ESC or click mapping to clear.
                      </div>
                      {Object.entries({
                        playA: { label: 'Play/Pause Deck A', desc: 'Toggle main playback' },
                        playB: { label: 'Play/Pause Deck B', desc: 'Toggle main playback' },
                        syncA: { label: 'Sync Deck A to Master', desc: 'Lock A to B tempo' },
                        syncB: { label: 'Sync Deck B to Master', desc: 'Lock B to A tempo' },
                        loopA: { label: 'Toggle Loop Deck A', desc: 'Toggle loop' },
                        loopB: { label: 'Toggle Loop Deck B', desc: 'Toggle loop' },
                        filterResetA: { label: 'Reset Filter Deck A', desc: 'Directly center filter knob' },
                        filterResetB: { label: 'Reset Filter Deck B', desc: 'Directly center filter knob' },
                      }).map(([actionKey, info]) => {
                        const code = keyboardMappings[actionKey];
                        const isLearning = learningKeyAction === actionKey;

                        return (
                          <div key={actionKey} className="bg-[#151515] p-1.5 rounded border border-white/5 flex flex-col gap-1 transition-all hover:bg-[#1a1a1a]">
                            <div className="flex items-center justify-between">
                              <div className="flex flex-col">
                                <span className="text-[8.5px] font-bold text-[#eee]">{info.label}</span>
                                <span className="text-[7px] text-[#555] font-mono leading-none">{info.desc}</span>
                              </div>
                              
                              <button
                                onClick={() => setLearningKeyAction(isLearning ? null : actionKey)}
                                className={`text-[8px] font-bold px-1.5 py-0.5 rounded transition-all uppercase cursor-pointer ${
                                  isLearning
                                    ? 'bg-purple-500/20 text-[#a8f] border border-purple-400/30 animate-pulse font-black'
                                    : 'bg-[#222] text-[#aaa] border border-[#333] hover:border-[#a8f] hover:text-[#a8f]'
                                }`}
                              >
                                {isLearning ? '🟢 KEY/ESC...' : 'LEARN'}
                              </button>
                            </div>

                            <div className="flex items-center gap-2 justify-between mt-0.5 pt-1 border-t border-[#a8f]/5 select-none text-[8px] font-mono">
                              <span className="text-[7px] text-[#444] uppercase font-bold">KEY MAP:</span>
                              <span className="font-extrabold text-[#a8f] uppercase text-[8.5px] bg-black/40 px-1 py-0.2 rounded border border-[#a8f]/10 font-mono">
                                {code || 'NOT MAPPED'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                 </div>
               </div>
             </motion.div>
          )}
          {activePanel === 'help' && (
             <motion.div 
               key="help"
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               className="absolute inset-0 p-3 bg-[#040406]/95 backdrop-blur-md flex flex-col z-30"
             >
               <div className="flex items-center justify-between border-b border-white/10 pb-1.5 mb-2.5 shrink-0">
                 <div className="flex items-center gap-1.5">
                   <HelpCircle size={12} className="text-[#eab308]" />
                   <span className="text-[10px] font-black text-[#eab308] uppercase tracking-wider font-sans">Help & DJ Guide</span>
                 </div>
                 <button 
                   onClick={() => setActivePanel('brow')}
                   className="text-[9.5px] font-bold text-[#888] hover:text-white hover:bg-white/5 border border-white/15 px-2.5 py-0.5 rounded-sm uppercase transition-all cursor-pointer active:scale-95"
                 >
                   CLOSE HELP
                 </button>
               </div>

               <div className="flex-1 grid grid-cols-3 gap-4 min-h-0 min-w-0 pb-1">
                 <div className="flex flex-col gap-2 overflow-y-auto custom-scrollbar pr-1">
                   <h3 className="text-[10px] font-black text-[#eab308] border-b border-[#eab308]/20 pb-1 flex items-center gap-1.5 uppercase font-display select-none">Keyboard Shortcuts</h3>
                   <div className="flex flex-col gap-1.5 font-mono text-[8.5px]">
                     <div className="flex justify-between border-b border-white/5 pb-0.5"><span className="text-[#64748b]">SPACEBAR</span><span className="text-white font-bold text-right">PLAY/PAUSE MASTER</span></div>
                     <div className="flex justify-between border-b border-white/5 pb-0.5"><span className="text-[#64748b]">Q / W</span><span className="text-white font-bold text-right">CUE SPEED A/B</span></div>
                     <div className="flex justify-between border-b border-white/5 pb-0.5"><span className="text-[#64748b]">Z / X / C</span><span className="text-[#00bcff] font-bold text-right">DECK A EQ FILTERS</span></div>
                     <div className="flex justify-between border-b border-white/5 pb-0.5"><span className="text-[#64748b]">B / N / M</span><span className="text-[#ff2255] font-bold text-right">DECK B EQ FILTERS</span></div>
                     <div className="flex justify-between border-b border-white/5 pb-0.5"><span className="text-[#64748b]">1 / 2 / 3 / 4</span><span className="text-[#a8f] font-bold text-right">HOT CUES 1-4 A</span></div>
                     <div className="flex justify-between border-b border-white/5 pb-0.5"><span className="text-[#64748b]">7 / 8 / 9 / 0</span><span className="text-[#a8f] font-bold text-right">HOT CUES 1-4 B</span></div>
                   </div>
                 </div>

                 <div className="flex flex-col gap-2 overflow-y-auto custom-scrollbar pr-1">
                   <h3 className="text-[10px] font-black text-[#00bcff] border-b border-[#00bcff]/20 pb-1 flex items-center gap-1.5 uppercase font-display select-none">Riddim Deck Features</h3>
                   <p className="text-[9px] leading-relaxed text-[#94a3b8]">
                     Built-in high-end DJ performance enhancements to orchestrate perfect riddle drops:
                   </p>
                   <ul className="text-[8.5px] list-disc pl-4 text-[#64748b] flex flex-col gap-1 leading-normal">
                     <li><strong className="text-[#e2e8f0]">Beat-Match Assist</strong>: Golden/Green real-time physical alignment ghost waveforms.</li>
                     <li><strong className="text-[#e2e8f0]">Smart Transition Folders</strong>: Curated key, rhythm, and BPM alignment folders.</li>
                     <li><strong className="text-[#e2e8f0]">Hot Cue Indicators</strong>: Physical markers with snap-to-beat assist guidelines.</li>
                     <li><strong className="text-[#e2e8f0]">Multi-Node Filters</strong>: Responsive low-pass and high-pass sweeps (ZXC / BNM keys).</li>
                   </ul>
                 </div>

                 <div className="flex flex-col gap-2 overflow-y-auto custom-scrollbar pr-1">
                   <h3 className="text-[10px] font-black text-[#10b981] border-b border-[#10b981]/20 pb-1 flex items-center gap-1.5 uppercase font-display select-none">Pro Mixing Guidelines</h3>
                   <p className="text-[9px] text-[#94a3b8] leading-relaxed mb-1">
                     Escalate crowd energy: check candidate track compatibility indicators in sidebar folders, pre-align on key beat snap ok points, then slide the crossfader smoothly.
                   </p>
                   <div className="bg-[#111] p-1.5 rounded border border-white/5 text-[8px] text-[#84cc16] font-mono leading-tight">
                     ⚙️ Note: Connect generic MIDI physical sliders; they are auto-detected by this advanced Web-MIDI interface deck!
                   </div>
                 </div>
               </div>
             </motion.div>
          )}
          {activePanel === 'brow' && (
             <motion.div 
               key="brow"
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               className="absolute inset-0 flex flex-col pt-1"
             >
               <div className="flex items-center gap-1 px-1.5 mb-1">
                 <div className="relative flex-1">
                   <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-white/30" />
                   <input 
                     value={search}
                     onChange={(e) => setSearch(e.target.value)}
                     className="w-full bg-[#0a0a0a] border border-[#333] rounded-sm text-[9px] pl-6 pr-2 h-[18px] focus:border-[#4af] outline-none"
                     placeholder="Search tracks, artists, BPM..."
                   />
                 </div>
                 <div className="flex bg-[#0a0a0a] border border-[#333] rounded-sm h-[18px] overflow-hidden">
                   <button onClick={() => setQueueTab('files')} className={`px-3 text-[7.5px] font-bold ${queueTab === 'files' ? 'text-[#4af] bg-white/5' : 'text-[#666]'}`}>FILES</button>
                   <button onClick={() => setQueueTab('queue')} className={`px-3 text-[7.5px] font-bold relative ${queueTab === 'queue' ? 'text-[#a8f] bg-white/5' : 'text-[#666]'}`}>
                     QUEUE
                     {queue.length > 0 && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-[#a8f] rounded-full animate-pulse shadow-[0_0_5px_#a8f]" />}
                   </button>
                   <button onClick={() => setQueueTab('requests')} className={`px-3 text-[7.5px] font-bold relative ${queueTab === 'requests' ? 'text-[#4c4] bg-white/5' : 'text-[#666]'}`}>
                     REQUESTS
                     {requests.filter(r => r.status === 'pending').length > 0 && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-[#4c4] rounded-full" />}
                   </button>
                 </div>
               </div>

               {queueTab === 'files' ? (
                  <div className="flex-1 flex min-h-0 divide-x divide-[#222]">
                    {/* Left Smart Folders Sidebar */}
                    <div className="w-[145px] bg-[#07080a] flex flex-col p-1.5 gap-1 overflow-y-auto custom-scrollbar select-none text-[8.5px] shrink-0 border-r border-[#222]">
                      <div className="text-[7px] text-[#444] font-black uppercase tracking-widest pl-1 mb-1 border-b border-[#222] pb-0.5">SMART FOLDER SYSTEM</div>
                      
                      {/* LIBRARY BASE */}
                      <button 
                        onClick={() => setSelectedFolderId('all')}
                        className={`w-full text-left p-1 rounded-sm flex items-center justify-between font-bold transition-all cursor-pointer ${
                          selectedFolderId === 'all' 
                            ? 'bg-[#181a24] border border-[#212330] text-white shadow-md' 
                            : 'text-[#6e738a] hover:text-[#bbb] hover:bg-white/3'
                        }`}
                      >
                        <span>📂 All Library</span>
                        <span className="text-[6.5px] font-mono text-[#555] font-black">{libraryTracks.length}</span>
                      </button>

                      {/* LIVE MIX TRANSITIONS */}
                      <div className="text-[7px] text-[#555] font-black uppercase tracking-widest pl-1 mt-2.5 mb-1 border-b border-white/5 pb-0.5">TRANSITION ASSISTANT</div>
                      
                      <button 
                        onClick={() => { if (deckA.activeTrack) setSelectedFolderId('smart_transition_A'); }}
                        disabled={!deckA.activeTrack}
                        className={`w-full text-left p-1 rounded-sm flex items-center justify-between font-bold transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                          selectedFolderId === 'smart_transition_A' 
                            ? 'bg-[#002b3d]/80 border border-[#00bcff]/40 text-[#00bcff]' 
                            : 'text-[#6e738a] hover:text-[#bbb] hover:bg-white/3'
                        }`}
                        title="Tracks with compatible harmonic keys AND BPM within mixable ±12 BPM of loaded Deck A"
                      >
                        <span className="truncate">🔥 Prep Deck A</span>
                        {deckA.activeTrack ? (
                          <span className="text-[6.5px] font-mono px-1 bg-[#00bcff]/15 rounded text-[#00bcff] font-extrabold">
                            {libraryTracks.filter(t => getTrackFolderFilter('smart_transition_A')(t)).length}
                          </span>
                        ) : (
                          <span className="text-[6.5px] text-[#333]">EMPTY</span>
                        )}
                      </button>

                      <button 
                        onClick={() => { if (deckB.activeTrack) setSelectedFolderId('smart_transition_B'); }}
                        disabled={!deckB.activeTrack}
                        className={`w-full text-left p-1 rounded-sm flex items-center justify-between font-bold transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                          selectedFolderId === 'smart_transition_B' 
                            ? 'bg-[#3d0013]/80 border border-[#ff2255]/40 text-[#ff2255]' 
                            : 'text-[#6e738a] hover:text-[#bbb] hover:bg-white/3'
                        }`}
                        title="Tracks with compatible harmonic keys AND BPM within mixable ±12 BPM of loaded Deck B"
                      >
                        <span className="truncate">🔥 Prep Deck B</span>
                        {deckB.activeTrack ? (
                          <span className="text-[6.5px] font-mono px-1 bg-[#ff2255]/15 rounded text-[#ff2255] font-extrabold">
                            {libraryTracks.filter(t => getTrackFolderFilter('smart_transition_B')(t)).length}
                          </span>
                        ) : (
                          <span className="text-[6.5px] text-[#333]">EMPTY</span>
                        )}
                      </button>

                      {/* ENERGY BOOST ELEVATION */}
                      <button 
                        onClick={() => { if (deckA.activeTrack) setSelectedFolderId('smart_energy_A'); }}
                        disabled={!deckA.activeTrack}
                        className={`w-full text-left p-1 rounded-sm flex items-center justify-between font-bold transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                          selectedFolderId === 'smart_energy_A' 
                            ? 'bg-[#2d004d]/80 border border-[#b24dff]/40 text-[#b24dff]' 
                            : 'text-[#6e738a] hover:text-[#bbb] hover:bg-white/3'
                        }`}
                        title="Key is +1 or +2 segments on Camelot wheel relative to Deck A (escalates crowd energy)"
                      >
                        <span className="truncate">📈 Energy Boost A</span>
                        {deckA.activeTrack ? (
                          <span className="text-[6.5px] font-mono px-1 bg-[#b24dff]/15 rounded text-[#b24dff] font-extrabold">
                            {libraryTracks.filter(t => getTrackFolderFilter('smart_energy_A')(t)).length}
                          </span>
                        ) : (
                          <span className="text-[6.5px] text-[#333]">EMPTY</span>
                        )}
                      </button>

                      <button 
                        onClick={() => { if (deckB.activeTrack) setSelectedFolderId('smart_energy_B'); }}
                        disabled={!deckB.activeTrack}
                        className={`w-full text-left p-1 rounded-sm flex items-center justify-between font-bold transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                          selectedFolderId === 'smart_energy_B' 
                            ? 'bg-[#2d004d]/80 border border-[#b24dff]/40 text-[#b24dff]' 
                            : 'text-[#6e738a] hover:text-[#bbb] hover:bg-white/3'
                        }`}
                        title="Key is +1 or +2 segments on Camelot wheel relative to Deck B (escalates crowd energy)"
                      >
                        <span className="truncate">📈 Energy Boost B</span>
                        {deckB.activeTrack ? (
                          <span className="text-[6.5px] font-mono px-1 bg-[#b24dff]/15 rounded text-[#b24dff] font-extrabold">
                            {libraryTracks.filter(t => getTrackFolderFilter('smart_energy_B')(t)).length}
                          </span>
                        ) : (
                          <span className="text-[6.5px] text-[#333]">EMPTY</span>
                        )}
                      </button>

                      {/* BASIC HARMONIC KEY MATCH */}
                      <button 
                        onClick={() => { if (deckA.activeTrack) setSelectedFolderId('harmony_A'); }}
                        disabled={!deckA.activeTrack}
                        className={`w-full text-left p-1 rounded-sm flex items-center justify-between font-bold transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                          selectedFolderId === 'harmony_A' 
                            ? 'bg-[#0a455a]/60 border border-[#00bcff]/40 text-[#00bcff]' 
                            : 'text-[#6e738a] hover:text-[#bbb] hover:bg-white/3'
                        }`}
                        title="All musically matching keys with Deck A, regardless of current track BPM"
                      >
                        <span className="truncate">🔗 Key Match Deck A</span>
                        {deckA.activeTrack && (
                          <span className="text-[6.5px] font-mono px-1 bg-[#00bcff]/15 rounded text-[#00bcff] font-extrabold">
                            {libraryTracks.filter(t => keysAreCompatible(deckA.activeTrack!.key, t.key) && t.id !== deckA.activeTrack!.id).length}
                          </span>
                        )}
                      </button>

                      <button 
                        onClick={() => { if (deckB.activeTrack) setSelectedFolderId('harmony_B'); }}
                        disabled={!deckB.activeTrack}
                        className={`w-full text-left p-1 rounded-sm flex items-center justify-between font-bold transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                          selectedFolderId === 'harmony_B' 
                            ? 'bg-[#501525]/60 border border-[#ff2255]/40 text-[#ff2255]' 
                            : 'text-[#6e738a] hover:text-[#bbb] hover:bg-white/3'
                        }`}
                        title="All musically matching keys with Deck B, regardless of current track BPM"
                      >
                        <span className="truncate">🔗 Key Match Deck B</span>
                        {deckB.activeTrack && (
                          <span className="text-[6.5px] font-mono px-1 bg-[#ff2255]/15 rounded text-[#ff2255] font-extrabold">
                            {libraryTracks.filter(t => keysAreCompatible(deckB.activeTrack!.key, t.key) && t.id !== deckB.activeTrack!.id).length}
                          </span>
                        )}
                      </button>

                      {/* SMART TEMPO GROUPS */}
                      <div className="text-[7px] text-[#555] font-black uppercase tracking-widest pl-1 mt-2.5 mb-1 border-b border-white/5 pb-0.5">SMART TEMPO</div>
                      
                      <button 
                        onClick={() => setSelectedFolderId('bpm_slow')}
                        className={`w-full text-left p-1 rounded-sm flex items-center justify-between font-bold transition-all cursor-pointer ${
                          selectedFolderId === 'bpm_slow' 
                            ? 'bg-[#2b2c3a] text-white border border-white/10' 
                            : 'text-[#6e738a] hover:text-[#bbb] hover:bg-white/3'
                        }`}
                      >
                        <span>☕ Chill (—120 BPM)</span>
                        <span className="text-[6.5px] font-mono font-black text-[#555]">{libraryTracks.filter(t => parseFloat(t.bpm) < 120).length}</span>
                      </button>

                      <button 
                        onClick={() => setSelectedFolderId('bpm_mid')}
                        className={`w-full text-left p-1 rounded-sm flex items-center justify-between font-bold transition-all cursor-pointer ${
                          selectedFolderId === 'bpm_mid' 
                            ? 'bg-[#2b2c3a] text-white border border-white/10' 
                            : 'text-[#6e738a] hover:text-[#bbb] hover:bg-white/3'
                        }`}
                      >
                        <span>🏠 House (120—130)</span>
                        <span className="text-[6.5px] font-mono font-black text-[#555]">{libraryTracks.filter(t => parseFloat(t.bpm) >= 120 && parseFloat(t.bpm) < 130).length}</span>
                      </button>

                      <button 
                        onClick={() => setSelectedFolderId('bpm_fast')}
                        className={`w-full text-left p-1 rounded-sm flex items-center justify-between font-bold transition-all cursor-pointer ${
                          selectedFolderId === 'bpm_fast' 
                            ? 'bg-[#2b2c3a] text-white border border-white/10' 
                            : 'text-[#6e738a] hover:text-[#bbb] hover:bg-white/3'
                        }`}
                      >
                        <span>☄️ Rave (130—145)</span>
                        <span className="text-[6.5px] font-mono font-black text-[#555]">{libraryTracks.filter(t => parseFloat(t.bpm) >= 130 && parseFloat(t.bpm) <= 145).length}</span>
                      </button>

                      <button 
                        onClick={() => setSelectedFolderId('key_minor')}
                        className={`w-full text-left p-1 rounded-sm flex items-center justify-between font-bold transition-all cursor-pointer mt-1 ${
                          selectedFolderId === 'key_minor' 
                            ? 'bg-[#181a24] text-[#aa88ff] border border-[#a8f]/20' 
                            : 'text-[#6e738a] hover:text-[#bbb] hover:bg-white/3'
                        }`}
                      >
                        <span>🎵 Minor Keys (m)</span>
                        <span className="text-[6.5px] font-mono font-black text-[#555]">{libraryTracks.filter(t => t.key.endsWith('m')).length}</span>
                      </button>

                      <button 
                        onClick={() => setSelectedFolderId('key_major')}
                        className={`w-full text-left p-1 rounded-sm flex items-center justify-between font-bold transition-all cursor-pointer ${
                          selectedFolderId === 'key_major' 
                            ? 'bg-[#181a24] text-[#ffcc44] border border-amber-500/20' 
                            : 'text-[#6e738a] hover:text-[#bbb] hover:bg-white/3'
                        }`}
                      >
                        <span>🎵 Major Keys</span>
                        <span className="text-[6.5px] font-mono font-black text-[#555]">{libraryTracks.filter(t => !t.key.endsWith('m')).length}</span>
                      </button>
                    </div>

                    {/* Right side: Filtered Track listing */}
                    <div className="flex-1 flex flex-col min-w-0">
                      <>
                   <div className="flex bg-[#111] border-b border-[#222] text-[7.5px] uppercase tracking-wider text-[#666] py-0.5 px-1.5">
                     <div className="w-7">#</div><div className="flex-[2.5]">Title / Artist</div><div className="flex-1 text-center">BPM</div><div className="flex-1 text-center">Key</div><div className="flex-1 text-right">Dur</div><div className="flex-1 ml-2">Load</div>
                   </div>
                   <div className="flex-1 overflow-y-auto custom-scrollbar">
                      {filteredTracks.map((track, i) => {
                        const bpm = Number(track.bpm);
                        return (
                          <div 
                            key={track.id} 
                            draggable
                            onDragStart={(e) => handleDragStart(e, track)}
                            className="flex px-1.5 py-1 border-b border-[#151515] hover:bg-white/5 active:bg-white/10 cursor-grab text-[9px] group items-center transition-all select-none"
                          >
                          <div className="w-7 text-[#555] font-mono">{i+1}</div>
                          <div className="flex-[2.5] flex flex-col min-w-0">
                            <div className="font-bold text-[#bbb] truncate">{track.title}</div>
                            <div className="text-[7.5px] text-[#888] uppercase font-display truncate mt-0.5">{track.artist || 'VirtualDJ Elite Artist'}</div>
                          </div>
                          <div className="flex-1 text-center font-mono text-[#aaa]">{track.bpm}.0</div>
                          <div className="flex-1 text-center text-[#7ab] font-mono">{track.key}</div>
                          <div className="flex-1 text-right font-mono text-[#888]">{track.dur}</div>
                          <div className="flex-1 flex gap-1 ml-2 justify-end">
                            <button className="bg-[#013]/60 border border-[#38f]/40 text-[#38f] text-[7.5px] font-bold px-1 rounded-sm hover:bg-[#38f] hover:text-white transition-colors" onClick={() => addToQueue(track)}>+Q</button>
                            <button className="bg-[#111] border border-[#444] text-[#888] text-[7.5px] font-bold px-1.5 rounded-sm hover:border-[#4af] hover:text-[#4af] transition-colors" onClick={() => loadDummyTrack('A', track)}>A</button>
                            <button className="bg-[#111] border border-[#444] text-[#888] text-[7.5px] font-bold px-1.5 rounded-sm hover:border-[#f44] hover:text-[#f44] transition-colors" onClick={() => loadDummyTrack('B', track)}>B</button>
                          </div>
                        </div>
                      );
                    })}
                   </div>
                      </>
                    </div>
                  </div>
               ) : queueTab === 'queue' ? (
                 <div className="flex-1 flex flex-col pt-1">
                  (
                    <div 
                      className={`flex-1 flex flex-col pt-1 transition-all ${
                        dragOverQueue 
                          ? 'bg-[#a8f]/10 border-2 border-dashed border-[#a8f]/40' 
                          : ''
                      }`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOverQueue(true);
                      }}
                      onDragLeave={() => setDragOverQueue(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOverQueue(false);
                        try {
                          const raw = e.dataTransfer.getData('application/json');
                          if (raw) {
                            const track = JSON.parse(raw);
                            addToQueue(track);
                          }
                        } catch (err) {
                          console.error("Error drop on queue tab:", err);
                        }
                      }}
                    >
                      {queue.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-[#444] gap-1 opacity-50">
                      <Plus size={20} />
                      <div className="text-[8px] uppercase font-bold">Queue is empty</div>
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                      {queue.map((track, i) => (
                        <div key={track.id} className="flex px-1.5 py-1 border-b border-[#222] bg-black/20 text-[9px] items-center">
                           <div className="w-6 text-[#555]">{i + 1}</div>
                           <div className="flex-1 font-bold text-[#eee] truncate mr-2">{track.title} <span className="text-[7.5px] text-[#666] font-normal uppercase ml-1">BY {track.artist || 'VirtualDJ Elite Artist'}</span></div>
                           <div className="flex gap-1 items-center">
                              <button onClick={() => moveQueueItem(i, 'up')} className="p-0.5 hover:text-[#4af]"><Plus size={10} className="rotate-45" /></button>
                              <button onClick={() => moveQueueItem(i, 'down')} className="p-0.5 hover:text-[#4af]"><Plus size={10} className="-rotate-45" /></button>
                              <button onClick={() => removeFromQueue(track.id)} className="p-0.5 text-[#f44] hover:brightness-125"><Zap size={10} /></button>
                              <div className="h-4 w-px bg-white/10 mx-1" />
                              <button onClick={() => loadDummyTrack('A', track)} className="bg-[#4af] text-white px-2 py-0.5 rounded-sm text-[7px] font-bold">LOAD A</button>
                              <button onClick={() => loadDummyTrack('B', track)} className="bg-[#f44] text-white px-2 py-0.5 rounded-sm text-[7px] font-bold">LOAD B</button>
                           </div>
                        </div>
                      ))}
                    </div>
                  )}
                  </div>
                )
                </div>
               ) : (
                 <div className="flex-1 flex flex-col pt-1">
                   <div className="p-2 border-b border-white/5 bg-black/40">
                     <div className="text-[8px] text-[#4c4] font-bold mb-1 uppercase tracking-widest">Submit Request</div>
                     <form 
                       onSubmit={(e) => {
                         e.preventDefault();
                         const f = e.target as HTMLFormElement;
                         const t = f.elements.namedItem('title') as HTMLInputElement;
                         const a = f.elements.namedItem('artist') as HTMLInputElement;
                         if (t.value && currentUser) {
                           submitSongRequest(t.value, a.value, currentUser.uid);
                           f.reset();
                         }
                       }}
                       className="flex gap-1"
                     >
                       <input name="title" placeholder="Song Title" className="flex-1 bg-black/60 border border-white/10 rounded-sm text-[8px] px-1.5 h-6 outline-none" required />
                       <input name="artist" placeholder="Artist" className="flex-1 bg-black/60 border border-white/10 rounded-sm text-[8px] px-1.5 h-6 outline-none" />
                       <button type="submit" className="bg-[#4c4] text-black text-[8px] font-bold px-2 rounded-sm active:scale-95 transition-transform">SEND</button>
                     </form>
                   </div>
                   <div className="flex-1 overflow-y-auto custom-scrollbar">
                     {requests.map((r, i) => (
                       <div key={r.id} className="flex px-1.5 py-1.5 border-b border-[#222] items-center gap-2 group">
                         <div className="w-1.5 h-1.5 rounded-full bg-[#4c4] shadow-[0_0_5px_#4c4]" />
                         <div className="flex-1">
                           <div className="text-[9px] font-bold text-white uppercase">{r.title}</div>
                           <div className="text-[7px] text-[#666]">{r.artist || 'Unknown Artist'}</div>
                         </div>
                         <div className="text-[7px] text-[#444] font-mono">{r.requestedAt ? new Date(r.requestedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</div>
                         <button 
                           onClick={() => {
                             addToQueue({ id: Math.random().toString(), title: r.title, artist: r.artist, bpm: '140', key: 'Am', dur: '04:20', n: i });
                           }}
                           className="opacity-0 group-hover:opacity-100 bg-[#4af] text-white text-[7px] font-bold px-1 py-0.5 rounded-sm"
                         >ADD TO QUEUE</button>
                       </div>
                     ))}
                   </div>
                 </div>
               )}
             </motion.div>
           )}
            {activePanel === 'samp' && (
              <motion.div 
                key="samp"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="absolute inset-0 p-3 flex bg-[#0c0d12] gap-3 select-none"
              >
                {/* Master Volume / Controls for Sampler */}
                <div className="w-[135px] bg-black/40 border border-white/5 p-2 rounded-md flex flex-col justify-between items-center text-center">
                  <div className="w-full">
                    <span className="text-[7.5px] text-[#888] font-black uppercase tracking-wider font-mono">SAMPLER MASTER</span>
                    <div className="mt-2 flex flex-col items-center">
                      <Knob 
                        size="sm" 
                        value={samplerVolume} 
                        color="#eab308" 
                        min={0} 
                        max={100}
                        onChange={(v) => {
                          setSamplerVolume(v);
                          if (samplerGainNodeRef.current) {
                            samplerGainNodeRef.current.gain.value = v / 100;
                          }
                        }}
                      />
                      <span className="text-[8px] font-mono font-bold text-white mt-1">{Math.round(samplerVolume)}%</span>
                    </div>
                  </div>
                  <div className="text-[6.5px] text-[#555] leading-normal uppercase">
                    Trigger keys: U, I, O, P, H, J, K, L, Y, G, F, D
                  </div>
                </div>

                {/* 12 Pads Grid */}
                <div className="flex-1 grid grid-cols-6 grid-rows-2 gap-1.5 h-full">
                  {Array.from({ length: 12 }).map((_, idx) => {
                    const keys = ['U', 'I', 'O', 'P', 'H', 'J', 'K', 'L', 'Y', 'G', 'F', 'D'];
                    const keyChar = keys[idx] || '';
                    return (
                      <div key={idx} className="relative group/pad h-full">
                        <div className="sampler-pad h-full">
                          <button 
                            onClick={() => handleSamplerTrigger(idx)}
                            className="w-full h-full border border-white/5 bg-linear-to-b from-[#1b1c26] to-[#0f1118] hover:from-[#242636] hover:to-[#141722] rounded-md flex flex-col items-center justify-center gap-1 transition-all relative overflow-hidden active:scale-95 cursor-pointer shadow-[2px_2px_4px_rgba(0,0,0,0.5)] border-b-2 border-b-black/85"
                          >
                            <div className="w-1.5 h-1.5 rounded-full bg-[#eab308]/60 shadow-[0_0_4px_#eab308] group-hover/pad:scale-125 transition-transform" />
                            <div className="text-[8px] font-black tracking-tighter text-white uppercase font-sans truncate px-1 max-w-full">
                              {samplerNames[idx]}
                            </div>
                            <span className="absolute bottom-1 right-2 font-mono text-[7px] font-black text-[#555] group-hover/pad:text-[#eab308] transition-colors">{keyChar}</span>
                          </button>
                        </div>
                        
                        {/* Elegant hover upload trigger */}
                        <label className="absolute top-1 right-1 cursor-pointer opacity-0 group-hover/pad:opacity-100 transition-all duration-150 bg-black/85 hover:bg-black p-1 rounded border border-white/10 hover:border-[#eab308] text-gray-400 hover:text-white flex items-center justify-center shadow-lg" title="Upload custom audio sample">
                          <Upload size={8} />
                          <input 
                            type="file" 
                            accept="audio/*" 
                            className="hidden" 
                            onChange={(e) => handleSamplerUpload(idx, e)} 
                          />
                        </label>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
            {activePanel === 'fx' && (
              <motion.div 
                key="fx"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="absolute inset-0 p-3 flex bg-[#0c0d12] gap-3"
              >
                {/* DECK A FX UNIT */}
                <div className="flex-1 bg-black/30 border border-white/5 rounded-md p-2 flex flex-col gap-1 min-w-[180px]">
                  <div className="flex items-center justify-between border-b border-white/5 pb-0.5 gap-1">
                    <span className="text-[8px] font-black text-[#a8f] uppercase font-mono tracking-widest flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#a8f] shadow-[0_0_4px_#a8f] animate-pulse"/>
                      DECK A FX UNIT
                    </span>
                    <button 
                      onClick={() => toggleFx('A')}
                      className={`text-[7px] font-black px-1.5 py-0.5 rounded-sm border cursor-pointer transition-all ${
                        deckA.fx?.enabled 
                          ? 'bg-[#a8f] text-black border-[#a8f] shadow-[0_0_8px_rgba(170,136,255,0.4)]' 
                          : 'bg-black/40 text-[#666] border-[#444]'
                      }`}
                    >
                      {deckA.fx?.enabled ? 'BYPASS_ON' : 'BYPASS_OFF'}
                    </button>
                  </div>
                  <div className="flex flex-1 gap-2 items-center">
                    <div className="flex flex-col gap-1.5 flex-1">
                      <span className="text-[7px] text-[#666] font-extrabold uppercase font-mono">TYPE</span>
                      <div className="flex flex-col gap-1">
                        {['echo', 'flanger', 'reverb'].map((t) => (
                          <button
                            key={t}
                            onClick={() => handleFxType('A', t as any)}
                            className={`w-full text-left px-2 py-0.5 text-[8px] font-mono uppercase font-black rounded border transition-all cursor-pointer ${
                              deckA.fx?.type === t 
                                ? 'bg-[#a8f]/10 text-[#a8f] border-[#a8f]/30 font-extrabold' 
                                : 'bg-black/20 text-[#555] border-white/5 hover:text-[#999]'
                            }`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-3 items-center justify-center px-1">
                      <div className="flex flex-col items-center">
                        <Knob 
                          size="xs" 
                          value={deckA.fx?.val1 ?? 50} 
                          color="#a8f" 
                          min={0} 
                          max={100}
                          onChange={(v) => handleFxParamChange('A', 1, v)}
                        />
                        <span className="text-[5.5px] font-black text-[#555] uppercase font-mono leading-none mt-1">
                          {deckA.fx?.type === 'echo' ? 'TIME' : deckA.fx?.type === 'flanger' ? 'RATE' : 'SIZE'}
                        </span>
                        <span className="text-[7px] font-mono text-[#aaa] mt-0.5">{Math.round(deckA.fx?.val1 ?? 50)}</span>
                      </div>
                      <div className="flex flex-col items-center">
                        <Knob 
                          size="xs" 
                          color="#a8f" 
                          value={deckA.fx?.val2 ?? 50}
                          min={0} 
                          max={100}
                          onChange={(v) => handleFxParamChange('A', 2, v)}
                        />
                        <span className="text-[5.5px] font-black text-[#555] uppercase font-mono leading-none mt-1">
                          {deckA.fx?.type === 'echo' ? 'FDBK' : deckA.fx?.type === 'flanger' ? 'DPTH' : 'MIX'}
                        </span>
                        <span className="text-[7px] font-mono text-[#aaa] mt-0.5">{Math.round(deckA.fx?.val2 ?? 50)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* CENTRAL XY CONTROLLER PAD */}
                <div className="w-[180px] bg-black/40 border border-white/5 rounded-md p-2 flex flex-col gap-1 shrink-0 relative">
                  <div className="flex items-center justify-between border-b border-white/5 pb-1">
                    <span className="text-[7.5px] font-black text-white/50 uppercase font-mono tracking-wider">COLLAB XY PAD</span>
                    <div className="flex gap-1.5 pb-0.5">
                      <button 
                        onClick={() => setXyActiveDeck(xyActiveDeck === 'A' ? 'B' : 'A')}
                        className="text-[7.5px] font-mono font-black border border-[#a8f]/30 text-[#a8f] px-1 py-0.2 rounded hover:bg-[#a8f]/10 cursor-pointer uppercase"
                      >
                        DECK {xyActiveDeck}
                      </button>
                      <button 
                        onClick={() => setXyLocked(!xyLocked)}
                        className={`text-[7.5px] font-mono font-black border px-1 py-0.2 rounded cursor-pointer uppercase ${
                          xyLocked ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : 'border-white/10 text-[#666]'
                        }`}
                      >
                        {xyLocked ? 'LOCKED' : 'LATCH'}
                      </button>
                    </div>
                  </div>
                  
                  {/* XY Surface Area */}
                  <div 
                    ref={xyPadRef}
                    onPointerDown={handleXyPointerDown}
                    onPointerMove={handleXyPointerMove}
                    onPointerUp={handleXyPointerUp}
                    className="flex-1 bg-black/80 rounded border border-white/10 relative overflow-hidden cursor-crosshair shadow-[inset_0_4px_12px_black]"
                  >
                    {/* Grid lines */}
                    <div className="absolute inset-x-0 top-1/2 h-[1px] bg-white/5 pointer-events-none" />
                    <div className="absolute inset-y-0 left-1/2 w-[1px] bg-white/5 pointer-events-none" />
                    <div className="absolute bottom-1 left-1.5 text-[5px] text-[#555] font-mono font-black pointer-events-none uppercase">X: {xyActiveDeck === 'A' ? (deckA.fx?.type === 'echo' ? 'TIME' : deckA.fx?.type === 'flanger' ? 'RATE' : 'SIZE') : (deckB.fx?.type === 'echo' ? 'TIME' : deckB.fx?.type === 'flanger' ? 'RATE' : 'SIZE')}</div>
                    <div className="absolute top-1 right-1.5 text-[5px] text-[#555] font-mono font-black pointer-events-none uppercase">Y: {xyActiveDeck === 'A' ? (deckA.fx?.type === 'echo' ? 'FDBK' : deckA.fx?.type === 'flanger' ? 'DPTH' : 'MIX') : (deckB.fx?.type === 'echo' ? 'FDBK' : deckB.fx?.type === 'flanger' ? 'DPTH' : 'MIX')}</div>

                    {/* Target cursor indicator */}
                    {(() => {
                      const deck = xyActiveDeck === 'A' ? deckA : deckB;
                      const x = deck.fx?.val1 ?? 50;
                      const y = deck.fx?.val2 ?? 50;
                      return (
                        <motion.div 
                          className="absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full border border-white/85 flex items-center justify-center pointer-events-none z-10 shadow-[0_0_8px_#a8f]"
                          animate={{ left: `${x}%`, top: `${100 - y}%` }}
                          transition={{ type: 'spring', stiffness: 450, damping: 25 }}
                          style={{ borderColor: xyActiveDeck === 'A' ? '#a8f' : '#f44' }}
                        >
                          <div className={`w-1.5 h-1.5 rounded-full ${xyActiveDeck === 'A' ? 'bg-[#a8f]' : 'bg-[#f44]'}`} />
                        </motion.div>
                      );
                    })()}
                  </div>
                </div>

                {/* DECK B FX UNIT */}
                <div className="flex-1 bg-black/30 border border-white/5 rounded-md p-2 flex flex-col gap-1 min-w-[180px]">
                  <div className="flex items-center justify-between border-b border-white/5 pb-0.5 gap-1">
                    <span className="text-[8px] font-black text-[#f44] uppercase font-mono tracking-widest flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#f44] shadow-[0_0_4px_#f44] animate-pulse"/>
                      DECK B FX UNIT
                    </span>
                    <button 
                      onClick={() => toggleFx('B')}
                      className={`text-[7px] font-black px-1.5 py-0.5 rounded-sm border cursor-pointer transition-all ${
                        deckB.fx?.enabled 
                          ? 'bg-[#f44] text-white border-[#f44] shadow-[0_0_8px_rgba(244,68,68,0.4)]' 
                          : 'bg-black/40 text-[#666] border-[#444]'
                      }`}
                    >
                      {deckB.fx?.enabled ? 'BYPASS_ON' : 'BYPASS_OFF'}
                    </button>
                  </div>
                  <div className="flex flex-1 gap-2 items-center">
                    <div className="flex flex-col gap-1.5 flex-1">
                      <span className="text-[7px] text-[#666] font-extrabold uppercase font-mono">TYPE</span>
                      <div className="flex flex-col gap-1">
                        {['echo', 'flanger', 'reverb'].map((t) => (
                          <button
                            key={t}
                            onClick={() => handleFxType('B', t as any)}
                            className={`w-full text-left px-2 py-0.5 text-[8px] font-mono uppercase font-black rounded border transition-all cursor-pointer ${
                              deckB.fx?.type === t 
                                ? 'bg-[#f44]/10 text-[#f44] border-[#f44]/30 font-extrabold' 
                                : 'bg-black/20 text-[#555] border-white/5 hover:text-[#999]'
                            }`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-3 items-center justify-center px-1">
                      <div className="flex flex-col items-center">
                        <Knob 
                          size="xs" 
                          value={deckB.fx?.val1 ?? 50} 
                          color="#f44" 
                          min={0} 
                          max={100}
                          onChange={(v) => handleFxParamChange('B', 1, v)}
                        />
                        <span className="text-[5.5px] font-black text-[#555] uppercase font-mono leading-none mt-1">
                          {deckB.fx?.type === 'echo' ? 'TIME' : deckB.fx?.type === 'flanger' ? 'RATE' : 'SIZE'}
                        </span>
                        <span className="text-[7px] font-mono text-[#aaa] mt-0.5">{Math.round(deckB.fx?.val1 ?? 50)}</span>
                      </div>
                      <div className="flex flex-col items-center">
                        <Knob 
                          size="xs" 
                          color="#f44" 
                          value={deckB.fx?.val2 ?? 50}
                          min={0} 
                          max={100}
                          onChange={(v) => handleFxParamChange('B', 2, v)}
                        />
                        <span className="text-[5.5px] font-black text-[#555] uppercase font-mono leading-none mt-1">
                          {deckB.fx?.type === 'echo' ? 'FDBK' : deckB.fx?.type === 'flanger' ? 'DPTH' : 'MIX'}
                        </span>
                        <span className="text-[7px] font-mono text-[#aaa] mt-0.5">{Math.round(deckB.fx?.val2 ?? 50)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
           {activePanel === 'rec' && (
             <motion.div 
               key="rec"
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               exit={{ opacity: 0 }}
               className="absolute inset-0 p-4 flex flex-col items-center justify-center bg-[#111]"
             >
               <div className="flex flex-col items-center gap-4 bg-black/40 p-8 rounded-xl border border-white/5 machinery-panel">
                 <div className="flex items-center gap-3">
                   <div className={`w-3 h-3 rounded-full bg-red-600 ${isRecording ? 'animate-pulse' : 'opacity-40'}`} />
                   <div className="text-[14px] font-bold font-mono tracking-widest text-[#eee]">
                     {recordDuration ? fmtTime(recordDuration) : '00:00.0'}
                   </div>
                 </div>
                 
                 <div className="flex gap-4">
                   {!isRecording ? (
                     <button 
                       onClick={startRecording}
                       className="flex items-center gap-2 bg-[#4c4]/20 border border-[#4c4]/40 text-[#4c4] px-6 py-2 rounded-md font-bold text-[11px] hover:bg-[#4c4]/30 btn-glow-success"
                     >
                       <Zap size={14} /> START RECORDING
                     </button>
                   ) : (
                     <button 
                       onClick={stopRecording}
                       className="flex items-center gap-2 bg-[#f44]/20 border border-[#f44]/40 text-[#f44] px-6 py-2 rounded-md font-bold text-[11px] hover:bg-[#f44]/30 btn-glow-danger"
                     >
                       <Square size={14} /> STOP & SAVE
                     </button>
                   )}
                 </div>
                 
                 <div className="flex items-center gap-2 mt-2">
                   <input 
                     type="checkbox" 
                     id="autodj" 
                     checked={autoDJ.enabled} 
                     onChange={(e) => setAutoDJ(prev => ({ ...prev, enabled: e.target.checked }))}
                     className="w-4 h-4 rounded border-[#333] bg-[#0a0a0a]"
                   />
                   <label htmlFor="autodj" className="text-[10px] font-bold text-[#888] cursor-pointer hover:text-white transition-colors">
                     ENABLE AUTO-DJ MODE
                   </label>
                 </div>
               </div>
               
               <div className="mt-4 text-[9px] text-[#555] uppercase tracking-widest">
                 Recording master output as WAV file
               </div>
             </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  )}
</div>
  );
}

// --- SUB-COMPONENTS ---

function DraggableFader({ value, onChange, label, className = "" }: { value: number, onChange: (val: number) => void, label?: string, className?: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    const update = (ev: MouseEvent) => {
      if (!trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100));
      onChange(Math.round(100 - pct));
    };
    const mu = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', update);
      document.removeEventListener('mouseup', mu);
    };
    document.addEventListener('mousemove', update);
    document.addEventListener('mouseup', mu);
    update(e.nativeEvent);
  };

  return (
    <div className={`flex flex-col items-center select-none ${className}`}>
      {label && (
        <span className="text-[6.5px] font-black text-slate-500 tracking-[0.16em] uppercase mb-1.5 select-none leading-none font-sans">
          {label}
        </span>
      )}
      
      {/* Outer professional hardware-like framing container */}
      <div className="relative w-15 h-24 bg-gradient-to-b from-[#090b10] to-[#040507] border border-[#1e2330]/40 rounded-[4px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.8),0_2px_4px_rgba(0,0,0,0.4)] flex items-center justify-center p-1 group hover:border-[#eab308]/20 transition-all">
        {/* Subtle grid pattern background */}
        <div className="absolute inset-0 opacity-[0.02] pointer-events-none bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:6px_6px]" />
        
        {/* Physical level tick markers flanking the slot */}
        {[...Array(11)].map((_, i) => {
          const dbVal = 10 - i * 3;
          const isMajor = i % 2 === 0;
          const tickColor = i < 2 ? 'bg-red-500/60' : i < 4 ? 'bg-amber-500/50' : 'bg-[#94a3b8]/20';
          return (
            <div key={i} className="absolute left-0 right-0 flex items-center h-px pointer-events-none" style={{ top: `${8 + i * 8.4}%` }}>
              {/* Left tick */}
              <div className={`absolute left-3 h-[1px] transition-all group-hover:opacity-100 ${isMajor ? 'w-1.5' : 'w-1'} ${tickColor}`} />
              {/* Right tick */}
              <div className={`absolute right-3 h-[1px] transition-all group-hover:opacity-100 ${isMajor ? 'w-1.5' : 'w-1'} ${tickColor}`} />
              {/* Scale dB numbers */}
              {isMajor && (
                <span className="absolute right-1 text-[5px] font-mono text-slate-500/80 tracking-tighter scale-[0.8] leading-none select-none font-medium">
                  {dbVal === 10 ? '+6' : dbVal === 4 ? '+3' : dbVal === -2 ? '0' : dbVal === -8 ? '-12' : '-∞'}
                </span>
              )}
            </div>
          );
        })}

        {/* Fader Track & Channel Slot */}
        <div 
          ref={trackRef}
          className="w-[5px] h-20 bg-gradient-to-r from-[#030406] to-[#0d0f14] border border-[#1e2330]/60 rounded-full relative cursor-pointer flex items-center justify-center"
          onMouseDown={handleMouseDown}
        >
          {/* Signal Level Indicator Line behind track */}
          <div 
            className="absolute bottom-0 left-0 right-0 rounded-full bg-gradient-to-t from-[#b45309] via-[#eab308] to-[#fde047] shadow-[0_0_6px_#f59e0b] opacity-80" 
            style={{ height: `${value}%` }}
          />

          {/* Slider Cap */}
          <motion.div 
            className="absolute left-1/2 -translateX-1/2 w-7 h-5 bg-gradient-to-r from-[#11131c] via-[#2b2e3f] to-[#11131c] border border-[#3e4359]/70 rounded-[1.5px] shadow-[0_4px_8px_rgba(0,0,0,0.9),inset_0_1px_1px_rgba(255,255,255,0.08)] cursor-grab active:cursor-grabbing hover:brightness-110 active:brightness-125 z-10 flex flex-col items-center justify-between py-[1.5px] px-[1px]"
            style={{ bottom: `${value}%`, transform: 'translate(-50%, 50%)' }}
            animate={{ boxShadow: isDragging ? '0 0 10px rgba(234,179,8,0.25), 0 4px 8px rgba(0,0,0,0.9)' : '0 4px 8px rgba(0,0,0,0.9)' }}
          >
            {/* Top horizontal tactile grip groove */}
            <div className="flex gap-[1px] w-full justify-center opacity-30">
              <div className="w-[1.5px] h-[1.5px] bg-white rounded-full"></div>
              <div className="w-[1.5px] h-[1.5px] bg-white rounded-full"></div>
              <div className="w-[1.5px] h-[1.5px] bg-white rounded-full"></div>
            </div>

            {/* Glowing amber level center mark line */}
            <div className="w-full h-[1.8px] bg-[#eab308] shadow-[0_0_5px_#f59e0b] rounded-[1px]" />

            {/* Bottom horizontal tactile grip groove */}
            <div className="flex gap-[1px] w-full justify-center opacity-30">
              <div className="w-[1.5px] h-[1.5px] bg-white rounded-full"></div>
              <div className="w-[1.5px] h-[1.5px] bg-white rounded-full"></div>
              <div className="w-[1.5px] h-[1.5px] bg-white rounded-full"></div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function Deck({ id, state, angle, zoom, onZoomChange, onPitchBend, onEqCrossover, analyser, visMode, onToggle, onSeek, onScratch, onSync, onKeySync, onHotCue, onClearHotCue, onFxToggle, onFxType, onFxParamChange, onLoop, onKeyLock, onPreCue, onLoad, onUpdateDeck, onFilterChange, phaseOffset, masterPhase = 0, deckPhase = 0, masterBpm = 160, showBrowser = false }: { 
  id: 'A' | 'B', 
  state: DeckState, 
  angle: number, 
  zoom: number,
  onZoomChange: (z: number) => void,
  onPitchBend: (amt: 1 | -1 | 0) => void,
  onEqCrossover: (band: 'loMid' | 'midHi', freq: number) => void,
  analyser?: AnalyserNode,
  visMode: 'bars' | 'wave' | 'particles',
  onToggle: () => void, 
  onSeek: (pos: number) => void,
  onScratch: (d: number, isDragging?: boolean, friction?: number) => void,
  onSync: () => void,
  onKeySync: () => void,
  onHotCue: (idx: number) => void,
  onClearHotCue: (idx: number) => void,
  onFxToggle: () => void,
  onFxType: (t: string) => void,
  onFxParamChange: (paramIndex: 1 | 2, val: number) => void,
  onLoop: (action: string, val?: number) => void,
  onKeyLock: () => void,
  onPreCue: () => void,
  onLoad: (file: File) => void,
  onUpdateDeck: (id: 'A' | 'B', updates: Partial<DeckState>) => void,
  onFilterChange: (val: number) => void,
  phaseOffset?: number,
  masterPhase?: number,
  deckPhase?: number,
  masterBpm?: number,
  showBrowser?: boolean
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [padMode, setPadMode] = useState<'hotcue' | 'loop'>('hotcue');
  const [padClearMode, setPadClearMode] = useState(false);
  const pitchTrackRef = useRef<HTMLDivElement>(null);

  const handlePitchPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!pitchTrackRef.current) return;
    pitchTrackRef.current.setPointerCapture(e.pointerId);

    const updatePitchFromEvent = (ev: PointerEvent | React.PointerEvent) => {
      if (!pitchTrackRef.current) return;
      const rect = pitchTrackRef.current.getBoundingClientRect();
      const relativeY = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));
      const pct = (relativeY / rect.height) * 100; // 0 for top, 100 for bottom
      const nextPitch = 10 - (pct / 50) * 10;
      
      const original = state.activeTrack ? (parseInt(state.activeTrack.bpm) || 160) : 160;
      const nextBpm = original * (1 + nextPitch / 100);

      onUpdateDeck(id, {
        pitch: nextPitch,
        bpm: nextBpm,
        bpmLocked: false
      });
    };

    updatePitchFromEvent(e);

    const handlePointerMove = (moveEv: PointerEvent) => {
      updatePitchFromEvent(moveEv);
    };

    const handlePointerUp = (upEv: PointerEvent) => {
      if (!pitchTrackRef.current) return;
      try {
        pitchTrackRef.current.releasePointerCapture(upEv.pointerId);
      } catch (err) {}
      pitchTrackRef.current.removeEventListener('pointermove', handlePointerMove);
      pitchTrackRef.current.removeEventListener('pointerup', handlePointerUp);
    };

    pitchTrackRef.current.addEventListener('pointermove', handlePointerMove);
    pitchTrackRef.current.addEventListener('pointerup', handlePointerUp);
  };
  const [tapTimes, setTapTimes] = useState<number[]>([]);
  return (
    <div className={`flex-1 flex flex-col deck-gradient p-1 gap-0.5 ${id === 'A' ? 'border-r-2 border-[#2a2a2a]' : 'border-l-2 border-[#2a2a2a]'}`}>
      {/* Header Info */}
      <div className="flex h-10 machinery-panel p-1 rounded-sm border-[#444]/20 border-b-2 relative">
        {showSettings && (
          <div className="absolute top-10 left-0 right-0 z-50 bg-[#151515] border border-white/10 rounded-sm p-2 shadow-2xl flex flex-col gap-2 bento-card">
              <div className="flex justify-between items-center mb-1">
                <span className="text-[8px] font-bold text-[#a8f]">DECK SETTINGS</span>
                <button onClick={() => setShowSettings(false)} className="text-[10px] text-[#666] hover:text-white px-1">×</button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                 <div className="flex flex-col gap-1">
                    <span className="text-[6px] text-[#666]">LO-MID: {state.eqCrossovers.loMid}Hz</span>
                    <input type="range" min="100" max="800" step="10" value={state.eqCrossovers.loMid} onChange={(e) => onEqCrossover('loMid', parseInt(e.target.value))} className="h-1 accent-[#a8f]" />
                 </div>
                 <div className="flex flex-col gap-1">
                    <span className="text-[6px] text-[#666]">MID-HI: {state.eqCrossovers.midHi}Hz</span>
                    <input type="range" min="1500" max="6000" step="100" value={state.eqCrossovers.midHi} onChange={(e) => onEqCrossover('midHi', parseInt(e.target.value))} className="h-1 accent-[#4af]" />
                 </div>
                 <div className="flex flex-col gap-1 col-span-2 border-t border-white/5 pt-1.5 mt-0.5">
                    <div className="flex justify-between items-center text-[6px]">
                      <span className="text-[#666]">SPIN-DOWN INERTIA (GLIDE):</span>
                      <span className="text-[#a8f] font-mono">{Math.round((state.scratchFriction ?? 0.95) * 100)}%</span>
                    </div>
                    <input 
                      type="range" 
                      min="0.80" 
                      max="0.99" 
                      step="0.01" 
                      value={state.scratchFriction ?? 0.95} 
                      onChange={(e) => onUpdateDeck(id, { scratchFriction: parseFloat(e.target.value) })} 
                      className="h-1 accent-[#a8f]" 
                    />
                 </div>
              </div>
          </div>
        )}
        <div className="w-10 h-full flex flex-col items-center justify-center font-display font-black text-[#555] text-lg bg-black/10 rounded mr-1 group relative">
          {id}
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className="absolute -top-1 -left-1 p-1 rounded-full bg-[#222] border border-white/5 text-[#555] hover:text-[#a8f] transition-all"
          >
            <Settings size={8} />
          </button>
          <button 
            onClick={onPreCue}
            className={`absolute -bottom-1 -right-1 p-1 rounded-full border transition-all ${
              state.preCue ? 'bg-[#4af] border-[#4af] text-white animate-pulse' : 'bg-[#222] border-white/10 text-white/40'
            }`}
          >
            <Volume2 size={8} />
          </button>
        </div>
        <div className="flex flex-col flex-1 min-w-0 justify-center gap-0.5">
          <div className="flex items-center gap-1.5">
            <div className="flex flex-col min-w-0 flex-1 leading-tight">
              <div className="text-[11px] text-[#44aaff] font-extrabold truncate tracking-wide uppercase">{state.activeTrack?.title || 'CHILL LARGO'}</div>
              <div className="text-[7.5px] text-[#6aa3ff] font-bold truncate uppercase tracking-widest">{state.activeTrack?.artist || 'VIRTUAL DJ ELITE'}</div>
            </div>
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept="audio/*" 
              onChange={(e) => e.target.files?.[0] && onLoad(e.target.files[0])} 
            />
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="bg-linear-to-b from-[#1a3a1a] to-[#0d1f0d] border border-[#2a6a2a] rounded-sm text-[#4c4] text-[8px] font-bold px-1.5 py-0.5 tracking-tighter hover:brightness-110 active:brightness-90 btn-glow-success"
            >LOAD</button>
            
            <button 
              onClick={onKeySync}
              className="ml-auto flex items-center gap-1 bg-[#1a1c3a] border border-[#38f]/30 text-[#8bf] text-[7.5px] font-bold px-1.5 py-0.5 rounded-sm hover:brightness-110 active:scale-95"
            >
              <RotateCcw size={8} /> KEY SYNC
            </button>
            <button 
              onClick={onKeyLock}
              className={`flex items-center gap-1 border text-[7.5px] font-bold px-1.5 py-0.5 rounded-sm transition-all ${
                state.keyLock ? 'bg-[#a8f] border-[#a8f] text-white shadow-[0_0_8px_#a8f]' : 'bg-[#1a1c3a] border-[#38f]/30 text-[#8bf] hover:brightness-110'
              }`}
            >
              <Lock size={8} /> KEY LOCK
            </button>
          </div>
          <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[8px] text-[#888]">
            <span>ELAPSED <span className="text-[#ccc] font-mono font-bold">{fmtTime(state.elapsed)}</span></span>
            <span>REMAIN <span className="text-[#ccc] font-mono font-bold">{fmtTime(state.total - state.elapsed)}</span></span>
            <span>KEY <span className="text-[#4af] font-mono font-bold">{state.keyShift > 0 ? '+' : ''}{state.keyShift} st</span></span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="text-right leading-none group relative cursor-help">
            <div className="text-[21px] font-bold text-[#eee] font-mono drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]">
              {state.bpm.toFixed(2)}
              {state.keyLock && <span className="absolute -top-1 -right-1 w-1 h-1 bg-[#a8f] rounded-full shadow-[0_0_5px_#a8f]" />}
            </div>
            <div className="text-[7px] text-[#777] tracking-[0.3em] font-bold">BPM</div>
            <div className="absolute top-full right-0 text-[6px] font-mono text-[#a8f] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
              {state.keyLock ? 'MASTER TEMPO ON' : 'PITCH LOCK OFF'}
            </div>
          </div>
          <div className="flex gap-1 h-3">
             <div className="w-1.5 h-full bg-[#111] overflow-hidden rounded-sm border border-white/5">
                <motion.div 
                  className="w-full bg-[#4c4]" 
                  initial={{ height: '50%' }}
                  animate={{ height: `${50 + state.pitch * 5}%` }}
                />
             </div>
             <div className="text-[6px] font-mono text-[#555] flex items-center">{state.pitch > 0 ? '+' : ''}{state.pitch.toFixed(1)}%</div>
          </div>
        </div>
          <div className="flex gap-0.5">
            {[0, 1, 2, 3, 4, 5, 6, 7].map(i => {
              const cueColors = [
                'bg-[#16d] border-[#38f] text-[#adf] btn-glow-accent', 
                'bg-[#172] border-[#3c5] text-[#afc] btn-glow-success', 
                'bg-[#c60] border-[#f93] text-[#fda] btn-glow-warning',
                'bg-[#c13] border-[#f35] text-[#fbc] btn-glow-danger',
                'bg-[#71b] border-[#a5f] text-[#ebf] btn-glow-indigo',
                'bg-[#168] border-[#3b9] text-[#bfe] btn-glow-cyan',
                'bg-[#174] border-[#3e8] text-[#cff] btn-glow-teal',
                'bg-[#b60] border-[#e93] text-[#fed] btn-glow-amber'
              ];
              return (
                <button 
                  key={i} 
                  onClick={(e) => {
                    if (e.shiftKey) onClearHotCue(i);
                    else onHotCue(i);
                  }}
                  title={`Hot Cue ${i + 1} (Shift-click to clear)`}
                  className={`w-5 h-3.5 rounded-sm text-[8px] font-bold border transition-all ${
                    state.hotCues[i] !== null 
                      ? cueColors[i]
                      : 'bg-[#18181a] border-[#2c2c2c] text-[#555]'
                  } hover:brightness-125`}
                >{i + 1}</button>
              );
            })}
          </div>
        </div>

      {/* Waveform */}
      <div className="relative group machinery-panel p-0.5 rounded-sm border-t border-[#444]/20 shadow-[inset_0_0_15px_rgba(0,0,0,0.5)] overflow-hidden">
        {state.isAnalyzing && (
          <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-2">
            <Activity className="text-[#4af] animate-spin" size={24} />
            <div className="text-[10px] font-bold text-[#4af] tracking-[0.2em] animate-pulse">ANALYZING WAVEFORM...</div>
          </div>
        )}
        <Waveform 
          data={state.waveform} 
          pos={Math.floor((state.elapsed / state.total) * 4000)} 
          zoom={zoom} 
          cues={{
            ...Object.entries(state.cuePoints || {}).reduce((acc, [k, v]) => {
              const numKey = parseInt(k, 10);
              if (!isNaN(numKey) && typeof v === 'number' && v >= 0 && state.total > 0) {
                acc[numKey] = Math.floor((v / state.total) * 4000);
              }
              return acc;
            }, {} as { [key: number]: number }),
            ...(state.hotCues || []).reduce((acc, hc, idx) => {
              if (hc !== null && typeof hc === 'number' && state.total > 0) {
                acc[idx + 1] = Math.floor((hc / state.total) * 4000);
              }
              return acc;
            }, {} as { [key: number]: number })
          }} 
          onSeek={onSeek}
          onZoomChange={onZoomChange}
          elapsedTime={state.elapsed}
          totalDuration={state.total}
          gridBpm={state.gridBpm}
          gridOffset={state.gridOffset}
          showGrid={state.showGrid}
          loopIn={state.loopIn}
          loopOut={state.loopOut}
          phaseOffset={phaseOffset}
          quantize={state.quantize}
        />
        <div className="absolute inset-0 pointer-events-none opacity-20 group-hover:opacity-40 transition-opacity">
           <Visualizer analyser={analyser} mode={visMode} color={id === 'A' ? '#44aaff' : '#ee2222'} />
        </div>
        {/* LCD Overlay */}
        <div className="absolute inset-0 pointer-events-none bg-linear-to-b from-transparent via-transparent to-black/10" />
        <div className="absolute inset-0 pointer-events-none opacity-[0.03] bg-[url('https://www.transparenttextures.com/patterns/digital-noise.png')]" />
        <div className="absolute top-0 inset-x-0 h-[1.5px] bg-white/5 pointer-events-none" />
      </div>
        <div className="absolute bottom-1 right-1 w-[80px] h-[25px]">
           <PitchCurve history={state.pitchHistory} color={id === 'A' ? '#44aaff' : '#ee2222'} />
        </div>

      {/* Beatgrid & Beat Loop Toolkit */}
      <div className="grid grid-cols-2 gap-1.5 p-1 bg-black/40 border border-[#222] rounded-sm relative">
        {/* Left Col: Beatgrid Adjustments */}
        <div className="flex flex-col gap-1 pr-1.5 border-r border-[#222]/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <span className="text-[7px] font-black text-[#5df] uppercase tracking-wider">BEATGRID TOOL</span>
              <button 
                onClick={() => onUpdateDeck(id, { showGrid: !state.showGrid })}
                className={`px-1 py-0.5 rounded-[2px] text-[5.5px] font-bold border transition-all cursor-pointer ${
                  state.showGrid 
                    ? 'bg-[#153a54] border-[#1da1f2]/40 text-[#5df] shadow-[0_0_6px_rgba(85,221,255,0.2)]' 
                    : 'bg-[#18181a] border-[#333] text-[#666] hover:text-[#aaa]'
                }`}
                title="Toggle Beatgrid Visualization Overlay"
              >
                {state.showGrid ? 'GRID ON' : 'GRID OFF'}
              </button>
            </div>
            
            <div className="text-[6.5px] font-mono text-[#888] flex items-center gap-1">
              <span 
                className="w-1.5 h-1.5 rounded-full bg-[#a855f7]/90 inline-block shadow-[0_0_4px_#a855f7]"
                style={{
                  animation: `beat-flash ${60 / (state.bpm || state.gridBpm || 160)}s infinite cubic-bezier(0.1, 0.8, 0.3, 1.0)`,
                }}
              />
              <span>{(state.gridBpm ?? 128).toFixed(1)} BPM</span>
            </div>
          </div>
          
          <div className="flex items-center gap-0.5">
            {/* TAP TEMPO PAD */}
            <button
              onClick={() => {
                const now = Date.now();
                const nextTaps = [...tapTimes, now].slice(-5);
                setTapTimes(nextTaps);
                if (nextTaps.length >= 2) {
                  let sum = 0;
                  for (let i = 1; i < nextTaps.length; i++) {
                    sum += (nextTaps[i] - nextTaps[i - 1]) / 1000;
                  }
                  const avgInterval = sum / (nextTaps.length - 1);
                  const calculatedBpm = Math.round((60 / avgInterval) * 10) / 10;
                  if (calculatedBpm >= 40 && calculatedBpm <= 240) {
                    onUpdateDeck(id, {
                      gridBpm: calculatedBpm,
                      gridOffset: state.elapsed
                    });
                  }
                } else {
                  onUpdateDeck(id, {
                    gridOffset: state.elapsed
                  });
                }
              }}
              className="flex-1 h-5 bg-linear-to-b from-[#241a3a] to-[#120d1f] hover:from-[#3d2c5e] hover:to-[#1e1533] border border-[#a8f]/30 hover:border-[#a8f]/60 rounded-sm text-[#cbf] hover:text-white text-[7px] font-bold uppercase transition-all flex items-center justify-center gap-1 relative overflow-hidden select-none cursor-pointer active:scale-[0.97] btn-glow-indigo"
              title="Tap Tempo (Multiple times to calculate BPM & align downbeat)"
            >
              <div 
                className="absolute inset-0 bg-[#a855f7]/15 pointer-events-none mix-blend-screen"
                style={{
                  animation: `beat-flash ${60 / (state.bpm || state.gridBpm || 160)}s infinite cubic-bezier(0.1, 0.8, 0.3, 1.0)`,
                }}
              />
              <Sparkles size={7} className="animate-pulse text-[#bbf]" />
              <span>TAP</span>
              <span className="relative flex h-1 w-1">
                <span 
                  className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#a855f7] opacity-80"
                  style={{ animationDuration: `${60 / (state.bpm || state.gridBpm || 160)}s` }}
                />
                <span className="relative inline-flex rounded-full h-1 w-1 bg-[#d8b4fe]" />
              </span>
            </button>

            {/* DOWNBEAT LOCK */}
            <button
              onClick={() => onUpdateDeck(id, { gridOffset: state.elapsed })}
              className="px-1 h-5 bg-[#14141c] hover:bg-[#1a1c2a] border border-[#5df]/20 hover:border-[#5df]/50 text-[#5df] rounded-sm text-[6.5px] font-bold uppercase transition-all flex items-center justify-center cursor-pointer"
              title="Set Current Position as Downbeat Anchor"
            >
              ANCHOR
            </button>

            {/* GRID NUDGE SHIFTS */}
            <div className="flex items-center gap-0.5 bg-[#14141c] border border-[#222] p-0.5 rounded-sm">
              <button
                onClick={() => onUpdateDeck(id, { gridOffset: Math.max(0, (state.gridOffset ?? 0) - 0.01) })}
                className="w-3.5 h-3.5 bg-[#1e2029] hover:bg-[#282b3a] text-white rounded-[2px] text-[7px] font-bold flex items-center justify-center active:scale-95 transition-all cursor-pointer"
                title="Nudge Grid Left (-10ms)"
              >
                ◀
              </button>
              <button
                onClick={() => onUpdateDeck(id, { gridOffset: (state.gridOffset ?? 0) + 0.01 })}
                className="w-3.5 h-3.5 bg-[#1e2029] hover:bg-[#282b3a] text-white rounded-[2px] text-[7px] font-bold flex items-center justify-center active:scale-95 transition-all cursor-pointer"
                title="Nudge Grid Right (+10ms)"
              >
                ▶
              </button>
            </div>

            {/* BPM EXPAND / CONTRACT */}
            <div className="flex items-center gap-0.5 bg-[#14141c] border border-[#222] p-0.5 rounded-sm">
              <button
                onClick={() => {
                  const current = state.gridBpm ?? 128;
                  onUpdateDeck(id, { gridBpm: Math.max(40, current - 0.1) });
                }}
                className="w-3.5 h-3.5 bg-[#1e2029] hover:bg-[#282b3a] text-white rounded-[2px] text-[7px] font-extrabold flex items-center justify-center active:scale-95 transition-all cursor-pointer"
                title="BPM -0.1"
              >
                -
              </button>
              <button
                onClick={() => {
                  const current = state.gridBpm ?? 128;
                  onUpdateDeck(id, { gridBpm: Math.min(240, current + 0.1) });
                }}
                className="w-3.5 h-3.5 bg-[#1e2029] hover:bg-[#282b3a] text-white rounded-[2px] text-[7px] font-extrabold flex items-center justify-center active:scale-95 transition-all cursor-pointer"
                title="BPM +0.1"
              >
                +
              </button>
            </div>

            {/* RESET GRID */}
            <button
              onClick={() => onUpdateDeck(id, {
                gridBpm: state.activeTrack ? parseFloat(state.activeTrack.bpm) : (id === 'A' ? 140 : 128),
                gridOffset: 0
              })}
              className="px-1 h-5 bg-[#251010] hover:bg-[#3d1a1a] border border-[#f44]/20 hover:border-[#f44]/50 text-[#f66] rounded-sm text-[6.5px] font-bold uppercase transition-all flex items-center justify-center active:scale-95 cursor-pointer"
              title="Reset Grid to original parsed Track BPM"
            >
              RST
            </button>
          </div>
        </div>

        {/* Right Col: BEAT LOOP CONTROLLER */}
        <div className="flex flex-col gap-1 pl-1.5 justify-between">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <span className="text-[7px] font-black text-[#1dd1a1] uppercase tracking-wider">BEAT LOOP</span>
              <span 
                className={`text-[5.5px] font-bold px-1 py-0.2 rounded-[2px] transition-all flex items-center gap-0.5 ${
                  state.looping 
                    ? 'bg-[#1b4332] text-[#1dd1a1] border border-[#1dd1a1]/30 animate-pulse shadow-[0_0_4px_rgba(29,209,161,0.2)]' 
                    : 'bg-[#18181a] text-[#555]'
                }`}
              >
                <span className={`w-1 h-1 rounded-full ${state.looping ? 'bg-[#1dd1a1]' : 'bg-[#444]'}`} />
                {state.looping ? `${state.loopSize} B` : 'OFF'}
              </span>
            </div>
            
            <div className="text-[6.5px] font-mono text-[#888] flex gap-1.5">
              {state.loopIn >= 0 && (
                <span className="text-[6px]">IN: <span className="text-[#e5a93c]">{(state.loopIn / 4000 * state.total).toFixed(1)}s</span></span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-0.5">
            {/* IN BUTTON */}
            <button
              onClick={() => onLoop('in')}
              className={`h-5 px-1 rounded-[3px] text-[7px] font-extrabold tracking-tight transition-all cursor-pointer active:scale-95 flex items-center justify-center border ${
                state.loopIn >= 0 
                  ? 'bg-gradient-to-b from-[#b5893a] to-[#805d21] border-[#e5a93c] text-white shadow-[0_0_4px_rgba(229,169,60,0.3)]' 
                  : 'bg-gradient-to-b from-[#222] to-[#141416] border-[#2d2f34] text-[#aa9165] hover:text-white'
              }`}
              title="Set Loop In Point"
            >
              IN
            </button>

            {/* OUT BUTTON */}
            <button
              onClick={() => onLoop('out')}
              className={`h-5 px-1 rounded-[3px] text-[7px] font-extrabold tracking-tight transition-all cursor-pointer active:scale-95 flex items-center justify-center border ${
                state.loopOut > state.loopIn 
                  ? 'bg-gradient-to-b from-[#a13b3b] to-[#752626] border-[#ef4444] text-white shadow-[0_0_4px_rgba(239,68,68,0.3)]' 
                  : 'bg-gradient-to-b from-[#222] to-[#141416] border-[#2d2f34] text-[#a4a] hover:text-white'
              }`}
              title="Set Loop Out Point & Activate Loop"
            >
              OUT
            </button>

            {/* HALVE SIZE */}
            <button
              onClick={() => onLoop('size', state.loopSize / 2)}
              className="w-4 h-5 bg-gradient-to-b from-[#222] to-[#141416] text-[6.5px] text-[#777] border border-[#2d2f34] rounded-[2px] hover:text-[#1dd1a1] hover:border-[#1dd1a1]/30 transition-colors cursor-pointer flex items-center justify-center font-bold"
              title="Halve Loop Size"
            >
              /2
            </button>

            {/* QUICK PRESETS */}
            <div className="flex gap-0.5 bg-black/40 p-0.5 border border-[#222] rounded-[3px] flex-1">
              {[2, 4, 8, 16, 32].map(l => (
                <button
                  key={l}
                  onClick={() => onLoop('size', l)}
                  className={`flex-1 h-3.5 border rounded-[1.5px] text-[6.5px] font-black font-mono tracking-tighter transition-all cursor-pointer active:scale-95 flex items-center justify-center ${
                    state.loopSize === l 
                      ? 'bg-gradient-to-b from-[#134931] to-[#0b291c] border-[#1dd1a1] text-[#1dd1a1] shadow-[inset_0_0_4px_rgba(29,209,161,0.5)]' 
                      : 'bg-gradient-to-br from-[#1c1d22] to-[#121215] border-[#25262a]/80 text-[#555] hover:text-[#bbb] hover:border-[#3a3d47]'
                  }`}
                  title={`Set ${l}-Beat Auto Loop`}
                >
                  {l}
                </button>
              ))}
            </div>

            {/* DOUBLE SIZE */}
            <button
              onClick={() => onLoop('size', state.loopSize * 2)}
              className="w-4 h-5 bg-gradient-to-b from-[#222] to-[#141416] text-[6.5px] text-[#777] border border-[#2d2f34] rounded-[2px] hover:text-[#1dd1a1] hover:border-[#1dd1a1]/30 transition-colors cursor-pointer flex items-center justify-center font-bold"
              title="Double Loop Size"
            >
              x2
            </button>

            {/* LOOP TOGGLE / EXIT */}
            <button
              onClick={() => onLoop('toggle')}
              className={`h-5 px-1 rounded-[3px] text-[6.5px] font-black tracking-tight border transition-all cursor-pointer active:scale-95 flex items-center justify-center uppercase ${
                state.looping 
                  ? 'bg-gradient-to-b from-[#1dd1a1] to-[#10ac84] border-[#1dd1a1] text-black shadow-[0_0_6px_rgba(29,209,161,0.45)]' 
                  : 'bg-gradient-to-b from-[#1e1f24] to-[#121214] border-[#2c2d34] text-[#888] hover:text-[#bbb]'
              }`}
              title="Toggle Beat Loop ON/OFF (Exit active loop)"
            >
              {state.looping ? 'EXIT' : 'LOOP'}
            </button>
          </div>
        </div>
      </div>

      {/* FX/SMP Bar */}
      <div className="flex h-[32px] border border-[#222] rounded-sm overflow-hidden text-[6.5px] uppercase">
        <div className="flex-1 flex flex-col justify-center px-1 bg-linear-to-b from-[#1c1c1c] to-[#141414] border-r border-[#2a2a2a] relative overflow-hidden">
          <div className="text-[#666] tracking-tighter mb-0.5 flex justify-between items-center">
            <span>Effects</span>
            {state.fx?.enabled && <Activity size={8} className="text-[#a8f] animate-pulse" />}
          </div>
          <div className="flex items-center gap-1">
            <select 
              value={state.fx?.type || 'echo'}
              onChange={(e) => onFxType(e.target.value)}
              className="bg-[#1a1a1a] border border-[#3a3a3a] text-[#aaa] text-[8px] h-4 px-0.5 rounded-sm outline-none w-14 cursor-pointer"
            >
              <option value="echo">Echo</option>
              <option value="flanger">Flanger</option>
              <option value="reverb">Reverb</option>
            </select>
            <button 
              onClick={onFxToggle}
              className={`h-4 px-1.5 rounded-sm border transition-all text-[7px] font-black cursor-pointer ${
                state.fx?.enabled ? 'bg-[#a8f] border-[#a8f] text-[#102] btn-glow-accent scale-105' : 'bg-[#252525] border-[#444] text-[#888]'
              }`}
            >
              {state.fx?.enabled && (
                <motion.div 
                  className="absolute inset-0 bg-[#a8f]/20 rounded-sm"
                  animate={{ opacity: [0.2, 0.5, 0.2] }}
                  transition={{ duration: 1, repeat: Infinity }}
                />
              )}
              ON
            </button>
            <div className="flex-1 flex gap-2 items-center justify-end pl-1 border-l border-[#2d2d2d]">
              <div className="flex flex-col items-center">
                <Knob 
                  size="xs" 
                  defaultValue={state.fx?.val1 ?? 50} 
                  color="#a8f" 
                  min={0} 
                  max={100}
                  unit={state.fx?.type === 'flanger' ? 'Hz' : state.fx?.type === 'reverb' ? 's' : 'ms'}
                  onChange={(v) => onFxParamChange(1, v)}
                />
                <span className="text-[5.5px] scale-[0.8] text-[#555] font-black uppercase leading-none mt-0.5">
                  {state.fx?.type === 'echo' ? 'TIME' : state.fx?.type === 'flanger' ? 'RATE' : 'SIZE'}
                </span>
              </div>
              
              <div className="flex flex-col items-center">
                <Knob 
                  size="xs" 
                  defaultValue={state.fx?.val2 ?? 50} 
                  color="#a8f" 
                  min={0} 
                  max={100}
                  unit="%"
                  onChange={(v) => onFxParamChange(2, v)}
                />
                <span className="text-[5.5px] scale-[0.8] text-[#555] font-black uppercase leading-none mt-0.5">
                  {state.fx?.type === 'echo' ? 'FDBK' : state.fx?.type === 'flanger' ? 'DPTH' : 'MIX'}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="flex-1 flex flex-col justify-center px-1 bg-linear-to-b from-[#1c1c1c] to-[#141414]">
          <div className="text-[#666] tracking-tighter mb-0.5">Sampler</div>
          <div className="flex items-center gap-0.5">
            <select className="bg-[#1a1a1a] border border-[#3a3a3a] text-[#aaa] text-[8px] h-3.5 px-0.5 rounded-sm outline-none w-14">
              <option>Siren</option><option>Saxo</option>
            </select>
            <Knob size="sm" defaultValue={80} color="#44aaff" />
            <button className="h-3.5 px-1 bg-[#333] border border-[#444] rounded-sm text-[#888] hover:text-white">◀</button>
            <button className="h-3.5 px-1 bg-[#333] border border-[#444] rounded-sm text-[#888] hover:text-white">▶</button>
          </div>
        </div>
      </div>

      {/* Controls Bar */}
      <div className="flex items-center gap-2.5 px-1.5 py-0.5 bg-linear-to-b from-[#181818] to-[#131313] border border-[#222] rounded-sm h-7">
        <Knob 
          size="md" 
          label="Filter" 
          max={100} 
          min={-100} 
          defaultValue={state.filterValue ?? 0} 
          color="#aa44ff" 
          onChange={onFilterChange}
        />
        <Knob 
          size="md" 
          label="Key" 
          max={12} 
          min={-12} 
          defaultValue={state.keyShift ?? 0} 
          color="#f83" 
          onChange={(v) => onUpdateDeck(id, { keyShift: Math.round(v) })}
        />
        <div className="ml-auto bg-black border border-[#2a2a2a] px-1.5 py-0.5 rounded flex items-center gap-1 cursor-pointer hover:border-[#4af] transition-colors">
          <Lock size={8} className={state.bpmLocked ? "text-[#4c4]" : "text-[#444]"} />
          <span className="text-[7px] text-[#666] tracking-tighter uppercase">{state.bpmLocked ? "Locked" : "Keylock"}</span>
          <span className="text-[9px] text-[#4c4] font-mono font-bold">{state.pitch >= 0 ? '+' : ''}{state.pitch.toFixed(1)}%</span>
        </div>
      </div>

      {/* Main Controls row */}
      <div className="flex gap-1 flex-1 min-h-0 bg-black/10 rounded">
        <div className="flex-1 flex flex-col justify-between p-1">
          <div className="bg-linear-to-b from-[#1a1a1a] to-[#141414] border border-[#252525] rounded-sm p-1.5 flex-1 flex flex-col mb-1 select-none">
            {/* Header Tabs */}
            <div className="flex justify-between items-center border-b border-[#1b1c1e] pb-1.5 mb-1.5 shrink-0">
              <div className="flex gap-1.5 bg-black/50 p-0.5 rounded-[4px] border border-[#222]/50">
                <button 
                  onClick={() => setPadMode('hotcue')} 
                  className={`text-[7.5px] font-black uppercase tracking-wider px-2 py-0.5 rounded-[3px] transition-all cursor-pointer ${
                    padMode === 'hotcue' 
                      ? 'bg-gradient-to-b from-[#b280ff] to-[#8a4fff] text-white font-extrabold shadow-[0_0_8px_rgba(138,79,255,0.45)]' 
                      : 'text-[#555] hover:text-[#bbb]'
                  }`}
                >
                  Hot Cue
                </button>
                <button 
                  onClick={() => setPadMode('loop')} 
                  className={`text-[7.5px] font-black uppercase tracking-wider px-2 py-0.5 rounded-[3px] transition-all cursor-pointer ${
                    padMode === 'loop' 
                      ? 'bg-gradient-to-b from-[#1dd1a1] to-[#10ac84] text-black font-extrabold shadow-[0_0_8px_rgba(29,209,161,0.45)]' 
                      : 'text-[#555] hover:text-[#bbb]'
                  }`}
                >
                  Loop
                </button>
              </div>
              {padMode === 'hotcue' && (
                <button 
                  onClick={() => setPadClearMode(!padClearMode)}
                  title="Toggle delete mode. Clicking a pad will delete the cue instead of jumping."
                  className={`text-[7px] font-extrabold uppercase px-1.5 py-0.5 rounded-[3px] border transition-all flex items-center gap-0.5 cursor-pointer ${
                    padClearMode 
                      ? 'bg-red-950/90 border-red-500 text-red-400 shadow-[0_0_6px_rgba(239,68,68,0.3)] animate-pulse' 
                      : 'bg-[#18181a] border-[#2d2d30] text-[#666] hover:text-red-400 hover:border-red-900/40'
                  }`}
                >
                  <Trash2 size={7} /> {padClearMode ? 'DELETE ACTIVE' : 'CLEAR CUE'}
                </button>
              )}
            </div>

            {/* Panel Contents */}
            {padMode === 'hotcue' ? (
              <div className="grid grid-cols-4 gap-1 mt-0.5 flex-1 p-0.5 bg-[#0b0c0d] rounded border border-[#1b1c1e]/50 shadow-[inset_0_2px_4px_rgba(0,0,0,0.8)]">
                {[0, 1, 2, 3, 4, 5, 6, 7].map(i => {
                  const cueVal = state.hotCues[i];
                  const isSet = cueVal !== null;
                  const padColors = [
                    '#00a8ff', // Pad 1: Cyan/Blue
                    '#4cd137', // Pad 2: Neon Green
                    '#fbc531', // Pad 3: Neon Gold
                    '#e84118', // Pad 4: Neon Red
                    '#ff007f', // Pad 5: Deep Pink
                    '#9c88ff', // Pad 6: Purple/Amethyst
                    '#1dd1a1', // Pad 7: Jade/Emerald
                    '#ff9f43'  // Pad 8: Amber/Orange
                  ];
                  const color = padColors[i];
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        if (padClearMode) {
                          onClearHotCue(i);
                        } else {
                          onHotCue(i);
                        }
                      }}
                      className={`relative aspect-[1.4/1] rounded-[3px] border-[1px] flex flex-col justify-between p-1 px-1.5 text-left transition-all overflow-hidden cursor-pointer select-none active:scale-95 ${
                        isSet 
                          ? 'hover:brightness-125' 
                          : 'bg-gradient-to-br from-[#1c1d22] to-[#121215] border-[#25262a]/80 hover:bg-[#202025] hover:border-[#333540] text-[#444] hover:text-[#777]'
                      }`}
                      style={isSet ? {
                        borderColor: color,
                        background: `radial-gradient(circle at center, ${color}2d 0%, ${color}0c 70%), linear-gradient(135deg, #18191d 0%, #0c0d10 100%)`,
                        boxShadow: `inset 0 0 8px ${color}55, 0 1px 3px rgba(0,0,0,0.5), 0 0 5px ${color}22`
                      } : {}}
                    >
                      {/* CDJ/DDJ Backlit Neon Filament Band */}
                      {isSet && (
                        <div 
                          className="absolute top-0 inset-x-0 h-[1.5px] opacity-90"
                          style={{ backgroundColor: color, boxShadow: `0 1px 6px ${color}, 0 0 3px ${color}` }}
                        />
                      )}
                      
                      <div className="flex justify-between items-start w-full pointer-events-none">
                        <span 
                          className="text-[7.5px] font-mono font-black tracking-tight leading-none"
                          style={isSet ? { color, textShadow: `0 0 4px ${color}88` } : {}}
                        >
                          P{i + 1}
                        </span>
                        {isSet && (
                          <span className="text-[5.5px] text-white/70 font-mono font-semibold tracking-tighter scale-[0.8] origin-top-right">
                            {fmtTime(cueVal)}
                          </span>
                        )}
                      </div>
                      
                      <div className="text-[5px] font-sans pointer-events-none truncate uppercase tracking-tight leading-none font-black text-white/45">
                        {isSet ? 'CUE' : 'EMPTY'}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col justify-end flex-1 pt-1.5 gap-1.5 p-1 bg-[#0b0c0d] rounded border border-[#1b1c1e]/50 shadow-[inset_0_2px_4px_rgba(0,0,0,0.8)]">
                <div className="flex gap-1 shrink-0">
                  <button 
                    onClick={() => onLoop('size', state.loopSize / 2)} 
                    className="flex-[0.8] h-5 bg-gradient-to-b from-[#222] to-[#141416] text-[5.5px] text-[#777] border border-[#2d2f34] rounded-[3px] hover:text-[#1dd1a1] hover:border-[#1dd1a1]/30 transition-colors cursor-pointer flex items-center justify-center font-bold"
                  >
                    ◀◀
                  </button>
                  {[1, 2, 4, 8, 16, 32].map(l => (
                    <button 
                      key={l} 
                      onClick={() => onLoop('size', l)}
                      className={`flex-1 h-5 border rounded-[3px] text-[7.5px] font-black font-mono tracking-tight transition-all cursor-pointer active:scale-95 ${
                        state.loopSize === l 
                          ? 'bg-gradient-to-b from-[#134931] to-[#0b291c] border-[#1dd1a1] text-[#1dd1a1] shadow-[inset_0_0_8px_rgba(29,209,161,0.5),0_0_6px_rgba(29,209,161,0.25)]' 
                          : 'bg-gradient-to-br from-[#1c1d22] to-[#121215] border-[#25262a]/80 text-[#555] hover:text-[#bbb] hover:border-[#3a3d47]'
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                  <button 
                    onClick={() => onLoop('size', state.loopSize * 2)} 
                    className="flex-[0.8] h-5 bg-gradient-to-b from-[#222] to-[#141416] text-[5.5px] text-[#777] border border-[#2d2f34] rounded-[3px] hover:text-[#1dd1a1] hover:border-[#1dd1a1]/30 transition-colors cursor-pointer flex items-center justify-center font-bold"
                  >
                    ▶▶
                  </button>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button 
                    onClick={() => onLoop('toggle')}
                    className={`h-5.5 px-2.5 text-[7.5px] font-black tracking-wider border rounded-[3px] transition-all cursor-pointer active:scale-95 ${
                      state.looping 
                        ? 'bg-gradient-to-b from-[#1dd1a1] to-[#10ac84] border-[#1dd1a1] text-black font-extrabold shadow-[0_0_8px_rgba(29,209,161,0.45)] text-shadow-glow' 
                        : 'bg-gradient-to-b from-[#1e1f24] to-[#121214] border-[#2c2d34] text-[#777] hover:text-[#bbb] hover:border-[#444]'
                    }`}
                  >
                    ACTIVE
                  </button>
                  <button 
                    onClick={() => onLoop('in')} 
                    className="h-5.5 flex-1 bg-gradient-to-b from-[#282932] to-[#16171d] hover:from-[#353744] hover:to-[#1e2029] text-[7.5px] font-black tracking-wider border border-[#3b3d4a] rounded-[3px] text-[#e5a93c] hover:text-white hover:border-[#e5a93c]/50 active:scale-95 transition-all cursor-pointer"
                  >
                    IN
                  </button>
                  <button 
                    onClick={() => onLoop('out')} 
                    className="h-5.5 flex-1 bg-gradient-to-b from-[#282932] to-[#16171d] hover:from-[#353744] hover:to-[#1e2029] text-[7.5px] font-black tracking-wider border border-[#3b3d4a] rounded-[3px] text-[#ef4444] hover:text-white hover:border-[#ef4444]/50 active:scale-95 transition-all cursor-pointer"
                  >
                    OUT
                  </button>
                </div>
              </div>
            )}
          </div>
          
          <div className="flex gap-1 mt-1 bg-black/20 p-1 rounded border border-[#222]/30">
            {/* CUE Hardware Button */}
            <button 
              onClick={() => {
                if (state.playing) {
                  onToggle();
                  const cuePos = state.cuePoints[0] !== undefined ? state.cuePoints[0] : 0;
                  onSeek(Math.floor((cuePos / state.total) * 4000));
                } else {
                  onUpdateDeck(id, { cuePoints: { ...state.cuePoints, 0: state.elapsed } });
                }
              }}
              className={`flex-1 h-[32px] rounded-full border text-[9px] font-black tracking-widest uppercase transition-all duration-150 active:scale-[0.93] cursor-pointer select-none flex items-center justify-center ${
                state.cuePoints[0] !== undefined 
                  ? 'bg-gradient-to-b from-[#ff9500] to-[#cc7600] border-[#ffb03a] text-black font-black shadow-[0_0_10px_rgba(255,149,0,0.5),inset_0_1px_3px_rgba(255,255,255,0.4)]' 
                  : 'bg-gradient-to-b from-[#25262c] to-[#14151a] border-[#3b3c46] text-[#666] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_1px_2px_rgba(0,0,0,0.4)] hover:text-[#999] hover:border-[#4c4e5a]'
              }`}
              title="Set and Trigger Temporary Cue Point"
            >
              CUE
            </button>

            {/* PAUSE Button */}
            <button 
              onClick={() => {
                if (state.playing) {
                  onToggle();
                }
              }}
              className="flex-1 h-[32px] bg-gradient-to-b from-[#2a2c35] to-[#16171c] border border-[#3e404e] rounded-full text-[#aaa] hover:text-white hover:border-[#525568] transition-all duration-150 active:scale-[0.93] cursor-pointer select-none flex items-center justify-center shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_1px_2px_rgba(0,0,0,0.4)]"
              title="Pause Track Playback"
            >
              <Pause size={10} className="stroke-[3]" />
            </button>

            {/* PLAY/PAUSE (Combinational mechanical trigger) */}
            <button 
              onClick={onToggle}
              className={`flex-[1.5] h-[32px] rounded-full border text-[9px] font-black tracking-widest uppercase transition-all duration-150 active:scale-[0.93] cursor-pointer select-none flex items-center justify-center ${
                state.playing 
                  ? 'bg-gradient-to-b from-[#34d399] to-[#059669] border-[#6ee7b7] text-black shadow-[0_0_10px_rgba(52,211,153,0.5),inset_0_1px_3px_rgba(255,255,255,0.4)]'
                  : 'bg-gradient-to-b from-[#1e2e26] to-[#0d1410] border-[#059669]/40 text-[#059669] hover:text-[#34d399] hover:border-[#059669]/70 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]'
              }`}
              title="Play or Pause Deck"
            >
              {state.playing ? (
                <Square size={10} className="fill-current stroke-[2.5]" />
              ) : (
                <Play size={10} className="fill-current stroke-[2.5] ml-0.5" />
              )}
            </button>

            {/* SYNC Button */}
            <button 
              onClick={onSync}
              className={`flex-1 h-[32px] border rounded-full text-[9px] font-black tracking-widest transition-all duration-150 active:scale-[0.93] cursor-pointer select-none flex items-center justify-center ${
                state.bpmLocked 
                  ? 'bg-gradient-to-b from-[#22d3ee] to-[#0891b2] border-[#67e8f9] text-black font-black shadow-[0_0_10px_rgba(34,211,238,0.5),inset_0_1px_3px_rgba(255,255,255,0.4)]' 
                  : 'bg-gradient-to-b from-[#25262c] to-[#14151a] border-[#3b3c46] text-[#666] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_1px_2px_rgba(0,0,0,0.4)] hover:text-[#999] hover:border-[#4c4e5a]'
              }`}
              title="Synchronize BPM with the other deck"
            >
              SYNC
            </button>
          </div>
        </div>

        <div className="flex flex-col items-center gap-1.5 shrink-0 select-none">
          <CircularPhaseMeter 
            deck={id} 
            masterPhase={masterPhase} 
            deckPhase={deckPhase} 
            bpm={state.bpm} 
            masterBpm={masterBpm}
          />
          <JogWheel deck={id} angle={angle} playing={state.playing} onScratch={onScratch} size={170} friction={state.scratchFriction || 0.95} />
          
          {/* Physical Deck Mode Toggles */}
          <div className="flex gap-2.5 mt-1 justify-center w-full">
            <button
              onClick={() => onUpdateDeck(id, { vinylMode: !state.vinylMode })}
              className={`px-2 py-0.5 rounded-[3px] border-[1px] text-[6.5px] font-mono font-black tracking-tight uppercase transition-all duration-150 active:scale-95 cursor-pointer flex items-center gap-1 ${
                state.vinylMode 
                  ? 'bg-gradient-to-b from-[#134931] to-[#0b291c] border-[#1dd1a1] text-[#1dd1a1] shadow-[0_0_6px_rgba(29,209,161,0.45)]' 
                  : 'bg-gradient-to-br from-[#1c1d22] to-[#121215] border-[#25262a]/80 text-[#555] hover:text-[#bbb] hover:border-[#3a3d47]'
              }`}
              title="Vinyl Mode: Scratching style on platter drag"
            >
              <span className={`w-1 h-1 rounded-full ${state.vinylMode ? 'bg-[#1dd1a1] animate-pulse' : 'bg-[#444]'}`} />
              VINYL
            </button>
            <button
              onClick={() => onUpdateDeck(id, { slipMode: !state.slipMode })}
              className={`px-2 py-0.5 rounded-[3px] border-[1px] text-[6.5px] font-mono font-black tracking-tight uppercase transition-all duration-150 active:scale-95 cursor-pointer flex items-center gap-1 ${
                state.slipMode 
                  ? 'bg-gradient-to-b from-[#4d131a] to-[#2a0b0e] border-[#ef4444] text-[#ef4444] shadow-[0_0_6px_rgba(239,68,68,0.45)]' 
                  : 'bg-gradient-to-br from-[#1c1d22] to-[#121215] border-[#25262a]/80 text-[#555] hover:text-[#bbb] hover:border-[#3a3d47]'
              }`}
              title="Slip Mode: Temporary scratching/looping doesn't stop track linear flow"
            >
              <span className={`w-1 h-1 rounded-full ${state.slipMode ? 'bg-[#ef4444] animate-pulse' : 'bg-[#444]'}`} />
              SLIP
            </button>
            <button
              onClick={() => onUpdateDeck(id, { quantize: !state.quantize })}
              className={`px-2 py-0.5 rounded-[3px] border-[1px] text-[6.5px] font-mono font-black tracking-tight uppercase transition-all duration-150 active:scale-95 cursor-pointer flex items-center gap-1 ${
                state.quantize 
                  ? 'bg-gradient-to-b from-[#0b3349] to-[#061d2b] border-[#00bcff] text-[#00bcff] shadow-[0_0_6px_rgba(0,188,255,0.45)]' 
                  : 'bg-gradient-to-br from-[#1c1d22] to-[#121215] border-[#25262a]/80 text-[#555] hover:text-[#bbb] hover:border-[#3a3d47]'
              }`}
              title="Quantize Mode: Snaps loop points and cues directly to beats"
            >
              <span className={`w-1 h-1 rounded-full ${state.quantize ? 'bg-[#00bcff] animate-pulse' : 'bg-[#444]'}`} />
              QUANT
            </button>
          </div>
        </div>

        <div className="flex flex-col items-center gap-0.5 py-1 w-[26px]">
           <span className="text-[6.5px] text-[#666] tracking-tighter">PITCH</span>
           <div 
             ref={pitchTrackRef}
             onPointerDown={handlePitchPointerDown}
             className="flex-1 w-4 bg-linear-to-b from-[#0a0a0a] via-[#181818] to-[#0a0a0a] border border-[#333] rounded-full relative cursor-ns-resize group select-none touch-none"
             title="Drag to adjust deck pitch & tempo"
           >
              <div className="absolute left-[-2px] right-[-2px] top-1/2 h-px bg-white/20 pointer-events-none" />
              <div 
                className="absolute left-1/2 w-[22px] h-[10px] bg-linear-to-b from-[#999] via-[#666] to-[#444] border border-[#aaa] rounded-sm shadow-lg pointer-events-none"
                style={{ 
                  top: `${Math.max(0, Math.min(100, 50 - state.pitch * 5))}%`, 
                  transform: 'translate(-50%, -50%)' 
                }} 
              />
           </div>
           <div className="flex flex-col gap-0.5 w-full mt-1">
              <button 
                onMouseDown={() => onPitchBend(1)} 
                onMouseUp={() => onPitchBend(0)} 
                onMouseLeave={() => onPitchBend(0)}
                className="w-full h-3.5 bg-[#222] border border-[#444] text-[7px] font-bold rounded-sm hover:bg-[#333] active:bg-[#4af] active:text-white transition-colors"
              >+</button>
              <button 
                onMouseDown={() => onPitchBend(-1)} 
                onMouseUp={() => onPitchBend(0)} 
                onMouseLeave={() => onPitchBend(0)}
                className="w-full h-3.5 bg-[#222] border border-[#444] text-[7px] font-bold rounded-sm hover:bg-[#333] active:bg-[#f44] active:text-white transition-colors"
              >-</button>
           </div>
           <div className="text-[7px] text-[#4c4] font-mono mt-1">{state.pitch >= 0 ? '+' : ''}{state.pitch.toFixed(1)}%</div>
        </div>
      </div>
    </div>
  );
}

function StemsStrip({ id, onEqKill, eqKills, eqLevels, onEqChange }: { 
  id: 'A' | 'B', 
  onEqKill: (id: 'A' | 'B', band: 'hi' | 'mid' | 'low') => void, 
  eqKills: { hi: boolean, mid: boolean, low: boolean },
  eqLevels: { low: number, mid: number, hi: number },
  onEqChange: (id: 'A' | 'B', band: 'hi' | 'mid' | 'low', val: number) => void
}) {
  return (
    <div className="flex flex-col items-center gap-2 pt-1 w-[78px] bg-black/40 border border-[#333]/20 p-1 rounded-sm shrink-0">
      <div className="text-[7px] text-[#ca8a04] font-black font-mono uppercase tracking-widest mb-0.5">CH {id} STEMS</div>
      
      {/* VOCAL STEM */}
      <div className="flex flex-col items-center w-full gap-1 p-1 bg-[#121214]/80 border border-white/5 rounded-xs">
        <div className="flex items-center justify-between w-full px-0.5 select-none text-[6.5px]">
          <span className="text-[#ffdd55] font-black tracking-widest leading-none scale-[0.9]">VOCAL</span>
          <span className="text-[#999] font-mono leading-none text-[6px]">{eqKills.hi ? 'MUTED' : `${Math.round(((eqLevels.hi + 24) / 36) * 100)}%`}</span>
        </div>
        <button 
          onClick={() => onEqKill(id, 'hi')}
          className={`w-full py-0.5 text-[6.5px] font-bold uppercase border rounded-sm transition-all flex flex-col items-center justify-center cursor-pointer select-none active:scale-[0.96] ${
            !eqKills.hi 
              ? 'bg-linear-to-b from-[#ffd200] to-[#b38000] text-black border-[#ffde59] shadow-[0_0_6px_rgba(255,222,89,0.2)] font-black' 
              : 'bg-black/60 border-white/5 text-white/20 line-through'
          }`}
        >
          {!eqKills.hi ? 'VOCAL' : 'MUTED'}
        </button>
        <input 
          type="range"
          min="-24"
          max="12"
          step="1"
          value={eqKills.hi ? -24 : eqLevels.hi}
          disabled={eqKills.hi}
          onChange={(e) => onEqChange(id, 'hi', parseFloat(e.target.value))}
          className="w-full accent-[#ffdd55] h-1 bg-neutral-900 rounded appearance-none cursor-pointer disabled:opacity-30"
        />
      </div>

      {/* MELODY STEM */}
      <div className="flex flex-col items-center w-full gap-1 p-1 bg-[#121214]/80 border border-white/5 rounded-xs">
        <div className="flex items-center justify-between w-full px-0.5 select-none text-[6.5px]">
          <span className="text-[#4af] font-black tracking-widest leading-none scale-[0.9]">MELODY</span>
          <span className="text-[#999] font-mono leading-none text-[6px]">{eqKills.mid ? 'MUTED' : `${Math.round(((eqLevels.mid + 24) / 36) * 100)}%`}</span>
        </div>
        <button 
          onClick={() => onEqKill(id, 'mid')}
          className={`w-full py-0.5 text-[6.5px] font-bold uppercase border rounded-sm transition-all flex flex-col items-center justify-center cursor-pointer select-none active:scale-[0.96] ${
            !eqKills.mid 
              ? 'bg-linear-to-b from-[#1da1f2] to-[#0d59a3] text-white border-[#4af] shadow-[0_0_6px_rgba(75,195,255,0.2)] font-black' 
              : 'bg-black/60 border-white/5 text-white/20 line-through'
          }`}
        >
          {!eqKills.mid ? 'MELODY' : 'MUTED'}
        </button>
        <input 
          type="range"
          min="-24"
          max="12"
          step="1"
          value={eqKills.mid ? -24 : eqLevels.mid}
          disabled={eqKills.mid}
          onChange={(e) => onEqChange(id, 'mid', parseFloat(e.target.value))}
          className="w-full accent-[#4af] h-1 bg-neutral-900 rounded appearance-none cursor-pointer disabled:opacity-30"
        />
      </div>

      {/* DRUMS STEM */}
      <div className="flex flex-col items-center w-full gap-1 p-1 bg-[#121214]/80 border border-white/5 rounded-xs">
        <div className="flex items-center justify-between w-full px-0.5 select-none text-[6.5px]">
          <span className="text-[#ff3366] font-black tracking-widest leading-none scale-[0.9]">DRUMS</span>
          <span className="text-[#999] font-mono leading-none text-[6px]">{eqKills.low ? 'MUTED' : `${Math.round(((eqLevels.low + 24) / 36) * 100)}%`}</span>
        </div>
        <button 
          onClick={() => onEqKill(id, 'low')}
          className={`w-full py-0.5 text-[6.5px] font-bold uppercase border rounded-sm transition-all flex flex-col items-center justify-center cursor-pointer select-none active:scale-[0.96] ${
            !eqKills.low 
              ? 'bg-linear-to-b from-[#ff3366] to-[#a30030] text-white border-red-400/80 shadow-[0_0_6px_rgba(255,51,102,0.2)] font-black' 
              : 'bg-black/60 border-white/5 text-white/20 line-through'
          }`}
        >
          {!eqKills.low ? 'DRUMS' : 'MUTED'}
        </button>
        <input 
          type="range"
          min="-24"
          max="12"
          step="1"
          value={eqKills.low ? -24 : eqLevels.low}
          disabled={eqKills.low}
          onChange={(e) => onEqChange(id, 'low', parseFloat(e.target.value))}
          className="w-full accent-[#ff3366] h-1 bg-neutral-900 rounded appearance-none cursor-pointer disabled:opacity-30"
        />
      </div>

      <div className="mt-0.5 flex flex-col items-center w-full">
         <span className="text-[5px] text-[#555] font-black leading-none scale-[0.9] uppercase tracking-wider">ISOLATOR STAGE</span>
         <div className="w-full h-1 bg-neutral-900 border border-[#222] rounded-full relative overflow-hidden mt-1">
           <div className={`h-full bg-linear-to-r ${id === 'A' ? 'from-[#4af]' : 'from-[#ee2222]'} to-white`} style={{ width: !eqKills.hi && !eqKills.mid && !eqKills.low ? '100%' : !eqKills.hi || !eqKills.mid || !eqKills.low ? '50%' : '0%' }} />
         </div>
      </div>
    </div>
  );
}

function Mixer({ crossfaderPos, onCrossfadeChange, masterFx, onMasterFxChange, onEqKill, onAutomix, masterEq, onMasterEqChange, crossfaderCurve, onCurveChange, deckA, deckB, onEqCrossoverChange, masterTempoLock, onMasterTempoToggle, onGainChange, onEqChange, onFilterChange, showBrowser = false, analyserA, analyserB }: { 
  crossfaderPos: number, 
  onCrossfadeChange: (val: number) => void,
  masterFx: number,
  onMasterFxChange: (val: number) => void,
  onEqKill: (id: 'A' | 'B', band: 'hi' | 'mid' | 'low') => void,
  onAutomix: () => void,
  masterEq: { low: number, mid: number, high: number },
  onMasterEqChange: (band: 'low' | 'mid' | 'high', val: number) => void,
  crossfaderCurve: CrossfaderCurve,
  onCurveChange: (c: CrossfaderCurve) => void,
  deckA: DeckState,
  deckB: DeckState,
  onEqCrossoverChange: (id: 'A' | 'B', type: 'loMid' | 'midHi', val: number) => void,
  masterTempoLock: boolean,
  onMasterTempoToggle: () => void,
  onGainChange: (id: 'A' | 'B', val: number) => void,
  onEqChange: (id: 'A' | 'B', band: 'hi' | 'mid' | 'low', val: number) => void,
  onFilterChange: (id: 'A' | 'B', val: number) => void,
  showBrowser?: boolean,
  analyserA?: AnalyserNode,
  analyserB?: AnalyserNode
}) {
  const [mixerMode, setMixerMode] = useState<'eq' | 'stems'>('eq');

  return (
    <div className="w-[185px] bg-linear-to-b from-[#1c1d1f] to-[#0d0d0f] border-x-2 border-[#25272a] flex flex-col p-1 gap-1 shadow-2xl relative">
      <div className="flex gap-0.5">
        <button 
          onClick={onMasterTempoToggle}
          className={`flex-1 h-4.5 border rounded-sm text-[7px] font-bold transition-all cursor-pointer ${
            masterTempoLock ? 'bg-[#a8f] border-[#a8f] text-white btn-glow-accent' : 'bg-[#1a1a1a] border-[#2a2a2a] text-[#555]'
          }`}
        >MT LOCK</button>
        <button 
          onClick={() => setMixerMode('eq')}
          className={`flex-1 h-4.5 border rounded-sm text-[7.5px] font-bold uppercase transition-all flex items-center justify-center cursor-pointer ${
            mixerMode === 'eq' ? 'bg-[#3a3a3a] border-[#444] text-white' : 'bg-[#1a1a1a] border-[#2a2a2a] text-[#555] hover:text-[#bbb]'
          }`}
        >MIXER</button>
        <button 
          onClick={() => setMixerMode('stems')}
          className={`flex-1 h-4.5 border rounded-sm text-[7.5px] font-bold uppercase transition-all flex items-center justify-center cursor-pointer ${
            mixerMode === 'stems' ? 'bg-[#a8f]/90 border-[#a8f]/40 text-white btn-glow-accent' : 'bg-[#1a1a1a] border-[#2a2a2a] text-[#555] hover:text-white'
          }`}
        >STEMS</button>
      </div>

      {/* MASTER EQ & CURVE SECTION */}
      <div className="machinery-panel p-1.5 rounded-sm flex flex-col gap-1 bento-card">
        <div className="flex justify-between items-center px-0.5">
           <span className="text-[7.5px] font-bold text-[#a8f] uppercase tracking-wider">Master EQ</span>
           <div className="flex items-center gap-1">
             <span className="text-[6px] text-[#444]">CURVE:</span>
             <select 
               value={crossfaderCurve}
               onChange={(e) => onCurveChange(e.target.value as any)}
               className="bg-[#0a0a0a] border border-[#333] text-[7.5px] text-[#4af] rounded h-3 px-0.5 outline-none"
             >
               <option value="linear">Lin</option>
               <option value="log">Log</option>
               <option value="exp">Exp</option>
               <option value="rev-exp">Rev</option>
               <option value="cut">Cut</option>
               <option value="custom">S-Curve</option>
             </select>
             <button 
               onClick={onAutomix}
               className="ml-1 bg-linear-to-b from-[#331144] to-[#110022] border border-[#a8f]/30 text-[#a8f] text-[6.5px] font-bold px-1 rounded-sm hover:brightness-125 transition-all flex items-center gap-0.5"
             >
               <Zap size={6} /> AUTO
             </button>
           </div>
        </div>
        <div className="grid grid-cols-3 gap-1 bg-black/20 p-1 rounded border border-white/5">
           <Knob size="md" label="LOW" min={-24} max={12} defaultValue={masterEq.low} color="#f44" onChange={(v) => onMasterEqChange('low', v)} />
           <Knob size="md" label="MID" min={-24} max={12} defaultValue={masterEq.mid} color="#f83" onChange={(v) => onMasterEqChange('mid', v)} />
           <Knob size="md" label="HIGH" min={-24} max={12} defaultValue={masterEq.high} color="#4af" onChange={(v) => onMasterEqChange('high', v)} />
        </div>
      </div>

      <div className="flex justify-between items-center px-1 py-1 machinery-panel rounded-sm">
        <Knob size="sm" label="Gain" color="#4af" />
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-[6.5px] text-[#777] tracking-widest">MASTER FX</span>
          <Knob 
            size="lg" 
            color="#a8f" 
            value={masterFx} 
            onChange={onMasterFxChange} 
          />
        </div>
        <Knob size="sm" label="Gain" color="#4af" />
      </div>

      <div className="flex flex-1 gap-1 px-1">
        {mixerMode === 'eq' ? (
          <ChannelStrip 
            id="A" 
            gain={deckA.gain} 
            onGainChange={onGainChange} 
            onEqKill={onEqKill} 
            eqKills={deckA.eqKills} 
            crossovers={deckA.eqCrossovers} 
            onCrossoverChange={onEqCrossoverChange} 
            eqLevels={deckA.eqLevels}
            onEqChange={onEqChange}
            filterValue={deckA.filterValue}
            onFilterChange={onFilterChange}
          />
        ) : (
          <StemsStrip id="A" onEqKill={onEqKill} eqKills={deckA.eqKills} eqLevels={deckA.eqLevels} onEqChange={onEqChange} />
        )}
        <div className="flex flex-col gap-0.5 mt-auto mb-2 flex-1 items-center">
           <div className="text-[6px] text-[#444] mb-1">VU</div>
           <div className="flex gap-1.5 h-[85%]">
             <VUMeter side="L" analyser={analyserA} />
             <VUMeter side="R" analyser={analyserB} />
           </div>
        </div>
        {mixerMode === 'eq' ? (
          <ChannelStrip 
            id="B" 
            gain={deckB.gain} 
            onGainChange={onGainChange} 
            onEqKill={onEqKill} 
            eqKills={deckB.eqKills} 
            crossovers={deckB.eqCrossovers} 
            onCrossoverChange={onEqCrossoverChange} 
            eqLevels={deckB.eqLevels}
            onEqChange={onEqChange}
            filterValue={deckB.filterValue}
            onFilterChange={onFilterChange}
          />
        ) : (
          <StemsStrip id="B" onEqKill={onEqKill} eqKills={deckB.eqKills} eqLevels={deckB.eqLevels} onEqChange={onEqChange} />
        )}
      </div>

      <div className="mt-auto px-2 pb-2.5">
        <div className="text-[7px] text-[#555] font-black text-center tracking-[0.2em] mb-1.5 font-display uppercase select-none">CROSSFADER</div>
        <div 
          className="h-5 bg-gradient-to-b from-[#0d0e14] to-[#040507] border border-[#1e2330]/80 rounded-[4px] relative cursor-pointer shadow-[inset_0_2px_4px_rgba(0,0,0,0.9)] flex items-center p-1 overflow-hidden group hover:border-[#eab308]/20 transition-all select-none"
          onMouseDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const update = (ev: MouseEvent) => {
              const pct = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
              onCrossfadeChange(Math.round(pct));
            };
            const mu = () => {
              document.removeEventListener('mousemove', update);
              document.removeEventListener('mouseup', mu);
            };
            document.addEventListener('mousemove', update);
            document.addEventListener('mouseup', mu);
            update(e.nativeEvent);
          }}
        >
          {/* Subtle grid pattern background */}
          <div className="absolute inset-0 opacity-[0.02] pointer-events-none bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:6px_6px]" />

          {/* Physical Track Ticks at 0%, 25%, 50%, 75%, 100% */}
          <div className="absolute top-0.5 bottom-0.5 left-[12px] right-[12px] pointer-events-none flex justify-between">
            <div className="w-[1px] h-1.5 bg-slate-700/60" />
            <div className="w-[1px] h-1 bg-slate-700/40" />
            <div className="w-[1.5px] h-full bg-slate-500/50" />
            <div className="w-[1px] h-1 bg-slate-700/40" />
            <div className="w-[1px] h-1.5 bg-slate-700/60" />
          </div>

          {/* Fader Grove Slot */}
          <div className="absolute top-1/2 -translate-y-1/2 left-[12px] right-[12px] h-[3px] bg-[#030406] border border-[#1e2330]/60 rounded-full w-full" />
          
          {/* Signal Link Colored Line (Left Deck A Blue to Right Deck B Red) */}
          <div className="absolute top-1/2 -translate-y-1/2 left-[12px] right-[12px] h-[1.5px] bg-gradient-to-r from-[#4af] via-[#ca8a04] to-[#f43f5e] opacity-80" />
          
          {/* Slider Cap */}
          <motion.div 
            className="absolute top-1/2 -translate-y-1/2 w-7 h-4.5 bg-gradient-to-b from-[#1c1e29] via-[#3a3d53] to-[#12141c] border border-[#3e4359]/70 rounded-[1px] shadow-[0_4px_8px_rgba(0,0,0,0.95),inset_0_1px_1px_rgba(255,255,255,0.08)] cursor-grab active:cursor-grabbing hover:brightness-110 active:brightness-125 z-20 flex items-center justify-between px-1.5 py-[1px]" 
            style={{ left: `${crossfaderPos}%`, marginLeft: '-14px' }}
          >
            {/* Left tactile groove dots */}
            <div className="flex flex-col gap-[1px] h-full justify-center opacity-30">
              <div className="w-[1px] h-[1px] bg-white rounded-full"></div>
              <div className="w-[1px] h-[1px] bg-white rounded-full"></div>
              <div className="w-[1px] h-[1px] bg-white rounded-full"></div>
            </div>

            {/* Glowing Amber cut-mark line */}
            <div className="w-[1.8px] h-full bg-[#eab308] shadow-[0_0_5px_#f59e0b] rounded-[1px]" />

            {/* Right tactile groove dots */}
            <div className="flex flex-col gap-[1px] h-full justify-center opacity-30">
              <div className="w-[1px] h-[1px] bg-white rounded-full"></div>
              <div className="w-[1px] h-[1px] bg-white rounded-full"></div>
              <div className="w-[1px] h-[1px] bg-white rounded-full"></div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function ChannelStrip({ 
  id, 
  onEqKill, 
  eqKills, 
  crossovers, 
  onCrossoverChange, 
  gain, 
  onGainChange,
  eqLevels = { hi: 0, mid: 0, low: 0 },
  onEqChange,
  filterValue = 0,
  onFilterChange
}: { 
  id: 'A' | 'B', 
  onEqKill: (id: 'A' | 'B', band: 'hi' | 'mid' | 'low') => void, 
  eqKills: { hi: boolean, mid: boolean, low: boolean }, 
  crossovers: { loMid: number, midHi: number }, 
  onCrossoverChange: (id: 'A' | 'B', type: 'loMid' | 'midHi', val: number) => void, 
  gain: number, 
  onGainChange: (id: 'A' | 'B', val: number) => void,
  eqLevels?: { hi: number, mid: number, low: number },
  onEqChange: (id: 'A' | 'B', band: 'hi' | 'mid' | 'low', val: number) => void,
  filterValue?: number,
  onFilterChange: (id: 'A' | 'B', val: number) => void
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 pt-1 relative w-[70px] bg-black/10 rounded-sm p-1 border border-[#333]/10">
      {/* CHANNEL EQ KNOBS */}
      <div className="flex flex-col items-center gap-1 group relative">
        <Knob size="sm" label="HI" color="#f44" min={-24} max={6} value={eqLevels.hi} onChange={(v) => onEqChange(id, 'hi', v)} />
        <button 
          onClick={() => onEqKill(id, 'hi')}
          className={`text-[6px] px-1 rounded-sm border transition-all cursor-pointer ${eqKills.hi ? 'bg-[#ffcc00] text-[#222] border-[#ffcc00] btn-glow-warning' : 'bg-black/40 text-[#666] border-[#444]'}`}
        >KILL</button>
        <div className="absolute top-0 right-[-15px] opacity-0 group-hover:opacity-100 transition-opacity z-50 bg-black p-1 border border-white/10 rounded">
           <Knob size="xs" label="XOVER" min={1500} max={6000} value={crossovers.midHi} onChange={(v) => onCrossoverChange(id, 'midHi', v)} />
        </div>
      </div>
      
      <div className="flex flex-col items-center gap-1 group">
        <Knob size="sm" label="MID" color="#fa0" min={-24} max={6} value={eqLevels.mid} onChange={(v) => onEqChange(id, 'mid', v)} />
        <button 
          onClick={() => onEqKill(id, 'mid')}
          className={`text-[6px] px-1 rounded-sm border transition-all cursor-pointer ${eqKills.mid ? 'bg-[#ff8800] text-white border-[#ff8800] btn-glow-warning shadow-[0_0_8px_rgba(255,136,0,0.4)]' : 'bg-black/40 text-[#666] border-[#444]'}`}
        >KILL</button>
      </div>

      <div className="flex flex-col items-center gap-1 group relative">
        <Knob size="sm" label="LOW" color="#48f" min={-24} max={6} value={eqLevels.low} onChange={(v) => onEqChange(id, 'low', v)} />
        <button 
          onClick={() => onEqKill(id, 'low')}
          className={`text-[6px] px-1 rounded-sm border transition-all cursor-pointer ${eqKills.low ? 'bg-[#ee2222] text-white border-[#f44] btn-glow-danger' : 'bg-black/40 text-[#666] border-[#444]'}`}
        >KILL</button>
        <div className="absolute bottom-10 right-[-15px] opacity-0 group-hover:opacity-100 transition-opacity z-50 bg-black p-1 border border-white/10 rounded">
           <Knob size="xs" label="XOVER" min={80} max={600} value={crossovers.loMid} onChange={(v) => onCrossoverChange(id, 'loMid', v)} />
        </div>
      </div>

      {/* SOUND COLOR FILTER */}
      <div className="flex flex-col items-center gap-0.5 my-1">
        <Knob size="md" label="FILTER" color="#a8f" min={-100} max={100} value={filterValue} onChange={(v) => onFilterChange(id, v)} />
      </div>

      {/* VOL FADER */}
      <DraggableFader value={gain * 100} onChange={(val) => onGainChange(id, val / 100)} label="VOL" />

      <button className={`w-full h-4 rounded-sm text-[8px] font-bold tracking-tight border transition-all cursor-pointer ${
        id === 'B' ? 'bg-[#ee2222]/80 border-[#f44] text-white btn-glow-danger' : 'bg-[#2a2a2a] border-[#444] text-[#888] hover:text-[#bbb] hover:bg-[#353535]'
      }`}>PFL</button>
    </div>
  );
}
function VUMeter({ side, analyser }: { side: string; analyser?: AnalyserNode }) {
  const [lit, setLit] = useState(0);

  useEffect(() => {
    if (!analyser) {
      setLit(0);
      return;
    }

    const bufferLength = analyser.frequencyBinCount || 128;
    const dataArray = new Uint8Array(bufferLength);
    let animationId: number;

    const updateMeter = () => {
      analyser.getByteTimeDomainData(dataArray);

      // Compute Root Mean Square (RMS) amplitude
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const val = (dataArray[i] - 128) / 128; // Normalize to [-1.0, 1.0]
        sum += val * val;
      }
      const rms = Math.sqrt(sum / bufferLength);

      // Map RMS to standard VU light divisions (0 to 18 bars)
      // Standard professional audio peak RMS is around 0.25 - 0.35
      const sensitivity = 3.6; 
      const normalized = Math.min(1.0, rms * sensitivity);
      const barsToLit = Math.round(normalized * 18);

      setLit(barsToLit);
      animationId = requestAnimationFrame(updateMeter);
    };

    updateMeter();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [analyser]);

  return (
    <div className="flex flex-col-reverse gap-px h-full w-[11px] items-center">
      {[...Array(18)].map((_, i) => (
        <div key={i} className={`w-full h-1 rounded-[1px] transition-opacity duration-30 ${i < lit ? 'opacity-100' : 'opacity-10'} ${
          i < 10 ? 'bg-[#0d0]' : i < 14 ? 'bg-[#dd0]' : 'bg-[#e11]'
        }`} />
      ))}
    </div>
  );
}

function Tab({ children, on, onClick }: { children: React.ReactNode, on: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`px-4 h-[17px] text-[9px] font-bold tracking-wider rounded-sm border transition-all ${
        on ? 'bg-linear-to-b from-[#424242] to-[#282828] text-white border-[#666]' : 'bg-linear-to-b from-[#2e2e2e] to-[#1c1c1c] text-[#777] border-[#3a3a3a] hover:text-[#ccc]'
      }`}
    >
      {children}
    </button>
  );
}

interface SamplerPadProps {
  index: number;
  onTrigger: () => void;
  key?: any;
}

function SamplerPad({ index, onTrigger }: SamplerPadProps) {
  const [active, setActive] = useState(false);
  const names = ['SIREN', 'SAXO', 'HANDS UP', 'PUSH IT', 'PUMP IT', 'THIS THIS', 'KICK', 'SNARE', 'HAT', 'VOX', 'RISE', 'LASER'];
  const name = names[index] || 'PAD';

  return (
    <div className={`flex-1 flex flex-col items-center p-1 gap-1 border rounded-[3.5px] transition-all bg-gradient-to-b from-[#161722] to-[#0a0c10] ${
      active ? 'border-[#eab308] btn-glow-accent' : 'border-[#1e2330]'
    }`}>
       <button 
         onClick={() => {
           onTrigger();
           setActive(true);
           setTimeout(() => setActive(false), 200);
         }}
         className={`w-full h-full border rounded-sm flex flex-col items-center justify-center gap-1 transition-all relative overflow-hidden cursor-pointer ${
           active ? 'bg-[#eab308] text-black font-extrabold' : 'bg-[#1b1c26] border-[#292d3f] text-[#8892b0] hover:text-white'
         }`}
       >
         {/* Center-expanding visual ripple animation */}
         {active && (
           <motion.div 
             initial={{ scale: 0, opacity: 0.7 }}
             animate={{ scale: 3.5, opacity: 0 }}
             transition={{ duration: 0.35, ease: "easeOut" }}
             className="absolute w-12 h-12 bg-white/40 rounded-full pointer-events-none"
             style={{ top: 'calc(50% - 24px)', left: 'calc(50% - 24px)' }}
           />
         )}
         <div className={`w-2.5 h-2.5 rounded-full z-10 ${active ? 'bg-black shadow-[0_0_8px_#ffffff]' : 'bg-[#eab308]/40'}`} />
         <div className="text-[7.5px] font-black uppercase tracking-tighter z-10">
           {name}
         </div>
       </button>
    </div>
  );
}
