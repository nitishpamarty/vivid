import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Without this, any render-time throw (e.g. a missing/unreachable Supabase
// config) unmounts the whole tree and leaves a blank white page with no clue
// what happened — exactly the "shows nothing" failure this guards against.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Vivid crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', minHeight: '100vh', gap: 12,
          fontFamily: 'system-ui, sans-serif', textAlign: 'center', padding: 24,
        }}>
          <h1 style={{ fontSize: 18, margin: 0 }}>Something went wrong loading Vivid</h1>
          <p style={{ color: '#666', maxWidth: 420, margin: 0 }}>
            {this.state.error.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 16px', borderRadius: 6, border: '1px solid #ccc',
              background: '#fff', cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
