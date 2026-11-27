import { stopPageUrl } from './api';
import { BOARD_CACHE_MAX_AGE_MS, HORIZON_MS, boardCacheKey, loadBoard, sortLines, type Board, type Departure } from './departures';
import { clockHtml, countdown, departureTime, escapeHtml, punctuality, stopsAwayText } from './format';
import {
  cacheGetStale,
  cacheSet,
  getFavourite,
  getFavourites,
  readSetting,
  removeFavourite,
  saveFavourite,
  writeSetting,
} from './store';
import { ALERT_MINUTES, follow, getFollowed, isFollowing, onFollowChange, unfollow } from './follow';
import { honk, renderFollowCard, renderSpotter } from './follow-card';
import { Swipes } from './swipe';
import { formatClock } from './time';
import { getStopInfo, type StopInfo } from './stop-info';

const REFRESH_MS = 30_000;
const TICK_MS = 10_000;


interface State {
  /** Board key: one ATCO code, or several joined by commas. */
  atco: string;
  atcos: string[];
  stops: Record<string, StopInfo>;
  /** Routes shown; empty means every route. Resets when the stop is left. */
  routes: string[];
  board: Board | null;
  loading: boolean;
  error: string | null;
  /** No stops were saved when this one opened, so save it once its name is known. */
  autoSave: boolean;
  /** Shows the note saying this stop was saved for them. */
  savedNote: boolean;
}

let state: State | null = null;
let swipes: Swipes;

/** Set once someone has used an alert, so the swipe hint stops showing. */
const SWIPE_HINT_KEY = 'swipeHintDone';
function swipeHintShown(): boolean {
  return readSetting<boolean>(SWIPE_HINT_KEY) === true;
}
let timer: number | undefined;
let root: HTMLElement;


/** The first stop someone opens becomes their saved stop, so the app opens there next time. */
function maybeAutoSave(s: State): void {
  if (!s.autoSave || !s.atcos.every((a) => s.stops[a])) return;
  s.autoSave = false;
  if (getFavourites().length) return;
  saveFavourite({ atco: s.atco, name: stopTitle(s) });
  s.savedNote = true;
  announce('Added to your stops.');
}

function renderSavedNote(): string {
  return `
    <div class="note" role="status">
      <p><strong>Added to your stops.</strong> It's on the main screen now. Add more from <strong>Settings</strong> (top right).</p>
      <button class="icon-button" data-action="dismiss-note" aria-label="Dismiss">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>`;
}

function isCombined(s: State): boolean {
  return s.atcos.length > 1;
}

function stopName(s: State, atco: string): string {
  return s.stops[atco]?.common_name ?? 'Bus stop';
}

function stopTitle(s: State): string {
  return (
    getFavourite(s.atco)?.name ??
    (isCombined(s) ? s.atcos.map((a) => stopName(s, a)).join(' + ') : stopName(s, s.atco))
  );
}

function stopSubtitle(s: State): string {
  if (isCombined(s)) {
    return Object.keys(s.stops).length ? `Buses from ${s.atcos.map((a) => stopName(s, a)).join(' and ')}` : '';
  }
  const stop = s.stops[s.atco];
  // Saved stops go by the name they were saved as, so don't contradict it.
  if (!stop || getFavourite(s.atco)) return '';
  // Skip the full name when the title already says it.
  const parts = [stopTitle(s).startsWith(stop.long_name) ? null : stop.long_name];
  if (stop.indicator && !stop.long_name.includes(stop.indicator)) parts.push(stop.indicator);
  return parts.filter(Boolean).join(' · ');
}

/** On a combined board, which stop the bus leaves from. */
function fromLine(d: Departure, s: State, withArrival: boolean): string {
  if (!isCombined(s)) return '';
  const arrival =
    withArrival && d.arrives !== null ? `<span class="bit">arrives ${formatClock(d.arrives)}</span>` : '';
  return `<div class="from"><span class="bit">From ${escapeHtml(stopName(s, d.stop))}</span>${arrival}</div>`;
}

/**
 * Live status, as separate items with no dot separators, so a narrow screen
 * wraps them cleanly. The green dot and colour mark the live part:
 * "● 1 stop away", then the delay ("23 min late", "On time").
 */
function metaItems(d: Departure): string[] {
  if (d.expected === null) return ['<span class="scheduled">Timetable</span>'];
  // Without a stop count, just say it's live.
  const where = stopsAwayText(d.stopsAway) ?? 'Live';
  const items = [
    `<span class="live"><span class="live-dot" aria-hidden="true"></span><span class="visually-hidden">Live, </span>${escapeHtml(where)}</span>`,
  ];
  const punct = punctuality(d);
  if (punct) items.push(`<span class="punct ${d.delay! >= 120 ? 'late' : ''}">${escapeHtml(punct)}</span>`);
  return items;
}

