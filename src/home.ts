// The main screen: the stops the user saved, each showing its next bus.
// Tapping one opens all of its departures.
import { BOARD_CACHE_MAX_AGE_MS, HORIZON_MS, boardCacheKey, loadBoard, type Board, type Departure } from './departures';
import { countdown, departureTime, escapeHtml } from './format';
import { getStopInfo } from './stop-info';
import { cacheGetStale, cacheSet, getFavourites, type SavedStop } from './store';
import { TIME_ZONE } from './time';
import { loadWeather, type Weather } from './weather';
import { weatherIcon } from './weather-icons';

/** Boards older than this are fetched again. Kept long to be gentle on bustimes.org. */
const REFRESH_MS = 60_000;
const TICK_MS = 10_000;

const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

interface StopState {
  board: Board | null;
  loading: boolean;
  failed: boolean;
}

let root: HTMLElement;
let stops: SavedStop[] = [];
const states = new Map<string, StopState>();
let timer: number | undefined;
let active = false;
let refreshing = false;
let weather: { data: Weather; place: string } | null = null;

function cachedBoard(atco: string): Board | null {
  const board = cacheGetStale<Board>(boardCacheKey(atco));
  return board && Date.now() - board.fetchedAt < BOARD_CACHE_MAX_AGE_MS ? board : null;
}

function nextBus(board: Board, now: number): Departure | null {
  return board.departures.find((d) => departureTime(d) >= now - 60_000) ?? null;
}

/** The next-bus part of a row: what's coming, and when. */
function renderNext(atco: string, now: number): { detail: string; when: string; label: string } {
  const st = states.get(atco);
  const board = st?.board ?? null;
  const next = board ? nextBus(board, now) : null;

  if (next) {
    const c = countdown(next, now);
    const live = next.expected !== null ? '<span class="next-live"><span class="live-dot" aria-hidden="true"></span>Live</span>' : '';
    return {
      detail: `<span class="route-badge tiny">${escapeHtml(next.line)}</span><span class="next-dest">${escapeHtml(next.destination)}</span>${live}`,
      when: `<span class="next-value">${escapeHtml(c.value)}</span>${c.unit ? `<span class="next-unit">${c.unit}</span>` : ''}`,
      label: `Next bus: ${next.line} to ${next.destination}, ${c.label}${next.expected !== null ? ', live' : ''}`,
    };
  }
  if (board) {
    const hours = Math.round((board.horizonMs ?? HORIZON_MS) / 3_600_000);
    return { detail: `<span class="next-note">No buses in the next ${hours} hours</span>`, when: '', label: `No buses in the next ${hours} hours` };
  }
  if (st?.failed) {
    return { detail: `<span class="next-note">Couldn't load times</span>`, when: '', label: "Couldn't load times" };
  }
  return {
    detail: '<span class="next-note">Checking for buses…</span>',
    when: '<span class="next-skeleton" aria-hidden="true"></span>',
    label: 'Checking for buses',
  };
}

function renderRow(stop: SavedStop, now: number): string {
  const next = renderNext(stop.atco, now);
  return `
    <li>
      <a class="stop-card" data-atco="${escapeHtml(stop.atco)}" href="#/stop/${encodeURIComponent(stop.atco)}"
        aria-label="${escapeHtml(`${stop.name}. ${next.label}`)}">
        <span class="home-main">
          <span class="stop-card-name">${escapeHtml(stop.name)}</span>
          <span class="next-detail">${next.detail}</span>
        </span>
        <span class="next-when">${next.when}</span>
        <span class="chevron">${CHEVRON}</span>
      </a>
    </li>`;
}

function greeting(now: Date): string {
  const hour = Number(new Intl.DateTimeFormat('en-IE', { hour: 'numeric', hourCycle: 'h23', timeZone: TIME_ZONE }).format(now));
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function renderWeather(): string {
  if (!weather) return '';
  const w = weather.data;
  const rain = w.rainChance === null ? '' : ` · ${w.rainChance}% rain`;
  return `
    <div class="home-weather" aria-label="${escapeHtml(`${Math.round(w.temperature)} degrees, ${w.label}${w.rainChance === null ? '' : `, ${w.rainChance}% chance of rain`}, near ${weather.place}`)}">
      ${weatherIcon(w.kind, w.isDay)}
      <span class="home-temp" aria-hidden="true">${Math.round(w.temperature)}°</span>
      <span class="home-wx-text" aria-hidden="true">${escapeHtml(w.label)}${rain}</span>
    </div>`;
}

function renderHeader(): string {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-IE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TIME_ZONE }).format(now);
  return `
    <header class="home-hero">
      <div class="home-hello">
        <h1>${greeting(now)}</h1>
        <p>${escapeHtml(date)}</p>
      </div>
      <div class="home-weather-slot">${renderWeather()}</div>
    </header>`;
}

