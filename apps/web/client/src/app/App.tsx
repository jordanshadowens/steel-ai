import { AnimatePresence, useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { useHealthQuery } from '../api/steelApi';
import { navigate, routeHref, useRoute } from './router';
import type { Route } from './router';
import { CreatorPage } from '../creator/CreatorPage';
import './App.css';
import { lazy, Suspense, useSyncExternalStore } from 'react';
import type { MouseEvent } from 'react';
import { AccountGate } from '../auth/AccountGate';
import { signOutAccount, getSession, subscribeSession } from '../auth/session';
import { store } from '../store/store';
import { isDirty } from '../store/workflowEditor';

const RunnerPage = lazy(() => import('../runner/RunnerPage').then(({ RunnerPage }) => ({ default: RunnerPage })));
const DesignerPage = lazy(() => import('../designer/DesignerPage').then(({ DesignerPage }) => ({ default: DesignerPage })));

const DESTINATIONS: Array<{ route: Route; label: string; compact?: string }> = [
  { route: 'creator', label: 'Workflow Creator', compact: 'Creator' },
  { route: 'runner', label: 'Workflow Runner', compact: 'Runner' },
  { route: 'designer', label: 'Data Designer' },
];

function followRoute(event: MouseEvent<HTMLAnchorElement>, route: Route) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(route);
}

export function App() {
  return (
    <AccountGate>
      <WorkspaceApp />
    </AccountGate>
  );
}

function WorkspaceApp() {
  const session = useSyncExternalStore(subscribeSession, getSession);
  const route = useRoute();
  const reduceMotion = useReducedMotion();
  const health = useHealthQuery(undefined, { pollingInterval: 30000 });
  async function signOut() {
    const state = store.getState();
    if (
      isDirty(state.workflowEditor) &&
      !window.confirm(
        'Sign out and discard unsaved changes? Saved work remains in your account.',
      )
    ) {
      return;
    }
    await signOutAccount();
  }

  return (
    <div className="shell">
      <header className="shell-nav">
        <div className="shell-identity">
          <a className="shell-brand" href={routeHref('creator')} onClick={(event) => followRoute(event, 'creator')}>
            <span className="shell-mark" aria-hidden="true"><span /></span>
            Steel AI
          </a>
          {import.meta.env.VITE_STEEL_ENVIRONMENT === 'staging' && (
            <span className="shell-environment" title="Temporary test data">Staging</span>
          )}
        </div>
        <nav aria-label="Primary">
          {DESTINATIONS.map((d) => (
            <a
              key={d.route}
              href={routeHref(d.route)}
              className={
                route === d.route
                  ? 'shell-link shell-link-active'
                  : 'shell-link'
              }
              aria-current={route === d.route ? 'page' : undefined}
              aria-label={d.compact ? d.label : undefined}
              onClick={(event) => followRoute(event, d.route)}
            >
              {d.compact ? (
                <>
                  <span className="shell-link-full">{d.label}</span>
                  <span className="shell-link-short">{d.compact}</span>
                </>
              ) : d.label}
            </a>
          ))}
        </nav>
        <div className="shell-user">
          {session.mode === 'account' ? (
            <>
              <span className="shell-account" title={session.email}>
                {session.auth?.display_name || session.email || 'Private workspace'}
              </span>
              <button className="shell-signout" type="button" onClick={() => void signOut()}>
                Sign out
              </button>
            </>
          ) : <span className="shell-account">Local workspace</span>}
        </div>
      </header>
      {health.isError && (
        <div className="shell-offline" role="alert">
          <span>Can’t reach the Steel server. Saving, starting runs, and approvals are unavailable.</span>
          <button
            type="button"
            className="btn"
            onClick={() => health.refetch()}
          >
            Retry
          </button>
        </div>
      )}
      <main className="shell-main">
        <AnimatePresence mode="wait" initial={false}>
          <m.div
            key={route}
            className="shell-page"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            aria-label={
              route === 'creator'
                ? 'Workflow Creator'
                : route === 'runner'
                  ? 'Workflow Runner'
                  : 'Data Designer'
            }
          >
            {route === 'creator' && <CreatorPage />}
            <Suspense fallback={<p role="status">Loading page...</p>}>
              {route === 'runner' && <RunnerPage />}
              {route === 'designer' && <DesignerPage />}
            </Suspense>
          </m.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
