import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useHealthQuery } from '../api/steelApi';
import { navigate, useRoute } from './router';
import type { Route } from './router';
import { CreatorPage } from '../creator/CreatorPage';
import { RunnerPage } from '../runner/RunnerPage';
import { TemplatesPage } from '../templates/TemplatesPage';
import { DesignerPage } from '../designer/DesignerPage';
import './App.css';

const DESTINATIONS: Array<{ route: Route; label: string }> = [
  { route: 'creator', label: 'Workflow Creator' },
  { route: 'runner', label: 'Workflow Runner' },
  { route: 'templates', label: 'Templates' },
  { route: 'designer', label: 'Data Designer' },
];

export function App() {
  const route = useRoute();
  const reduceMotion = useReducedMotion();
  const health = useHealthQuery(undefined, { pollingInterval: 30000 });

  return (
    <div className="shell">
      <header className="shell-nav">
        <span className="shell-brand">Steel AI</span>
        <nav aria-label="Primary">
          {DESTINATIONS.map((d) => (
            <button
              key={d.route}
              type="button"
              className={route === d.route ? 'shell-link shell-link-active' : 'shell-link'}
              aria-current={route === d.route ? 'page' : undefined}
              onClick={() => navigate(d.route)}
            >
              {d.label}
            </button>
          ))}
        </nav>
      </header>
      {health.isError && (
        <div className="shell-offline" role="alert">
          The Steel server is not responding. Data shown may be stale; saving, running and approvals are unavailable until it returns.
          <button type="button" className="btn" onClick={() => health.refetch()}>
            Retry now
          </button>
        </div>
      )}
      <main className="shell-main">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={route}
            className="shell-page"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            aria-label={route === 'creator' ? 'Workflow Creator' : route === 'runner' ? 'Workflow Runner' : route === 'templates' ? 'Templates' : 'Data Designer'}
          >
            {route === 'creator' && <CreatorPage />}
            {route === 'runner' && <RunnerPage />}
            {route === 'templates' && <TemplatesPage />}
            {route === 'designer' && <DesignerPage />}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
