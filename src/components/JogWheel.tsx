import React, { useRef, useEffect } from 'react';

interface JogWheelProps {
  deck: 'A' | 'B';
  angle: number;
  playing: boolean;
  onScratch: (delta: number) => void;
  size?: number;
}

export const JogWheel: React.FC<JogWheelProps> = ({ deck, angle, playing, onScratch, size: sizeProp = 210 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const vinylTexRef = useRef<HTMLCanvasElement | null>(null);

  // Pre-render the vinyl texture once or when deck changes
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

    // 1. Vinyl Base (deeper carbon black satin-finish)
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#050505';
    ctx.fill();

    // 2. Lead-in / Run-out outer wax margin (polished smooth plastic ring)
    const leadInGrad = ctx.createRadialGradient(cx, cy, r - 6, cx, cy, r);
    leadInGrad.addColorStop(0, '#09090b');
    leadInGrad.addColorStop(0.65, '#121215');
    leadInGrad.addColorStop(1, '#050505');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.arc(cx, cy, r - 6, 0, Math.PI * 2, true);
    ctx.fillStyle = leadInGrad;
    ctx.fill();

    // Sparsely draw spiral lead-in grooves
    ctx.lineWidth = 0.45;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    ctx.arc(cx, cy, r - 2.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 4.2, 0, Math.PI * 2);
    ctx.stroke();

    // 3. Audio track regions: separates songs physically on the vinyl
    const audioTracks = [
      { start: 50, end: 61, d: 1.1 }, // Track 1: Outer Song
      { start: 39, end: 48, d: 1.3 }, // Track 2: Middle Song
      { start: 28, end: 37, d: 0.9 }  // Track 3: Inner Song
    ];

    audioTracks.forEach((track, idx) => {
      // Draw track matte background
      const trackGrad = ctx.createRadialGradient(cx, cy, track.start, cx, cy, track.end);
      trackGrad.addColorStop(0, '#0a0a0b');
      trackGrad.addColorStop(0.5, '#121214');
      trackGrad.addColorStop(1, '#080809');
      ctx.beginPath();
      ctx.arc(cx, cy, track.end, 0, Math.PI * 2);
      ctx.arc(cx, cy, track.start, 0, Math.PI * 2, true);
      ctx.fillStyle = trackGrad;
      ctx.fill();

      // Density grooves representing song dynamic range waveforms
      ctx.lineWidth = 0.35;
      for (let gr = track.start + 0.5; gr < track.end - 0.5; gr += 0.8) {
        // Vary opacities to simulate audio waveforms reflecting microgrooves
        const waveMod = Math.sin(gr * 2.5 + idx * 3) * Math.cos(gr * 0.75);
        const intensity = 0.04 + (Math.sin(gr * 12.0) * 0.015) + (waveMod * 0.02);
        ctx.beginPath();
        ctx.arc(cx, cy, gr, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,255,255,${intensity})`;
        ctx.stroke();
      }
    });

    // Dark silence/inter-track gaps
    ctx.lineWidth = 1.0;
    ctx.strokeStyle = '#040404';
    ctx.beginPath();
    ctx.arc(cx, cy, 49, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 38, 0, Math.PI * 2);
    ctx.stroke();

    // 4. Printed central paper record label (authentic styled 45rpm press label)
    const isDeckA = deck === 'A';
    const labelBg = isDeckA ? '#ffffff' : '#fce7f3'; // bright white label for A, pinkish retro for B
    const accentColor = isDeckA ? '#2563eb' : '#dc2626'; // brilliant blue or intense red
    const darkAccent = isDeckA ? '#0f172a' : '#450a0a';

    ctx.beginPath();
    ctx.arc(cx, cy, 27, 0, Math.PI * 2);
    ctx.fillStyle = labelBg;
    ctx.fill();

    // Styled graphic blocks for outstanding rotational contrast (crucial visual feedback)
    // Draw an elegant color block sector
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, 27, 0, Math.PI, false);
    ctx.fillStyle = accentColor;
    ctx.fill();

    // Draw central white and black contrasting sub-rings
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.strokeStyle = labelBg;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Outer label edge ink outline
    ctx.beginPath();
    ctx.arc(cx, cy, 27, 0, Math.PI * 2);
    ctx.strokeStyle = darkAccent;
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // Dynamic text inside printed label
    ctx.save();
    ctx.translate(cx, cy);

    // Mini text labels (vintage press details)
    ctx.fillStyle = labelBg;
    ctx.font = '900 4px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(isDeckA ? "A" : "B", 0, -21); // Big letter in the center of top half

    ctx.fillStyle = '#ffffff';
    ctx.font = '800 3px "JetBrains Mono", monospace';
    ctx.fillText("DECIBEL", -12, -15);
    ctx.fillText("STUDIO", 12, -15);

    // Bottom half horizontal labels
    ctx.fillStyle = darkAccent;
    ctx.font = '800 3.5px "JetBrains Mono", monospace';
    ctx.fillText("SERATO CONT.", 0, 11);
    ctx.font = '500 2.5px "JetBrains Mono", monospace';
    ctx.fillText("LICENSED FOR DJ USE", 0, 16);
    ctx.fillText("33 1/3 RPM STEREO", 0, 21);

    ctx.restore();

    // 5. Classic Fluo Neon Marker Sticker (The ultimate vinyl cueing sticker)
    // Used by turntablists globally to locate the first beat easily. Very tactile!
    ctx.save();
    ctx.translate(cx, cy);
    // Rotating marker strip extending out of the paper label
    ctx.fillStyle = isDeckA ? '#00f6ff' : '#ff0055'; // super radiant hot cyan or neon magenta
    // Render a high-contrast rectangular tape sticker
    ctx.fillRect(-1.5, -r + 1, 3, r - 20);
    ctx.restore();
    ctx.restore(); // restores our initial scale save

    vinylTexRef.current = oc;
  }, [deck, sizeProp]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !vinylTexRef.current) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = canvas.width;
    const baseSize = 160;
    const scaleFactor = size / baseSize;
    const cx = baseSize / 2, cy = baseSize / 2;
    const outerR = baseSize / 2 - 1; // 79

    ctx.clearRect(0, 0, size, size);

    ctx.save();
    ctx.scale(scaleFactor, scaleFactor);

    // 1. Sleek metallic outer base rim (platter frame)
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.fillStyle = '#101012';
    ctx.fill();

    // 2. Extruded silver-brushed aluminium platter side (Technics SL-1200 style)
    const platterGrad = ctx.createRadialGradient(cx, cy, outerR - 10, cx, cy, outerR);
    platterGrad.addColorStop(0, '#2b2b2d');
    platterGrad.addColorStop(0.3, '#73737a');
    platterGrad.addColorStop(0.55, '#d1d1d6');
    platterGrad.addColorStop(0.85, '#48484a');
    platterGrad.addColorStop(1, '#1c1c1e');
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.fillStyle = platterGrad;
    ctx.fill();

    // Metallic micro-grooves around side rim
    ctx.lineWidth = 0.5;
    for (let rEdge = outerR - 9; rEdge < outerR; rEdge += 1.5) {
      ctx.beginPath();
      ctx.arc(cx, cy, rEdge, 0, Math.PI * 2);
      ctx.strokeStyle = rEdge % 3 === 0 ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.2)';
      ctx.stroke();
    }

    // 3. Strobe Dot dimples (Turntable outer visual timing ring)
    // 60 small circular metallic rivets catching the overhead light
    const strobeRadius = outerR - 5;
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const dotX = cx + Math.cos(a) * strobeRadius;
      const dotY = cy + Math.sin(a) * strobeRadius;

      // Realistic 3D micro silver gradient dot
      const dotGrad = ctx.createRadialGradient(dotX - 0.4, dotY - 0.4, 0, dotX, dotY, 1.2);
      dotGrad.addColorStop(0, '#ffffff');
      dotGrad.addColorStop(0.4, '#c7c7cc');
      dotGrad.addColorStop(1, '#2c2c2e');
      ctx.beginPath();
      ctx.arc(dotX, dotY, 1.2, 0, Math.PI * 2);
      ctx.fillStyle = dotGrad;
      ctx.fill();
    }

    // 4. Dark recessed platter well beneath the vinyl
    const wellBg = ctx.createRadialGradient(cx, cy, outerR - 13, cx, cy, outerR - 10);
    wellBg.addColorStop(0, '#020202');
    wellBg.addColorStop(1, '#111113');
    ctx.beginPath();
    ctx.arc(cx, cy, outerR - 9, 0, Math.PI * 2);
    ctx.fillStyle = wellBg;
    ctx.fill();

    // Inner rim shadow
    ctx.beginPath();
    ctx.arc(cx, cy, outerR - 9, 0, Math.PI * 2);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 5. SPINNING VINYL RECORD (rotated overlay)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    // Vinyl width/height is 134, centered at (-67, -67) inside well of radius 70
    ctx.drawImage(vinylTexRef.current, -134 / 2, -134 / 2, 134, 134);
    ctx.restore();

    // 6. FIXED SCIENTIFIC ANISOTROPIC LIGHT SHEEN OVERLAYS (Hourglass shape)
    // Reflections stay in place regarding user perspective while vinyl rotates underneath!
    const drawSheenWedge = (startAngle: number, endAngle: number, maxAlpha: number) => {
      const sh = ctx.createRadialGradient(cx, cy, 10, cx, cy, outerR - 10);
      sh.addColorStop(0, 'rgba(255,255,255,0.01)');
      sh.addColorStop(0.4, `rgba(255,255,255,${maxAlpha * 0.7})`);
      sh.addColorStop(0.8, `rgba(255,255,255,${maxAlpha})`);
      sh.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, outerR - 10, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = sh;
      ctx.fill();
    };

    // Primary bright hourglass reflections (top-left to bottom-right)
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    drawSheenWedge(-Math.PI * 0.25 - 0.22, -Math.PI * 0.25 + 0.22, 0.16); // Top-right wedge
    drawSheenWedge(Math.PI * 0.75 - 0.22, Math.PI * 0.75 + 0.22, 0.16);   // Bottom-left wedge

    // Secondary softer reflections (orthogonal / ambient spotlight)
    drawSheenWedge(Math.PI * 0.25 - 0.18, Math.PI * 0.25 + 0.18, 0.08);  // Bottom-right wedge
    drawSheenWedge(-Math.PI * 0.75 - 0.18, -Math.PI * 0.75 + 0.18, 0.08); // Top-left wedge
    ctx.restore();

    // 7. Bezel fine inner highlight ring
    ctx.beginPath();
    ctx.arc(cx, cy, outerR - 9.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // 8. 3D Spindle Cap & Pin (Static silver center core)
    // Spindle peg doesn't rotate, creating gorgeous realism
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0a0d';
    ctx.fill();
    ctx.strokeStyle = '#222226';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    const spindleGrad = ctx.createRadialGradient(cx - 1.2, cy - 1.2, 0, cx, cy, 3.8);
    spindleGrad.addColorStop(0, '#ffffff');
    spindleGrad.addColorStop(0.35, '#cccccc');
    spindleGrad.addColorStop(0.7, '#66666c');
    spindleGrad.addColorStop(1, '#2c2c30');
    ctx.beginPath();
    ctx.arc(cx, cy, 3.8, 0, Math.PI * 2);
    ctx.fillStyle = spindleGrad;
    ctx.fill();

    // Highlight indicator if playing to enhance active deck UI glow
    if (playing) {
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
      ctx.strokeStyle = deck === 'A' ? 'rgba(75,195,255,0.12)' : 'rgba(239,68,68,0.12)';
      ctx.lineWidth = 6;
      ctx.stroke();
    }
    ctx.restore(); // restores our main scale save
  }, [angle, playing, deck, sizeProp]);

  const handleMouseDown = (e: React.MouseEvent) => {
    let lastX = e.clientX;
    const onMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - lastX;
      lastX = ev.clientX;
      onScratch(dx);
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <canvas
        ref={canvasRef}
        width={sizeProp}
        height={sizeProp}
        className="rounded-full cursor-grab active:cursor-grabbing jog-inner-glow"
        onMouseDown={handleMouseDown}
      />
      <div className="text-[7px] text-[#555] uppercase tracking-widest font-display">Deck {deck}</div>
    </div>
  );
};
