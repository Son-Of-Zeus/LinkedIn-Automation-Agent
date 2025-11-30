import React, { Component } from 'react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback({
          error: this.state.error,
          errorInfo: this.state.errorInfo,
          reset: this.handleReset,
        });
      }

      return (
        <div 
          className="flex flex-col items-center justify-center p-8 border"
          style={{ 
            background: 'var(--bg)', 
            borderColor: '#ff375f',
            minHeight: '200px'
          }}
        >
          <div className="w-12 h-12 mb-4 border-2 flex items-center justify-center" style={{ borderColor: '#ff375f' }}>
            <span className="text-2xl">⚠️</span>
          </div>
          <div className="font-mono text-sm tracking-wider mb-2" style={{ color: 'var(--text)' }}>
            SOMETHING WENT WRONG
          </div>
          <div className="font-mono text-[11px] mb-4 max-w-[300px] text-center" style={{ color: 'var(--text-muted)' }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </div>
          <button
            onClick={this.handleReset}
            className="px-4 py-2 font-mono text-xs tracking-widest"
            style={{ background: '#ff375f', color: '#fff' }}
          >
            RESET
          </button>
          {process.env.NODE_ENV === 'development' && this.state.errorInfo && (
            <details className="mt-4 max-w-[400px] overflow-auto">
              <summary className="font-mono text-[10px] cursor-pointer" style={{ color: 'var(--text-muted)' }}>
                Stack trace
              </summary>
              <pre className="mt-2 p-2 text-[9px] overflow-auto" style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
                {this.state.errorInfo.componentStack}
              </pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

// Function for wrapping components with error boundary
export function withErrorBoundary(Component, fallback, onReset) {
  return function WrappedComponent(props) {
    return (
      <ErrorBoundary fallback={fallback} onReset={onReset}>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
}
