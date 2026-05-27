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
  phaseOffset
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const panStartRef = useRef<{ x: number, pos: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data.length) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width = containerRef.current?.clientWidth || 400;
    const H = canvas.height = containerRef.current?.clientHeight || 56;

    ctx.fillStyle = '#010105'; // Deep dark organic obsidian black base
    ctx.fillRect(0, 0, W, H);

    // Dynamic background telemetry dashboard design
    // 1. Dotted and faint horizontal level gridlines (representing amplitude bands)
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.015)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 5]);
    const horizGridLevels = [0.15, 0.35, 0.5, 0.65, 0.85];
    horizGridLevels.forEach(lvl => {
      const y = Math.floor(H * lvl);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    });
    ctx.restore();

    // 2. Faint vertical time tickmarks (every 40 pixels)
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
    ctx.lineWidth = 1;
    for (let col = 0; col < W; col += 40) {
      ctx.beginPath();
      ctx.moveTo(col, 0);
      ctx.lineTo(col, H);
      ctx.stroke();
    }
    ctx.restore();

    const playX = Math.floor(W * 0.3);
    const startIdx = Math.max(0, Math.round(pos - playX / zoom));
    const centerY = H / 2;
    const maxH = H - 8; // Maintain 4px padding at both top and bottom edges

    // --- RENDER DENSE SPECTRUM WAVE ----
    for (let x = 0; x < W; x++) {
      const di = Math.min(data.length - 1, startIdx + Math.floor(x / zoom));
      const pt = data[di];
      if (!pt) continue;

      // Phrase dividers: elegant gold glow
      if (pt.isPhrase) {
        ctx.fillStyle = 'rgba(255, 196, 0, 0.28)';
        ctx.fillRect(x, 0, 1, H);
        continue;
      }

      // Bar guides in behind the waves
      if (pt.isBar) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
        ctx.fillRect(x, 0, 1, H);
      } else if (pt.isBeat) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
        ctx.fillRect(x, 0, 1, H);
      }

      // MULTI-SPECTRAL CENTRIC AUDIO COMPOSITION (Pioneer RGB style overlapping stack)
      // 1. BASS SUB-LAYER (Wide crimson/magenta aura base for low-end energy)
      const bassAmp = Math.min(1.0, pt.bass * 1.1);
      const bassH = Math.max(1, bassAmp * maxH);
      const r_bass = Math.round(pt.bass * 255);
      ctx.fillStyle = `rgba(${Math.max(120, r_bass)}, 22, 60, 0.24)`;
      ctx.fillRect(x, Math.floor(centerY - bassH / 2), 1, Math.floor(bassH));

      // 2. MIDRANGE LAYER (Solid glowing neon cyan/emerald core for vocals/dynamics)
      const midAmp = Math.min(1.0, pt.mid * 0.95);
      const midH = Math.max(1, midAmp * (maxH - 4));
      const midG = Math.round(pt.mid * 255);
      ctx.fillStyle = `rgba(16, ${Math.max(130, midG)}, 140, 0.52)`;
      ctx.fillRect(x, Math.floor(centerY - midH / 2), 1, Math.floor(midH));

      // 3. HIGHS / PEAKS LAYER (Sharp white/icy blue needle spikes for transient hats/claps)
      const highAmp = Math.min(1.0, pt.high * 0.9);
      const highH = Math.max(1, highAmp * (maxH - 8));
      let highColor = 'rgba(235, 250, 255, 0.85)';
      if (pt.high > 0.6) {
        highColor = 'rgba(255, 250, 170, 0.95)'; // Yellow flares on hyper-loud highs
      } else if (pt.high > 0.3) {
        highColor = 'rgba(100, 235, 255, 0.88)'; // Icy cyan peaks
      }
      ctx.fillStyle = highColor;
      ctx.fillRect(x, Math.floor(centerY - highH / 2), 1, Math.floor(highH));
    }

    // --- BEATGRID OVERLAY DISPLAY ---
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
          ctx.strokeStyle = '#ff3b30'; // CDJ style neon-red downbeats
          ctx.lineWidth = 1.2;
          ctx.setLineDash([]);
        } else {
          ctx.strokeStyle = 'rgba(0, 170, 255, 0.38)'; // Transparent electric blue subbeats
          ctx.lineWidth = 0.8;
          ctx.setLineDash([2, 4]);
        }
        ctx.stroke();
        
        // Render labels elegantly
        ctx.fillStyle = isBar ? '#ff6b62' : 'rgba(150, 215, 255, 0.7)';
        ctx.font = 'bold 7px "JetBrains Mono", Courier, monospace';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        
        const barNumber = Math.floor(Math.max(0, k) / 4) + 1;
        const beatInBar = (Math.max(0, k) % 4) + 1;
        const labelText = `${barNumber}.${beatInBar}`;
        
        ctx.fillText(labelText, x + 3, 2);
      }
      ctx.restore();
    }

    // Loop selection shade
    if (loopIn >= 0 && loopOut > loopIn) {
      const lx1 = Math.round((loopIn - startIdx) * zoom);
      const lx2 = Math.round((loopOut - startIdx) * zoom);
      if (lx2 > 0 && lx1 < W) {
        ctx.fillStyle = 'rgba(0, 240, 100, 0.09)'; // Light emerald transparent loop mask
        ctx.fillRect(Math.max(0, lx1), 0, Math.min(lx2, W) - Math.max(0, lx1), H);
        ctx.fillStyle = '#00df80'; // Vivid neon-green boundaries
        if (lx1 >= 0 && lx1 < W) ctx.fillRect(lx1, 0, 2, H);
        if (lx2 >= 0 && lx2 < W) ctx.fillRect(lx2, 0, 2, H);
      }
    }

    // High-performance hot cue flag rendering
    const cueColors: { [key: number]: string } = { 1: '#0088ff', 2: '#00cc66', 3: '#ff9500' };
    const cueLabels: { [key: number]: string } = { 1: 'P1', 2: 'P2', 3: 'P3' };
    Object.entries(cues).forEach(([n, cPos]) => {
      const posVal = cPos as number;
      if (posVal < 0) return;
      const key = parseInt(n);
      const cx = Math.round((posVal - startIdx) * zoom);
      if (cx < 0 || cx >= W) return;
      
      const color = cueColors[key] || '#ffffff';
      
      // Vertical laser thread
      ctx.fillStyle = color;
      ctx.fillRect(cx, 0, 1.5, H);
      
      // Slick plastic flag banner
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx + 14, 0);
      ctx.lineTo(cx + 10, 6);
      ctx.lineTo(cx + 14, 12);
      ctx.lineTo(cx, 12);
      ctx.closePath();
      ctx.fill();

      // Flag text (e.g., P1, P2)
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 7px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(cueLabels[key] || 'C', cx + 2, 2);
    });

    // Sleek dual-gained Playhead HUD
    // 1. Subtle glowing halo behind playhead
    ctx.fillStyle = 'rgba(255, 40, 70, 0.08)';
    ctx.fillRect(playX - 6, 0, 13, H);

    // 2. Playhead sharp central needle rule
    ctx.fillStyle = '#ff2b47';
    ctx.fillRect(playX, 0, 2, H);

    // 3. Playhead aerodynamic triangular caps
    ctx.fillStyle = '#ff2b47';
    ctx.beginPath();
    ctx.moveTo(playX - 4, 0);
    ctx.lineTo(playX + 6, 0);
    ctx.lineTo(playX + 1, 5);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(playX - 4, H);
    ctx.lineTo(playX + 6, H);
    ctx.lineTo(playX + 1, H - 5);
    ctx.closePath();
    ctx.fill();

    // 4. Past audio segments dimming envelope
    ctx.fillStyle = 'rgba(0, 0, 5, 0.28)';
    ctx.fillRect(0, 0, playX, H);

  }, [data, pos, zoom, loopIn, loopOut, cues, elapsedTime, totalDuration, gridBpm, gridOffset, showGrid]);

  const handleMouseDown = (e: React.MouseEvent) => {
    panStartRef.current = { x: e.clientX, pos };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!panStartRef.current) return;
    const dx = e.clientX - panStartRef.current.x;
    const newPos = Math.max(0, Math.min(data.length - 1, panStartRef.current.pos - Math.round(dx / zoom)));
    onSeek(newPos);
  };

  const handleMouseUp = () => {
    panStartRef.current = null;
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
      className="h-[56px] bg-[#020209] border border-[#1a1a2a] rounded-sm overflow-hidden relative cursor-crosshair group"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onClick={handleClick}
      onWheel={handleWheel}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
      
      {phaseOffset !== undefined && (
        <div className="absolute top-1 left-1.5 flex flex-col items-start gap-0.5 z-10 bg-[#07070a]/90 border border-white/5 p-1 rounded backdrop-blur-md pointer-events-none select-none">
          <div className="flex items-center gap-1.5">
            <span className="text-[5.5px] text-white/40 tracking-widest font-black uppercase">BEAT Match</span>
            <span className={`text-[6px] font-mono leading-none font-bold ${Math.abs(phaseOffset) < 0.05 ? 'text-[#1dd1a1]' : 'text-[#ff3838]'}`}>
              {Math.abs(phaseOffset) < 0.05 ? 'SYNCED' : (phaseOffset > 0 ? `+${(phaseOffset * 100).toFixed(0)}%` : `${(phaseOffset * 100).toFixed(0)}%`)}
            </span>
          </div>
          <div className="w-[85px] h-1.5 bg-neutral-900 border border-[#222]/80 rounded relative overflow-hidden flex items-center justify-center">
            <div className="absolute h-full w-[1.5px] bg-white/20 z-10" />
            <div 
              className={`absolute h-full w-[5px] rounded-[1px] transition-all duration-75 ${
                Math.abs(phaseOffset) < 0.05 
                  ? 'bg-[#1dd1a1] shadow-[0_0_6px_rgba(29,209,161,0.8)]' 
                  : 'bg-[#ff3838] shadow-[0_0_4px_rgba(255,56,56,0.5)]'
              }`}
              style={{ left: `calc(50% + ${phaseOffset * 100}% - 2.5px)` }}
            />
          </div>
        </div>
      )}

      <div className="absolute top-1 right-1 flex items-center gap-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="px-1.5 py-0.5 bg-black/80 border border-white/10 rounded flex items-center gap-2">
          <button className="text-[10px] text-[#4af] hover:text-white" onClick={(e) => { e.stopPropagation(); onZoomChange(Math.max(0.5, zoom * 0.5)); }}>-</button>
          <span className="text-[7.5px] text-[#4af] font-mono font-bold min-w-[20px] text-center">{zoom.toFixed(1)}x</span>
          <button className="text-[10px] text-[#4af] hover:text-white" onClick={(e) => { e.stopPropagation(); onZoomChange(Math.min(16, zoom * 2)); }}>+</button>
        </div>
      </div>
    </div>
  );
};
