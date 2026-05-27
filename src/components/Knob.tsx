import React, { useState, useRef, useEffect } from 'react';

interface KnobProps {
  size?: 'xs' | 'sm' | 'md' | 'lg';
  min?: number;
  max?: number;
  defaultValue?: number;
  unit?: string;
  label?: string;
  color?: string;
  onChange?: (value: number) => void;
}

export const Knob: React.FC<KnobProps> = ({
  size = 'md',
  min = 0,
  max = 100,
  defaultValue = 50,
  unit = '',
  label,
  color = '#44aaff',
  onChange,
}) => {
  const [value, setValue] = useState(defaultValue);
  const [angle, setAngle] = useState(((defaultValue - min) / (max - min)) * 270 - 135);
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef<number>(0);
  const startAngleRef = useRef<number>(0);

  const sizePx = size === 'xs' ? 20 : size === 'sm' ? 28 : size === 'md' ? 34 : 40;
  const innerInset1 = size === 'xs' ? '2px' : '3px';
  const innerInset2 = size === 'xs' ? '4px' : '5px';

  useEffect(() => {
    const newVal = min + ((angle + 135) / 270) * (max - min);
    setValue(newVal);
    if (onChange) onChange(newVal);
  }, [angle]);

  const handleMouseDown = (e: React.MouseEvent) => {
    startYRef.current = e.clientY;
    startAngleRef.current = angle;
    setIsDragging(true);

    const handleMouseMove = (ev: MouseEvent) => {
      const deltaY = startYRef.current - ev.clientY;
      const newAngle = Math.max(-135, Math.min(135, startAngleRef.current + deltaY * 1.5));
      setAngle(newAngle);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleDoubleClick = () => {
    setAngle(0);
  };

  const handleWheel = (e: React.WheelEvent) => {
    const delta = e.deltaY > 0 ? -5 : 5;
    setAngle(prev => Math.max(-135, Math.min(135, prev + delta)));
  };

  const displayValue = Number.isInteger(value) ? value : value.toFixed(1);

  return (
    <div className="flex flex-col items-center gap-1">
      <div 
        className="relative rounded-full cursor-pointer group"
        style={{ 
          width: sizePx, 
          height: sizePx,
          background: `conic-gradient(from 135deg, ${color} 0deg, ${color} ${angle + 135}deg, #1e1e1e ${angle + 135}deg, #1e1e1e 270deg, #0d0d0d 270deg)`
        }}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
      >
        {/* Ticks/Markers */}
        {[...Array(11)].map((_, i) => {
          const tickAngle = i * 27 - 135;
          const isActive = (tickAngle + 135) <= (angle + 135);
          return (
            <div 
              key={i}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
              style={{ 
                transform: `rotate(${tickAngle}deg) translateY(-${sizePx/2 - 1}px)`,
                width: '1px',
                height: i % 5 === 0 ? '4px' : '2px',
                background: isActive ? color : '#333',
                boxShadow: isActive ? `0 0 4px ${color}` : 'none'
              }}
            />
          );
        })}

        <div className="absolute rounded-full bg-[#0d0d0d] shadow-inner" style={{ inset: innerInset1 }} />
        <div 
          className="absolute rounded-full knob-body flex items-start justify-center transition-transform duration-75"
          style={{ transform: `rotate(${angle}deg)`, inset: innerInset2 }}
        >
          {/* Main Pointer Line */}
          <div className="w-[1.5px] h-[55%] mt-[1px] bg-white rounded-full shadow-[0_0_4px_rgba(255,255,255,0.8)]" />
        </div>
        
        {/* Tooltip */}
        {(isDragging || true) && (
          <div className={`absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-[#111] border border-[${color}] text-[${color}] text-[8px] px-1 rounded whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50`}>
            {displayValue}{unit}
          </div>
        )}
      </div>
      {label && <div className="text-[6.5px] text-[#666] uppercase tracking-[0.5px]">{label}</div>}
    </div>
  );
};
