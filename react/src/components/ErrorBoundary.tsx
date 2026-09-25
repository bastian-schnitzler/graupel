import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled UI error caught by ErrorBoundary:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="card empty-state error-boundary-card" style={{ padding: '24px', margin: '16px' }} data-testid="error-boundary">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', color: '#ef4444' }}>
            <AlertTriangle size={24} />
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>
              {this.props.fallbackTitle || 'An unexpected display error occurred'}
            </h3>
          </div>
          <p style={{ color: 'var(--text-secondary, #64748b)', fontSize: '0.9rem', marginBottom: '16px' }}>
            {this.state.error?.message || 'Something went wrong while rendering this component.'}
          </p>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={this.handleReset}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <RefreshCw size={14} />
            <span>Try Again</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
