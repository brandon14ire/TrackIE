// Finding stops near the phone, used by the Settings page.
import { fetchStopsInBox, type NearbyStop } from './api';
import { distanceMetres, distanceText, escapeHtml } from './format';

// About 900 m north/south and east/west at British and Irish latitudes.
const BOX_LAT = 0.008;
const BOX_LON = 0.013;
const MAX_NEARBY = 25;

export type NearbyResult =
  | { kind: 'idle' }
  | { kind: 'locating' }
  | { kind: 'error'; message: string; denied: boolean }
  | { kind: 'done'; stops: (NearbyStop & { distance: number })[] };

/** Asks for the phone's location and lists the closest stops. */
export function locateNearby(): Promise<NearbyResult> {
  if (!('geolocation' in navigator)) {
    return Promise.resolve({ kind: 'error', message: "This browser can't share your location.", denied: false });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const here: [number, number] = [position.coords.longitude, position.coords.latitude];
        try {
          const stops = await fetchStopsInBox(
            here[0] - BOX_LON,
            here[1] - BOX_LAT,
            here[0] + BOX_LON,
            here[1] + BOX_LAT,
          );
          resolve({
            kind: 'done',
            stops: stops
              .map((s) => ({ ...s, distance: distanceMetres(here, s.location) }))
              .sort((a, b) => a.distance - b.distance)
              .slice(0, MAX_NEARBY),
          });
        } catch {
          resolve({ kind: 'error', message: "Couldn't load nearby stops from bustimes.org.", denied: false });
        }
      },
      (error) => {
        const denied = error.code === error.PERMISSION_DENIED;
        resolve({
          kind: 'error',
          denied,
          message: denied
            ? 'Location access is turned off. You can allow it in your browser settings.'
            : "Couldn't get your location. Try again in a moment.",
        });
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 60_000 },
    );
  });
}

function listItems(stops: (NearbyStop & { distance: number })[], filterText: string): string {
  const query = filterText.trim().toLowerCase();
  const matching = stops.filter(
    (s) =>
      !query || s.name.toLowerCase().includes(query) || s.services.some((line) => line.toLowerCase() === query),
  );
  if (!matching.length) return '<li class="muted">No matching stops.</li>';
  return matching
    .map(
      (s) => `
      <li>
        <a class="stop-link" href="#/stop/${encodeURIComponent(s.atco_code)}">
          <span class="stop-link-name">${escapeHtml(s.name)}</span>
          <span class="stop-link-meta">${escapeHtml(distanceText(s.distance))}${
            s.services.length ? ` · ${escapeHtml(s.services.join(', '))}` : ''
          }</span>
        </a>
      </li>`,
    )
    .join('');
}

/** The filter box and list of nearby stops. */
export function renderNearbyList(stops: (NearbyStop & { distance: number })[], filterText: string): string {
  return `
    <label class="field">
      <span class="visually-hidden">Filter nearby stops</span>
      <input type="search" id="nearby-filter" placeholder="Filter by name or route" value="${escapeHtml(filterText)}" autocomplete="off">
    </label>
    <ul class="stop-list" id="nearby-list">${listItems(stops, filterText)}</ul>`;
}

/** Redraws only the list, so the filter box keeps focus and cursor position. */
export function updateNearbyList(
  root: HTMLElement,
  stops: (NearbyStop & { distance: number })[],
  filterText: string,
): void {
  const list = root.querySelector('#nearby-list');
  if (list) list.innerHTML = listItems(stops, filterText);
}
