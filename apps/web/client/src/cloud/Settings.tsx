import { ApiKeys } from './ApiKeys';
import { Connections } from './Connections';
import './settings.css';

const preferences = [
  ['settings-ai', 'AI provider'],
  ['settings-database', 'PostgreSQL'],
  ['settings-tokens', 'Personal access tokens'],
] as const;

export function Settings() {
  return <div className="workspace-keys workspace-settings">
    <h1>Settings</h1>
    <div className="workspace-settings-layout">
      <nav aria-label="Settings sections">
        {preferences.map(([id, label]) => <button key={id} type="button" onClick={() => {
          const section = document.getElementById(id);
          section?.focus({preventScroll: true});
          section?.scrollIntoView({block: 'start'});
        }}>{label}</button>)}
      </nav>
      <div className="workspace-settings-list">
        <Connections />
        <ApiKeys />
      </div>
    </div>
  </div>;
}
