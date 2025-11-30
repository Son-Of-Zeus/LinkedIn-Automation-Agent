import { useEffect, useRef, useCallback, useState } from 'react';


//socket.io connection hook
export function useSocketConnection(socket, handlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  
  useEffect(() => {
    if (!socket) return;
    
    const currentHandlers = handlersRef.current;
    
    Object.entries(currentHandlers).forEach(([event, handler]) => {
      if (handler) socket.on(event, handler);
    });
    
    const handleConnect = () => {
      socket.emit('get-session');
    };
    
    socket.on('connect', handleConnect);
    
    if (socket.connected) {
      socket.emit('get-session');
    }
    
    return () => {
      socket.off('connect', handleConnect);
      Object.keys(currentHandlers).forEach(event => {
        socket.off(event);
      });
    };
  }, [socket]); 
}

//Focus management hook
export function useFocusManagement(ref, shouldFocus) {
  useEffect(() => {
    if (shouldFocus && ref.current) {
      ref.current.focus();
    }
  }, [shouldFocus, ref]);
}

//Focus Trap hook
export function useFocusTrap(containerRef, isActive) {
  useEffect(() => {
    if (!isActive || !containerRef.current) return;
    
    const container = containerRef.current;
    const focusableElements = container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    
    const handleKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      
      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };
    
    container.addEventListener('keydown', handleKeyDown);
    firstElement?.focus();
    
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, [isActive, containerRef]);
}

//Debounce state update hook
export function useDebouncedCallback(callback, delay) {
  const timeoutRef = useRef(null);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);
  
  return useCallback((...args) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      callbackRef.current(...args);
    }, delay);
  }, [delay]);
}

//Stable call back hook
export function useStableCallback(callback) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  
  return useCallback((...args) => {
    return callbackRef.current(...args);
  }, []);
}

//Previous value hook
export function usePrevious(value) {
  const ref = useRef();
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}
export function useIntersectionObserver(ref, options = {}) {
  const [isIntersecting, setIsIntersecting] = useState(false);
  
  useEffect(() => {
    if (!ref.current) return;
    
    const observer = new IntersectionObserver(([entry]) => {
      setIsIntersecting(entry.isIntersecting);
    }, options);
    
    observer.observe(ref.current);
    
    return () => observer.disconnect();
  }, [ref, options.threshold, options.root, options.rootMargin]);
  
  return isIntersecting;
}