import { Component } from 'react';

/**
 * Catches render-time crashes so a single broken page cannot leave the
 * user staring at a blank white screen. Details are logged, never shown.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[ui-error]', error, info?.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="panel max-w-md p-8 text-center">
          <span className="material-symbols-outlined text-[40px] text-error" aria-hidden="true">
            error
          </span>
          <h1 className="mt-3 text-headline-sm text-on-surface">Something went wrong</h1>
          <p className="mt-2 text-body-sm text-on-surface-variant">
            The page could not be displayed. Reloading usually fixes it. If it keeps happening, please tell
            your department administrator.
          </p>
          <button type="button" className="btn-primary mt-5" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
