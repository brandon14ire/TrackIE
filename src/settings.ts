import { escapeHtml } from './format';
import { StopMap } from './map';
import { locateNearby, renderNearbyList, updateNearbyList, type NearbyResult } from './nearby';
import { installSection, promptInstall } from './pwa';
import { getFavourites, removeFavourite } from './store';

let root: HTMLElement;
let nearby: NearbyResult = { kind: 'idle' };
let filterText = '';
let map: StopMap | null = null;
let mapOpen = false;
let active = false;

function renderSaved(): string {
  const favourites = getFavourites();
  if (favourites.length === 0) {
    return '<p class="muted">No saved stops yet. Open a stop and tap Save to keep it here.</p>';
  }
  return `<ul class="stop-list">${favourites
    .map(
      (f) => `
      <li>
        <a class="stop-link" href="#/stop/${encodeURIComponent(f.atco)}">
          <span class="stop-link-name">${escapeHtml(f.name)}</span>
        </a>
        <button class="icon-button" data-action="remove" data-atco="${escapeHtml(f.atco)}"
          aria-label="Remove ${escapeHtml(f.name)}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </li>`,
    )
    .join('')}</ul>`;
}

function renderNearby(): string {
  switch (nearby.kind) {
    case 'idle':
      return '';
    case 'locating':
      return '<p class="muted" role="status">Finding stops near you…</p>';
    case 'error':
      return `<p class="warn" role="alert">${escapeHtml(nearby.message)}</p>`;
    case 'done':
      return nearby.stops.length
        ? renderNearbyList(nearby.stops, filterText)
        : '<p class="muted">No stops found within about 1 km.</p>';
  }
}

function render(): void {
  // Installed apps have no browser back button, so offer one here.
  root.innerHTML = `
    <section class="stops settings">
      <a class="back" href="#/">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
        Your stops
      </a>
      <h1>Settings</h1>

      <h2>Saved stops</h2>
      ${renderSaved()}

      <h2>Find a stop</h2>
      <div class="button-row">
        <button class="button" data-action="locate" ${nearby.kind === 'locating' ? 'disabled' : ''}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/></svg>
          Use my location
        </button>
        <button class="button" data-action="map" aria-expanded="${mapOpen}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/></svg>
          ${mapOpen ? 'Hide map' : 'Pick on a map'}
        </button>
      </div>
      <div id="nearby">${renderNearby()}</div>
      ${mapOpen ? '<div id="map-slot"></div>' : ''}

      ${installSection()}

      <h2>About</h2>
      <p class="about">
        Bus times from <a href="https://bustimes.org" target="_blank" rel="noopener">bustimes.org</a>,
        using public transport open data.
        Weather by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>.
        Maps &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors.
      </p>

      <p class="version">Version ${escapeHtml(__APP_VERSION__)}</p>
    </section>`;
  const slot = root.querySelector<HTMLElement>('#map-slot');
  if (slot) {
    map ??= new StopMap();
    void map.mount(slot);
  }
}

function locate(): void {
  nearby = { kind: 'locating' };
  render();
  void locateNearby().then((result) => {
    nearby = result;
    if (active) render();
  });
}

function onClick(event: MouseEvent): void {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!target) return;
  switch (target.dataset.action) {
    case 'locate':
      locate();
      break;
    case 'map':
      mapOpen = !mapOpen;
      if (!mapOpen) {
        map?.destroy();
        map = null;
      }
      render();
      root.querySelector<HTMLElement>('[data-action="map"]')?.focus();
      break;
    case 'remove':
      removeFavourite(target.dataset.atco ?? '');
      render();
      break;
    case 'install':
      void promptInstall().then(() => active && render());
      break;
  }
}

function onInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  if (input.id !== 'nearby-filter' || nearby.kind !== 'done') return;
  filterText = input.value;
  updateNearbyList(root, nearby.stops, filterText);
}

export function showSettings(container: HTMLElement): () => void {
  root = container;
  active = true;
  document.title = 'Settings · TrackIE';
  render();
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  return () => {
    active = false;
    map?.destroy();
    map = null;
    mapOpen = false;
    root.removeEventListener('click', onClick);
    root.removeEventListener('input', onInput);
  };
}
