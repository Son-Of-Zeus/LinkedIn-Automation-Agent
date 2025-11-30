import React, { createContext, useContext, useState, useCallback, useRef, useMemo, useTransition } from 'react';

const SocketContext = createContext(null);

const AppStateContext = createContext(null);

const AppActionsContext = createContext(null);

const ThemeContext = createContext(null);

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) throw new Error('useSocket must be used within AppProvider');
  return context;
};

export const useAppState = () => {
  const context = useContext(AppStateContext);
  if (!context) throw new Error('useAppState must be used within AppProvider');
  return context;
};

export const useAppActions = () => {
  const context = useContext(AppActionsContext);
  if (!context) throw new Error('useAppActions must be used within AppProvider');
  return context;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within AppProvider');
  return context;
};

export function AppProvider({ children, socket }) {
    //All the states
    const [connected, setConnected] = useState(false);
    const [loggedIn, setLoggedIn] = useState(false);
    const [logs, setLogs] = useState([]);
    const [stats, setStats] = useState({ current: 0, total: 0 });
    const [workflow, setWorkflow] = useState([{ type: 'visit', delayMs: 0 }]);
    const [isRunning, setIsRunning] = useState(false);
    const [selectedAction, setSelectedAction] = useState(null);
    const [theme, setTheme] = useState('light');
  
  // Refs 
  const workflowRef = useRef(workflow);
  workflowRef.current = workflow;
  
 
  const [isPending, startTransition] = useTransition();
  

  const addLog = useCallback((msg) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    startTransition(() => {
      setLogs(prev => [`[${time}] ${msg}`, ...prev].slice(0, 50));
    });
  }, []);
  
  // Memoized state object
  const state = useMemo(() => ({
    connected,
    loggedIn,
    logs,
    stats,
    workflow,
    isRunning,
    selectedAction,
    isPending,
    workflowRef,
  }), [connected, loggedIn, logs, stats, workflow, isRunning, selectedAction, isPending]);
  
  // Memoized actions object
  const actions = useMemo(() => ({
    setConnected,
    setLoggedIn,
    setLogs,
    setStats,
    setWorkflow,
    setIsRunning,
    setSelectedAction,
    addLog,
    startTransition,
  }), [addLog]);


  //For changing the theme
  const themeValue = useMemo(() => ({
    theme,
    setTheme,
    toggleTheme: () => setTheme(t => t === 'dark' ? 'light' : 'dark'),
  }), [theme]);
  
  return (
    <SocketContext.Provider value={socket}>
      <ThemeContext.Provider value={themeValue}>
        <AppStateContext.Provider value={state}>
          <AppActionsContext.Provider value={actions}>
            {children}
          </AppActionsContext.Provider>
        </AppStateContext.Provider>
      </ThemeContext.Provider>
    </SocketContext.Provider>
  );
}
