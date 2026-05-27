import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { doc, onSnapshot, updateDoc, setDoc, serverTimestamp, collection, query, orderBy, limit } from 'firebase/firestore';
import { db, auth, loginWithGoogle, logout, getUserProfile, saveUserProfile, submitSongRequest } from './lib/firebase.ts';
import { 
  Settings, Home, HelpCircle, Search, Folder, Plus, Music, 
  Play, Pause, Square, SkipBack, Lock, Unlock, 
  Volume2, FastForward, Activity, Mic, Disc,
  Sparkles, Users, Share2, MessageSquare,
  Radio, RotateCcw, Zap, Download, Layout, LayoutPanelTop,
  User, LogOut, Trash2
} from 'lucide-react';
import { Track, WavePoint, DeckState, CrossfaderCurve, AutoDJSettings, SongRequest } from './types.ts';
import { Knob } from './components/Knob.tsx';
import { Waveform } from './components/Waveform.tsx';
import { JogWheel } from './components/JogWheel.tsx';
import { Visualizer } from './components/Visualizer.tsx';
import { PitchCurve } from './components/PitchCurve.tsx';

// --- UTILS ---
const fmtTime = (s: number) => {
  const m = Math.floor(s / 60);
  const x = (s % 60).toFixed(1);
  return `${m.toString().padStart(2, '0')}:${x.padStart(4, '0')}`;
};

const generateDummyWaveform = (len = 4000): WavePoint[] => {
  const d: WavePoint[] = [];
  let energy = 0.3;
  for (let i = 0; i < len; i++) {
    const isBeat = i % 64 < 3;
    const isBar = i % 256 < 3;
    const isPhrase = i % 1024 < 3;
    energy = energy * 0.88 + Math.random() * 0.12;
    let amp = energy;
    if (isBeat) amp = Math.min(1, amp + 0.45);
    if (isBar) amp = Math.min(1, amp + 0.15);
    if (isPhrase) amp = Math.min(1, amp + 0.25);
    d.push({
      amp: Math.max(0.04, amp),
      bass: amp * 0.9 + Math.random() * 0.1,
      mid: amp * 0.6 + Math.random() * 0.25,
      high: amp * 0.3 + Math.random() * 0.5,
      isBeat, isBar, isPhrase
    });
  }
  return d;
};

