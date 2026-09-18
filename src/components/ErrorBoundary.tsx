import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="p-4 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 rounded-xl text-xs font-mono border border-red-200 dark:border-red-900/50 my-2 space-y-1">
          <p className="font-bold">An error occurred rendering this component:</p>
          <p className="break-all">{this.state.error?.message || String(this.state.error)}</p>
          {this.state.error?.stack && (
            <details className="mt-2 text-[10px] opacity-80 cursor-pointer">
              <summary>Stack Trace</summary>
              <pre className="mt-1 whitespace-pre-wrap overflow-x-auto">{this.state.error.stack}</pre>
            </details>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
