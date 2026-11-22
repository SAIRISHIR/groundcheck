import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

/**
 * If any screen throws while rendering, show what happened instead of an
 * empty frame, with a way to reload. (React otherwise unmounts everything.)
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('Groundcheck UI error', error, info?.componentStack);
    // Keep where it happened, to show under "Details" (useful in support requests).
    this.setState({ where: String(info?.componentStack ?? '').trim().split('\n').slice(0, 6).join('\n') });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="canvas">
        <section className="panel panel__body">
          <div className="error-line">Something went wrong on this screen: {String(this.state.error?.message ?? this.state.error)}</div>
          <button className="text-button" style={{ marginTop: 12 }} onClick={() => location.reload()}>
            Reload
          </button>
          {this.state.where && (
            <details style={{ marginTop: 12 }}>
              <summary className="faint small">Details</summary>
              <pre className="faint small" style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>
                {this.state.where}
              </pre>
            </details>
          )}
        </section>
      </div>
    );
  }
}

// Groundcheck always renders in its own dark terminal theme (see index.css),
// so it does not follow Jira's light/dark setting.
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