function timesLine(d: Departure, s: State): string {
  const parts = [clockHtml(d.scheduled, d.expected)];
  // Comparing stops only makes sense with when each bus gets you there.
  if (isCombined(s) && d.arrives !== null) parts.push(`Arrives ${formatClock(d.arrives)}`);
  return parts.join(' · ');
}

const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/></svg>';
function renderFollow(s: State, now: number): string {
  const f = getFollowed();
  if (!f) return '';
  return renderFollowCard(f, now, s.atco) + renderSpotter(f);
}

/** The alert button hidden behind a departure: swipe the bus left to reveal it. */
function swipeAction(d: Departure): string {
  const on = isFollowing(d, getFollowed());
  return `<button class="swipe-action${on ? ' on' : ''}" data-action="follow" data-trip="${d.tripId}" data-stop="${escapeHtml(d.stop)}"
    aria-pressed="${on}" aria-label="${on ? 'Stop the alert for' : `Alert me ${ALERT_MINUTES} minutes before`} this ${escapeHtml(d.line)}">${BELL}<span>${on ? 'Stop alert' : 'Alert me'}</span></button>`;
}

function swipeKey(d: Departure): string {
  return `${d.tripId}:${d.stop}`;
}

/** A small bell beside the time of the bus being followed. */
function followedMark(d: Departure): string {
  return isFollowing(d, getFollowed()) ? `<span class="followed-mark" title="Alert on">${BELL}</span>` : '';
}

function renderHero(d: Departure, s: State, now: number): string {
  const c = countdown(d, now);
  return `
    <div class="${swipes.classFor(swipeKey(d))} hero-swipe" data-swipe="${escapeHtml(swipeKey(d))}">
    ${swipeAction(d)}
    <article class="hero swipe-content" aria-label="Next bus: ${escapeHtml(d.line)} to ${escapeHtml(d.destination)}, ${escapeHtml(c.label)}">
      <div class="hero-route">
        <span class="route-badge">${escapeHtml(d.line)}</span>
        <span class="hero-dest">${escapeHtml(d.destination)}</span>
        <span class="hero-countdown" aria-hidden="true">
          <span class="hero-value">${escapeHtml(c.value)}</span>
          ${c.unit ? `<span class="hero-unit">${c.unit}</span>` : ''}
        </span>
        ${followedMark(d)}
      </div>
      ${fromLine(d, s, false)}
      <div class="hero-meta">${[...metaItems(d), `<span class="hero-times">${timesLine(d, s)}</span>`].join('')}</div>
    </article>
    </div>
    ${swipeHintShown() ? '' : '<p class="swipe-hint">Swipe a bus left to get an alert before it arrives.</p>'}`;
}

function renderRow(d: Departure, s: State, now: number): string {
  const c = countdown(d, now);
  const clock = formatClock(departureTime(d));
  return `
    <li class="${swipes.classFor(swipeKey(d))}" data-swipe="${escapeHtml(swipeKey(d))}">
    ${swipeAction(d)}
    <div class="row swipe-content" aria-label="${escapeHtml(d.line)} to ${escapeHtml(d.destination)}, ${escapeHtml(c.label)}">
      <span class="route-badge small">${escapeHtml(d.line)}</span>
      <div class="row-main">
        <div class="row-dest">${escapeHtml(d.destination)}</div>
        ${fromLine(d, s, true)}
        <div class="row-meta">${metaItems(d).map((item) => `<div>${item}</div>`).join('')}</div>
      </div>
      <div class="row-when" aria-hidden="true">
        <span class="row-value">${followedMark(d)}${escapeHtml(c.value)}${c.unit ? `<small> ${c.unit}</small>` : ''}</span>
        ${c.value === clock ? '' : `<span class="row-clock">${clockHtml(d.scheduled, d.expected)}</span>`}
      </div>
    </div>
    </li>`;
}

function renderStatus(s: State, now: number): string {
  const bits: string[] = [];
  if (s.loading) bits.push('Updating…');
  else if (s.board) bits.push(`Updated ${formatClock(s.board.fetchedAt)}`);
  if (s.error) {
    bits.push(
      s.board
        ? `<span class="warn">Can't reach bustimes.org, showing times from ${formatClock(s.board.fetchedAt)}</span>`
        : `<span class="warn">${escapeHtml(s.error)}</span>`,
    );
  } else if (s.board && !s.board.liveOk) {
    bits.push(
      navigator.onLine === false
        ? '<span class="warn">Offline, showing timetable times</span>'
        : '<span class="warn">Live tracking unavailable, timetable only</span>',
    );
  }
  if (s.board && now - s.board.fetchedAt > 5 * 60_000 && !s.error && !s.loading) {
    bits.push('<span class="warn">These times may be out of date</span>');
  }
  return bits.join('<span class="sep" aria-hidden="true">·</span>');
}

