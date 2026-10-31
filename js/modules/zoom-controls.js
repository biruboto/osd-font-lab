// Auto reports the fitted scale; stepping from Auto starts at that actual scale.
export function createZoomControl({ root, min, max, initial = "auto", onChange }) {
  const auto = root.querySelector(".zoom-auto");
  const decrease = root.querySelector('[data-zoom-step="-1"]');
  const increase = root.querySelector('[data-zoom-step="1"]');
  const output = root.querySelector("output");
  const number = Number(initial);
  let value = Number.isInteger(number) && number >= min && number <= max ? String(number) : "auto";
  let actual = value === "auto" ? min : Number(value);

  function render() {
    const automatic = value === "auto";
    const scale = automatic ? actual : Number(value);
    const text = `${scale}×`;
    if (output.value !== text) output.value = text;
    auto.setAttribute("aria-pressed", String(automatic));
    decrease.disabled = scale <= min;
    increase.disabled = scale >= max;
    root.dataset.zoom = value;
  }

  function setValue(next) {
    if (next === value) return;
    value = next;
    render();
    onChange?.(value);
  }

  auto.addEventListener("click", () => setValue(value === "auto" ? String(actual) : "auto"));
  for (const [button, direction] of [[decrease, -1], [increase, 1]]) {
    button.addEventListener("click", () => {
      const current = value === "auto" ? actual : Number(value);
      setValue(String(Math.max(min, Math.min(max, current + direction))));
    });
  }
  render();

  return {
    get value() { return value; },
    sync(scale) {
      if (!Number.isInteger(Number(scale))) return;
      const next = Math.max(min, Math.min(max, Number(scale)));
      if (next === actual) return;
      actual = next;
      if (value === "auto") render();
    },
  };
}
