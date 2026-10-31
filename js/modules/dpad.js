// js/modules/dpad.js
export function initDpadControls({
  onTargetChange,
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

  function actionFor(btn) {
    if (!btn || btn.disabled) return null;
    const dpad = btn.closest(".dpad");
    const target = dpad?.getAttribute("data-nudge-target");
    if (!target) return null;

    const action = btn.getAttribute("data-action");
    const dx = parseInt(btn.getAttribute("data-dx") || "0", 10);
    const dy = parseInt(btn.getAttribute("data-dy") || "0", 10);

    return () => {
      if (btn.disabled || dpad.getAttribute("data-nudge-target") !== target) {
        stopHold();
        return;
      }
      if (action === "reset" && target === "replaced") {
        onResetReplaced?.();
        return;
      }
      if (action === "reset" && target === "selection") {
        onClearSelection?.();
        return;
      }
      if (dx === 0 && dy === 0) return;
      if (target === "replaced") onNudgeReplaced?.(dx, dy);
      if (target === "selection") onNudgeSelection?.(dx, dy);
    };
  }

  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !e.isPrimary) return;
    const fire = actionFor(e.target.closest(".dpad button"));
    if (!fire) return;
    stopHold();

    fire();
    holdTimer = setTimeout(() => {
      holdInterval = setInterval(fire, 60);
    }, 250);
  });

  // Pointer activation fires on press; keyboard/assistive activation uses click.
  document.addEventListener("click", (e) => {
    const targetButton = e.target.closest("[data-nudge-scope]");
    if (targetButton) {
      stopHold();
      onTargetChange?.(targetButton.getAttribute("data-nudge-scope"));
      return;
    }
    if (e.detail === 0) actionFor(e.target.closest(".dpad button"))?.();
  });
  window.addEventListener("pointerup", stopHold);
  window.addEventListener("pointercancel", stopHold);
  window.addEventListener("mouseleave", stopHold);
  window.addEventListener("blur", stopHold);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopHold();
  });
}
