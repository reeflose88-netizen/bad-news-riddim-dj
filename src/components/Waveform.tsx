import React, { useRef, useEffect } from 'react';
import { WavePoint } from '../types';

interface WaveformProps {
  data: WavePoint[];
  pos: number;
  zoom: number;
  loopIn?: number;
  loopOut?: number;
  cues: { [key: number]: number };
  onSeek: (pos: number) => void;
  onZoomChange: (zoom: number) => void;
  elapsedTime: number;
  totalDuration: number;
  gridBpm?: number;
  gridOffset?: number;
  showGrid?: boolean;
  phaseOffset?: number;
  quantize?: boolean;
}

export const Waveform: React.FC<WaveformProps> = ({
  data,
  pos,
  zoom,
  loopIn = -1,
  loopOut = -1,
  cues,
  onSeek,
  onZoomChange,
  elapsedTime,
  totalDuration,
  gridBpm = 120,
  gridOffset = 0,
  showGrid = true,
  phaseOffset,
  quantize = false
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const panStartRef = useRef<{ x: number, pos: number } | null>(null);
  const [dimensions, setDimensions] = React.useState({ width: 400, height: 58 });
  const [hoverX, setHoverX] = React.useState<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      setDimensions({
        width: Math.floor(width) || 400,
        height: Math.floor(height) || 58
      });
    });

    resizeObserver.observe(container);
    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data.length) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = dimensions.width;
    const H = dimensions.height;

    // Scale canvas buffer for crisp high-DPI graphics
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    // Organic space-grade deep obsidian black base with a subtle midnight indigo gradient
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#04050a');
    bgGrad.addColorStop(0.5, '#020306');
    bgGrad.addColorStop(1, '#05070c');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    const playX = Math.floor(W * 0.3);
    const startIdx = Math.round(pos - playX / zoom);
    const centerY = H / 2;
    const maxH = H - 12; // Maintain solid 6px padding at both top and bottom edges

    // --- TELEMETRY DASHBOARD BACKGROUND DESIGN ---
    // 1. Dotted and faint horizontal level gridlines with dB labels
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.015)';
    ctx.lineWidth = 0.55;
    ctx.setLineDash([3, 6]);
    
    // Telemetry lines representing dB levels
    const gridLevels = [
      { yLvl: 0.12, label: '0dB' },
      { yLvl: 0.28, label: '-6dB' },
      { yLvl: 0.50, label: 'MID' },
      { yLvl: 0.72, label: '-18dB' },
      { yLvl: 0.88, label: '-INF' }
    ];

    gridLevels.forEach((level, idx) => {
      const y = Math.floor(H * level.yLvl);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();

      // Render ultra-crisp micro dB readings in margins
      if (idx !== 2) { // Skip center
        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.font = '500 5px "JetBrains Mono", monospace';
        ctx.fillText(level.label, 4, y - 2);
        ctx.fillText(level.label, W - 18, y - 2);
      }
    });
    ctx.restore();

    // 2. Fine-grain time ruler graduations on top and bottom borders
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
    ctx.lineWidth = 0.75;
    for (let tx = 0; tx < W; tx += 12) {
      // Top tick
      ctx.beginPath();
      ctx.moveTo(tx, 0);
      ctx.lineTo(tx, tx % 60 === 0 ? 4 : 2);
      ctx.stroke();

      // Bottom tick
      ctx.beginPath();
      ctx.moveTo(tx, H);
      ctx.lineTo(tx, H - (tx % 60 === 0 ? 4 : 2));
      ctx.stroke();
    }
    ctx.restore();

    // Arrays to collect peak coordinates to render beautiful continuous glowing vector envelope lines
    const upperPeaks: { x: number, y: number }[] = [];
    const lowerPeaks: { x: number, y: number }[] = [];

    // --- RENDER DENSE SPECTRAL COMB FILTER WAVE ----
    for (let x = 0; x < W; x++) {
      const di = startIdx + Math.floor(x / zoom);
      if (di < 0 || di >= data.length) continue;
      const pt = data[di];
      if (!pt) continue;

      // Phrase dividers: elegant glowing amber golden gates
      if (pt.isPhrase) {
        ctx.fillStyle = 'rgba(245, 158, 11, 0.25)';
        ctx.fillRect(x, 0, 1, H);
        continue;
      }

      // Bar guides inside background
      if (pt.isBar) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(x, 0, 1, H);
      } else if (pt.isBeat) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.015)';
        ctx.fillRect(x, 0, 1, H);
      }

      // MULTI-SPECTRAL HIGH-FIDELITY OVERLAPPING STACK (Pioneer Nexus / AlphaTheta vibe)
      // We render the composite frequencies with precise glowing opacities.
      
      // 1. SUB-BASS RESONANCE (Thick premium electric neon pink/purple floor aura)
      const bassAmp = Math.min(1.0, pt.bass * 1.12);
      const bassH = Math.max(1, bassAmp * maxH);
      const bassTop = centerY - bassH / 2;
      
      const bassGrad = ctx.createLinearGradient(x, bassTop, x, bassTop + bassH);
      bassGrad.addColorStop(0, 'rgba(236, 72, 153, 0.03)');
      bassGrad.addColorStop(0.5, 'rgba(217, 70, 239, 0.18)');
      bassGrad.addColorStop(1, 'rgba(236, 72, 153, 0.03)');
      ctx.fillStyle = bassGrad;
      ctx.fillRect(x, Math.floor(bassTop), 1, Math.floor(bassH));

      // 2. CRISTALLINE MIDRANGE (Vibrant glowing turquoise-cyan core for instruments, synth and vocals)
      const midAmp = Math.min(1.0, pt.mid * 0.98);
      const midH = Math.max(1, midAmp * (maxH - 3));
      const midTop = centerY - midH / 2;

      const midGrad = ctx.createLinearGradient(x, midTop, x, midTop + midH);
      midGrad.addColorStop(0, 'rgba(6, 182, 212, 0.1)');
      midGrad.addColorStop(0.5, 'rgba(16, 185, 129, 0.45)'); // Emerald warmth inside cyan core
      midGrad.addColorStop(1, 'rgba(6, 182, 212, 0.1)');
      ctx.fillStyle = midGrad;
      ctx.fillRect(x, Math.floor(midTop), 1, Math.floor(midH));

      // 3. TRANSIENT HIGHS / PEAKS (Icy cobalt blue/white sharp needle needles for hi-hats/snares)
      const highAmp = Math.min(1.0, pt.high * 0.92);
      const highH = Math.max(1, highAmp * (maxH - 6));
      const highTop = centerY - highH / 2;
      
      let highColor = 'rgba(224, 242, 254, 0.82)'; // Diamond polar white
      if (pt.high > 0.65) {
        highColor = 'rgba(253, 224, 71, 0.95)'; // Flare golden peaks on sudden spikes
      } else if (pt.high > 0.32) {
        highColor = 'rgba(103, 232, 249, 0.88)'; // Cool neon ice
      }
      ctx.fillStyle = highColor;
      ctx.fillRect(x, Math.floor(highTop), 1, Math.floor(highH));

      // Record peak envelope coordinates for the premium vector trace
      upperPeaks.push({ x, y: highTop });
      lowerPeaks.push({ x, y: highTop + highH });
    }

    // --- PREMIUM VECTOR TRACE OVERLAY (Continuous Analog Crest) ---
    // Smooth connected crest line across peaks adds substantial production value
    if (upperPeaks.length > 1) {
      ctx.save();
      
      // Upper Crest Glowing Path
      ctx.beginPath();
      ctx.moveTo(upperPeaks[0].x, upperPeaks[0].y);
      for (let i = 1; i < upperPeaks.length; i++) {
        ctx.lineTo(upperPeaks[i].x, upperPeaks[i].y);
      }
      ctx.strokeStyle = 'rgba(224, 242, 254, 0.4)';
      ctx.lineWidth = 0.95;
      ctx.stroke();

      // Lower Crest Glowing Path
      ctx.beginPath();
      ctx.moveTo(lowerPeaks[0].x, lowerPeaks[0].y);
      for (let i = 1; i < lowerPeaks.length; i++) {
        ctx.lineTo(lowerPeaks[i].x, lowerPeaks[i].y);
      }
      ctx.strokeStyle = 'rgba(103, 232, 249, 0.28)';
      ctx.lineWidth = 0.95;
      ctx.stroke();

      ctx.restore();
    }

    // --- GHOST-TRACK PERFECT ALIGNMENT ASSIST OVERLAY ---
    const showGhost = phaseOffset !== undefined && Math.abs(phaseOffset) < 0.25 && gridBpm && totalDuration;
    if (showGhost) {
      const beatInterval = 60 / gridBpm;
      // Calculate how many indices of the 4000-point wave correspond to the current phase offset
      const indexOffset = phaseOffset * beatInterval * (4000 / totalDuration);
      
      const ghostOpacity = Math.max(0, 1 - (Math.abs(phaseOffset) / 0.25)) * 0.45;
      const isPerfect = Math.abs(phaseOffset) < 0.02;
      const ghostColor = isPerfect 
        ? `rgba(16, 185, 129, ${ghostOpacity * 1.5})` // Vibrant emerald
        : `rgba(251, 191, 36, ${ghostOpacity})`;    // Amber golden alignment shadow

      ctx.save();
      ctx.strokeStyle = ghostColor;
      ctx.lineWidth = 1.0;
      ctx.setLineDash([2, 4]); // Beautiful dotted/dashed futuristic line
      
      ctx.beginPath();
      let first = true;
      
      for (let x = 0; x < W; x += 2) { // Step by 2 pixels for extreme performance and a dotted look
        const diRaw = startIdx + Math.round(x / zoom);
        const diGhost = Math.round(diRaw + indexOffset);
        
        if (diGhost >= 0 && diGhost < data.length) {
          const ptGhost = data[diGhost];
          if (ptGhost) {
            // Draw ghost peak envelope
            const highAmp = Math.min(1.0, ptGhost.high * 0.92);
            const highH = Math.max(1, highAmp * (maxH - 6));
            const highTop = centerY - highH / 2;
            
            if (first) {
              ctx.moveTo(x, highTop);
              first = false;
            } else {
              ctx.lineTo(x, highTop);
            }
          }
        }
      }
      ctx.stroke();

      // Lower envelope of ghost track
      ctx.beginPath();
      first = true;
      for (let x = 0; x < W; x += 2) {
        const diRaw = startIdx + Math.round(x / zoom);
        const diGhost = Math.round(diRaw + indexOffset);
        
        if (diGhost >= 0 && diGhost < data.length) {
          const ptGhost = data[diGhost];
          if (ptGhost) {
            const highAmp = Math.min(1.0, ptGhost.high * 0.92);
            const highH = Math.max(1, highAmp * (maxH - 6));
            const highTop = centerY - highH / 2;
            const highBtm = highTop + highH;
            
            if (first) {
              ctx.moveTo(x, highBtm);
              first = false;
            } else {
              ctx.lineTo(x, highBtm);
            }
          }
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    // --- CDJ/SOFTWARE PRO BEATGRID OVERLAY DISPLAY ---
    if (showGrid && gridBpm && totalDuration) {
      const beatInterval = 60 / gridBpm;
      const pxPerSec = zoom * (4000 / totalDuration);
      
      const t_left = elapsedTime - playX / pxPerSec;
      const t_right = elapsedTime + (W - playX) / pxPerSec;
      const offset = gridOffset || 0;
      
      const kMin = Math.floor((t_left - offset) / beatInterval) - 1;
      const kMax = Math.ceil((t_right - offset) / beatInterval) + 1;
      
      ctx.save();
      for (let k = kMin; k <= kMax; k++) {
        const t = offset + k * beatInterval;
        if (t < 0 || t > totalDuration) continue;
        
        const x = playX + (t - elapsedTime) * pxPerSec;
        if (x < 0 || x > W) continue;
        
        const isBar = (k % 4 === 0);
        
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        
        if (isBar) {
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.45)'; // Sleek transparent ruby red
          ctx.lineWidth = 1.35;
          ctx.stroke();

          // High-contrast downbeat guide triangles (top & bottom anchors)
          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.moveTo(x - 3, 0);
          ctx.lineTo(x + 3, 0);
          ctx.lineTo(x, 3);
          ctx.closePath();
          ctx.fill();

          ctx.beginPath();
          ctx.moveTo(x - 3, H);
          ctx.lineTo(x + 3, H);
          ctx.lineTo(x, H - 3);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)'; // Soft cyan subbeats
          ctx.lineWidth = 0.85;
          ctx.setLineDash([2, 5]);
          ctx.stroke();
        }
        
        // Dynamic bar-beat indicators
        ctx.fillStyle = isBar ? '#f87171' : 'rgba(125, 211, 252, 0.65)';
        ctx.font = 'bold 6.5px "JetBrains Mono", monospace';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        
        const barNumber = Math.floor(Math.max(0, k) / 4) + 1;
        const beatInBar = (Math.max(0, k) % 4) + 1;
        const labelText = `${barNumber}.${beatInBar}`;
        
        ctx.fillText(labelText, x + 3, 4);
      }
      ctx.restore();
    }

    // --- LOOP REGION SELECTION SHADE ---
    if (loopIn >= 0 && loopOut > loopIn) {
      const lx1 = Math.round((loopIn - startIdx) * zoom);
      const lx2 = Math.round((loopOut - startIdx) * zoom);
      if (lx2 > 0 && lx1 < W) {
        // Transparent glowing emerald backdrop
        ctx.fillStyle = 'rgba(16, 185, 129, 0.08)'; 
        ctx.fillRect(Math.max(0, lx1), 0, Math.min(lx2, W) - Math.max(0, lx1), H);

        // Vivid neon emerald laser markers with micro borders
        const loopGrad = ctx.createLinearGradient(0, 0, 0, H);
        loopGrad.addColorStop(0, '#34d399');
        loopGrad.addColorStop(0.5, '#10b981');
        loopGrad.addColorStop(1, '#059669');
        
        ctx.fillStyle = loopGrad;
        if (lx1 >= 0 && lx1 < W) {
          ctx.fillRect(lx1, 0, 2.2, H);
          // Loop start handle flag
          ctx.font = '900 6px Arial, sans-serif';
          ctx.fillText("IN", lx1 + 4, H - 10);
        }
        if (lx2 >= 0 && lx2 < W) {
          ctx.fillRect(lx2, 0, 2.2, H);
          // Loop end handle flag
          ctx.font = '900 6px Arial, sans-serif';
          ctx.fillText("OUT", lx2 - 15, H - 10);
        }
      }
    }

    // --- HOVER SNAP TO BEAT CUE GUIDE INDICATION ---
    if (hoverX !== null && gridBpm && totalDuration) {
      const pxPerSec = zoom * (4000 / totalDuration);
      const beatInterval = 60 / gridBpm;
      const offset = gridOffset || 0;

      // Time position of hover cursor
      const hoverSecs = elapsedTime + (hoverX - playX) / pxPerSec;

      // Nearest beat index k
      const k = Math.round((hoverSecs - offset) / beatInterval);
      const snapTime = offset + k * beatInterval;

      if (snapTime >= 0 && snapTime <= totalDuration) {
        const snapX = playX + (snapTime - elapsedTime) * pxPerSec;

        if (snapX >= 0 && snapX <= W) {
          ctx.save();

          // Draw dashed guide line
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)'; // Elegant amber hot cue color
          ctx.lineWidth = 1.25;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(snapX, 0);
          ctx.lineTo(snapX, H);
          ctx.stroke();

          // Draw snap feedback magnet icon/indicator: a small pulsing circle at the center
          ctx.fillStyle = '#f59e0b';
          ctx.beginPath();
          ctx.arc(snapX, centerY, 3.5, 0, Math.PI * 2);
          ctx.fill();
          
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.stroke();

          // Small triangular arrow at the top pointing to downbeat
          ctx.fillStyle = '#f59e0b';
          ctx.beginPath();
          ctx.moveTo(snapX - 4, 0);
          ctx.lineTo(snapX + 4, 0);
          ctx.lineTo(snapX, 4);
          ctx.closePath();
          ctx.fill();

          // Capsule badge display
          const barNum = Math.floor(Math.max(0, k) / 4) + 1;
          const beatInBar = (Math.max(0, k) % 4) + 1;
          const snapLabel = `SNAP: ${barNum}.${beatInBar}`;
          ctx.font = 'bold 6.5px "JetBrains Mono", monospace';
          const textW = ctx.measureText(snapLabel).width;
          const bx = snapX - textW / 2 - 4;
          const bw = textW + 8;
          const by = H - 14;
          const bh = 10;

          // Draw badge container
          ctx.fillStyle = 'rgba(10, 11, 16, 0.95)';
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 0.75;
          
          // Cross-browser capsule drawing helper
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(bx, by, bw, bh, 2);
          } else {
            ctx.rect(bx, by, bw, bh);
          }
          ctx.fill();
          ctx.stroke();

          // Write Snap Beat number
          ctx.fillStyle = '#f59e0b';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(snapLabel, snapX, by + bh / 2 + 0.5);

          ctx.restore();
        }
      }
    }

    // --- PLAYHEAD SNAP LOCK INDICATOR ---
    if (gridBpm && totalDuration) {
      const beatInterval = 60 / gridBpm;
      const offset = gridOffset || 0;
      const currentK = Math.round((elapsedTime - offset) / beatInterval);
      const nearestBeatTime = offset + currentK * beatInterval;
      const diffSecs = Math.abs(elapsedTime - nearestBeatTime);

      // Within 80 milliseconds is a perfect snap zone for a cue point!
      if (diffSecs < 0.08) {
        ctx.save();
        const pxPerSec = zoom * (4000 / totalDuration);
        const beatX = playX + (nearestBeatTime - elapsedTime) * pxPerSec;
        
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.45)';
        ctx.lineWidth = 2.0;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(beatX, 0);
        ctx.lineTo(beatX, H);
        ctx.stroke();

        // Capsule display next to playhead for Cue placement alignment validation
        const shx = playX - 62;
        const shy = H - 15;
        const shw = 52;
        const shh = 11;
        
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(shx, shy, shw, shh, 2);
        } else {
          ctx.rect(shx, shy, shw, shh);
        }
        ctx.fillStyle = 'rgba(6, 78, 59, 0.9)';
        ctx.fill();
        
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 0.85;
        ctx.stroke();

        ctx.font = 'bold 5.5px "JetBrains Mono", monospace';
        ctx.fillStyle = '#10b981';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🧲 BEAT SNAP OK', shx + shw / 2, shy + shh / 2 + 0.5);
        ctx.restore();
      }
    }

    // --- CYBER CUE FLAG INTEGRATIONS ---
    // Make HOT CUES look like actual high-end hardware physical overlays
    const cueColors: { [key: number]: string } = { 
      0: '#9e9e9e', // Main silver/gray temporary cue color
      1: '#3b82f6', // Cyan/Blue
      2: '#10b981', // Neon Green
      3: '#f59e0b', // Neon Gold
      4: '#ef4444', // Neon Red
      5: '#ec4899', // Deep Pink
      6: '#8b5cf6', // Indigo/Purple
      7: '#14b8a6', // Teal
      8: '#f97316'  // Orange/Amber
    };
    const cueLabels: { [key: number]: string } = { 
      0: 'CUE',
      1: 'CUE 1', 
      2: 'CUE 2', 
      3: 'CUE 3',
      4: 'CUE 4',
      5: 'CUE 5',
      6: 'CUE 6',
      7: 'CUE 7',
      8: 'CUE 8'
    };
    
    Object.entries(cues).forEach(([n, cPos]) => {
      const posVal = cPos as number;
      if (posVal < 0) return;
      const key = parseInt(n);
      const cx = Math.round((posVal - startIdx) * zoom);
      if (cx < 0 || cx >= W) return;
      
      const themeColor = cueColors[key] || '#ffffff';
      
      // Fine-thread neon laser beam targeting the sound peak
      ctx.fillStyle = themeColor;
      ctx.fillRect(cx - 0.5, 0, 1.2, H);
      
      // Draw prominent color-coded timeline notches directly on the borders
      ctx.save();
      ctx.fillStyle = themeColor;
      
      // Top timeline down-pointing triangle notch
      ctx.beginPath();
      ctx.moveTo(cx - 4, 0);
      ctx.lineTo(cx + 4, 0);
      ctx.lineTo(cx, 5);
      ctx.closePath();
      ctx.fill();

      // Bottom timeline up-pointing triangle notch
      ctx.beginPath();
      ctx.moveTo(cx - 4, H);
      ctx.lineTo(cx + 4, H);
      ctx.lineTo(cx, H - 5);
      ctx.closePath();
      ctx.fill();
      
      ctx.restore();

      // Graphic badge container for CUE label
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 4;
      
      ctx.fillStyle = themeColor;
      ctx.beginPath();
      // Draw modern badge index with robust roundRect cross-browser support
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(cx - 1, 4, 25, 10, 2);
      } else {
        ctx.rect(cx - 1, 4, 25, 10);
      }
      ctx.fill();
      
      ctx.fillStyle = '#ffffff';
      ctx.font = 'black 6.5px "JetBrains Mono", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(cueLabels[key] || 'CUE', cx + 11.5, 11);
      ctx.restore();
    });

    // --- SCI-FI PLAYHEAD LASER SCANNER HUD ---
    // 1. Soft radial lens flare aura behind playhead center
    const playheadGlow = ctx.createRadialGradient(playX, centerY, 1, playX, centerY, 24);
    playheadGlow.addColorStop(0, 'rgba(239, 68, 68, 0.22)');
    playheadGlow.addColorStop(0.3, 'rgba(239, 68, 68, 0.08)');
    playheadGlow.addColorStop(1, 'rgba(239, 68, 68, 0)');
    ctx.fillStyle = playheadGlow;
    ctx.beginPath();
    ctx.arc(playX, centerY, 24, 0, Math.PI * 2);
    ctx.fill();

    // 2. Playhead sharp central neon particle beam
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(playX - 0.5, 0, 1.5, H);

    // 3. Playhead aerodynamic futuristic cursor heads
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(playX - 5, 0);
    ctx.lineTo(playX + 6, 0);
    ctx.lineTo(playX + 0.5, 5);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(playX - 5, H);
    ctx.lineTo(playX + 6, H);
    ctx.lineTo(playX + 0.5, H - 5);
    ctx.closePath();
    ctx.fill();

    // 4. Past audio segments dimming glassmorphism mask (dimming retroact)
    ctx.fillStyle = 'rgba(0, 0, 8, 0.38)';
    ctx.fillRect(0, 0, playX, H);

    // --- PHRASE BEATS COUNTDOWN INDICATOR ---
    const getRemainingBeatsInPhrase = (): { beats: number; activeBeat: number } => {
      const playIndex = Math.min(data.length - 1, Math.max(0, Math.round(pos)));
      
      // Calculate active beat in current 4-beat bar using the grid logic
      let activeBeat = 1;
      if (gridBpm && totalDuration) {
        const beatInterval = 60 / gridBpm;
        const currentBeatIndex = Math.floor((elapsedTime - (gridOffset || 0)) / beatInterval);
        activeBeat = (Math.max(0, currentBeatIndex) % 4) + 1;
      }

      // Find the next phrase boundary in the data array
      let nextPhraseIndex = -1;
      for (let i = playIndex + 3; i < data.length; i++) {
        if (data[i].isPhrase) {
          nextPhraseIndex = i;
          break;
        }
      }
      
      if (nextPhraseIndex === -1) {
        // Fallback: estimate remaining beats based on standard 1024-step phrase layout (16 beats)
        const gap = 1024 - (playIndex % 1024);
        return { beats: Math.max(1, Math.ceil(gap / 64)), activeBeat };
      }
      
      // Count distinct beat blocks from playIndex to nextPhraseIndex
      let beatCount = 0;
      let inBeat = false;
      for (let i = playIndex; i < nextPhraseIndex; i++) {
        if (data[i].isBeat) {
          if (!inBeat) {
            beatCount++;
            inBeat = true;
          }
        } else {
          inBeat = false;
        }
      }
      return { beats: beatCount, activeBeat };
    };

    const { beats: remainingBeats, activeBeat } = getRemainingBeatsInPhrase();

    const rx = playX - 62;
    const ry = 4;
    const rw = 52;
    const rh = 19;

    ctx.save();
    // Drop shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;

    // Custom futuristic faceted capsule path
    ctx.beginPath();
    ctx.moveTo(rx + 4, ry);
    ctx.lineTo(rx + rw - 4, ry);
    ctx.lineTo(rx + rw, ry + 4);
    ctx.lineTo(rx + rw, ry + rh - 4);
    ctx.lineTo(rx + rw - 4, ry + rh);
    ctx.lineTo(rx + 4, ry + rh);
    ctx.lineTo(rx, ry + rh - 4);
    ctx.lineTo(rx, ry + 4);
    ctx.closePath();
    ctx.fillStyle = 'rgba(10, 11, 16, 0.9)';
    ctx.fill();

    // Disable shadow to render lines crisp
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    // Glowing border outline
    ctx.strokeStyle = 'rgba(234, 179, 8, 0.45)';
    ctx.lineWidth = 0.85;
    ctx.stroke();

    // 1. Pulsing LED Dot on left
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(rx + 7, ry + 7, 1.8, 0, Math.PI * 2);
    ctx.fill();

    // 2. Big display numeric beats
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 10.5px "Outfit", "Space Grotesk", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(remainingBeats.toString().padStart(2, '0'), rx + 13.5, ry + 2);

    // 3. Floating label text stack
    ctx.fillStyle = '#eab308';
    ctx.font = '900 4.5px "JetBrains Mono", monospace';
    ctx.fillText("BEATS", rx + 29.5, ry + 2.5);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.font = '700 4px "JetBrains Mono", monospace';
    ctx.fillText("PHR-REMAIN", rx + 29.5, ry + 7.5);

    // 4. CDJ Nexus Style Subdivision measure block dots
    const dotW = 2.8;
    const dotH = 1.6;
    const dotYOffset = ry + 13.5;
    for (let d = 0; d < 4; d++) {
      const dx = rx + 13.5 + d * (dotW + 1.2);
      ctx.fillStyle = (d + 1 === activeBeat) ? '#f59e0b' : 'rgba(255, 255, 255, 0.15)';
      ctx.fillRect(dx, dotYOffset, dotW, dotH);
    }

    ctx.restore();

    // --- SMART PHASE SYNC GUIDANCE HUD ---
    if (showGhost) {
      const isPerfect = Math.abs(phaseOffset) < 0.02;
      const hx = playX + 15;
      const hy = 4;
      const hw = 75;
      const hh = 11;

      ctx.save();
      // Capsule border & fill
      ctx.beginPath();
      ctx.moveTo(hx + 2, hy);
      ctx.lineTo(hx + hw - 2, hy);
      ctx.lineTo(hx + hw, hy + 2);
      ctx.lineTo(hx + hw, hy + hh - 2);
      ctx.lineTo(hx + hw - 2, hy + hh);
      ctx.lineTo(hx + 2, hy + hh);
      ctx.lineTo(hx, hy + hh - 2);
      ctx.lineTo(hx, hy + 2);
      ctx.closePath();
      
      ctx.fillStyle = 'rgba(10, 11, 16, 0.9)';
      ctx.fill();
      
      ctx.strokeStyle = isPerfect ? '#10b981' : '#f59e0b';
      ctx.lineWidth = 0.85;
      ctx.stroke();

      // Text inside
      ctx.font = 'bold 5.5px "JetBrains Mono", monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      
      if (isPerfect) {
        ctx.fillStyle = '#10b981';
        ctx.fillText('⚡ PHASE SYNCED', hx + hw / 2, hy + hh / 2 + 0.5);
      } else if (phaseOffset > 0) {
        const blink = Math.floor(Date.now() / 250) % 2 === 0;
        ctx.fillStyle = '#f59e0b';
        ctx.fillText(`${blink ? '◀◀' : '  '} NUDGE SLOW`, hx + hw / 2, hy + hh / 2 + 0.5);
      } else {
        const blink = Math.floor(Date.now() / 250) % 2 === 0;
        ctx.fillStyle = '#f59e0b';
        ctx.fillText(`NUDGE FAST ${blink ? '▶▶' : '  '}`, hx + hw / 2, hy + hh / 2 + 0.5);
      }
      ctx.restore();
    }

    // --- "SNAP TO GRID" CONFIRMATION OVERLAY ---
    if (quantize) {
      ctx.save();
      ctx.fillStyle = 'rgba(168, 85, 247, 0.2)';
      ctx.strokeStyle = 'rgba(168, 85, 247, 0.5)';
      ctx.lineWidth = 0.75;
      
      const badgeText = "SNAP GRID ON";
      ctx.font = 'bold 6px "JetBrains Mono", monospace';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      const tw = ctx.measureText(badgeText).width;
      
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(W - tw - 10, H - 11, tw + 6, 8, 1.5);
      } else {
        ctx.rect(W - tw - 10, H - 11, tw + 6, 8);
      }
      ctx.fill();
      ctx.stroke();
      
      ctx.fillStyle = '#e9d5ff';
      ctx.fillText(badgeText, W - tw - 7, H - 9.5);
      ctx.restore();
    }

  }, [data, pos, zoom, loopIn, loopOut, cues, elapsedTime, totalDuration, gridBpm, gridOffset, showGrid, dimensions, phaseOffset, hoverX, quantize]);

  const handleMouseDown = (e: React.MouseEvent) => {
    panStartRef.current = { x: e.clientX, pos };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    // Track hover location for snap overlay helpers
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) {
      const x = e.clientX - rect.left;
      setHoverX(x);
    }

    if (!panStartRef.current) return;
    const dx = e.clientX - panStartRef.current.x;
    const newPos = Math.max(0, Math.min(data.length - 1, panStartRef.current.pos - Math.round(dx / zoom)));
    onSeek(newPos);
  };

  const handleMouseUp = () => {
    panStartRef.current = null;
  };

  const handleMouseLeave = () => {
    handleMouseUp();
    setHoverX(null);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (panStartRef.current && Math.abs(e.clientX - panStartRef.current.x) > 4) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const playX = rect.width * 0.3;
    const delta = (x - playX) / zoom;
    onSeek(Math.max(0, Math.min(data.length - 1, pos + Math.round(delta))));
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.85;
    const newZoom = Math.max(0.5, Math.min(16, zoom * factor));
    onZoomChange(newZoom);
  };

  return (
    <div 
      ref={containerRef} 
      className="h-[48px] bg-[#030308] border border-[#222435] rounded-lg overflow-hidden relative cursor-crosshair group shadow-[0_4px_16px_rgba(0,0,0,0.8)] hover:border-[#3b82f6]/20 transition-all duration-300"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      onWheel={handleWheel}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />

      {/* Cybernetic HUD Overlays */}
      <div className="absolute top-1.5 right-1.5 flex items-center gap-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <div className="px-1.5 py-0.5 bg-black/80 border border-white/10 rounded-full flex items-center gap-2 shadow-lg backdrop-blur-sm">
          <button 
            className="text-[10px] font-black text-[#60a5fa] hover:text-white cursor-pointer select-none px-1" 
            onClick={(e) => { e.stopPropagation(); onZoomChange(Math.max(0.5, zoom * 0.5)); }}
            title="Zoom In"
          >
            -
          </button>
          <span className="text-[7.5px] text-[#60a5fa] font-mono font-bold min-w-[22px] text-center">{zoom.toFixed(1)}x</span>
          <button 
            className="text-[10px] font-black text-[#60a5fa] hover:text-white cursor-pointer select-none px-1" 
            onClick={(e) => { e.stopPropagation(); onZoomChange(Math.min(16, zoom * 2)); }}
            title="Zoom Out"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
};

