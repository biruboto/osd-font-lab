// Change the notice ID for a future announcement that everyone should see once.
export const WELCOME_NOTICE_ID = '2026-10-font-lab-overhaul';
export const ANNOUNCEMENT_STORAGE_KEY = 'osdFontLabNoticeSeen';

export function createAnnouncements({ banner, toggle, dismiss, storage = () => localStorage, onChange = () => {} }) {
  let initialized = false, seen = false, wanted = false, recoveryPending = false, explicitlyOpened = false;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let flight = null, arrival = null, ghost = null;

  function cancelMotion() {
    flight?.cancel();
    arrival?.cancel();
    ghost?.remove();
    flight = arrival = ghost = null;
  }

  function prepareMinimize() {
    if (reducedMotion.matches || banner.hidden || !banner.animate) return null;
    const source = banner.getBoundingClientRect();
    if (!source.width || !source.height) return null;
    const copy = banner.cloneNode(true);
    copy.removeAttribute('id');
    copy.removeAttribute('aria-labelledby');
    for (const element of copy.querySelectorAll('[id]')) element.removeAttribute('id');
    copy.setAttribute('aria-hidden', 'true');
    copy.inert = true;
    copy.classList.add('notice-flight');
    Object.assign(copy.style, {
      left: `${source.left}px`, top: `${source.top}px`,
      width: `${source.width}px`, height: `${source.height}px`,
    });
    document.body.append(copy);
    ghost = copy;
    return { copy, source };
  }

  function minimizeToBell({ copy, source }) {
    const target = toggle.getBoundingClientRect();
    const animation = copy.animate([
      { transform: 'translate(0, 0) scale(1, 1)', opacity: 1 },
      { transform: `translate(${target.left - source.left}px, ${target.top - source.top}px) scale(${target.width / source.width}, ${target.height / source.height})`, opacity: 0 },
    ], { duration: 320, easing: 'cubic-bezier(.4, 0, .2, 1)' });
    flight = animation;
    animation.finished.then(() => {
      copy.remove();
      if (flight !== animation) return;
      flight = ghost = null;
      if (!banner.hidden || reducedMotion.matches || document.hidden) return;
      arrival = toggle.animate([
        { transform: 'scale(1)', boxShadow: '0 0 0 0 color-mix(in srgb, var(--accent-0) 65%, transparent)' },
        { transform: 'scale(1.12)', boxShadow: '0 0 0 6px transparent' },
        { transform: 'scale(1)', boxShadow: '0 0 0 10px transparent' },
      ], { duration: 280, easing: 'ease-out' });
      arrival.finished.catch(() => {});
    }).catch(() => copy.remove());
  }

  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) cancelMotion(); });
  window.addEventListener('resize', cancelMotion);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancelMotion(); });

  function render() {
    const open = initialized && wanted && (!recoveryPending || explicitlyOpened);
    const changed = open !== !banner.hidden;
    banner.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.dataset.unread = String(initialized && !seen);
    if (changed) onChange();
  }

  function close({ returnFocus = false, minimize = false } = {}) {
    cancelMotion();
    const moving = minimize ? prepareMinimize() : null;
    wanted = false;
    explicitlyOpened = false;
    seen = true;
    try { storage().setItem(ANNOUNCEMENT_STORAGE_KEY, WELCOME_NOTICE_ID); } catch { /* The notice remains usable without preference storage. */ }
    render();
    if (returnFocus) toggle.focus({ preventScroll: true });
    if (moving) minimizeToBell(moving);
  }

  toggle.addEventListener('click', () => {
    cancelMotion();
    if (!banner.hidden) close();
    else {
      wanted = true;
      explicitlyOpened = true;
      render();
    }
  });
  dismiss.addEventListener('click', () => close({ returnFocus: true, minimize: true }));
  banner.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    close({ returnFocus: true });
  });

  return {
    init() {
      try { seen = storage().getItem(ANNOUNCEMENT_STORAGE_KEY) === WELCOME_NOTICE_ID; } catch { seen = false; }
      initialized = true;
      wanted = !seen;
      render();
    },
    setRecoveryPending(pending) {
      recoveryPending = pending;
      render();
    },
  };
}
