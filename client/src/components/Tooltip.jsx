import React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';

export function TooltipProvider({ children }) {
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export function Tooltip({ children, content, side = 'top', sideOffset = 5 }) {
  if (!content) return children;
  
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>
        {children}
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={sideOffset}
          className="z-50 px-2 py-1 font-mono text-[10px] tracking-wider animate-in fade-in-0 zoom-in-95"
          style={{
            background: 'var(--text)',
            color: 'var(--bg)',
            borderRadius: '0',
          }}
        >
          {content}
          <TooltipPrimitive.Arrow style={{ fill: 'var(--text)' }} />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

// Button with tooltip
export function TooltipButton({ tooltip, children, ...props }) {
  return (
    <Tooltip content={tooltip}>
      <button {...props}>
        {children}
      </button>
    </Tooltip>
  );
}
