// The first screen, shown whenever no stops are saved: nearby stops if the
// phone shares its location, otherwise a map to pick one from.
import { StopMap } from './map';
import { locateNearby, renderNearbyList, updateNearbyList, type NearbyResult } from './nearby';
import { escapeHtml } from './format';

let root: HTMLElement;
let nearby: NearbyResult = { kind: 'idle' };
let filterText = '';
let map: StopMap | null = null;
let active = false;

function renderContent(): string {
  switch (nearby.kind) {
    case 'idle':
    case 'locating':
      return '<p class="muted" role="status">Finding stops near you…</p>';
    case 'done':
      if (nearby.stops.length) {
        return `<h2>Stops near you</h2>${renderNearbyList(nearby.stops, filterText)}`;
      }
      return `<p class="muted">No stops found near you. Pick yours on the map.</p><div id="map-slot"></div>`;
    case 'error':
      return `<p class="muted">${
        nearby.denied
          ? 'Location is off, so pick your stop on the map.'
          : `${escapeHtml(nearby.message)} You can pick your stop on the map instead.`
      }</p><div id="map-slot"></div>`;
  }
}

function render(): void {
  root.innerHTML = `
    <section class="welcome">
      <img class="welcome-logo" src="favicon.svg" alt="" width="64" height="64">
      <h1>Welcome to Next Bus</h1>
      <p class="welcome-lede">Pick your stop to see live departures.</p>
      ${renderContent()}
    </section>`;
  const slot = root.querySelector<HTMLElement>('#map-slot');
  if (slot) {
    map ??= new StopMap();
    void map.mount(slot);
  }
}

function onInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  if (input.id !== 'nearby-filter' || nearby.kind !== 'done') return;
  filterText = input.value;
  updateNearbyList(root, nearby.stops, filterText);
}

export function showWelcome(container: HTMLElement): () => void {
  root = container;
  active = true;
  filterText = '';
  document.title = 'Next Bus';
  if (nearby.kind !== 'done') {
    nearby = { kind: 'locating' };
    void locateNearby().then((result) => {
      nearby = result;
      if (active) render();
    });
  }
  render();
  root.addEventListener('input', onInput);
  return () => {
    active = false;
    map?.destroy();
    map = null;
    root.removeEventListener('input', onInput);
  };
}
