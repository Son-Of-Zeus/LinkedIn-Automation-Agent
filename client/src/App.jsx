import React, { 
  useEffect, 
  useState, 
  useCallback, 
  useRef, 
  useMemo, 
  useLayoutEffect,
  useTransition,
  Suspense,
  memo
} from 'react';
import ReactFlow, { Controls, useNodesState, useEdgesState, MarkerType } from 'reactflow';
import { io } from 'socket.io-client';
import { useDropzone } from 'react-dropzone';
import Papa from 'papaparse';
import 'reactflow/dist/style.css';
import './index.css';

// Custom Components
import { ErrorBoundary } from './components/ErrorBoundary';
import { TooltipProvider, Tooltip, TooltipButton } from './components/Tooltip';
import { nodeTypes, ACTIONS } from './components/FlowNodes';

// Custom Hooks
import { useSocketConnection, useFocusTrap, useStableCallback, useDebouncedCallback } from './hooks/useSocket';

const socket = io('http://localhost:3001');

const Metric = memo(function Metric({ value, label, color = 'var(--text)' }) {
  return (
    <div className="text-center">
      <div className="text-5xl font-bold tracking-tighter" style={{ color }}>{value}</div>
      <div className="text-[10px] font-mono tracking-widest mt-1" style={{ color: 'var(--text-muted)' }}>{label}</div>
    </div>
  );
});

const LogLine = memo(function LogLine({ text, index }) {
  const isError = text.includes('ERROR');
  const isSuccess = text.includes('DONE');
  const color = isError ? '#ff375f' : isSuccess ? '#32d74b' : 'var(--text-muted)';
  
  return (
    <div className="font-mono text-[11px] py-1 flex gap-3" style={{ borderBottom: '1px solid var(--border)' }}>
      <span style={{ color: 'var(--text-subtle)' }}>{String(index + 1).padStart(3, '0')}</span>
      <span style={{ color }}>{text}</span>
    </div>
  );
});

const LoadingFallback = memo(function LoadingFallback() {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--text-muted)' }}>
        LOADING...
      </div>
    </div>
  );
});

// Login overlay
const LoginOverlay = memo(function LoginOverlay() {
  return (
    <div 
      className="absolute inset-0 flex items-center justify-center"
      style={{ background: 'var(--bg)', opacity: 0.95 }}
    >
      <div className="text-center p-8 border" style={{ background: 'var(--bg)', borderColor: 'var(--border-strong)' }}>
        <div className="w-12 h-12 mx-auto mb-4 border-2 flex items-center justify-center" style={{ borderColor: '#ff375f' }}>
          <span className="text-2xl">🔒</span>
        </div>
        <div className="font-mono text-sm tracking-wider mb-2" style={{ color: 'var(--text)' }}>LOGIN REQUIRED</div>
        <div className="font-mono text-[11px] max-w-[280px]" style={{ color: 'var(--text-muted)' }}>
          Please Click on the Debug URL and login to the browserinstance. After logging in please refresh this page.
          If already logged in, please wait while the agent logs into your account.
        </div>
        <div className="mt-4 flex items-center justify-center gap-2">
          <span className="w-2 h-2 animate-pulse" style={{ background: '#ff375f' }} />
          <span className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--text-muted)' }}>WAITING FOR AUTH</span>
        </div>
      </div>
    </div>
  );
});

// Stats display
const StatsDisplay = memo(function StatsDisplay({ stats }) {
  if (stats.total <= 0) return null;
  
  const metrics = useMemo(() => [
    { v: stats.current, l: 'DONE', c: '#32d74b' },
    { v: stats.total, l: 'TOTAL', c: 'var(--text)' },
    { v: Math.round((stats.current / stats.total) * 100) + '%', l: 'PROGRESS', c: '#0a84ff' }
  ], [stats.current, stats.total]);
  
  return (
    <div className="grid grid-cols-3 gap-px border-b" style={{ background: 'var(--border)', borderColor: 'var(--border)' }}>
      {metrics.map((m, i) => (
        <div key={i} className="p-3" style={{ background: 'var(--bg)' }}>
          <Metric value={m.v} label={m.l} color={m.c} />
        </div>
      ))}
    </div>
  );
});

