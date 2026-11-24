import { useHealthQuery } from '../api/steelApi';
import { navigate, routeHref, useRoute } from './router';
import type { Route } from './router';
import { CreatorPage } from '../creator/CreatorPage';
import './App.css';
import { Component, lazy, Suspense, useSyncExternalStore, type ReactNode } from 'react';
import type { MouseEvent } from 'react';
import { AccountGate } from '../auth/AccountGate';
import { signOutAccount, getSession, subscribeSession } from '../auth/session';
import { store } from '../store/store';
import { isDirty } from '../store/workflowEditor';

const RunnerPage = lazy(() => import('../runner/RunnerPage').then(({ RunnerPage }) => ({ default: RunnerPage })));
const ApiKeys = lazy(() => import('../cloud/ApiKeys').then(({ ApiKeys }) => ({ default: ApiKeys })));
const Observability = lazy(() => import('../observability/Observability').then(({ Observability }) => ({ default: Observability })));
const DesignerPage = lazy(() => import('../designer/DesignerPage').then(({ DesignerPage }) => ({ default: DesignerPage })));

const DESTINATIONS: Array<{ route: Route; label: string; compact?: string }> = [
  { route: 'creator', label: 'Workflow Creator', compact: 'Creator' },
  { route: 'runner', label: 'Workflow Runner', compact: 'Runner' },
  { route: 'designer', label: 'Data Designer', compact: 'Data' },
  { route: 'observability', label: 'Observability', compact: 'Monitor' },
];

function followRoute(event: MouseEvent<HTMLAnchorElement>, route: Route) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(route);
}

class WorkspaceViewBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = {failed: false};

  static getDerivedStateFromError() {
    return {failed: true};
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <section className="shell-view-error" role="alert">
      <h1>Couldn’t open this view</h1>
      <p>Reload the workspace to try again.</p>
      <button type="button" className="btn" onClick={() => location.reload()}>Reload workspace</button>
    </section>;
  }
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
      <a className="shell-skip" href="#workspace-content" onClick={event => {
        event.preventDefault();
        document.getElementById('workspace-content')?.focus();
      }}>Skip to workspace</a>
      <header className={import.meta.env.VITE_STEEL_CLOUD === '1' ? 'shell-nav shell-nav-cloud' : 'shell-nav'}>
        <div className="shell-identity">
          <a className="shell-brand" href={routeHref('creator')} onClick={event => followRoute(event, 'creator')}>
            <span className="shell-mark" aria-hidden="true"><span /></span>
            {import.meta.env.VITE_STEEL_CLOUD === '1' ? 'Steel Cloud' : 'Steel AI'}
          </a>
          {import.meta.env.VITE_STEEL_ENVIRONMENT === 'staging' && (
            <span className="shell-environment" title="Temporary test data">Staging</span>
          )}
        </div>
        <nav aria-label="Primary">
          {DESTINATIONS.filter(d => d.route !== 'observability' || import.meta.env.VITE_STEEL_CLOUD === '1').map((d) => (
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
          {import.meta.env.VITE_STEEL_CLOUD === '1' && <a className={route === 'api-keys' ? 'shell-link shell-link-active' : 'shell-link'} href={routeHref('api-keys')} aria-current={route === 'api-keys' ? 'page' : undefined} onClick={(event) => followRoute(event, 'api-keys')}>API keys</a>}
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
      <main className="shell-main" data-route={route} id="workspace-content" tabIndex={-1}>
          <div
            key={route}
            className="shell-page"
            aria-label={
              route === 'creator'
                ? 'Workflow Creator'
                : route === 'runner'
                  ? 'Workflow Runner'
                  : route === 'observability' ? 'Observability' : route === 'api-keys' ? 'API keys' : 'Data Designer'
            }
          >
            <WorkspaceViewBoundary>
            {route === 'creator' && <CreatorPage />}
            <Suspense fallback={<p role="status">Loading page...</p>}>
              {route === 'runner' && <RunnerPage />}
              {route === 'designer' && <DesignerPage />}
              {route === 'observability' && <Observability />}
              {route === 'api-keys' && import.meta.env.VITE_STEEL_CLOUD === '1' && <ApiKeys />}
            </Suspense>
            </WorkspaceViewBoundary>
          </div>
      </main>
    </div>
  );
}
