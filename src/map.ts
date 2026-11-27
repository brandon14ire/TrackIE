// A map for picking a stop when location isn't available. Leaflet and its
// styles load only when a map is first shown, so they don't slow down launch.
// Map tiles come from OpenStreetMap; stops come from bustimes.org, and only
// once zoomed in to street level, to keep requests low.
import type * as Leaflet from 'leaflet';
import { fetchStopsInBox, type NearbyStop } from './api';
import { escapeHtml } from './format';

type L = typeof Leaflet;

/** Stops are loaded and shown from this zoom level in. */
const MIN_STOP_ZOOM = 15;
const LOAD_DELAY_MS = 350;
/** The island of Ireland. */
const START_BOUNDS: [[number, number], [number, number]] = [
  [51.35, -10.7],
  [55.45, -5.9],
];

let leaflet: Promise<L> | null = null;

function loadLeaflet(): Promise<L> {
  leaflet ??= Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]).then(
    ([mod]) => ((mod as unknown as { default?: L }).default ?? mod) as L,
  );
  return leaflet;
}

function popupHtml(stop: NearbyStop): string {
  const routes = stop.services.length
    ? `<span class="map-popup-routes">${escapeHtml(stop.services.join(', '))}</span>`
    : '';
  return `
    <div class="map-popup">
      <strong>${escapeHtml(stop.name)}</strong>
      ${routes}
      <a class="button primary" href="#/stop/${encodeURIComponent(stop.atco_code)}">Open</a>
    </div>`;
}

export class StopMap {
  private wrap: HTMLElement | null = null;
  private hint: HTMLElement | null = null;
  private map: Leaflet.Map | null = null;
  private markers: Leaflet.LayerGroup | null = null;
  private loaded: Leaflet.LatLngBounds | null = null;
  private timer: number | undefined;
  private request = 0;
  private destroyed = false;

  /** Shows the map inside `slot`, creating it the first time. */
  async mount(slot: HTMLElement): Promise<void> {
    if (this.wrap) {
      slot.replaceChildren(this.wrap);
      this.map?.invalidateSize();
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'stop-map-wrap';
    wrap.innerHTML = `
      <div class="stop-map" role="application" aria-label="Map of bus stops"></div>
      <p class="map-hint" aria-live="polite">Loading map…</p>`;
    this.wrap = wrap;
    this.hint = wrap.querySelector('.map-hint');
    slot.replaceChildren(wrap);

    let Lf: L;
    try {
      Lf = await loadLeaflet();
    } catch {
      this.setHint("Couldn't load the map. Check your connection.");
      return;
    }
    if (this.destroyed) return;

    const map = Lf.map(wrap.querySelector<HTMLElement>('.stop-map')!, { zoomControl: true });
    Lf.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(map);
    map.fitBounds(START_BOUNDS);
    this.map = map;
    this.markers = Lf.layerGroup().addTo(map);
    map.on('moveend', () => this.scheduleLoad(Lf));
    this.scheduleLoad(Lf);
  }

  destroy(): void {
    this.destroyed = true;
    window.clearTimeout(this.timer);
    this.map?.remove();
    this.map = null;
    this.wrap = null;
  }

  private setHint(text: string): void {
    if (!this.hint) return;
    this.hint.textContent = text;
    this.hint.hidden = !text;
  }

  private scheduleLoad(Lf: L): void {
    window.clearTimeout(this.timer);
    const map = this.map;
    if (!map) return;
    if (map.getZoom() < MIN_STOP_ZOOM) {
      this.request++;
      this.markers?.clearLayers();
      this.loaded = null;
      this.setHint('Zoom in on your area to see bus stops.');
      return;
    }
    // Small pans inside the area already loaded don't need a new request.
    if (this.loaded?.contains(map.getBounds())) return;
    this.timer = window.setTimeout(() => void this.load(Lf), LOAD_DELAY_MS);
  }

  private async load(Lf: L): Promise<void> {
    const map = this.map;
    if (!map) return;
    const bounds = map.getBounds().pad(0.3);
    const id = ++this.request;
    this.setHint('Finding stops…');
    try {
      const stops = await fetchStopsInBox(bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth());
      if (id !== this.request || !this.markers) return;
      this.loaded = bounds;
      this.markers.clearLayers();
      const colour = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0f6b4f';
      for (const stop of stops) {
        const [lon, lat] = stop.location;
        Lf.circleMarker([lat, lon], {
          radius: 9,
          color: '#ffffff',
          weight: 2,
          fillColor: colour,
          fillOpacity: 1,
        })
          .bindPopup(popupHtml(stop), { closeButton: true })
          .addTo(this.markers);
      }
      this.setHint(stops.length ? '' : 'No bus stops here. Try moving the map.');
    } catch {
      if (id === this.request) this.setHint("Couldn't load stops from bustimes.org.");
    }
  }
}
