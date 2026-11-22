import { AnimatePresence, useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { useHealthQuery } from '../api/steelApi';
import { navigate, useRoute } from './router';
import type { Route } from './router';
import { CreatorPage } from '../creator/CreatorPage';
import './App.css';
import { lazy, Suspense, useSyncExternalStore } from 'react';
import { AccountGate } from '../auth/AccountGate';
import { signOutAccount, getSession, subscribeSession } from '../auth/session';
import { store } from '../store/store';
import { isDirty } from '../store/workflowEditor';
import { isSpecDirty } from '../store/templateEditor';

const RunnerPage = lazy(() => import('../runner/RunnerPage').then(({ RunnerPage }) => ({ default: RunnerPage })));
const TemplatesPage = lazy(() => import('../templates/TemplatesPage').then(({ TemplatesPage }) => ({ default: TemplatesPage })));
const DesignerPage = lazy(() => import('../designer/DesignerPage').then(({ DesignerPage }) => ({ default: DesignerPage })));

const DESTINATIONS: Array<{ route: Route; label: string }> = [
  { route: 'creator', label: 'Workflow Creator' },
  { route: 'runner', label: 'Workflow Runner' },
  { route: 'templates', label: 'Templates' },
  { route: 'designer', label: 'Data Designer' },
];

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
      (isDirty(state.workflowEditor) || isSpecDirty(state.templateEditor)) &&
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
        <button
          className="shell-brand"
          type="button"
          onClick={() => navigate('creator')}
        >
          <img
            className="shell-mark"
            src={`${import.meta.env.BASE_URL}steel-logo.png`}
            width={28}
            height={28}
            alt=""
          />
          Steel AI
          {import.meta.env.VITE_STEEL_ENVIRONMENT === 'staging'
            ? ' · STAGING (temporary test data)'
            : ''}
        </button>
        <span className="shell-account">
          {session.mode === 'account' && session.email ? (
            <>
              <img
                className="shell-profile"
                src={`${import.meta.env.BASE_URL}profile.jpg`}
                width={28}
                height={28}
                alt=""
              />
              {session.auth?.display_name || session.email}
            </>
          ) : (
            session.mode === 'account' ? 'Private workspace' : 'Local workspace'
          )}
        </span>
        {session.mode === 'account' && (
          <button
            className="shell-link"
            type="button"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        )}
        <nav aria-label="Primary">
          {DESTINATIONS.map((d) => (
            <button
              key={d.route}
              type="button"
              className={
                route === d.route
                  ? 'shell-link shell-link-active'
                  : 'shell-link'
              }
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
          The Steel server is not responding. Data shown may be stale; saving,
          running and approvals are unavailable until it returns.
          <button
            type="button"
            className="btn"
            onClick={() => health.refetch()}
          >
            Retry now
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
                  : route === 'templates'
                    ? 'Templates'
                    : 'Data Designer'
            }
          >
            {route === 'creator' && <CreatorPage />}
            <Suspense fallback={<p role="status">Loading page...</p>}>
              {route === 'runner' && <RunnerPage />}
              {route === 'templates' && <TemplatesPage />}
              {route === 'designer' && <DesignerPage />}
            </Suspense>
          </m.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
