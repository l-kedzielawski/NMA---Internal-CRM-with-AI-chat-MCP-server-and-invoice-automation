import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-bg-main p-4">
          <div className="card max-w-2xl w-full bg-red-50 border-2 border-red-200">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-12 h-12 bg-danger rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div className="flex-1">
                <h1 className="text-2xl font-bold text-danger mb-2">Application Error</h1>
                <p className="text-text-muted mb-4">
                  An unexpected error occurred while loading the application.
                </p>
                <details className="mb-4">
                  <summary className="cursor-pointer text-sm font-medium text-text-primary hover:text-primary mb-2">
                    View error details
                  </summary>
                  <pre className="bg-surface-2 p-4 rounded-lg overflow-auto text-xs text-text-muted border border-surface-2">
                    {this.state.error?.toString()}
                    {'\n\n'}
                    {this.state.error?.stack}
                  </pre>
                </details>
                <div className="flex gap-3">
                  <button 
                    onClick={() => window.location.reload()}
                    className="btn btn-primary"
                  >
                    Refresh Page
                  </button>
                  <button 
                    onClick={() => window.location.href = '/'}
                    className="btn btn-secondary"
                  >
                    Go to Dashboard
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