// --- MUSIC LIBRARY ---
const LIBRARY_TRACKS: Track[] = [
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
  keyShift: 0,
  bpmLocked: false,
  masterTempoLocked: false,
  vinylMode: true,
  slipMode: false,
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
  gridBpm: 130, // Default baseline BPM for initialization
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
  const [activePanel, setActivePanel] = useState<'brow' | 'samp' | 'fx' | 'rec' | 'ai' | 'conf'>('samp');
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
  
  const [dragOverDeckA, setDragOverDeckA] = useState(false);
  const [dragOverDeckB, setDragOverDeckB] = useState(false);
  const [dragOverQueue, setDragOverQueue] = useState(false);

  // Filter track list based on search (by title, artist, or BPM)
  const filteredTracks = LIBRARY_TRACKS.filter(track => {
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
  const masterEqNodes = useRef<{ low: BiquadFilterNode, mid: BiquadFilterNode, high: BiquadFilterNode } | null>(null);
  const recDestRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const lastTimeRef = useRef<number>(0);
  const analyserARef = useRef<AnalyserNode | null>(null);
  const analyserBRef = useRef<AnalyserNode | null>(null);

  // --- MIDI SUPPORT ---
  useEffect(() => {
    if (!navigator.requestMIDIAccess) return;

    const onMIDIMessage = (msg: any) => {
      const [status, data1, data2] = msg.data;
      const type = status & 0xf0;
      
      // Basic mapping: CC 0-127
      if (type === 0xb0) {
        if (data1 === 1) setCrossfaderPos((data2 / 127) * 100);
        if (data1 === 7) setDeckA(prev => ({ ...prev, gain: data2 / 127 }));
      }
      // Note On mapping (e.g. pads)
      if (type === 0x90 && data2 > 0) {
        if (data1 === 60) handlePlayToggle('A');
        if (data1 === 62) handlePlayToggle('B');
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
      masterGainRef.current?.connect(recDestRef.current);
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
      
      // Chain: masterEq -> masterGain -> destination
      low.connect(mid);
      mid.connect(high);
      high.connect(masterGainRef.current);
      masterGainRef.current.connect(audioCtxRef.current.destination);

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
    
    // Simulate smart analysis
    const detectedBpm = 120 + Math.floor(Math.random() * 40);
    const keys = ['Am', 'Bm', 'Cm', 'Dm', 'Em', 'Fm', 'Gm', 'C#m', 'Eb', 'F'];
    const detectedKey = keys[Math.floor(Math.random() * keys.length)];
    
    setDeck(prev => ({
      ...prev,
      buffer: audioBuf,
      total: audioBuf.duration,
      bpm: detectedBpm,
      key: detectedKey,
      gain: calculatedGain, // <-- Auto Gain applied!
      isAnalyzing: false,
      activeTrack: {
        id: Math.random().toString(),
        n: 0,
        title: file.name.replace(/\.[^.]+$/, ''),
        bpm: detectedBpm.toString(),
        key: detectedKey,
        dur: fmtTime(audioBuf.duration)
      }
    }));
  };

  const stopDeck = (id: 'A' | 'B') => {
    const deck = id === 'A' ? deckA : deckB;
    if (deck.source) {
      try { deck.source.stop(); } catch(e) {}
      deck.source.disconnect();
    }
  };

  const playDeck = (id: 'A' | 'B', offset?: number) => {
    const ctx = initAudio();
    const deck = id === 'A' ? deckA : deckB;
    const setDeck = id === 'A' ? setDeckA : setDeckB;
    const analyser = id === 'A' ? analyserARef.current : analyserBRef.current;

    stopDeck(id);
    if (!deck.buffer) return;

    const source = ctx.createBufferSource();
    source.buffer = deck.buffer;
    source.playbackRate.value = (deck.bpm / 160) * (1 + deck.pitchBend / 100); 
    
    // EQ Filters
    const lowNode = ctx.createBiquadFilter();
    lowNode.type = 'lowshelf';
    lowNode.frequency.value = deck.eqCrossovers.loMid;
    lowNode.gain.value = deck.eqKills.low ? -40 : 0;

    const midNode = ctx.createBiquadFilter();
    midNode.type = 'peaking';
    midNode.frequency.value = (deck.eqCrossovers.loMid + deck.eqCrossovers.midHi) / 2;
    midNode.Q.value = 0.8;
    midNode.gain.value = deck.eqKills.mid ? -40 : 0;

    const hiNode = ctx.createBiquadFilter();
    hiNode.type = 'highshelf';
    hiNode.frequency.value = deck.eqCrossovers.midHi;
    hiNode.gain.value = deck.eqKills.hi ? -40 : 0;

    const filterNode = ctx.createBiquadFilter();
    filterNode.type = 'lowpass';
    filterNode.frequency.value = 22000;

    // FX Nodes
    let node1: any = undefined;
    let node2: any = undefined;

    const gainNode = ctx.createGain();
    gainNode.gain.value = deck.gain;

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
      offset: off
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
      node.gain.setTargetAtTime(newVal ? -40 : 0, audioCtxRef.current!.currentTime, 0.01);
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
      const newCues = [...deck.hotCues];
      newCues[index] = deck.elapsed;
      setDeck(prev => ({ ...prev, hotCues: newCues }));
    } else {
      // Jump to cue
      const pos = deck.hotCues[index]!;
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

  const handleLoop = (id: 'A' | 'B', action: 'in' | 'out' | 'size' | 'toggle', val?: number) => {
    const deck = id === 'A' ? deckA : deckB;
    const setDeck = id === 'A' ? setDeckA : setDeckB;
    
    if (action === 'in') {
      setDeck(prev => ({ ...prev, loopIn: (prev.elapsed / prev.total) * 4000, looping: false }));
    } else if (action === 'out') {
      const cur = (deck.elapsed / deck.total) * 4000;
      if (cur > deck.loopIn) {
        setDeck(prev => ({ ...prev, loopOut: cur, looping: true }));
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
    
    // Synthesize a simple sound if no buffer exists
    if (!samplerBuffers[index]) {
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < buf.length; i++) {
        const t = i / ctx.sampleRate;
        // Simple kick-like decay
        data[i] = Math.sin(2 * Math.PI * 60 * (1 - t / 0.5) * t) * Math.exp(-10 * t);
      }
      setSamplerBuffers(prev => ({ ...prev, [index]: buf }));
      playBuffer(buf);
    } else {
      playBuffer(samplerBuffers[index]);
    }

    function playBuffer(buf: AudioBuffer) {
      const source = ctx.createBufferSource();
      source.buffer = buf;
      const samplerGain = ctx.createGain();
      samplerGain.gain.value = 0.5;
      source.connect(samplerGain);
      samplerGain.connect(masterGainRef.current || ctx.destination);
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
       deck.source.playbackRate.setTargetAtTime((deck.bpm / 160) * (1 + amount / 100), audioCtxRef.current!.currentTime, 0.05);
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
    
    // Simulate thinking/fetching
    await new Promise(r => setTimeout(r, 1200));

    // Synthesize a generic waveform for the dummy track
    const buf = ctx.createBuffer(2, ctx.sampleRate * 180, ctx.sampleRate); // 3 min empty buffer
    
    // Perceived Auto-Gain Normalization (RMS mockup)
    const normalizedGain = getDummyTrackNormalizedGain(track.title);
    
    setDeck(prev => ({
      ...prev,
      buffer: buf,
      total: buf.duration,
      bpm: parseInt(track.bpm),
      key: track.key,
      gain: normalizedGain, // <-- Auto Gain applied!
      isAnalyzing: false,
      activeTrack: track,
      gridBpm: parseInt(track.bpm) || 128,
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
    const otherDeck = id === 'A' ? deckB : deckA;
    const setDeck = id === 'A' ? setDeckA : setDeckB;
    setDeck(prev => ({ ...prev, bpm: otherDeck.bpm, bpmLocked: !prev.bpmLocked }));
  };

  const handleUpdateDeck = useCallback((id: 'A' | 'B', updates: Partial<DeckState>) => {
    const setDeck = id === 'A' ? setDeckA : setDeckB;
    setDeck(prev => ({ ...prev, ...updates }));
  }, []);

  // --- SYNC LOCK LOGIC ---
  useEffect(() => {
    if (deckA.bpmLocked && deckB.bpm !== deckA.bpm) {
      setDeckA(prev => ({ ...prev, bpm: deckB.bpm }));
    }
  }, [deckB.bpm]);

  useEffect(() => {
    if (deckB.bpmLocked && deckA.bpm !== deckB.bpm) {
      setDeckB(prev => ({ ...prev, bpm: deckA.bpm }));
    }
  }, [deckA.bpm]);

  const toggleDeckSetting = (id: 'A' | 'B', setting: 'vinylMode' | 'quantize' | 'slipMode') => {
    const setDeck = id === 'A' ? setDeckA : setDeckB;
    setDeck(prev => ({ ...prev, [setting]: !prev[setting] }));
  };

  const handlePlayToggle = (id: 'A' | 'B') => {
    const deck = id === 'A' ? deckA : deckB;
    if (deck.playing) {
      const elapsed = deck.elapsed;
      stopDeck(id);
      const setDeck = id === 'A' ? setDeckA : setDeckB;
      setDeck(prev => ({ ...prev, playing: false, elapsed }));
    } else {
      playDeck(id);
    }
  };

  const handleSeek = (id: 'A' | 'B', newPos: number) => {
    const setDeck = id === 'A' ? setDeckA : setDeckB;
    setDeck(prev => {
      const newElapsed = (newPos / 4000) * prev.total;
      return { ...prev, elapsed: newElapsed, offset: newElapsed };
    });
  };

  const handleScratch = (id: 'A' | 'B', delta: number) => {
    setJogAngles(prev => ({ ...prev, [id]: prev[id] + delta * 0.015 }));
    const setDeck = id === 'A' ? setDeckA : setDeckB;
    setDeck(prev => {
      const move = delta * 0.5;
      const newPos = Math.max(0, Math.min(3999, (prev.elapsed / prev.total) * 4000 + move));
      const newElapsed = (newPos / 4000) * prev.total;
      return { ...prev, elapsed: newElapsed };
    });
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
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [deckA.playing, deckB.playing, deckA.hotCues, deckB.hotCues]);

  // --- ANIMATION LOOP ---
  useEffect(() => {
    const loop = (ts: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = ts;
      const dt = (ts - lastTimeRef.current) / 1000;
      lastTimeRef.current = ts;

      if (deckA.playing) {
        setDeckA(prev => {
          const spd = prev.bpm / 160;
          let next;
          if (audioCtxRef.current && prev.source) {
             next = prev.offset + (audioCtxRef.current.currentTime - prev.startTime);
          } else {
             next = Math.min(prev.total, prev.elapsed + dt * spd);
          }
          if (prev.looping && prev.loopIn >= 0 && prev.loopOut > prev.loopIn) {
             const curPos = (next / prev.total) * 4000;
             if (curPos >= prev.loopOut) {
                const retryOffset = (prev.loopIn / 4000) * prev.total;
                // For real audio, we'd need to re-trigger playDeck here
                return { ...prev, elapsed: retryOffset };
             }
          }
          return { 
            ...prev, 
            elapsed: next,
            pitchHistory: [...prev.pitchHistory.slice(-99), prev.pitch]
          };
        });
        setJogAngles(prev => ({ ...prev, A: prev.A + dt * (deckA.bpm / 60) * 2 * Math.PI * 0.25 }));
      }

      if (deckB.playing) {
        setDeckB(prev => {
          const spd = prev.bpm / 160;
          let next;
          if (audioCtxRef.current && prev.source) {
             next = prev.offset + (audioCtxRef.current.currentTime - prev.startTime);
          } else {
             next = Math.min(prev.total, prev.elapsed + dt * spd);
          }
          return { 
            ...prev, 
            elapsed: next,
            pitchHistory: [...prev.pitchHistory.slice(-99), prev.pitch]
          };
        });
        setJogAngles(prev => ({ ...prev, B: prev.B + dt * (deckB.bpm / 60) * 2 * Math.PI * 0.25 }));
      }

      requestAnimationFrame(loop);
    };
    const frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
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
      <div className="h-[21px] bg-linear-to-b from-[#4a4a4a] to-[#2c2c2c] border-b-2 border-black flex items-center px-1.5 shrink-0 z-50">
        <button 
          onClick={() => setActivePanel('conf')}
          className={`bg-linear-to-b border rounded-sm text-[9px] font-bold px-2 py-px flex items-center gap-1 transition-all ${
            activePanel === 'conf' ? 'from-[#a8f] to-[#639] border-[#a8f] text-white' : 'from-[#5a5a5a] to-[#333] border-[#777] border-b-[#222] text-[#eee] hover:brightness-110'
          }`}
        >
          <Settings size={9} /> CONFIG
        </button>
        <div className="vj-logo px-1.5 py-px text-[10px] font-bold tracking-tight mx-2 rounded-sm border-[#900] border">
          BAD N3WS RIDDIM DJ
        </div>
        <div className="flex gap-4">
          <span className="flex items-center gap-1 text-[10px] text-[#ddd] cursor-pointer hover:bg-white/10 px-2 rounded-sm transition-colors"><Home size={9} /> Home</span>
          <span className="flex items-center gap-1 text-[10px] text-[#ddd] cursor-pointer hover:bg-white/10 px-2 rounded-sm transition-colors"><HelpCircle size={9} /> Help</span>
        </div>
      </div>

      {/* HEADER WITH SPECTRUM (edjing style) */}
      <div className="h-9 bg-linear-to-b from-[#1a1a1a] to-black border-b border-white/5 flex items-center px-3 gap-4 shrink-0 relative overflow-hidden">
        <div className="flex items-center gap-2">
           <Disc className="text-[#a8f] animate-[spin_4s_linear_infinite]" size={20} />
           <h1 className="text-sm font-black tracking-tighter text-white font-display">VIRTUAL<span className="text-[#a8f]">DJ</span> <span className="text-[10px] font-medium text-[#666] ml-1 uppercase">PRO Elite</span></h1>
        </div>

        <div className="flex-1 h-full mx-8 flex items-center justify-center gap-px opacity-30">
           {[...Array(64)].map((_, i) => (
             <motion.div 
               key={i}
               style={{ height: `${Math.random() * 80}%` }}
               animate={{ height: [`${Math.random() * 40}%`, `${Math.random() * 90}%`, `${Math.random() * 30}%`] }}
               transition={{ duration: 0.5 + Math.random(), repeat: Infinity, ease: "easeInOut" }}
               className="w-1 bg-linear-to-t from-[#a8f] to-[#4af] rounded-t-sm"
             />
           ))}
        </div>
        
        <div className="flex items-center gap-4">
          {currentUser ? (
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 pl-1 pr-2 py-0.5 rounded-full">
              {currentUser.photoURL ? (
                <img src={currentUser.photoURL} alt="" className="w-5 h-5 rounded-full" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-[#a8f] flex items-center justify-center text-[10px] text-white font-bold">
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

          <div className="flex items-center gap-2">
            <button 
              onClick={() => setShowBrowser(!showBrowser)}
              className={`flex items-center gap-1.5 text-[9px] font-bold px-2 py-1 rounded-sm border transition-all ${
                !showBrowser ? 'bg-[#a8f] border-[#a8f] text-white' : 'bg-white/5 border-white/10 text-[#eee]'
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
             <span className="text-[10px] font-mono font-bold text-[#4af]">MASTER BPM:</span>
             <span className="text-[11px] font-mono font-bold text-white tracking-widest">
                {masterBpm.toFixed(1)}
             </span>
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
      <div className="flex-1 flex min-h-0">
        {/* DECK A */}
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
            onScratch={(d) => handleScratch('A', d)}
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
            phaseOffset={phaseDiff}
          />
        </div>
        
        {/* MIXER */}
        <Mixer 
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
        />
 
        {/* DECK B */}
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
            onScratch={(d) => handleScratch('B', d)}
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
            phaseOffset={-phaseDiff}
          />
        </div>
      </div>

      {/* BOTTOM SECTIONS */}
      {showBrowser && (
        <>
          {/* BOTTOM TABS */}
          <div className="h-[22px] bg-linear-to-b from-[#252525] to-[#1a1a1a] border-t-2 border-[#333] border-b border-[#2a2a2a] flex items-center px-1.5 gap-1 shrink-0">
            <Tab on={activePanel === 'brow'} onClick={() => setActivePanel('brow')}>BROWSER</Tab>
            <Tab on={activePanel === 'samp'} onClick={() => setActivePanel('samp')}>SAMPLER</Tab>
            <Tab on={activePanel === 'fx'} onClick={() => setActivePanel('fx')}>EFFECTS</Tab>
            <Tab on={activePanel === 'rec'} onClick={() => setActivePanel('rec')}>RECORD</Tab>
          </div>

          {/* PANELS */}
          <div className="h-[165px] relative overflow-hidden bg-black/20 shrink-0">
            <AnimatePresence mode="wait">
              {activePanel === 'ai' && (
                <motion.div 
                  key="ai"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 p-3 flex flex-col bg-linear-to-b from-[#1a0022] to-[#0a0a0a]"
                >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-[#a8f] font-bold text-[10px] uppercase tracking-widest">
                  <Sparkles size={12} /> AI MIX RECOMMENDATIONS
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setVisMode('bars')} className={`text-[8px] px-2 py-0.5 rounded-sm border ${visMode === 'bars' ? 'bg-[#a8f] text-[#102] border-[#a8f]' : 'border-white/10 text-[#666]'}`}>BARS</button>
                  <button onClick={() => setVisMode('wave')} className={`text-[8px] px-2 py-0.5 rounded-sm border ${visMode === 'wave' ? 'bg-[#a8f] text-[#102] border-[#a8f]' : 'border-white/10 text-[#666]'}`}>WAVE</button>
                  <button onClick={() => setVisMode('particles')} className={`text-[8px] px-2 py-0.5 rounded-sm border ${visMode === 'particles' ? 'bg-[#a8f] text-[#102] border-[#a8f]' : 'border-white/10 text-[#666]'}`}>PULSE</button>
                </div>
              </div>
              <div className="flex-1 flex gap-3 overflow-x-auto pb-1 custom-scrollbar">
                {suggestions.map((s, i) => (
                  <div key={i} className="min-w-[180px] bg-white/5 border border-white/10 rounded-md p-2 flex flex-col gap-1.5 hover:border-[#a8f]/50 transition-all group">
                    <div className="flex justify-between items-start">
                      <div className="font-bold text-[10px] text-[#eee] truncate w-full">{s.title}</div>
                    </div>
                    <div className="text-[8px] text-[#a8f] uppercase font-display">{s.artist}</div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-mono text-[#4c4]">{s.bpm} BPM</span>
                      <div className="h-px flex-1 bg-white/10" />
                    </div>
                    <div className="text-[7.5px] text-[#888] italic leading-tight bg-black/30 p-1.5 rounded-sm border border-white/5 group-hover:text-white transition-colors">
                      "{s.mixingTip}"
                    </div>
                    <div className="mt-auto flex gap-1 pt-1 border-t border-white/5">
                      <button className="flex-1 bg-[#1a1c3a] border border-[#38f]/30 text-[#8bf] text-[7.5px] font-bold py-1 rounded-sm hover:brightness-125">LOAD A</button>
                      <button className="flex-1 bg-[#2a1a1c] border border-[#d22]/30 text-[#f88] text-[7.5px] font-bold py-1 rounded-sm hover:brightness-125">LOAD B</button>
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
               className="absolute inset-0 p-4 grid grid-cols-3 gap-6 bg-[#0a0a0a]/90 backdrop-blur-md"
             >
               <div className="flex flex-col gap-3">
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
               <div className="flex flex-col gap-3">
                 <h3 className="text-[10px] font-bold text-[#4af] border-b border-[#4af]/20 pb-1">AUDIO ENGINE</h3>
                 <div className="flex flex-col gap-1">
                   <span className="text-[8px] text-[#666]">Buffer Size (ms)</span>
                   <select className="bg-black border border-[#333] text-[9px] p-1 rounded">
                     <option>2.5 ms (Ultra Low)</option>
                     <option selected>5.0 ms (Optimal)</option>
                     <option>10.0 ms (Safe)</option>
                   </select>
                 </div>
                 <div className="flex flex-col gap-1">
                   <span className="text-[8px] text-[#666]">Sample Rate</span>
                   <select className="bg-black border border-[#333] text-[9px] p-1 rounded">
                     <option>44100 Hz</option>
                     <option selected>48000 Hz</option>
                   </select>
                 </div>
               </div>
               <div className="flex flex-col gap-3">
                 <h3 className="text-[10px] font-bold text-[#4c4] border-b border-[#4c4]/20 pb-1">HARDWARE</h3>
                 <div className="bg-black/40 p-2 rounded border border-white/5 flex flex-col gap-2">
                   <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#4c4] animate-pulse"/>
                      <span className="text-[9px]">MIDI CONTROLLER DETECTED</span>
                   </div>
                   <button className="text-[8px] bg-white/5 border border-white/10 py-1 rounded hover:bg-white/10 uppercase font-bold">Rescan Bus</button>
                 </div>
               </div>
               <button 
                  onClick={() => setActivePanel('samp')}
                  className="absolute bottom-4 right-4 text-[9px] font-bold text-[#888] hover:text-white"
               >CLOSE SETTINGS</button>
             </motion.div>
          )}
          {activePanel === 'samp' && (
             <motion.div 
               key="samp"
               initial={{ opacity: 0, y: 10 }}
               animate={{ opacity: 1, y: 0 }}
               exit={{ opacity: 0, y: -10 }}
               className="absolute inset-0 p-1 flex gap-1"
             >
               {[...Array(12)].map((_, i) => (
                 <SamplerPad key={i} index={i} onTrigger={() => handleSamplerTrigger(i)} />
               ))}
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
      onChange(100 - pct);
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
    <div className={`flex flex-col items-center gap-1 ${className}`}>
      {label && <span className="text-[6.5px] text-[#666] tracking-widest">{label}</span>}
      <div 
        ref={trackRef}
        className="w-4 h-24 fader-track rounded-full relative cursor-pointer group"
        onMouseDown={handleMouseDown}
      >
        {/* Scale lines */}
        {[...Array(11)].map((_, i) => (
          <div key={i} className="absolute left-[-2px] right-[-2px] h-px bg-white/10" style={{ top: `${i * 10}%` }} />
        ))}
        
        <motion.div 
          className="absolute left-1/2 -translateX-1/2 w-6 h-3 bg-linear-to-b from-[#888] via-[#444] to-[#222] border border-[#aaa]/30 rounded-[2px] shadow-lg cursor-grab active:cursor-grabbing z-10"
          style={{ bottom: `${value}%`, transform: 'translate(-50%, 50%)' }}
        >
          <div className="absolute inset-x-1.5 top-1/2 -translate-y-1/2 h-px bg-white/40" />
        </motion.div>
      </div>
    </div>
  );
}

function Deck({ id, state, angle, zoom, onZoomChange, onPitchBend, onEqCrossover, analyser, visMode, onToggle, onSeek, onScratch, onSync, onKeySync, onHotCue, onClearHotCue, onFxToggle, onFxType, onFxParamChange, onLoop, onKeyLock, onPreCue, onLoad, onUpdateDeck, phaseOffset }: { 
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
  onScratch: (d: number) => void,
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
  phaseOffset?: number
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [padMode, setPadMode] = useState<'hotcue' | 'loop'>('hotcue');
  const [padClearMode, setPadClearMode] = useState(false);
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
          cues={state.cuePoints} 
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
            
            <div className="text-[6.5px] font-mono text-[#888] flex gap-1">
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
              className="flex-1 h-5 bg-linear-to-b from-[#241a3a] to-[#120d1f] hover:from-[#3d2c5e] hover:to-[#1e1533] border border-[#a8f]/30 hover:border-[#a8f]/60 rounded-sm text-[#cbf] hover:text-white text-[7px] font-bold uppercase transition-all flex items-center justify-center gap-0.5 select-none cursor-pointer active:scale-[0.97] btn-glow-indigo"
              title="Tap Tempo (Multiple times to calculate BPM & align downbeat)"
            >
              <Sparkles size={7} className="animate-pulse text-[#bbf]" />
              TAP
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
      <div className="flex h-[37px] border border-[#222] rounded-sm overflow-hidden text-[6.5px] uppercase">
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
        <Knob size="md" label="Filter" max={100} min={-100} defaultValue={0} color="#aa44ff" />
        <Knob size="md" label="Key" max={12} min={-12} defaultValue={0} color="#f83" />
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
              className={`flex-1 h-[32px] rounded-full border text-[9px] font-black tracking-widest uppercase transition-all duration-150 active:scale-[0.93] cursor-pointer select-none flex items-center justify-center ${
                Object.keys(state.cuePoints).length 
                  ? 'bg-gradient-to-b from-[#ff9500] to-[#cc7600] border-[#ffb03a] text-black font-black shadow-[0_0_10px_rgba(255,149,0,0.5),inset_0_1px_3px_rgba(255,255,255,0.4)]' 
                  : 'bg-gradient-to-b from-[#25262c] to-[#14151a] border-[#3b3c46] text-[#666] shadow-[inset_0_1px_1px_rgba(255,255,255,0.05),0_1px_2px_rgba(0,0,0,0.4)] hover:text-[#999] hover:border-[#4c4e5a]'
              }`}
              title="Set and Trigger Temporary Cue Point"
            >
              CUE
            </button>

            {/* PAUSE Button */}
            <button 
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

        <JogWheel deck={id} angle={angle} playing={state.playing} onScratch={onScratch} size={210} />

        <div className="flex flex-col items-center gap-0.5 py-1 w-[26px]">
           <span className="text-[6.5px] text-[#666] tracking-tighter">PITCH</span>
           <div className="flex-1 w-4 bg-linear-to-b from-[#0a0a0a] via-[#181818] to-[#0a0a0a] border border-[#333] rounded-full relative cursor-pointer group">
              <div className="absolute left-1/2 -translate-x-1/2 w-[22px] h-[10px] bg-linear-to-b from-[#888] via-[#555] to-[#444] border border-[#aaa] rounded-sm shadow-lg top-1/2 -mt-1 group-active:cursor-grabbing" />
              <div className="absolute left-[-2px] right-[-2px] top-1/2 h-px bg-white/20 pointer-events-none" />
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

function Mixer({ crossfaderPos, onCrossfadeChange, masterFx, onMasterFxChange, onEqKill, onAutomix, masterEq, onMasterEqChange, crossfaderCurve, onCurveChange, deckA, deckB, onEqCrossoverChange, masterTempoLock, onMasterTempoToggle }: { 
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
  onMasterTempoToggle: () => void
}) {
  return (
    <div className="w-[185px] bg-linear-to-b from-[#1c1d1f] to-[#0d0d0f] border-x-2 border-[#25272a] flex flex-col p-1 gap-1 shadow-2xl relative">
      <div className="flex gap-0.5">
        <button 
          onClick={onMasterTempoToggle}
          className={`flex-1 h-4.5 border rounded-sm text-[7px] font-bold transition-all ${
            masterTempoLock ? 'bg-[#a8f] border-[#a8f] text-white btn-glow-accent' : 'bg-[#1a1a1a] border-[#2a2a2a] text-[#555]'
          }`}
        >MT LOCK</button>
        <div className="flex-1 h-4.5 bg-[#3a3a3a] border border-[#444] rounded-sm text-[7.5px] font-bold text-white flex items-center justify-center">MIXER</div>
        <div className="flex-1 h-4.5 bg-[#1a1a1a] border border-[#2a2a2a] rounded-sm text-[7.5px] font-bold text-[#555] flex items-center justify-center">STEMS</div>
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
        <ChannelStrip id="A" onEqKill={onEqKill} eqKills={deckA.eqKills} crossovers={deckA.eqCrossovers} onCrossoverChange={onEqCrossoverChange} />
        <div className="flex flex-col gap-0.5 mt-auto mb-2 flex-1 items-center">
           <div className="text-[6px] text-[#444] mb-1">VU</div>
           <div className="flex gap-1.5 h-[85%]">
             <VUMeter side="L" />
             <VUMeter side="R" />
           </div>
        </div>
        <ChannelStrip id="B" onEqKill={onEqKill} eqKills={deckB.eqKills} crossovers={deckB.eqCrossovers} onCrossoverChange={onEqCrossoverChange} />
      </div>

      <div className="mt-auto px-2 pb-2">
        <div className="text-[7px] text-[#666] text-center tracking-widest mb-1.5 font-display uppercase">CROSSFADER</div>
        <div 
          className="h-3.5 bg-linear-to-b from-[#080808] to-[#161616] border border-[#2a2a2a] rounded-full relative cursor-pointer"
          onMouseDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const update = (ev: MouseEvent) => {
              const pct = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
              onCrossfadeChange(pct);
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
          <div className="absolute top-1/2 -translate-y-1/2 left-[8px] right-[8px] h-px bg-linear-to-r from-[#4af] via-[#333] to-[#e33] opacity-40" />
          {/* Marks */}
          <div className="absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px bg-white/20" />
          
          <motion.div 
            className="absolute top-1/2 -translate-y-1/2 w-5 h-6 bg-linear-to-b from-[#999] via-[#666] to-[#333] border border-white/20 rounded-[2px] shadow-2xl z-20" 
            style={{ left: `${crossfaderPos}%`, marginLeft: '-10px' }}
          >
            <div className="absolute inset-y-1.5 left-1/2 -translate-x-1/2 w-px bg-white/40 shadow-[0_0_2px_white]" />
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function ChannelStrip({ id, onEqKill, eqKills, crossovers, onCrossoverChange }: { id: 'A' | 'B', onEqKill: (id: 'A' | 'B', band: 'hi' | 'mid' | 'low') => void, eqKills: { hi: boolean, mid: boolean, low: boolean }, crossovers: { loMid: number, midHi: number }, onCrossoverChange: (id: 'A' | 'B', type: 'loMid' | 'midHi', val: number) => void }) {
  return (
    <div className="flex flex-col items-center gap-2 pt-1 relative">
      <div className="flex flex-col items-center gap-1 group">
        <Knob size="sm" label="HI" color="#f44" />
        <button 
          onClick={() => onEqKill(id, 'hi')}
          className={`text-[6px] px-1 rounded-sm border transition-all ${eqKills.hi ? 'bg-[#ffcc00] text-[#222] border-[#ffcc00] btn-glow-warning' : 'bg-black/40 text-[#666] border-[#444]'}`}
        >KILL</button>
        <div className="absolute top-0 right-[-15px] opacity-0 group-hover:opacity-100 transition-opacity z-50 bg-black p-1 border border-white/10 rounded">
           <Knob size="xs" label="XOVER" min={1500} max={6000} value={crossovers.midHi} onChange={(v) => onCrossoverChange(id, 'midHi', v)} />
        </div>
      </div>
      
      <DraggableFader value={75} onChange={() => {}} label="VOL" />
      
      <div className="flex flex-col items-center gap-1 group">
        <Knob size="sm" label="MID" color="#fa0" />
        <button 
          onClick={() => onEqKill(id, 'mid')}
          className={`text-[6px] px-1 rounded-sm border transition-all ${eqKills.mid ? 'bg-[#ff8800] text-white border-[#ff8800] btn-glow-warning shadow-[0_0_8px_rgba(255,136,0,0.4)]' : 'bg-black/40 text-[#666] border-[#444]'}`}
        >KILL</button>
      </div>

      <div className="flex flex-col items-center gap-1 group">
        <Knob size="sm" label="LOW" color="#48f" />
        <button 
          onClick={() => onEqKill(id, 'low')}
          className={`text-[6px] px-1 rounded-sm border transition-all ${eqKills.low ? 'bg-[#ee2222] text-white border-[#f44] btn-glow-danger' : 'bg-black/40 text-[#666] border-[#444]'}`}
        >KILL</button>
        <div className="absolute bottom-10 right-[-15px] opacity-0 group-hover:opacity-100 transition-opacity z-50 bg-black p-1 border border-white/10 rounded">
           <Knob size="xs" label="XOVER" min={80} max={600} value={crossovers.loMid} onChange={(v) => onCrossoverChange(id, 'loMid', v)} />
        </div>
      </div>

      <button className={`w-full h-4 rounded-sm text-[8px] font-bold tracking-tight border transition-all ${
        id === 'B' ? 'bg-[#ee2222]/80 border-[#f44] text-white btn-glow-danger' : 'bg-[#2a2a2a] border-[#444] text-[#888] hover:text-[#bbb] hover:bg-[#353535]'
      }`}>PFL</button>
    </div>
  );
}
function VUMeter({ side }: { side: string }) {
  const [lit, setLit] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setLit(Math.floor(Math.random() * 18)), 50);
    return () => clearInterval(iv);
  }, []);

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
    <div className={`flex-1 flex flex-col items-center p-1 gap-1 border rounded-[3px] transition-all bg-linear-to-b from-[#191919] to-[#111] ${
      active ? 'border-[#a8f] btn-glow-accent' : 'border-[#222]'
    }`}>
       <button 
         onClick={() => {
           onTrigger();
           setActive(true);
           setTimeout(() => setActive(false), 200);
         }}
         className={`w-full h-full border rounded-sm flex flex-col items-center justify-center gap-1 transition-all relative overflow-hidden ${
           active ? 'bg-[#a8f] text-[#102]' : 'bg-[#2e2e2e] border-[#3a3a3a] text-[#888] hover:text-white'
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
         <div className={`w-3 h-3 rounded-full z-10 ${active ? 'bg-white' : 'bg-[#a8f]/40'}`} />
         <div className="text-[7px] font-bold uppercase tracking-tighter z-10">
           {name}
         </div>
       </button>
    </div>
  );
}
