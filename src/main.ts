import './style.css';
import { showBoard } from './board';
import { initPwa } from './pwa';
import { showSettings } from './settings';
import { showHome } from './home';
import { pruneCache } from './store';
import { onAlert, startFollowWatcher } from './follow';
import { recordSpot } from './spotter';

const app = document.getElementById('app')!;
let teardown: (() => void) | null = null;
let currentRoute = '';

// Hash routes work on GitHub Pages without any server-side rewrites.
function route(): void {
  const hash = location.hash.replace(/^#/, '');
  const stopMatch = hash.match(/^\/stop\/([^/]+)$/);

  let next: string;
  if (stopMatch) next = `stop:${decodeURIComponent(stopMatch[1])}`;
  else if (hash === '/settings') next = 'settings';
  else if (hash === '/stops') {
    // The Stops page became Settings; keep old links and shortcuts working.
    location.replace('#/settings');
    return;
  }
  else if (hash === '/') next = 'home';
  else {
    // The main screen is the list of saved stops.
    location.replace('#/');
    return;
  }
  if (next === currentRoute) return;
  currentRoute = next;

  teardown?.();
  window.scrollTo(0, 0);
  teardown =
    next === 'settings'
      ? showSettings(app)
      : next === 'home'
        ? showHome(app)
        : showBoard(app, next.slice('stop:'.length));

  document.querySelectorAll<HTMLAnchorElement>('[data-nav]').forEach((link) => {
    const isCurrent = link.dataset.nav === (next === 'settings' ? 'settings' : next === 'home' ? 'home' : '');
    if (isCurrent) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

// Every launch starts on the list of saved stops. A stop left in the address
// from last time would otherwise win.
// A refresh is different: it stays on the stop being looked at.
const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
if (navigation?.type !== 'reload' && location.hash.startsWith('#/stop/')) {
  history.replaceState(null, '', location.pathname + location.search);
}

window.addEventListener('hashchange', route);
route();

initPwa(() => {
  // Re-render the stops page so the install section appears or disappears.
  if (currentRoute === 'settings') {
    currentRoute = '';
    route();
  }
});

// Follow a bus across every page, and log live buses caught for the spotter.
onAlert((f) => {
  if (f.vehicleName && f.expected !== null) recordSpot(f.vehicleName);
});
startFollowWatcher();

// Trip timetables are cached for a week; drop anything long expired.
pruneCache(24 * 60 * 60_000);
