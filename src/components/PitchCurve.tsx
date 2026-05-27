import React, { useRef, useEffect } from 'react';

interface PitchCurveProps {
  history: number[];
  color?: string;
}

export const PitchCurve: React.FC<PitchCurveProps> = ({ history, color = '#44aaff' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width = canvas.parentElement?.clientWidth || 200;
    const H = canvas.height = canvas.parentElement?.clientHeight || 40;

    const render = () => {
      ctx.clearRect(0, 0, W, H);
      
      // Center line
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.beginPath();
      ctx.moveTo(0, H / 2);
      ctx.lineTo(W, H / 2);
      ctx.stroke();

      if (history.length < 2) return;

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();

      const sliceWidth = W / 100; // Show last 100 points
      const startIdx = Math.max(0, history.length - 100);
      const points = history.slice(startIdx);

      points.forEach((p, i) => {
        // Map pitch (-16 to 16) to height
        const normalized = (p / 16) * (H / 2);
        const x = i * sliceWidth;
        const y = H / 2 - normalized;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });

      ctx.stroke();

      // Fade effect at the end
      const grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.1, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = grad;
      // ctx.fillRect(0, 0, W, H);
    };

    render();
  }, [history, color]);

  return (
    <div className="w-full h-full relative overflow-hidden bg-black/40 rounded-sm border border-white/5">
      <canvas ref={canvasRef} className="w-full h-full block" />
      <div className="absolute top-0.5 left-1 text-[6px] text-white/30 uppercase font-mono">Pitch Curve</div>
    </div>
  );
};