// The header is only redrawn when it changes, so the regular countdown
// updates never move keyboard focus off its buttons.
let lastHead = '';

function renderHead(s: State): string {
  const favourite = getFavourite(s.atco);
  return `
    <a class="back" href="#/">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
      Your stops
    </a>
    <div class="stop-head">
      <div class="stop-names">
        <h1>${escapeHtml(stopTitle(s))}</h1>
        <p class="stop-sub">${escapeHtml(stopSubtitle(s))}</p>
      </div>
      <button class="save" data-action="favourite" aria-pressed="${Boolean(favourite)}"
        aria-label="Save stop" title="Saved stops appear on the main screen">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>
        <span aria-hidden="true">${favourite ? 'Saved' : 'Save'}</span>
      </button>
    </div>`;
}

function renderBody(s: State, now: number): string {
  const filter = s.routes;
  const upcoming = (s.board?.departures ?? []).filter((d) => departureTime(d) >= now - 60_000);
  const visible = upcoming.filter((d) => filter.length === 0 || filter.includes(d.line));

  let departures: string;
  if (!s.board) {
    departures = s.error
      ? `<div class="empty"><p>Couldn't load departures.</p><button class="button" data-action="refresh">Try again</button></div>`
      : `<div class="skeleton" aria-hidden="true"><div></div><div></div><div></div></div>`;
  } else if (visible.length === 0) {
    const which = filter.length ? `${filter.join(', ')} ` : '';
    const hours = Math.round((s.board.horizonMs ?? HORIZON_MS) / 3_600_000);
    departures = `<div class="empty"><p>No ${escapeHtml(which)}buses in the next ${hours} hours.</p></div>`;
  } else {
    const [next, ...rest] = visible;
    departures = `${renderHero(next, s, now)}${
      rest.length ? `<h2 class="list-title">Later</h2><ol class="list">${rest.map((d) => renderRow(d, s, now)).join('')}</ol>` : ''
    }`;
  }

  // One button per route with a bus leaving soon, plus any already chosen.
  const lines = sortLines([...upcoming.map((d) => d.line), ...filter]);
  const chips =
    lines.length > 1
      ? `<div class="chips" role="group" aria-label="Show routes">
          <button class="chip" data-action="route" data-route="" aria-pressed="${filter.length === 0}">All</button>
          ${lines
            .map(
              (line) =>
                `<button class="chip" data-action="route" data-route="${escapeHtml(line)}" aria-pressed="${filter.includes(line)}">${escapeHtml(line)}</button>`,
            )
            .join('')}
        </div>`
      : '';

  return `
    ${s.savedNote ? renderSavedNote() : ''}
    ${renderFollow(s, now)}
    ${chips}
    <div class="status">
      <span class="status-text">${renderStatus(s, now)}</span>
      <button class="refresh" data-action="refresh" aria-label="Refresh now" ${s.loading ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/></svg>
      </button>
    </div>
    ${departures}
    <p class="credit">
      Times from <a href="${stopPageUrl(s.atcos[0])}" target="_blank" rel="noopener">bustimes.org</a>,
      using public transport open data.
    </p>`;
}

function render(): void {
  if (!state) return;
  const s = state;

  let head = root.querySelector<HTMLElement>('[data-part="head"]');
  let body = root.querySelector<HTMLElement>('[data-part="body"]');
  if (!head || !body) {
    root.innerHTML = '<section class="board"><div data-part="head"></div><div data-part="body"></div></section>';
    head = root.querySelector<HTMLElement>('[data-part="head"]')!;
    body = root.querySelector<HTMLElement>('[data-part="body"]')!;
    lastHead = '';
  }

  // Redrawing replaces buttons, so put keyboard focus back after.
  const focused = root.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset : null;

  const headHtml = renderHead(s);
  if (headHtml !== lastHead) {
    head.innerHTML = headHtml;
    lastHead = headHtml;
  }
  // Don't redraw under a finger mid-swipe; Swipes calls render() when it ends.
  if (!swipes.dragging) body.innerHTML = renderBody(s, Date.now());

  if (focused?.action && !root.contains(document.activeElement)) {
    const selector = `[data-action="${focused.action}"]${
      focused.route !== undefined ? `[data-route="${CSS.escape(focused.route)}"]` : ''
    }`;
    root.querySelector<HTMLElement>(selector)?.focus();
  }
}

function announce(message: string): void {
  const region = document.getElementById('announcer');
  if (region) region.textContent = message;
}

