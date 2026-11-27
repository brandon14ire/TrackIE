// The slim "Following" strip, shown on the main screen and on stop screens.
// It also holds the secret Bus Spotter: tap the little bus five times quickly.
import { clockHtml, escapeHtml, stopsAwayText } from './format';
import { ALERT_MINUTES, followedTime, notificationsBlocked, type Followed } from './follow';
import { spotter, spotterRank, tapBus } from './spotter';
import { minutesUntil } from './time';

const BUS =
  '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="12" y="10" width="40" height="40" rx="8" fill="#ffd23f"/><rect x="17" y="15" width="30" height="15" rx="3" fill="#0f6b4f"/><circle cx="21" cy="42" r="3.5" fill="#0f6b4f"/><circle cx="43" cy="42" r="3.5" fill="#0f6b4f"/><rect x="16" y="50" width="8" height="6" rx="2" fill="#333"/><rect x="40" y="50" width="8" height="6" rx="2" fill="#333"/></svg>';
const CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

/**
 * The strip for a followed bus. `onBoard` is the stop screen being shown, if
 * any: the strip links to the followed bus's stop unless that's already open.
 */
export function renderFollowCard(f: Followed, now: number, onBoard: string | null): string {
  const minutes = minutesUntil(followedTime(f), now);
  // The progress line fills over the bus's last half hour.
  const progress = Math.max(0, Math.min(1, 1 - minutes / 30));
  const where = stopsAwayText(f.stopsAway);
  const alert = f.alerted
    ? 'Alert sent'
    : `Alert at ${ALERT_MINUTES} min${notificationsBlocked() ? ' (in app)' : ''}`;
  const sub = [
    where ? `<span class="live"><span class="live-dot" aria-hidden="true"></span>${escapeHtml(where)}</span>` : clockHtml(f.scheduled, f.expected),
    `<span class="follow-alert">${escapeHtml(alert)}</span>`,
  ].join('');
  const when = `<span class="follow-when" aria-hidden="true"><strong>${minutes === 0 ? 'Due' : minutes}</strong>${minutes === 0 ? '' : ' min'}</span>`;
  const label = `Following the ${f.line} to ${f.destination} from ${f.stopName}, ${minutes === 0 ? 'due now' : `in ${minutes} minutes`}`;
  const body = `
    <span class="follow-main">
      <span class="follow-title"><span class="route-badge tiny">${escapeHtml(f.line)}</span><span class="follow-dest">${escapeHtml(f.destination)}</span></span>
      <span class="follow-sub">${sub}</span>
    </span>
    ${when}`;
  const linked = f.board !== onBoard;
  return `
    <section class="follow${f.alerted ? ' alerted' : ''}" aria-label="${escapeHtml(label)}">
      <button class="follow-bus" data-action="honk" tabindex="-1" aria-hidden="true">${BUS}</button>
      ${
        linked
          ? `<a class="follow-body" href="#/stop/${encodeURIComponent(f.board)}" aria-label="${escapeHtml(`${label}. Open ${f.stopName}`)}">${body}</a>`
          : `<div class="follow-body">${body}</div>`
      }
      <button class="follow-stop" data-action="unfollow" aria-label="Stop following">${CLOSE}</button>
      <span class="follow-progress" aria-hidden="true" style="--progress: ${progress.toFixed(3)}"></span>
    </section>`;
}

/** Shown under the strip once the Bus Spotter is unlocked. */
export function renderSpotter(f: Followed): string {
  const data = spotter();
  if (!data.unlocked) return '';
  const counts = Object.values(data.seen);
  const total = counts.reduce((a, b) => a + b, 0);
  const thisBus = f.vehicleName
    ? `This bus: <strong>${escapeHtml(f.vehicleName)}</strong>, caught ${data.seen[f.vehicleName] ?? 0}×`
    : "This bus isn't live-tracked, so it can't be logged";
  return `
    <div class="spotter">
      <div class="spotter-head">🔭 <strong>Bus Spotter</strong><span class="spotter-rank">${spotterRank(total)}</span></div>
      <p>${thisBus}</p>
      <p class="muted">${counts.length} different ${counts.length === 1 ? 'bus' : 'buses'} caught, ${total} in total. Catch a live bus with an alert to log it.</p>
    </div>`;
}

/**
 * The secret: tap the bus five times quickly. Returns true when this tap
 * unlocked the Bus Spotter (the caller redraws to show it). After that, it honks.
 */
export function honk(bus: HTMLElement): boolean {
  if (tapBus()) {
    confetti();
    return true;
  }
  if (!spotter().unlocked) return false;
  bus.classList.remove('honking');
  void bus.offsetWidth; // Restart the animation.
  bus.classList.add('honking');
  const bubble = document.createElement('span');
  bubble.className = 'beep';
  bubble.textContent = 'Beep beep!';
  bus.append(bubble);
  setTimeout(() => bubble.remove(), 1200);
  return false;
}

function confetti(): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colours = ['#ffd23f', '#37c093', '#2f80d1', '#ff7a59', '#b072ff'];
  for (let i = 0; i < 40; i++) {
    const piece = document.createElement('span');
    piece.className = 'confetti';
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.background = colours[i % colours.length];
    piece.style.animationDelay = `${Math.random() * 0.3}s`;
    piece.style.setProperty('--drift', `${(Math.random() - 0.5) * 120}px`);
    document.body.append(piece);
    setTimeout(() => piece.remove(), 2200);
  }
}