function render(): void {
  if (stops.length === 0) {
    root.innerHTML = `
      <section class="empty-start">
        <img src="favicon.svg" alt="" width="56" height="56">
        <h1>No stops added yet</h1>
        <p class="muted">Add a stop to see its live departures here.</p>
        <a class="button primary" href="#/stops">${PLUS} Add a stop</a>
      </section>`;
    return;
  }
  const now = Date.now();
  root.innerHTML = `
    <section class="home">
      ${renderHeader()}
      <div class="home-section">
        <h2>Your stops</h2>
        <a class="home-manage" href="#/stops">Manage</a>
      </div>
      <ul class="home-list">${stops.map((s) => renderRow(s, now)).join('')}</ul>
      <a class="add-stop" href="#/stops">${PLUS} Add a stop</a>
      ${weather ? '<p class="credit">Weather by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>.</p>' : ''}
    </section>`;
}

/** Redraws one row in place, so taps and focus elsewhere aren't disturbed. */
function updateRow(atco: string): void {
  const link = root.querySelector<HTMLElement>(`.stop-card[data-atco="${CSS.escape(atco)}"]`);
  const stop = stops.find((s) => s.atco === atco);
  if (!link || !stop) return;
  const fresh = document.createElement('ul');
  fresh.innerHTML = renderRow(stop, Date.now());
  const replacement = fresh.querySelector('.stop-card')!;
  link.setAttribute('aria-label', replacement.getAttribute('aria-label') ?? '');
  link.innerHTML = replacement.innerHTML;
}

/** Fetches stale boards one stop at a time, to keep requests to bustimes.org low. */
async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    for (const stop of stops) {
      if (!active || document.visibilityState !== 'visible') break;
      // The list can change while this runs (leaving and coming back).
      const st = states.get(stop.atco);
      if (!st) continue;
      const age = st.board ? Date.now() - st.board.fetchedAt : Infinity;
      if (age < REFRESH_MS) continue;
      st.loading = true;
      try {
        const board = await loadBoard(stop.atco.split(',').filter(Boolean));
        st.board = board;
        st.failed = false;
        cacheSet(boardCacheKey(stop.atco), board, BOARD_CACHE_MAX_AGE_MS);
      } catch {
        st.failed = true;
      } finally {
        st.loading = false;
      }
      if (active) updateRow(stop.atco);
    }
  } finally {
    refreshing = false;
  }
}

/** Weather where the first saved stop is. A nice extra: on failure it's left out. */
async function refreshWeather(): Promise<void> {
  const first = stops[0];
  if (!first) return;
  try {
    const info = await getStopInfo(first.atco.split(',')[0]);
    if (!info?.location) return;
    const data = await loadWeather(info.location);
    if (!active) return;
    const hadWeather = weather !== null;
    weather = { data, place: first.name };
    const slot = root.querySelector('.home-weather-slot');
    if (slot) slot.innerHTML = renderWeather();
    if (!hadWeather && !root.querySelector('.credit')) {
      root.querySelector('.home')?.insertAdjacentHTML(
        'beforeend',
        '<p class="credit">Weather by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>.</p>',
      );
    }
  } catch {
    // Leave the weather out.
  }
}

function tick(): void {
  if (!active || document.visibilityState !== 'visible') return;
  // Keep the countdowns current between fetches.
  for (const stop of stops) updateRow(stop.atco);
  void refresh();
  // Weather is cached for 15 minutes, so this rarely makes a request.
  void refreshWeather();
}

function onVisibility(): void {
  if (document.visibilityState === 'visible') tick();
}

export function showHome(container: HTMLElement): () => void {
  root = container;
  active = true;
  document.title = 'TrackIE';
  stops = getFavourites();
  states.clear();
  for (const stop of stops) states.set(stop.atco, { board: cachedBoard(stop.atco), loading: false, failed: false });
  render();
  if (stops.length) {
    void refresh();
    void refreshWeather();
    timer = window.setInterval(tick, TICK_MS);
    document.addEventListener('visibilitychange', onVisibility);
  }
  return () => {
    active = false;
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