// Workflow sequence
const WorkflowSequence = memo(function WorkflowSequence({ 
  workflow, 
  showMenu, 
  setShowMenu, 
  setWorkflow, 
  disabled 
}) {
  const handleAddAction = useCallback((key) => {
    setWorkflow(w => [...w, { type: key, delayMs: 0 }]);
    setShowMenu(false);
  }, [setWorkflow, setShowMenu]);
  
  const handleRemoveAction = useCallback((index) => {
    if (index > 0) {
      setWorkflow(w => w.filter((_, j) => j !== index));
    }
  }, [setWorkflow]);
  
  return (
    <div 
      className="p-4 border-b" 
      style={{ 
        borderColor: 'var(--border)', 
        opacity: disabled ? 0.5 : 1, 
        pointerEvents: disabled ? 'none' : 'auto' 
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--text-muted)' }}>SEQUENCE</span>
        <TooltipButton 
          tooltip="Add action to sequence"
          onClick={() => setShowMenu(!showMenu)} 
          className="font-mono text-[10px]" 
          style={{ color: 'var(--text-muted)' }}
        >
          [+]
        </TooltipButton>
      </div>
      
      {showMenu && (
        <div className="mb-3 border divide-y" style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-secondary)' }}>
          {Object.entries(ACTIONS).map(([key, { label, color }]) => (
            <button
              key={key}
              onClick={() => handleAddAction(key)}
              className="w-full px-3 py-2 text-left font-mono text-xs flex items-center gap-2 hover:opacity-80 transition-opacity"
            >
              <span className="w-2 h-2" style={{ background: color }} />
              <span style={{ color: 'var(--text)' }}>{label}</span>
            </button>
          ))}
        </div>
      )}
      
      <div className="space-y-1">
        {workflow.map((item, i) => {
          const type = typeof item === 'string' ? item : item.type;
          const a = ACTIONS[type];
          const hasMessage = type === 'connect' && item.message;
          
          return (
            <div 
              key={i} 
              className="flex items-center gap-2 p-2 group transition-all"
              style={{ background: 'var(--bg-secondary)' }}
            >
              <span className="w-2 h-2 flex-shrink-0" style={{ background: a.color }} />
              <span className="font-mono text-xs flex-1" style={{ color: 'var(--text)' }}>
                {a.label}
                {hasMessage && <span style={{ color: 'var(--text-muted)' }}> + note</span>}
              </span>
              <Tooltip content={i > 0 ? "Remove action" : null}>
                <button 
                  onClick={() => handleRemoveAction(i)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ color: i > 0 ? '#ff375f' : 'transparent' }}
                  disabled={i === 0}
                  aria-label={i > 0 ? "Remove action" : undefined}
                >
                  ×
                </button>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// Log panel 
const LogPanel = memo(function LogPanel({ logs, isRunning, onClear }) {
  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="px-4 py-2 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] tracking-widest" style={{ color: 'var(--text-muted)' }}>LOG</span>
          {isRunning && <span className="w-1.5 h-1.5 bg-[#32d74b] animate-[blink_1s_infinite]" />}
        </div>
        {logs.length > 0 && (
          <TooltipButton 
            tooltip="Clear all logs"
            onClick={onClear} 
            className="font-mono text-[10px] tracking-widest hover:opacity-70"
            style={{ color: 'var(--text-muted)' }}
          >
            CLEAR
          </TooltipButton>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {logs.length === 0 ? (
          <div className="font-mono text-[11px]" style={{ color: 'var(--text-subtle)' }}>// ready</div>
        ) : (
          logs.map((log, i) => <LogLine key={`${log}-${i}`} text={log} index={i} />)
        )}
      </div>
    </div>
  );
});

// Edit Panel
const InlineEditPanel = memo(function InlineEditPanel({ 
  selectedAction, 
  workflow, 
  setWorkflow, 
  onClose 
}) {
  const panelRef = useRef(null);
  const textareaRef = useRef(null);
  
  // Focus for acesssibility purposes
  useFocusTrap(panelRef, selectedAction !== null);
  
  // Local state for optimistic UI
  const [localMessage, setLocalMessage] = useState('');
  
  useEffect(() => {
    if (selectedAction !== null) {
      setLocalMessage(workflow[selectedAction]?.message || '');
    }
  }, [selectedAction, workflow]);
  
  useLayoutEffect(() => {
    if (selectedAction !== null && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [selectedAction]);
  
  const debouncedSetMessage = useDebouncedCallback((msg) => {
    setWorkflow(w => w.map((it, j) => j === selectedAction ? { ...it, message: msg } : it));
  }, 150);
  
  const handleMessageChange = useCallback((e) => {
    const msg = e.target.value;
    setLocalMessage(msg);
    debouncedSetMessage(msg);
  }, [debouncedSetMessage]);
  
  const handleInsertVariable = useCallback((variable) => {
    const newMessage = localMessage + variable;
    setLocalMessage(newMessage);
    debouncedSetMessage(newMessage);
    textareaRef.current?.focus();
  }, [localMessage, debouncedSetMessage]);
  
  const variables = useMemo(() => [
    { var: '{{firstName}}', label: 'First Name', color: '#0a84ff' },
    { var: '{{lastName}}', label: 'Last Name', color: '#bf5af2' }
  ], []);
  
  if (selectedAction === null || workflow[selectedAction]?.type !== 'connect') {
    return null;
  }
  
  return (
    <div 
      ref={panelRef}
      className="absolute top-0 right-0 h-full w-[300px] border-l flex flex-col"
      style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
      role="dialog"
      aria-label="Edit connection note"
    >
      <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3" style={{ background: '#32d74b' }} />
          <span className="font-mono text-sm font-bold" style={{ color: 'var(--text)' }}>CONNECT</span>
        </div>
        <TooltipButton 
          tooltip="Close panel"
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center"
          style={{ color: 'var(--text-muted)' }}
          aria-label="Close edit panel"
        >
          ×
        </TooltipButton>
      </div>
      
      <div className="p-4 flex-1 overflow-y-auto">
        <label htmlFor="connection-note" className="font-mono text-[10px] tracking-widest mb-2 block" style={{ color: 'var(--text-muted)' }}>
          CONNECTION NOTE
        </label>
        <div className="font-mono text-[9px] mb-3" style={{ color: 'var(--text-subtle)' }}>
          Optional message sent with your connection request
        </div>
        <textarea
          id="connection-note"
          ref={textareaRef}
          value={localMessage}
          onChange={handleMessageChange}
          placeholder="Hi {{firstName}}, I'd love to connect!"
          className="w-full px-3 py-3 border font-mono text-xs outline-none resize-none"
          style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-strong)', color: 'var(--text)', minHeight: '120px' }}
        />
        
        <div className="font-mono text-[10px] tracking-widest mt-4 mb-2" style={{ color: 'var(--text-muted)' }}>
          VARIABLES
        </div>
        <div className="flex flex-wrap gap-2">
          {variables.map(v => (
            <TooltipButton
              key={v.var}
              tooltip={`Insert ${v.label}`}
              onClick={() => handleInsertVariable(v.var)}
              className="px-3 py-2 font-mono text-[10px] transition-all hover:opacity-80"
              style={{ background: v.color, color: '#fff' }}
            >
              {v.label}
            </TooltipButton>
          ))}
        </div>
        
        <div className="font-mono text-[9px] mt-4 p-3 border" style={{ borderColor: 'var(--border)', color: 'var(--text-subtle)', background: 'var(--bg-secondary)' }}>
          Leave empty to send without a note
        </div>
      </div>
    </div>
  );
});



//Main APp
export default function App() {
  // ReactFlow stuff
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  
  // App stuff
  const [connected, setConnected] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState({ current: 0, total: 0 });
  const [workflow, setWorkflow] = useState([{ type: 'visit', delayMs: 0 }]);
  const [isRunning, setIsRunning] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [theme, setTheme] = useState('light');
  const [mode, setMode] = useState('single');
  const [singleUrl, setSingleUrl] = useState('');
  const [selectedAction, setSelectedAction] = useState(null);
  
  // Refs
  const workflowRef = useRef(workflow);
  const inputRef = useRef(null);
  
 
  useEffect(() => {
    workflowRef.current = workflow;
  }, [workflow]);
  

  const [, startTransition] = useTransition();
  
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  
  useLayoutEffect(() => {
    if (mode === 'single' && loggedIn && inputRef.current) {
      inputRef.current.focus();
    }
  }, [mode, loggedIn]);
  
  const addLog = useStableCallback((msg) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    startTransition(() => {
      setLogs(prev => [`[${time}] ${msg}`, ...prev].slice(0, 50));
    });
  });
  
  const buildFlow = useCallback(() => {
    const wf = workflowRef.current;
    const n = [{ id: 'start', type: 'start', position: { x: 200, y: 0 }, data: { active: isRunning } }];
    const e = [];
    
    wf.forEach((item, i) => {
      const type = typeof item === 'string' ? item : item.type;
      const hasNote = type === 'connect' && item.message;
      n.push({
        id: `cmd-${i}`,
        type: 'command',
        position: { x: 200, y: 80 + i * 100 },
        data: { type, index: i + 1, status: 'idle', hasNote, isSelected: selectedAction === i }
      });
      e.push({
        id: `e-${i}`,
        source: i === 0 ? 'start' : `cmd-${i - 1}`,
        target: `cmd-${i}`,
        style: { stroke: 'var(--border-strong)', strokeWidth: 1 },
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--border-strong)', width: 15, height: 15 }
      });
    });
    
    n.push({ id: 'end', type: 'end', position: { x: 200, y: 80 + wf.length * 100 } });
    e.push({
      id: 'e-end',
      source: `cmd-${wf.length - 1}`,
      target: 'end',
      style: { stroke: 'var(--border-strong)', strokeWidth: 1, strokeDasharray: '4 4' }
    });
    
    setNodes(n);
    setEdges(e);
  }, [isRunning, selectedAction, setNodes, setEdges]);
  
  useEffect(() => {
    buildFlow();
  }, [workflow, isRunning, selectedAction, buildFlow]);
  
  const socketHandlers = useMemo(() => ({
    'session-init': ({ message }) => {
      addLog(`INIT: ${message}`);
    },
    'login-status': ({ loggedIn: isLoggedIn }) => {
      setLoggedIn(isLoggedIn);
      addLog(isLoggedIn ? 'AUTH: Logged in' : 'AUTH: Not logged in - check Live View');
    },
    'agent-session-start': ({ sessionId }) => {
      setConnected(true);
      addLog(`SESSION: ${sessionId?.slice(0, 8)}...`);
    },
    'node-update': ({ nodeId, status, data }) => {
      const match = nodeId.match(/^action-(\d+)$/);
      if (match) {
        const idx = parseInt(match[1], 10);
        
        let result = '';
        if (data) {
          if (data.name) result = data.name;
          else if (data.connected) result = 'Connected';
          else if (data.followed) result = 'Followed';
          else if (data.liked) result = 'Liked';
          else if (data.messageOpened) result = 'Opened';
        }
        
        setNodes(ns => ns.map(n => 
          n.id === `cmd-${idx}` ? { ...n, data: { ...n.data, status, result } } : n
        ));
        setEdges(es => es.map(e => ({
          ...e,
          style: { ...e.style, stroke: e.target === `cmd-${idx}` && status === 'active' ? 'var(--text)' : 'var(--border-strong)' },
          animated: e.target === `cmd-${idx}` && status === 'active'
        })));
        
        const actionType = workflowRef.current[idx]?.type || 'action';
        addLog(`${status.toUpperCase()}: ${actionType}`);
        
        if (actionType === 'visit' && status === 'completed' && data?.name) {
          addLog(`PROFILE: ${data.name}`);
          if (data.headline) addLog(`  ${data.headline.slice(0, 60)}${data.headline.length > 60 ? '...' : ''}`);
        }
      }
    },
    'campaign-progress': (data) => setStats(data),
    'campaign-result': ({ url }) => addLog(`DONE: ${url.slice(0, 40)}...`),
    'agent-error': ({ message }) => addLog(`ERROR: ${message}`),
    'campaign-finished': () => { 
      addLog('END: Complete'); 
      setIsRunning(false); 
    },
    'reset-graph': () => {
      setNodes(() => {
        const wf = workflowRef.current;
        const n = [{ id: 'start', type: 'start', position: { x: 200, y: 0 }, data: { active: true } }];
        wf.forEach((item, i) => {
          const type = typeof item === 'string' ? item : item.type;
          const hasNote = type === 'connect' && item.message;
          n.push({
            id: `cmd-${i}`,
            type: 'command',
            position: { x: 200, y: 80 + i * 100 },
            data: { type, index: i + 1, status: 'idle', hasNote, isSelected: false }
          });
        });
        n.push({ id: 'end', type: 'end', position: { x: 200, y: 80 + wf.length * 100 } });
        return n;
      });
    },
    'disconnect': () => setConnected(false),
  }), [addLog, setNodes, setEdges]);
  
  useSocketConnection(socket, socketHandlers);
  
  const handleNodeClick = useCallback((event, node) => {
    if (node.id.startsWith('cmd-')) {
      const idx = parseInt(node.id.replace('cmd-', ''), 10);
      const item = workflowRef.current[idx];
      if (item?.type === 'connect') {
        setSelectedAction(prev => prev === idx ? null : idx);
      } else {
        setSelectedAction(null);
      }
    } else {
      setSelectedAction(null);
    }
  }, []);
  
  const handlePaneClick = useCallback(() => {
    setSelectedAction(null);
  }, []);
  
  // Handle node reordering
  const handleNodeDragStop = useCallback((event, node) => {
    if (node.id === 'start') {
      setNodes(ns => ns.map(n => n.id === 'start' ? { ...n, position: { x: 200, y: 0 } } : n));
      return;
    }
    if (node.id === 'end') {
      const endY = 80 + workflowRef.current.length * 100;
      setNodes(ns => ns.map(n => n.id === 'end' ? { ...n, position: { x: 200, y: endY } } : n));
      return;
    }
    
    if (node.id === 'cmd-0') {
      setNodes(ns => ns.map(n => n.id === 'cmd-0' ? { ...n, position: { x: 200, y: 80 } } : n));
      return;
    }
    
    if (!node.id.startsWith('cmd-')) return;
    
    // Get all command nodes with their current positions
    setNodes(currentNodes => {
      // Get only reorderable nodes
      const reorderableNodes = currentNodes
        .filter(n => n.id.startsWith('cmd-') && n.id !== 'cmd-0')
        .map(n => ({
          ...n,
          workflowIdx: parseInt(n.id.replace('cmd-', ''), 10)
        }))
        .sort((a, b) => a.position.y - b.position.y);
      
      // Build new workflow; visit always stays first
      const visitAction = workflowRef.current[0];
      const reorderedActions = reorderableNodes.map(n => workflowRef.current[n.workflowIdx]);
      const newWorkflow = [visitAction, ...reorderedActions];
      
      // Check if order actually changed 
      const orderChanged = reorderableNodes.some((n, i) => n.workflowIdx !== i + 1);
      
      if (orderChanged) {
        // Update the workflow state 
        setWorkflow(newWorkflow);
      } else {
        //snap the node back to its proper position if order din't change
        return currentNodes.map(n => {
          if (n.id.startsWith('cmd-')) {
            const idx = parseInt(n.id.replace('cmd-', ''), 10);
            return { ...n, position: { x: 200, y: 80 + idx * 100 } };
          }
          return n;
        });
      }
      
      return currentNodes;
    });
  }, [setNodes, setWorkflow]);
  
  // controls
  const startCampaign = useCallback((urls) => {
    if (urls.length) {
      setStats({ current: 0, total: urls.length });
      setIsRunning(true);
      addLog(`INIT: ${urls.length} target${urls.length > 1 ? 's' : ''}`);
      socket.emit('start-campaign', { urls, workflow: workflowRef.current });
    }
  }, [addLog]);
  
  const stopCampaign = useCallback(() => {
    socket.emit('stop-campaign');
    setIsRunning(false);
    addLog('STOP: Cancelled');
  }, [addLog]);
  
  const handleSingleRun = useCallback(() => {
    if (singleUrl && singleUrl.startsWith('http')) {
      startCampaign([singleUrl]);
      setSingleUrl('');
    }
  }, [singleUrl, startCampaign]);
  
  const clearLogs = useCallback(() => setLogs([]), []);
  
  const toggleTheme = useCallback(() => {
    setTheme(t => t === 'dark' ? 'light' : 'dark');
  }, []);
  
  const dropzoneConfig = useMemo(() => ({
    onDrop: (files) => {
      Papa.parse(files[0], {
        complete: (res) => {
          const urls = res.data.map(r => r[0]).filter(u => u?.startsWith('http'));
          startCampaign(urls);
        }
      });
    },
    maxFiles: 1,
    accept: { 'text/csv': ['.csv'] }
  }), [startCampaign]);
  
  const { getRootProps, getInputProps, isDragActive } = useDropzone(dropzoneConfig);
  
  return (
    <ErrorBoundary>
      <TooltipProvider>
        <div className="h-screen w-screen flex overflow-hidden" style={{ background: 'var(--bg)' }}>
          <div className="w-[400px] flex flex-col border-r" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
            <header className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
              <h1 className="text-xl font-bold tracking-tight">LINKEDIN AGENT</h1>
              <div className="flex items-center gap-2">
                <TooltipButton 
                  tooltip={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                  onClick={toggleTheme}
                  className="w-8 h-8 flex items-center justify-center border"
                  style={{ borderColor: 'var(--border-strong)' }}
                  aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                  {theme === 'dark' ? '☀' : '☾'}
                </TooltipButton>
              </div>
            </header>

            <div 
              className="p-4 border-b" 
              style={{ 
                borderColor: 'var(--border)', 
                opacity: !loggedIn ? 0.5 : 1, 
                pointerEvents: !loggedIn ? 'none' : 'auto' 
              }}
            >
              <div className="flex border" style={{ borderColor: 'var(--border-strong)' }} role="tablist">
                {['single', 'batch'].map((m) => (
                  <Tooltip key={m} content={m === 'single' ? 'Process one profile' : 'Process multiple profiles from CSV'}>
                    <button
                      role="tab"
                      aria-selected={mode === m}
                      onClick={() => setMode(m)}
                      className="flex-1 py-2 font-mono text-xs tracking-wider transition-all"
                      style={{ 
                        background: mode === m ? 'var(--text)' : 'transparent', 
                        color: mode === m ? 'var(--bg)' : 'var(--text-muted)' 
                      }}
                    >
                      {m.toUpperCase()}
                    </button>
                  </Tooltip>
                ))}
              </div>
            </div>

            <div 
              className="p-4 border-b" 
              style={{ 
                borderColor: 'var(--border)', 
                opacity: !loggedIn ? 0.5 : 1, 
                pointerEvents: !loggedIn ? 'none' : 'auto' 
              }}
            >
              {mode === 'single' ? (
                <div>
                  <input
                    ref={inputRef}
                    type="text"
                    value={singleUrl}
                    onChange={(e) => setSingleUrl(e.target.value)}
                    placeholder="https://linkedin.com/in/username"
                    className="w-full px-3 py-3 border font-mono text-xs outline-none"
                    style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-strong)', color: 'var(--text)' }}
                    onKeyDown={(e) => e.key === 'Enter' && !isRunning && handleSingleRun()}
                    disabled={isRunning}
                    aria-label="LinkedIn profile URL"
                  />
                  <Tooltip content={isRunning ? 'Stop the current campaign' : 'Start processing the profile'}>
                    <button 
                      onClick={isRunning ? stopCampaign : handleSingleRun} 
                      disabled={!isRunning && !singleUrl} 
                      className="w-full mt-2 py-3 font-mono text-xs tracking-widest disabled:opacity-30" 
                      style={{ background: isRunning ? '#ff375f' : 'var(--text)', color: isRunning ? '#fff' : 'var(--bg)' }}
                    >
                      {isRunning ? '■ STOP' : 'RUN →'}
                    </button>
                  </Tooltip>
                </div>
              ) : (
                <div>
                  <Tooltip content="Drop a CSV file with LinkedIn profile URLs">
                    <div 
                      {...getRootProps()} 
                      className="border border-dashed p-6 text-center cursor-pointer" 
                      style={{ 
                        borderColor: isDragActive ? 'var(--text)' : 'var(--border-strong)', 
                        opacity: isRunning ? 0.5 : 1, 
                        pointerEvents: isRunning ? 'none' : 'auto' 
                      }}
                    >
                      <input {...getInputProps()} aria-label="Upload CSV file" />
                      <div className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                        {isDragActive ? '[ DROP ]' : '[ CSV ]'}
                      </div>
                    </div>
                  </Tooltip>
                  {isRunning && (
                    <Tooltip content="Stop the current batch campaign">
                      <button 
                        onClick={stopCampaign} 
                        className="w-full mt-2 py-3 font-mono text-xs tracking-widest" 
                        style={{ background: '#ff375f', color: '#fff' }}
                      >
                        ■ STOP
                      </button>
                    </Tooltip>
                  )}
                </div>
              )}
            </div>

            <StatsDisplay stats={stats} />

            <WorkflowSequence 
              workflow={workflow}
              showMenu={showMenu}
              setShowMenu={setShowMenu}
              setWorkflow={setWorkflow}
              disabled={!loggedIn}
            />

            <LogPanel 
              logs={logs} 
              isRunning={isRunning} 
              onClear={clearLogs} 
            />
          </div>

          <div className="flex-1 relative">
            <div 
              className="absolute inset-0"
              style={{
                backgroundImage: `linear-gradient(90deg, var(--border) 1px, transparent 1px), linear-gradient(var(--border) 1px, transparent 1px)`,
                backgroundSize: '40px 40px'
              }}
            />
            
            <ErrorBoundary>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeClick={handleNodeClick}
                onPaneClick={handlePaneClick}
                onNodeDragStop={handleNodeDragStop}
                nodeTypes={nodeTypes}
                nodesDraggable={loggedIn && !isRunning}
                fitView
                fitViewOptions={{ padding: 0.4 }}
                proOptions={{ hideAttribution: true }}
              >
                {loggedIn && <Controls showInteractive={false} />}
              </ReactFlow>
            </ErrorBoundary>
            
            <div className="absolute top-3 left-3 font-mono text-[9px]" style={{ color: 'var(--text-subtle)' }}>WORKFLOW</div>
            <div className="absolute bottom-3 right-3 font-mono text-[9px]" style={{ color: 'var(--text-subtle)' }}>{workflow.length} NODES</div>
            
            {connected && !loggedIn && <LoginOverlay />}
            
            <Suspense fallback={<LoadingFallback />}>
              <InlineEditPanel
                selectedAction={selectedAction}
                workflow={workflow}
                setWorkflow={setWorkflow}
                onClose={() => setSelectedAction(null)}
              />
            </Suspense>
          </div>
        </div>
      </TooltipProvider>
    </ErrorBoundary>
  );
}
