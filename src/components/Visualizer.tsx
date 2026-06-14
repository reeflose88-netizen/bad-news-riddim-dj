import React, { useRef, useEffect } from 'react';

interface VisualizerProps {
  analyser?: AnalyserNode;
  mode: 'bars' | 'wave' | 'particles';
  color?: string;
}

export const Visualizer: React.FC<VisualizerProps> = ({ analyser, mode, color = '#44aaff' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const render = () => {
      animationId = requestAnimationFrame(render);
      
      const W = canvas.width = canvas.parentElement?.clientWidth || 200;
      const H = canvas.height = canvas.parentElement?.clientHeight || 100;

      if (mode === 'bars') {
        analyser.getByteFrequencyData(dataArray);
        ctx.clearRect(0, 0, W, H);

        const barWidth = (W / bufferLength) * 2.5;
        let x = 0;

        const isDeckA = color === '#44aaff';
        const peakColor = isDeckA ? '#66ccff' : '#ff4444';
        const midColor = isDeckA ? '#0099ff' : '#cc1111';
        const baseColor = isDeckA ? 'rgba(0, 80, 200, 0.2)' : 'rgba(150, 10, 10, 0.2)';

        for (let i = 0; i < bufferLength; i++) {
          const barHeight = (dataArray[i] / 255) * H;
          if (barHeight > 1) {
            const barGrad = ctx.createLinearGradient(x, H - barHeight, x, H);
            barGrad.addColorStop(0, peakColor); // Glowing peak
            barGrad.addColorStop(0.5, midColor); // Mid-deck color
            barGrad.addColorStop(1, baseColor); // Dark base
            ctx.fillStyle = barGrad;
            ctx.fillRect(x, H - barHeight, barWidth, barHeight);
          }
          x += barWidth + 1.2;
        }
      } else if (mode === 'wave') {
        analyser.getByteTimeDomainData(dataArray);
        ctx.clearRect(0, 0, W, H);
        
        ctx.save();
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = color;
        ctx.shadowBlur = 6;
        ctx.shadowColor = color === '#44aaff' ? 'rgba(0, 188, 255, 0.6)' : 'rgba(239, 68, 68, 0.6)';
        ctx.beginPath();

        const sliceWidth = W / bufferLength;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const v = dataArray[i] / 128.0;
          const y = (v * H) / 2;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += sliceWidth;
        }
        ctx.stroke();
        ctx.restore();
      } else if (mode === 'particles') {
        analyser.getByteFrequencyData(dataArray);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.22)'; // Transparent neutral decay trail feedback
        ctx.fillRect(0, 0, W, H);
        
        const count = 36;
        const step = Math.floor(bufferLength / count);
        
        for (let i = 0; i < count; i++) {
          const val = dataArray[i * step];
          const radius = (val / 255) * 16;
          const x = (i / count) * W + W / count / 2;
          const y = H / 2;
          
          if (radius > 1) {
            ctx.save();
            ctx.beginPath();
            const radGrad = ctx.createRadialGradient(x, y, 0, x, y, radius);
            const isDeckA = color === '#44aaff';
            radGrad.addColorStop(0, '#ffffff'); // bright hot spark
            radGrad.addColorStop(0.3, isDeckA ? '#00bcff' : '#ee2222'); // glowing deck key color
            radGrad.addColorStop(1, 'rgba(0, 0, 0, 0)'); // dissipation fading
            ctx.fillStyle = radGrad;
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }
      }
    };

    render();
    return () => cancelAnimationFrame(animationId);
  }, [analyser, mode, color]);

  return <canvas ref={canvasRef} className="w-full h-full block" />;
};
