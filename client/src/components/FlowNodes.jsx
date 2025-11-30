import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';

export const ACTIONS = {
  visit: { label: 'VISIT', code: 'VIS', color: '#0a84ff' },
  connect: { label: 'CONNECT', code: 'CON', color: '#32d74b' },
  like: { label: 'LIKE', code: 'LKE', color: '#ff375f' },
};

// Memoized CommandNode to prevent unnecessary re-renders
export const CommandNode = memo(function CommandNode({ data }) {
  const action = ACTIONS[data.type] || ACTIONS.visit;
  const isActive = data.status === 'active';
  const isDone = data.status === 'completed';
  const isSelected = data.isSelected;
  
  return (
    <div className="relative group">
      <Handle 
        type="target" 
        position={Position.Top} 
        className="!w-2 !h-2 !border-0 !rounded-none" 
        style={{ background: 'var(--node-handle)' }} 
      />
      <div 
        className="min-w-[160px] border transition-all duration-300 cursor-pointer"
        style={{ 
          background: isDone ? action.color : 'var(--node-bg)',
          borderColor: isSelected ? action.color : isActive ? 'var(--node-text)' : 'var(--node-border)',
          boxShadow: isSelected 
            ? `0 0 0 2px ${action.color}` 
            : isActive 
              ? `0 0 0 1px ${action.color}, 0 0 30px ${action.color}40` 
              : 'none'
        }}
      >
        <div 
          className="flex items-center justify-between px-3 py-2 border-b" 
          style={{ borderColor: isDone ? 'rgba(255,255,255,0.2)' : 'var(--node-border)' }}
        >
          <span 
            className="font-mono text-[10px] tracking-wider" 
            style={{ color: isDone ? '#fff' : action.color }}
          >
            {action.code}_{String(data.index || 0).padStart(2, '0')}
          </span>
          <div className="flex gap-1">
            {isActive && (
              <span 
                className="w-2 h-2 animate-[blink_1s_infinite]" 
                style={{ background: 'var(--node-text)' }} 
              />
            )}
            {isDone && <span className="text-white text-xs">✓</span>}
          </div>
        </div>
        <div className="px-3 py-3 relative">
          <div 
            className="text-sm font-bold tracking-wide" 
            style={{ color: isDone ? '#fff' : 'var(--node-text)' }}
          >
            {action.label}
          </div>
          {data.hasNote && (
            <div 
              className="mt-1 font-mono text-[9px]" 
              style={{ color: isDone ? 'rgba(255,255,255,0.6)' : 'var(--text-muted)' }}
            >
              + note
            </div>
          )}
          {data.result && (
            <div 
              className="mt-1 font-mono text-[9px] max-w-[140px] truncate" 
              style={{ color: isDone ? 'rgba(255,255,255,0.7)' : 'var(--node-text-muted)' }}
            >
              {data.result}
            </div>
          )}
          
          {/* Hover indicator */}
          {data.type === 'connect' && !isActive && !isDone && (
            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <span 
                className="text-[9px] font-mono tracking-wider px-1.5 py-0.5" 
                style={{ background: '#32d74b', color: '#fff' }}
              >
                EDIT
              </span>
            </div>
          )}
        </div>
      </div>
      <Handle 
        type="source" 
        position={Position.Bottom} 
        className="!w-2 !h-2 !border-0 !rounded-none" 
        style={{ background: 'var(--node-handle)' }} 
      />
    </div>
  );
});

// Memoized StartNode
export const StartNode = memo(function StartNode({ data }) {
  return (
    <div className="relative">
      <div 
        className="px-6 py-3 border font-mono text-xs tracking-widest transition-all duration-300"
        style={{
          background: data.active ? '#32d74b' : 'var(--node-bg)',
          color: data.active ? '#fff' : 'var(--node-text)',
          borderColor: data.active ? '#32d74b' : 'var(--node-border)'
        }}
      >
        START
      </div>
      <Handle 
        type="source" 
        position={Position.Bottom} 
        className="!w-2 !h-2 !border-0 !rounded-none" 
        style={{ background: 'var(--node-handle)' }} 
      />
    </div>
  );
});

// Memoized EndNode
export const EndNode = memo(function EndNode() {
  return (
    <div className="relative">
      <Handle 
        type="target" 
        position={Position.Top} 
        className="!w-2 !h-2 !border-0 !rounded-none" 
        style={{ background: 'var(--node-handle)' }} 
      />
      <div 
        className="px-6 py-3 border font-mono text-xs tracking-widest" 
        style={{ 
          background: 'var(--node-bg)', 
          borderColor: 'var(--node-border)', 
          color: 'var(--node-text-muted)' 
        }}
      >
        END
      </div>
    </div>
  );
});

// Node types object
export const nodeTypes = { 
  command: CommandNode, 
  start: StartNode, 
  end: EndNode 
};
