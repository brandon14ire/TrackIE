// Swipe a departure left to reveal the action behind it (the alert button).
// Markup: <div class="swipe" data-swipe="key"><button class="swipe-action">…
// </button><div class="swipe-content">…</div></div>. Keyboard users reach the
// action by tabbing to it, which slides the row open (see :focus-within in CSS).

/** How far an open row slides; matches .swipe-action's width in CSS. */
const OPEN_PX = 96;
/** Movement before deciding between a swipe and a scroll. */
const SLOP_PX = 8;

export class Swipes {
  /** Key of the row that's open, if any. */
  open: string | null = null;
  /** True mid-swipe, so the page shouldn't redraw under the finger. */
  dragging = false;

  private el: HTMLElement | null = null;
  private content: HTMLElement | null = null;
  private startX = 0;
  private startY = 0;
  private base = 0;
  private offset = 0;
  private decided: 'swipe' | 'scroll' | null = null;
  private pointerId = -1;
  private suppressClick = false;

  constructor(
    private root: HTMLElement,
    /** Called when a swipe ends, so the caller can redraw anything it held back. */
    private onSettle: () => void,
  ) {}

  /** Class for a row's wrapper: "swipe open" when it's the open one. */
  classFor(key: string): string {
    return key === this.open ? 'swipe open' : 'swipe';
  }

  attach(): () => void {
    const down = (e: PointerEvent) => this.down(e);
    const move = (e: PointerEvent) => this.move(e);
    const up = (e: PointerEvent) => this.up(e);
    const click = (e: MouseEvent) => this.click(e);
    this.root.addEventListener('pointerdown', down);
    this.root.addEventListener('pointermove', move);
    this.root.addEventListener('pointerup', up);
    this.root.addEventListener('pointercancel', up);
    this.root.addEventListener('click', click, true);
    return () => {
      this.root.removeEventListener('pointerdown', down);
      this.root.removeEventListener('pointermove', move);
      this.root.removeEventListener('pointerup', up);
      this.root.removeEventListener('pointercancel', up);
      this.root.removeEventListener('click', click, true);
    };
  }

  /** Closes any open row, e.g. after its action was used. */
  close(): void {
    this.open = null;
    this.root.querySelectorAll('.swipe.open').forEach((el) => el.classList.remove('open'));
  }

  private down(e: PointerEvent): void {
    if (e.button !== 0) return;
    const content = (e.target as HTMLElement).closest<HTMLElement>('.swipe-content');
    const el = content?.closest<HTMLElement>('.swipe');
    if (!content || !el) return;
    this.el = el;
    this.content = content;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.base = el.classList.contains('open') ? -OPEN_PX : 0;
    this.offset = this.base;
    this.decided = null;
    this.pointerId = e.pointerId;
  }

  private move(e: PointerEvent): void {
    if (!this.el || !this.content || e.pointerId !== this.pointerId) return;
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    if (!this.decided) {
      if (Math.abs(dx) > SLOP_PX && Math.abs(dx) > Math.abs(dy)) {
        this.decided = 'swipe';
        this.dragging = true;
        this.el.classList.add('dragging');
        this.content.setPointerCapture(e.pointerId);
      } else if (Math.abs(dy) > SLOP_PX) {
        this.decided = 'scroll';
      }
    }
    if (this.decided !== 'swipe') return;
    // A little give past fully open, none past closed.
    this.offset = Math.max(-OPEN_PX * 1.25, Math.min(0, this.base + dx));
    this.content.style.transform = `translateX(${this.offset}px)`;
  }

  private up(e: PointerEvent): void {
    if (!this.el || !this.content || e.pointerId !== this.pointerId) return;
    if (this.decided === 'swipe') {
      const opening = this.offset < -OPEN_PX / 2;
      const key = this.el.dataset.swipe ?? null;
      this.close();
      if (opening) {
        this.open = key;
        this.el.classList.add('open');
      }
      this.el.classList.remove('dragging');
      this.content.style.transform = '';
      // A swipe can end in a click on the row; don't let it count as a tap.
      // That click comes straight after pointerup, so the flag only lasts
      // until then and never swallows a later tap (like the action itself).
      this.suppressClick = true;
      setTimeout(() => {
        this.suppressClick = false;
      }, 0);
      this.dragging = false;
      this.onSettle();
    }
    this.el = null;
    this.content = null;
    this.decided = null;
  }

  private click(e: MouseEvent): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // With a row open, a tap anywhere but its action just closes it.
    if (this.open && !(e.target as HTMLElement).closest('.swipe.open .swipe-action')) {
      this.close();
      if ((e.target as HTMLElement).closest('.swipe-content')) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }
}
