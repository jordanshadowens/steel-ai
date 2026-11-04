import { useEffect, useState } from 'react';

export type Route = 'creator' | 'runner' | 'templates';

// History routing in production (/ → Creator). Before the route cutover the
// bundle is served from /app/, where pathname routing cannot work, so the
// hash carries the destination instead. Both shapes parse here.
export function parseRoute(): Route {
  const { pathname, hash } = window.location;
  if (pathname.startsWith('/app')) {
    if (hash.startsWith('#/runner')) return 'runner';
    if (hash.startsWith('#/templates')) return 'templates';
    return 'creator';
  }
  if (pathname === '/runner' || pathname.startsWith('/runner/')) return 'runner';
  if (pathname === '/templates' || pathname.startsWith('/templates/')) return 'templates';
  return 'creator';
}

export function navigate(route: Route): void {
  if (window.location.pathname.startsWith('/app')) {
    window.location.hash = route === 'creator' ? '#/' : `#/${route}`;
    window.dispatchEvent(new PopStateEvent('popstate'));
    return;
  }
  window.history.pushState(null, '', route === 'creator' ? '/' : `/${route}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parseRoute);
  useEffect(() => {
    const onChange = () => setRoute(parseRoute());
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  }, []);
  return route;
}
