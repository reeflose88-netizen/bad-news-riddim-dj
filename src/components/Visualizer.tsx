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
        ctx.fillStyle = '#0d0d0d';
        ctx.fillRect(0, 0, W, H);

        const barWidth = (W / bufferLength) * 2.5;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const barHeight = (dataArray[i] / 255) * H;
          ctx.fillStyle = color;
          ctx.fillRect(x, H - barHeight, barWidth, barHeight);
          x += barWidth + 1;
        }
      } else if (mode === 'wave') {
        analyser.getByteTimeDomainData(dataArray);
        ctx.fillStyle = '#0d0d0d';
        ctx.fillRect(0, 0, W, H);
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
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
      } else if (mode === 'particles') {
        analyser.getByteFrequencyData(dataArray);
        ctx.fillStyle = 'rgba(13, 13, 13, 0.2)'; // trail effect
        ctx.fillRect(0, 0, W, H);
        
        const count = 40;
        const step = Math.floor(bufferLength / count);
        
        for (let i = 0; i < count; i++) {
          const val = dataArray[i * step];
          const radius = (val / 255) * 20;
          const x = (i / count) * W + W / count / 2;
          const y = H / 2;
          
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        }
      }
    };

    render();
    return () => cancelAnimationFrame(animationId);
  }, [analyser, mode, color]);

  return <canvas ref={canvasRef} className="w-full h-full block" />;
};
