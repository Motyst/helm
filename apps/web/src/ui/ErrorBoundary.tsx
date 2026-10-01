import { Component, type ReactNode } from 'react';

/**
 * Last resort for a render crash: say so and offer a reload, rather than leave a blank screen.
 * Unsaved changes may be lost, but everything saved is on the server.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="crash" role="alert">
        <h1>Something went wrong</h1>
        <p>Helm hit an error and stopped. Your saved tasks are safe; reload to carry on.</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
        <p className="crash-detail">{this.state.error.message}</p>
      </main>
    );
  }
}