async function refresh(manual = false): Promise<void> {
  if (!state || state.loading) return;
  const s = state;
  s.loading = true;
  render();
  try {
    // Stop names come from a cache; fetch any not seen before.
    const missing = s.atcos.filter((a) => !s.stops[a]?.location);
    const [board, infos] = await Promise.all([loadBoard(s.atcos, s.routes), Promise.all(missing.map(getStopInfo))]);
    if (state !== s) return; // Navigated away while loading.
    s.board = board;
    missing.forEach((a, i) => {
      const info = infos[i];
      if (info) s.stops[a] = info;
    });
    s.error = null;
    maybeAutoSave(s);
    cacheSet(boardCacheKey(s.atco), board, BOARD_CACHE_MAX_AGE_MS);
    if (manual) announce('Departures updated');
  } catch (err) {
    if (state !== s) return;
    console.error(err);
    s.error = navigator.onLine === false ? "You're offline" : "Couldn't reach bustimes.org";
    announce(s.board ? `${s.error}. Showing earlier times.` : s.error);
  } finally {
    if (state === s) {
      s.loading = false;
      render();
    }
  }
}

function tick(): void {
  if (!state || document.visibilityState !== 'visible') return;
  const age = state.board ? Date.now() - state.board.fetchedAt : Infinity;
  if (age >= REFRESH_MS || (state.error && !state.loading)) void refresh();
  else render(); // Keep the countdowns current between fetches.
}

function onClick(event: MouseEvent): void {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!target || !state) return;
  const atco = state.atco;
  switch (target.dataset.action) {
    case 'refresh':
      void refresh(true);
      break;
    case 'dismiss-note':
      state.savedNote = false;
      render();
      break;
    case 'favourite': {
      const saved = getFavourite(atco);
      if (saved) {
        // One tap on "Saved" shouldn't silently drop a stop from the main screen.
        if (!window.confirm(`Remove ${saved.name} from your stops?`)) break;
        removeFavourite(atco);
        announce('Removed from saved stops');
      } else {
        saveFavourite({ atco, name: stopTitle(state) });
        announce('Saved. It now appears on the main screen.');
      }
      render();
      break;
    }
    case 'follow': {
      const d = state.board?.departures.find(
        (x) => String(x.tripId) === target.dataset.trip && x.stop === target.dataset.stop,
      );
      if (!d) break;
      swipes.close();
      if (isFollowing(d, getFollowed())) {
        unfollow();
        announce('Stopped following');
      } else {
        writeSetting(SWIPE_HINT_KEY, true);
        void follow(d, atco, stopTitle(state));
        announce(
          `Following the ${d.line}. You'll get an alert ${ALERT_MINUTES} minutes before it arrives. Keep TrackIE open: phones pause web apps in the background.`,
        );
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      break;
    }
    case 'unfollow':
      unfollow();
      announce('Stopped following');
      break;
    case 'honk':
      if (honk(target)) {
        announce('Bus Spotter unlocked!');
        render();
      }
      break;
    case 'route': {
      const route = target.dataset.route ?? '';
      const current = state.routes;
      state.routes = !route ? [] : current.includes(route) ? current.filter((r) => r !== route) : [...current, route];
      render();
      // A quiet route may need the board to look further ahead.
      void refresh();
      break;
    }
  }
}

function onVisibility(): void {
  if (document.visibilityState === 'visible') tick();
}

function onOnline(): void {
  void refresh();
}

export function showBoard(container: HTMLElement, atco: string): () => void {
  root = container;
  // Created before the first render, which asks it which row is open.
  swipes = new Swipes(root, render);
  root.innerHTML = '';
  const atcos = atco.split(',').filter(Boolean);
  const snapshot = cacheGetStale<Board>(boardCacheKey(atco));
  const fresh = snapshot && Date.now() - snapshot.fetchedAt < BOARD_CACHE_MAX_AGE_MS ? snapshot : null;
  state = {
    atco,
    atcos,
    routes: [],
    stops: Object.fromEntries(
      atcos.flatMap((a) => {
        const info = cacheGetStale<StopInfo>(`stop:${a}`);
        return info ? [[a, info]] : [];
      }),
    ),
    board: fresh,
    loading: false,
    error: null,
    autoSave: getFavourites().length === 0,
    savedNote: false,
  };
  maybeAutoSave(state);
  document.title = `${stopTitle(state)} · TrackIE`;
  render();
  void refresh().then(() => {
    if (state?.atco === atco) document.title = `${stopTitle(state)} · TrackIE`;
  });

  const detachSwipes = swipes.attach();
  root.addEventListener('click', onClick);
  const stopWatchingFollow = onFollowChange(render);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', onOnline);
  timer = window.setInterval(tick, TICK_MS);

  return () => {
    state = null;
    window.clearInterval(timer);
    detachSwipes();
    root.removeEventListener('click', onClick);
    stopWatchingFollow();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', onOnline);
  };
}
