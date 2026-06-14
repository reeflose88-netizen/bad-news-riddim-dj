import React, { useRef, useEffect } from 'react';

interface JogWheelProps {
  deck: 'A' | 'B';
  angle: number;
  playing: boolean;
  onScratch: (delta: number, isDragging?: boolean, friction?: number) => void;
  size?: number;
  friction?: number;
}

export const JogWheel: React.FC<JogWheelProps> = ({ deck, angle, playing, onScratch, size: sizeProp = 210, friction = 0.95 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vinylTexRef = useRef<HTMLCanvasElement | null>(null);

  // Pre-render the vinyl texture once or when deck/size changes
  useEffect(() => {
    const scaleFactor = sizeProp / 160;
    const baseSize = 134;
    const size = Math.round(baseSize * scaleFactor);
    const oc = document.createElement('canvas');
    oc.width = size;
    oc.height = size;
    const ctx = oc.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(scaleFactor, scaleFactor);

    const cx = baseSize / 2, cy = baseSize / 2;
    const r = baseSize / 2; // radius is 67

    // 1. Vinyl Base (ultra-deep matte carbon charcoal black with a slight slate velvet texture)
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#060608';
    ctx.fill();

    // Subtle carbon fiber weave or record micro-texture base
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.015)';
    ctx.lineWidth = 0.4;
    for (let j = 4; j < r; j += 1.5) {
      ctx.beginPath();
      ctx.arc(cx, cy, j, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 2. Lead-in & Lead-out Outer Rim Wax (Polished high-sheen wax margin)
    const leadInGrad = ctx.createRadialGradient(cx, cy, r - 7, cx, cy, r);
    leadInGrad.addColorStop(0, '#0a0a0f');
    leadInGrad.addColorStop(0.5, '#16161c');
    leadInGrad.addColorStop(1, '#050508');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.arc(cx, cy, r - 7, 0, Math.PI * 2, true);
    ctx.fillStyle = leadInGrad;
    ctx.fill();

    // Sparsely draw spiral lead-in grooves with high-precision lines
    ctx.lineWidth = 0.55;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.arc(cx, cy, r - 2.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.beginPath();
    ctx.arc(cx, cy, r - 4.5, 0, Math.PI * 2);
    ctx.stroke();

    // 3. Audio track regions: separates songs physically on the vinyl
    const audioTracks = [
      { start: 50, end: 61, d: 1.1, name: 'AURA OUT' },
      { start: 39, end: 48, d: 1.3, name: 'CORE BEAT' },
      { start: 28, end: 37, d: 0.9, name: 'DEEP GRID' }
    ];

    audioTracks.forEach((track, idx) => {
      // Draw track matte background
      const trackGrad = ctx.createRadialGradient(cx, cy, track.start, cx, cy, track.end);
      trackGrad.addColorStop(0, '#08080c');
      trackGrad.addColorStop(0.3, '#14141a');
      trackGrad.addColorStop(0.7, '#1b1b22');
      trackGrad.addColorStop(1, '#07070a');
      ctx.beginPath();
      ctx.arc(cx, cy, track.end, 0, Math.PI * 2);
      ctx.arc(cx, cy, track.start, 0, Math.PI * 2, true);
      ctx.fillStyle = trackGrad;
      ctx.fill();

      // Density grooves representing song dynamic range waveforms
      ctx.lineWidth = 0.35;
      for (let gr = track.start + 0.6; gr < track.end - 0.6; gr += 0.7) {
        // Vary opacities to simulate audio waveforms reflecting microgrooves
        const waveMod = Math.sin(gr * 3.5 + idx * 4.2) * Math.cos(gr * 0.9);
        const intensity = 0.05 + (Math.sin(gr * 15.0) * 0.02) + (waveMod * 0.035);
        ctx.beginPath();
        ctx.arc(cx, cy, gr, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,255,255,${intensity})`;
        ctx.stroke();
      }
    });

    // Dark silence/inter-track gaps (smooth flat grooves)
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#020204';
    ctx.beginPath();
    ctx.arc(cx, cy, 49, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 38, 0, Math.PI * 2);
    ctx.stroke();

    // 4. Printed central paper record label (Modern minimalist high-end club style)
    const isDeckA = deck === 'A';
    const labelBg = '#0a0b10'; // Velvet deep space matte labels
    const accentColor = isDeckA ? '#3b82f6' : '#ef4444'; // Electric blue or blazing crimson
    const labelBorderColor = isDeckA ? 'rgba(59, 130, 246, 0.4)' : 'rgba(239, 68, 68, 0.4)';

    ctx.beginPath();
    ctx.arc(cx, cy, 27, 0, Math.PI * 2);
    ctx.fillStyle = labelBg;
    ctx.fill();

    // Radial gradient glow on outer label boundary to look like metallic press ink
    const labelEdgeGrad = ctx.createRadialGradient(cx, cy, 25, cx, cy, 27);
    labelEdgeGrad.addColorStop(0, '#0a0b10');
    labelEdgeGrad.addColorStop(1, accentColor);
    ctx.beginPath();
    ctx.arc(cx, cy, 27, 0, Math.PI * 2);
    ctx.arc(cx, cy, 25, 0, Math.PI * 2, true);
    ctx.fillStyle = labelEdgeGrad;
    ctx.fill();

    // Central circular graphic pattern for rotation contrast
    ctx.beginPath();
    ctx.arc(cx, cy, 23, 0, Math.PI * 2);
    ctx.strokeStyle = labelBorderColor;
    ctx.lineWidth = 0.55;
    ctx.stroke();

    // Creative modern sectors
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, 23, -Math.PI / 6, Math.PI / 6, false);
    ctx.closePath();
    ctx.fillStyle = `rgba(${isDeckA ? '59,130,246' : '239,68,68'}, 0.25)`;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, 23, 5 * Math.PI / 6, 7 * Math.PI / 6, false);
    ctx.closePath();
    ctx.fillStyle = `rgba(${isDeckA ? '59,130,246' : '239,68,68'}, 0.25)`;
    ctx.fill();

    // Central core contrasting rings
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Dynamic brand text inside printed label (vintage/tech pairing)
    ctx.save();
    ctx.translate(cx, cy);

    // Modern branding
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 3.5px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText("BAD N3WS", 0, -11);

    ctx.fillStyle = accentColor;
    ctx.font = '800 2.8px "JetBrains Mono", monospace';
    ctx.fillText("RIDDIM DJ", 0, -7);

    // Decorative graphics
    ctx.fillStyle = '#64748b';
    ctx.font = '500 2.2px "JetBrains Mono", monospace';
    ctx.fillText("DIRECT DRIVE", -8, 11);
    ctx.fillText("QUARTZ LOCK", 8, 11);

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 6px "Space Grotesk", Arial, sans-serif';
    ctx.fillText(isDeckA ? "A" : "B", 0, 4);

    ctx.font = '500 2px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fillText("STABILITY CONTROL • 33RPM", 0, 16);

    ctx.restore();

    // 5. Deluxe Vinyl Cueing Sticker (Glossy physical tape cue marker)
    ctx.save();
    ctx.translate(cx, cy);
    // Rotating marker strip extending out of the paper label
    // Use an elegant glowing neon gradient for the tape marker
    const stickGrad = ctx.createLinearGradient(0, -r + 1, 0, -20);
    if (isDeckA) {
      stickGrad.addColorStop(0, '#00f2fe');
      stickGrad.addColorStop(1, '#4facfe');
    } else {
      stickGrad.addColorStop(0, '#ff0844');
      stickGrad.addColorStop(1, '#ffb199');
    }
    
    // Tape drop shadow simulated
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 2.5;
    ctx.shadowOffsetX = 0.5;
    
    ctx.fillStyle = stickGrad;
    ctx.fillRect(-1.4, -r + 1, 2.8, r - 22);

    // Small dark tactile notches on the sticker
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(-1.4, -r + 12, 2.8, 0.8);
    ctx.fillRect(-1.4, -r + 24, 2.8, 0.8);
    
    ctx.restore();
    ctx.restore(); // restores our initial scale save

    vinylTexRef.current = oc;
  }, [deck, sizeProp]);

  // Main drawing effect
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !vinylTexRef.current) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = canvas.width;
    const baseSize = 160;
    const scaleFactor = size / baseSize;
    const cx = baseSize / 2, cy = baseSize / 2;
    const outerR = baseSize / 2 - 1.5; // ~78.5

    ctx.clearRect(0, 0, size, size);

    ctx.save();
    ctx.scale(scaleFactor, scaleFactor);

    // 1. Sleek metallic outer base rim (platter frame with drop shadow)
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.fillStyle = '#0f0f12';
    ctx.fill();

    // 2. Extruded silver-brushed aluminium platter side (Chunky, expensive multi-step machining look)
    const platterGrad = ctx.createRadialGradient(cx, cy, outerR - 10, cx, cy, outerR);
    platterGrad.addColorStop(0, '#1c1c1f');
    platterGrad.addColorStop(0.2, '#3a3a40');
    platterGrad.addColorStop(0.42, '#a1a1aa');
    platterGrad.addColorStop(0.55, '#f4f4f5');
    platterGrad.addColorStop(0.72, '#71717a');
    platterGrad.addColorStop(0.9, '#27272a');
    platterGrad.addColorStop(1, '#0c0c0e');
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.fillStyle = platterGrad;
    ctx.fill();

    // Precision CNC micro-grooves around silver side rim
    ctx.lineWidth = 0.45;
    for (let rEdge = outerR - 9; rEdge < outerR; rEdge += 1.2) {
      ctx.beginPath();
      ctx.arc(cx, cy, rEdge, 0, Math.PI * 2);
      ctx.strokeStyle = rEdge % 3 < 1.2 ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.35)';
      ctx.stroke();
    }

    // 3. Strobe Dot dimples (Precision timing beads catching light in 3D)
    const strobeRadius = outerR - 4.5;
    const strobeCount = 72; // Higher density for premium look
    for (let i = 0; i < strobeCount; i++) {
      const a = (i / strobeCount) * Math.PI * 2;
      const dotX = cx + Math.cos(a) * strobeRadius;
      const dotY = cy + Math.sin(a) * strobeRadius;

      // Realistic light-catching silver drop-dot
      const dotGrad = ctx.createRadialGradient(dotX - 0.4, dotY - 0.4, 0, dotX, dotY, 1.2);
      dotGrad.addColorStop(0, '#ffffff');
      dotGrad.addColorStop(0.35, '#cbd5e1');
      dotGrad.addColorStop(0.8, '#475569');
      dotGrad.addColorStop(1, '#0f172a');
      ctx.beginPath();
      ctx.arc(dotX, dotY, 1.1, 0, Math.PI * 2);
      ctx.fillStyle = dotGrad;
      ctx.fill();
    }

    // 4. Dark recessed platter well beneath the vinyl
    const wellBg = ctx.createRadialGradient(cx, cy, outerR - 13, cx, cy, outerR - 9);
    wellBg.addColorStop(0, '#010103');
    wellBg.addColorStop(0.5, '#07070a');
    wellBg.addColorStop(1, '#15151b');
    ctx.beginPath();
    ctx.arc(cx, cy, outerR - 8.5, 0, Math.PI * 2);
    ctx.fillStyle = wellBg;
    ctx.fill();

    // Heavy inner-rim shadow for immersive depth
    ctx.beginPath();
    ctx.arc(cx, cy, outerR - 8.5, 0, Math.PI * 2);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // 5. SPINNING VINYL RECORD ON SLIPMAT
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    // Vinyl pre-rendered width is 134, fits beautifully
    ctx.drawImage(vinylTexRef.current, -134 / 2, -134 / 2, 134, 134);
    ctx.restore();

    // 6. MULTI-BLEND LUXURY ANISOTROPIC LIGHT SHEEN
    // Simulates natural overhead spotlights reacting to polycarbonate record materials
    const drawSheenWedge = (startAngle: number, endAngle: number, maxAlpha: number, lightColor: string = '255,255,255') => {
      const sh = ctx.createRadialGradient(cx, cy, 12, cx, cy, outerR - 10);
      sh.addColorStop(0, `rgba(${lightColor}, 0)`);
      sh.addColorStop(0.2, `rgba(${lightColor}, ${maxAlpha * 0.4})`);
      sh.addColorStop(0.45, `rgba(${lightColor}, ${maxAlpha * 0.85})`);
      sh.addColorStop(0.7, `rgba(${lightColor}, ${maxAlpha})`);
      sh.addColorStop(1, `rgba(${lightColor}, 0)`);
      
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, outerR - 10, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = sh;
      ctx.fill();
    };

    // Screen composition for premium flare
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    
    const sheenColor = deck === 'A' ? '220, 240, 255' : '255, 230, 230'; // Icy cool reflections vs warm embers

    // Primary stark reflection axis (Diagonal top-right to bottom-left)
    drawSheenWedge(-Math.PI * 0.28 - 0.24, -Math.PI * 0.28 + 0.24, 0.23, sheenColor);
    drawSheenWedge(Math.PI * 0.72 - 0.24, Math.PI * 0.72 + 0.24, 0.23, sheenColor);

    // Ultra-soft secondary reflection axis (Horizontal spotlight spill)
    drawSheenWedge(Math.PI * 0.15 - 0.15, Math.PI * 0.15 + 0.15, 0.11, '255,255,255');
    drawSheenWedge(-Math.PI * 0.85 - 0.15, -Math.PI * 0.85 + 0.15, 0.11, '255,255,255');
    
    ctx.restore();

    // 7. Bezel fine inner highlight ring (golden/silver hairline outline)
    ctx.beginPath();
    ctx.arc(cx, cy, outerR - 9.0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 0.85;
    ctx.stroke();

    // 8. 3D Spindle Pin & Steel Cap (Highly detailed static crown)
    ctx.beginPath();
    ctx.arc(cx, cy, 6.2, 0, Math.PI * 2);
    ctx.fillStyle = '#060608';
    ctx.fill();

    const spindleGrad = ctx.createRadialGradient(cx - 1.2, cy - 1.2, 0, cx, cy, 4.2);
    spindleGrad.addColorStop(0, '#ffffff');
    spindleGrad.addColorStop(0.3, '#cbd5e1');
    spindleGrad.addColorStop(0.65, '#475569');
    spindleGrad.addColorStop(0.9, '#1e293b');
    spindleGrad.addColorStop(1, '#020617');
    ctx.beginPath();
    ctx.arc(cx, cy, 4.2, 0, Math.PI * 2);
    ctx.fillStyle = spindleGrad;
    ctx.fill();

    // Micro spindle pin hole
    ctx.beginPath();
    ctx.arc(cx, cy, 1.2, 0, Math.PI * 2);
    ctx.fillStyle = '#020203';
    ctx.fill();

    // 9. HIGH-FIDELITY ACTIVE LED CHASE RING (Exclusive Visual Upgrade)
    // Dynamic circular chaser of pixels indicating speed and direction
    if (playing) {
      const ledCount = 120;
      const chaseSpeed = angle * 2.8; 
      const activeColor = deck === 'A' ? '#60a5fa' : '#f87171'; // Blue / Ruby red

      ctx.save();
      for (let i = 0; i < ledCount; i += 3) {
        const offsetAng = (i / ledCount) * Math.PI * 2 + chaseSpeed;
        const lx = cx + Math.cos(offsetAng) * (outerR - 10);
        const ly = cy + Math.sin(offsetAng) * (outerR - 10);

        // Pulsing tail glow
        const fadeValue = 0.1 + 0.4 * Math.abs(Math.sin(offsetAng * 3.5));
        ctx.fillStyle = activeColor;
        ctx.globalAlpha = fadeValue;
        ctx.beginPath();
        ctx.arc(lx, ly, 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Outer interactive active-deck halo matching overall DJ mixer design
    ctx.beginPath();
    ctx.arc(cx, cy, outerR + 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = playing
      ? (deck === 'A' ? 'rgba(59, 130, 246, 0.32)' : 'rgba(239, 68, 68, 0.32)')
      : 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = playing ? 2.5 : 1.0;
    ctx.stroke();

    ctx.restore(); // restores our main scale save
  }, [angle, playing, deck, sizeProp]);

  const handleMouseDown = (e: React.MouseEvent) => {
    let lastX = e.clientX;
    onScratch(0, true, friction);
    const onMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - lastX;
      lastX = ev.clientX;
      onScratch(dx, true, friction);
    };
    const onMouseUp = () => {
      onScratch(0, false, friction);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div className="flex flex-col items-center gap-1.5 p-1 bg-[#090a0f] border border-[#202230]/40 rounded-xl shadow-xl hover:border-[#3b82f6]/20 transition-colors duration-300">
      <div className="relative p-1 bg-gradient-to-b from-[#181a24] to-[#0a0b10] rounded-full shadow-[inset_0_2px_10px_rgba(0,0,0,0.8),0_4px_12px_rgba(0,0,0,0.5)]">
        <canvas
          ref={canvasRef}
          width={sizeProp}
          height={sizeProp}
          className="rounded-full cursor-grab active:cursor-grabbing hover:brightness-110 active:scale-[0.985] transition-transform duration-100"
          onMouseDown={handleMouseDown}
        />
      </div>
      <div className="flex items-center gap-2 px-3 py-0.5 bg-black/40 border border-white/5 rounded-full">
        <span className={`w-1.5 h-1.5 rounded-full ${playing ? (deck === 'A' ? 'bg-blue-400 animate-pulse' : 'bg-red-400 animate-pulse') : 'bg-neutral-600'}`} />
        <div className="text-[7.5px] text-[#8892b0] uppercase tracking-[0.25em] font-black">{deck === 'A' ? 'DECK A | MAIN' : 'DECK B | AUX'}</div>
      </div>
    </div>
  );
};

