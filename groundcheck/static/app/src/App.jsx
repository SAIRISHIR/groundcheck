import React, { useEffect, useState } from 'react';
import { view } from '@forge/bridge';
import IssuePanel from './IssuePanel.jsx';
import Dashboard from './Dashboard.jsx';

/**
 * One frontend serves two places in Jira. Forge tells us which module is
 * rendering us, and we show the matching screen.
 */
export default function App() {
  const [moduleKey, setModuleKey] = useState(null);

  useEffect(() => {
    view.getContext().then((ctx) => setModuleKey(ctx.moduleKey));
  }, []);

  if (!moduleKey) return null;
  if (moduleKey === 'groundcheck-dashboard') return <Dashboard />;
  return <IssuePanel />;
}
