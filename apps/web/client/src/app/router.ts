import { useEffect, useState } from 'react';

export type Route = 'creator' | 'runner' | 'designer' | 'observability' | 'api-keys';

// History routing in production (/ → Creator). Before the route cutover the
// bundle is served from /app/, where pathname routing cannot work, so the
// hash carries the destination instead. Both shapes parse here.
export function parseRoute(): Route {
  const { pathname, hash } = window.location;
  if (pathname.startsWith('/app')) {
    if (hash.startsWith('#/runner')) {
      return 'runner';
    }
    if (hash.startsWith('#/api-keys')) return 'api-keys';
    if (hash.startsWith('#/observability')) return 'observability';
    if (hash.startsWith('#/designer')) {
      return 'designer';
    }
    return 'creator';
  }
  if (pathname === '/api-keys') return 'api-keys';
  if (pathname === '/observability') return 'observability';
  if (pathname === '/runner' || pathname.startsWith('/runner/')) {
    return 'runner';
  }
  if (pathname === '/designer' || pathname.startsWith('/designer/')) {
    return 'designer';
  }
  return 'creator';
}

export function routeHref(route: Route, query?: URLSearchParams): string {
  const path = route === 'creator' ? '/' : `/${route}`;
  const suffix = query?.size ? `?${query}` : '';
  return (window.location.pathname.startsWith('/app') ? '#' : '') + path + suffix;
}

export function navigate(route: Route, query?: URLSearchParams): void {
  const href = routeHref(route, query);
  if (window.location.pathname.startsWith('/app')) {
    window.location.hash = href;
    window.dispatchEvent(new PopStateEvent('popstate'));
    return;
  }
  window.history.pushState(null, '', href);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parseRoute);
  useEffect(() => {
    const onChange = () => {
      const { pathname, hash } = window.location;
      const path = pathname.startsWith('/app') ? hash.slice(1) : pathname;
      if (path === '/templates' || path.startsWith('/templates/')) {
        window.history.replaceState(window.history.state, '', routeHref('creator'));
      }
      setRoute(parseRoute());
    };
    onChange();
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  }, []);
  return route;
}
