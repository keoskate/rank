/**
 * Error Boundary Component
 *
 * Catches JavaScript errors in child components and displays
 * a fallback UI instead of crashing the entire application.
 */

import { Component } from 'react';
import theme from '../../theme';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      // Custom fallback UI if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <div
          style={{
            padding: theme.spacing.xl,
            backgroundColor: theme.colors.gray50,
            borderRadius: theme.borderRadius.lg,
            border: `1px solid ${theme.colors.error}`,
            margin: theme.spacing.md
          }}
        >
          <h2
            style={{
              color: theme.colors.error,
              marginTop: 0,
              marginBottom: theme.spacing.md,
              fontSize: theme.typography.fontSize.xl
            }}
          >
            Something went wrong
          </h2>
          <p
            style={{
              color: theme.colors.gray600,
              marginBottom: theme.spacing.md
            }}
          >
            {this.props.message || 'An unexpected error occurred in this section.'}
          </p>

          {process.env.NODE_ENV === 'development' && this.state.error && (
            <details
              style={{
                marginBottom: theme.spacing.md,
                padding: theme.spacing.md,
                backgroundColor: theme.colors.gray100,
                borderRadius: theme.borderRadius.md,
                overflow: 'auto'
              }}
            >
              <summary
                style={{
                  cursor: 'pointer',
                  color: theme.colors.gray700,
                  fontWeight: theme.typography.fontWeight.medium
                }}
              >
                Error Details
              </summary>
              <pre
                style={{
                  marginTop: theme.spacing.sm,
                  fontSize: theme.typography.fontSize.sm,
                  color: theme.colors.error,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word'
                }}
              >
                {this.state.error.toString()}
                {this.state.errorInfo?.componentStack}
              </pre>
            </details>
          )}

          <button
            onClick={this.handleRetry}
            style={{
              padding: `${theme.spacing.sm} ${theme.spacing.lg}`,
              backgroundColor: theme.colors.primary,
              color: theme.colors.white,
              border: 'none',
              borderRadius: theme.borderRadius.md,
              cursor: 'pointer',
              fontSize: theme.typography.fontSize.md,
              fontWeight: theme.typography.fontWeight.medium
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
