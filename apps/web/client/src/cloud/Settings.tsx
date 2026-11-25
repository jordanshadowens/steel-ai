import { useEffect, useState } from 'react';
import { routeHref, routeSearch } from '../app/router';
import { ApiKeys } from './ApiKeys';
import { Connections } from './Connections';
import './settings.css';

const preferences = [
  ['ai', 'AI provider'],
  ['database', 'Database'],
  ['tokens', 'Personal access tokens'],
] as const;

function selectedSection(): typeof preferences[number][0] {
  const requested = routeSearch().get('section');
  if (requested === 'database' || requested === 'tokens') return requested;
  if (!requested && /(?:#|^)\/api-keys(?:\?|$)/.test(location.hash || location.pathname)) return 'tokens';
  return 'ai';
}

export function Settings() {
  const [section, setSection] = useState(selectedSection);
  useEffect(() => {
    const refresh = () => setSection(selectedSection());
    window.addEventListener('hashchange', refresh);
    window.addEventListener('popstate', refresh);
    return () => {
      window.removeEventListener('hashchange', refresh);
      window.removeEventListener('popstate', refresh);
    };
  }, []);

  return <div className="workspace-keys workspace-settings">
    <h1>Settings</h1>
    <div className="workspace-settings-layout">
      <nav aria-label="Settings sections">
        {preferences.map(([id, label]) => <a key={id} aria-current={section === id ? 'page' : undefined}
          href={routeHref('settings', new URLSearchParams({section: id}))}>{label}</a>)}
      </nav>
      <div className="workspace-settings-list">
        {section === 'tokens' ? <ApiKeys /> : <Connections key={section} section={section} />}
      </div>
    </div>
  </div>;
}
