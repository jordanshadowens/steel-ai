import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { MotionConfig } from 'motion/react';
import '@fontsource/montserrat/400.css';
import '@fontsource/montserrat/500.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import './styles/tokens.css';
import { store } from './store/store';
import { App } from './app/App';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

// Dev-only inspection hook for the performance probe (perf.spec.ts).
// Stripped from production builds; never used by product code.
if (import.meta.env.DEV) {
  (window as unknown as { __steelStore: typeof store }).__steelStore = store;
}
createRoot(root).render(
  <StrictMode>
    <Provider store={store}>
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </Provider>
  </StrictMode>,
);
