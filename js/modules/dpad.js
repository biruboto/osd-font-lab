// js/modules/dpad.js
export function initDpadControls({
  onResetReplaced,
  onClearSelection,
  onNudgeReplaced,
  onNudgeSelection,
}) {
  if (window.__dpadsBound) return;
  window.__dpadsBound = true;

  let holdTimer = null;
  let holdInterval = null;

  function stopHold() {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    if (holdInterval) {
      clearInterval(holdInterval);
      holdInterval = null;
    }
  }

  document.addEventListener("mousedown", (e) => {
    const btn = e.target.closest(".dpad button");
    if (!btn) return;

    const dpad = btn.closest(".dpad");
    const target = dpad?.getAttribute("data-nudge-target");
    if (!target) return;

    e.preventDefault();

    const action = btn.getAttribute("data-action");
    const dx = parseInt(btn.getAttribute("data-dx") || "0", 10);
    const dy = parseInt(btn.getAttribute("data-dy") || "0", 10);

    const fire = () => {
      if (action === "reset" && target === "replaced") {
        onResetReplaced?.();
        return;
      }
      if (action === "clear" && target === "selection") {
        onClearSelection?.();
        return;
      }
      if (dx === 0 && dy === 0) return;
      if (target === "replaced") onNudgeReplaced?.(dx, dy);
      if (target === "selection") onNudgeSelection?.(dx, dy);
    };

    fire();
    holdTimer = setTimeout(() => {
      holdInterval = setInterval(fire, 60);
    }, 250);
  });

  window.addEventListener("mouseup", stopHold);
  window.addEventListener("mouseleave", stopHold);
}
