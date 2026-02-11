// js/app.js
import { decodeMCM, encodeMCM } from "./mcm.js";

/* -----------------------------
   DOM
------------------------------ */
const drop = document.getElementById("drop");
const fileInput = document.getElementById("file");
const loadStatus = document.getElementById("loadStatus");

const themeSelect = document.getElementById("themeSelect");

const compareToggle = document.getElementById("compareToggle");

const bfFontSelect = document.getElementById("bfFontSelect");

const baseGridCanvas = document.getElementById("baseGrid");
const resultGridCanvas = document.getElementById("resultGrid");
const baseGridCtx = baseGridCanvas?.getContext("2d");
const resultGridCtx = resultGridCanvas?.getContext("2d");
if (baseGridCtx) baseGridCtx.imageSmoothingEnabled = false;
if (resultGridCtx) resultGridCtx.imageSmoothingEnabled = false;

const baseZoomCanvas = document.getElementById("baseZoom");
const resultZoomCanvas = document.getElementById("resultZoom");
const baseZoomCtx = baseZoomCanvas?.getContext("2d");
const resultZoomCtx = resultZoomCanvas?.getContext("2d");
if (baseZoomCtx) baseZoomCtx.imageSmoothingEnabled = false;
if (resultZoomCtx) resultZoomCtx.imageSmoothingEnabled = false;

const glyphInfo = document.getElementById("glyphInfo");
const overlaySelect = document.getElementById("overlaySelect");
const swapTargetSelect = document.getElementById("swapTargetSelect");
const swapSourceSelect = document.getElementById("swapSourceSelect");
const clearSwapTargetBtn = document.getElementById("clearSwapTargetBtn");
const clearAllSwapsBtn = document.getElementById("clearAllSwapsBtn");

const replNudgeReadout = document.getElementById("replNudgeReadout");
const selCount = document.getElementById("selCount");

const showGridsEl = document.getElementById("showGrids");
const holdOriginalPreviewBtn = document.getElementById("holdOriginalPreview");

const exportMCMBtn = document.getElementById("exportMCM");
const exportPNGBtn = document.getElementById("exportPNG");

/* -----------------------------
   Constants / State
------------------------------ */

// Replaceable ASCII characters (exact mcmedit list)
const REPLACE_CHARS = ` !"#%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`;
const REPLACE_SET = new Set([...REPLACE_CHARS].map(c => c.charCodeAt(0)));
const isReplaceable = (idx) => REPLACE_SET.has(idx);

const SCALE = 3; // grid sheet scale
const COLS = 16;

let baseFont = null;     // decoded MCM
let resultFont = null;   // base + overlay + nudges
let currentOverlay = null;
let holdOriginalPreview = false;

const SWAP_TARGETS = [
  { id: "rssi", label: "RSSI", indices: [1] },
  { id: "throttle", label: "Throttle", indices: [4] },
  { id: "volts", label: "Volts", indices: [6] },
  { id: "mah", label: "mAh", indices: [7] },
  { id: "amp", label: "A / Amp", indices: [154] },
  { id: "thermometer", label: "Thermometer", indices: [122] },
  { id: "lq", label: "LQ", indices: [123] },
  { id: "on_m", label: "ON m", indices: [155] },
  { id: "fly_m", label: "FLY m", indices: [156] },
  { id: "battery_set", label: "Batteries", indices: [144, 145, 146, 147, 148, 149, 150, 151] },
  { id: "crosshair_set", label: "Crosshairs", indices: [114, 115, 116] },
];

const swapTargetsById = new Map(SWAP_TARGETS.map((t) => [t.id, t]));
const swapSourceCache = new Map(); // sourceId(+target) -> decoded glyph source
const swapSourceRegistry = new Map(); // sourceId -> source descriptor
const swapOverrides = new Map(); // idx -> Uint8Array glyph
let swapTargetPickerApi = null;
let swapSourcePickerApi = null;

let selectedIndex = 0;
let selectedSet = new Set([0]);
let selectionAnchor = 0;

const nudge = {
  replaced: { x: 0, y: 0 },   // global replacement offset
  perGlyph: new Map(),        // idx -> {x,y}
};

// Shared overlay cache (used by dropdown + title banner)
const overlayCache = new Map(); // file -> overlay JSON
let overlayManifest = null;     // cached manifest list [{file,name,id,...}]
let swapCustomManifest = null;  // cached list from fonts/custom.json

// showGrids persisted
let showGrids = (localStorage.getItem("showGrids") ?? "1") === "1";

let loadStatusText = "No file loaded.";
let loadStatusSubtext = "";
let loadStatusError = false;

// Betaflight OSD glyph labels (from Betaflight docs table)
const BF_GLYPH_LABELS = (() => {
  // Named / special symbols from the docs table
  const m = {
    0x01: { names: ["SYM_RSSI"], note: "RSSI Icon" },
    0x02: { names: ["SYM_AH_RIGHT"], note: "" },
    0x03: { names: ["SYM_AH_LEFT", "SYM_CURSOR"], note: "" },
    0x04: { names: ["SYM_THR"], note: "Throttle icon" },
    0x05: { names: ["SYM_OVER_HOME"], note: "" },
    0x06: { names: ["SYM_VOLT"], note: "" },
    0x07: { names: ["SYM_MAH"], note: "" },

    0x08: { names: ["SYM_STICK_OVERLAY_SPRITE_HIGH"], note: "Stick overlay" },
    0x09: { names: ["SYM_STICK_OVERLAY_SPRITE_MID"], note: "Stick overlay" },
    0x0A: { names: ["SYM_STICK_OVERLAY_SPRITE_LOW"], note: "Stick overlay" },
    0x0B: { names: ["SYM_STICK_OVERLAY_CENTER"], note: "Stick overlay" },

    0x0C: { names: ["SYM_M"], note: "" },
    0x0D: { names: ["SYM_F"], note: "Fahrenheit" },
    0x0E: { names: ["SYM_C"], note: "Celsius" },
    0x0F: { names: ["SYM_FT"], note: "" },

    0x10: { names: ["SYM_BBLOG"], note: "Black Box Log" },
    0x11: { names: ["SYM_HOMEFLAG"], note: "" },
    0x12: { names: ["SYM_RPM"], note: "" },
    0x13: { names: ["SYM_AH_DECORATION"], note: "Horizon Sidebars" },
    0x14: { names: ["SYM_ROLL"], note: "" },
    0x15: { names: ["SYM_PITCH"], note: "" },
    0x16: { names: ["SYM_STICK_OVERLAY_VERTICAL"], note: "Stick overlay" },
    0x17: { names: ["SYM_STICK_OVERLAY_HORIZONTAL"], note: "Stick overlay" },

    0x18: { names: ["SYM_HEADING_N"], note: "Compass bar" },
    0x19: { names: ["SYM_HEADING_S"], note: "Compass bar" },
    0x1A: { names: ["SYM_HEADING_E"], note: "Compass bar" },
    0x1B: { names: ["SYM_HEADING_W"], note: "Compass bar" },
    0x1C: { names: ["SYM_HEADING_DIVIDED_LINE"], note: "Compass bar" },
    0x1D: { names: ["SYM_HEADING_LINE"], note: "Compass bar" },
    0x1E: { names: ["SYM_SAT_L"], note: "GPS icon left" },
    0x1F: { names: ["SYM_SAT_R"], note: "GPS icon right" },

    // ASCII section: 0x20..0x5F (32..95) is "ASCII for printing strings"
    // Special callouts inside ASCII block:
    0x2D: { names: ["SYM_HYPHEN"], note: "" },
    0x57: { names: ["SYM_WATT"], note: "Also ASCII 'W'" },

    // Arrows 0x60..0x6F
    0x60: { names: ["SYM_ARROW_SOUTH"], note: "Direction to home, crash flip, etc" },
    0x61: { names: ["SYM_ARROW_2"], note: "Calculated from SYM_ARROW_SOUTH + heading" },
    0x62: { names: ["SYM_ARROW_3"], note: "Calculated from SYM_ARROW_SOUTH + heading" },
    0x63: { names: ["SYM_ARROW_4"], note: "Calculated from SYM_ARROW_SOUTH + heading" },
    0x64: { names: ["SYM_ARROW_EAST"], note: "Calculated from SYM_ARROW_SOUTH + heading" },
    0x65: { names: ["SYM_ARROW_6"], note: "Calculated from SYM_ARROW_SOUTH + heading" },
    0x66: { names: ["SYM_ARROW_7"], note: "Calculated from SYM_ARROW_SOUTH + heading" },
    0x67: { names: ["SYM_ARROW_8"], note: "Calculated from SYM_ARROW_SOUTH + heading" },
    0x68: { names: ["SYM_ARROW_NORTH"], note: "Calculated from SYM_ARROW_SOUTH + heading" },
    0x69: { names: ["SYM_ARROW_10"], note: "Calculated from SYM_ARROW_SOUTH + heading" },
    0x6A: { names: ["SYM_ARROW_11"], note: "Calculated from SYM_ARROW_SOUTH + heading" },
    0x6B: { names: ["SYM_ARROW_12"], note: "Calculated from SYM_ARROW_SOUTH + heading" },
    0x6C: { names: ["SYM_ARROW_WEST"], note: "Calculated from SYM_ARROW_SOUTH + heading" },
    0x6D: { names: ["SYM_ARROW_14"], note: "Calculated from SYM_ARROW_SOUTH + heading" },
    0x6E: { names: ["SYM_ARROW_15"], note: "Calculated from SYM_ARROW_SOUTH + heading" },
    0x6F: { names: ["SYM_ARROW_16"], note: "Calculated from SYM_ARROW_SOUTH + heading" },

    // 0x70..0x9F
    0x70: { names: ["SYM_SPEED"], note: "" },
    0x71: { names: ["SYM_TOTAL_DISTANCE"], note: "" },
    0x72: { names: ["SYM_AH_CENTER_LINE"], note: "Crosshairs" },
    0x73: { names: ["SYM_AH_CENTER"], note: "Crosshairs" },
    0x74: { names: ["SYM_AH_CENTER_LINE_RIGHT"], note: "Crosshairs" },

    0x7A: { names: ["SYM_TEMPERATURE"], note: "" },
    0x7F: { names: ["SYM_ALTITUDE"], note: "" },

    0x80: { names: ["SYM_AH_BAR9_0"], note: "" },
    0x81: { names: ["SYM_AH_BAR9_1"], note: "Calculated in AH using SYM_AH_BAR9_0 as base" },
    0x82: { names: ["SYM_AH_BAR9_2"], note: "Calculated in AH using SYM_AH_BAR9_0 as base" },
    0x83: { names: ["SYM_AH_BAR9_3"], note: "Calculated in AH using SYM_AH_BAR9_0 as base" },
    0x84: { names: ["SYM_AH_BAR9_4"], note: "Calculated in AH using SYM_AH_BAR9_0 as base" },
    0x85: { names: ["SYM_AH_BAR9_5"], note: "Calculated in AH using SYM_AH_BAR9_0 as base" },
    0x86: { names: ["SYM_AH_BAR9_6"], note: "Calculated in AH using SYM_AH_BAR9_0 as base" },
    0x87: { names: ["SYM_AH_BAR9_7"], note: "Calculated in AH using SYM_AH_BAR9_0 as base" },
    0x88: { names: ["SYM_AH_BAR9_8"], note: "Calculated in AH using SYM_AH_BAR9_0 as base" },

    0x89: { names: ["SYM_LAT"], note: "" },
    0x8A: { names: ["SYM_PB_START"], note: "" },
    0x8B: { names: ["SYM_PB_FULL"], note: "" },
    0x8C: { names: ["SYM_PB_HALF"], note: "" },
    0x8D: { names: ["SYM_PB_EMPTY"], note: "" },
    0x8E: { names: ["SYM_PB_END"], note: "" },
    0x8F: { names: ["SYM_PB_CLOSE"], note: "" },

    0x90: { names: ["SYM_BATT_FULL"], note: "Calculated from SYM_BATT_EMPTY" },
    0x91: { names: ["SYM_BATT_5"], note: "Calculated from SYM_BATT_EMPTY" },
    0x92: { names: ["SYM_BATT_4"], note: "Calculated from SYM_BATT_EMPTY" },
    0x93: { names: ["SYM_BATT_3"], note: "Calculated from SYM_BATT_EMPTY" },
    0x94: { names: ["SYM_BATT_2"], note: "Calculated from SYM_BATT_EMPTY" },
    0x95: { names: ["SYM_BATT_1"], note: "Calculated from SYM_BATT_EMPTY" },
    0x96: { names: ["SYM_BATT_EMPTY"], note: "" },

    0x97: { names: ["SYM_MAIN_BATT"], note: "" },
    0x98: { names: ["SYM_LON"], note: "" },
    0x99: { names: ["SYM_FTPS"], note: "ft per second (vario)" },
    0x9A: { names: ["SYM_AMP"], note: "" },
    0x9B: { names: ["SYM_ON_M"], note: "" },
    0x9C: { names: ["SYM_FLY_M"], note: "" },
    0x9D: { names: ["SYM_MPH"], note: "" },
    0x9E: { names: ["SYM_KPH"], note: "" },
    0x9F: { names: ["SYM_MPS"], note: "meters per second (vario)" },

    0xA0: { names: ["LOGO_START"], note: "Logo starts here" },
    0xFF: { names: ["SYM_END_OF_FONT"], note: "" },
  };

  function asciiLabel(idx) {
    // Betaflight doc calls out 0x20..0x5F as ASCII printing section
    if (idx < 0x20 || idx > 0x5F) return null;
    const ch = String.fromCharCode(idx);
    return ch === " " ? "SPACE" : `"${ch}"`;
  }

  function logoLabel(idx) {
    // After 0xA0 "logo starts here" through 0xFE are effectively logo/splash tiles
    if (idx < 0xA0 || idx > 0xFE) return null;
    return `Logo tile ${idx - 0xA0} (0x${idx.toString(16).toUpperCase().padStart(2, "0")})`;
  }

  function labelFor(idx) {
    if (m[idx]) return { kind: "bf", ...m[idx] };

    const a = asciiLabel(idx);
    if (a) return { kind: "ascii", names: ["ASCII"], note: a };

    const l = logoLabel(idx);
    if (l) return { kind: "logo", names: ["LOGO_TILE"], note: l };

    return { kind: "unknown", names: ["(unmapped)"], note: "" };
  }

  return { m, labelFor };
})();

/* -----------------------------
   Small helpers
------------------------------ */
const THEME_KEY = "osdFontLabTheme";

function applyTheme(theme) {
  // Use data-theme on <html>
  if (!theme || theme === "dusk") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

function initTheme() {
  if (!themeSelect) return;

  const saved = localStorage.getItem(THEME_KEY) || "dusk";
  themeSelect.value = saved;
  applyTheme(saved);

  themeSelect.addEventListener("change", () => {
    const t = themeSelect.value;
    localStorage.setItem(THEME_KEY, t);
    applyTheme(t);
    rerenderAll();
    renderLoadStatusVisual();
    window.__redrawBrandTitle?.();
  });
}

function buildFontPicker({
  selectEl,
  getLabel,          // (optionEl) => string
  getValue,          // (optionEl) => string
  getPreviewUrl,     // (value) => string URL to png
  onChange,          // (value) => void
}) {
  if (!selectEl) return;

  if (selectEl.__fontPickerApi) {
    selectEl.__fontPickerApi.rebuild();
    selectEl.__fontPickerApi.refresh();
    return selectEl.__fontPickerApi;
  }

  // Hide native select (keep it for your existing logic + accessibility fallback)
  // Visually hide, but keep it in the DOM (so we can drive it with keyboard logic)
  selectEl.style.position = "absolute";
  selectEl.style.left = "-9999px";
  selectEl.style.width = "1px";
  selectEl.style.height = "1px";
  selectEl.style.opacity = "0";
  selectEl.style.pointerEvents = "none";

  const wrap = document.createElement("div");
  wrap.className = "fontpicker";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "fontpicker-btn";

  const thumb = document.createElement("img");
  thumb.className = "fontpicker-thumb";
  thumb.alt = "";

  const name = document.createElement("span");
  name.className = "fontpicker-name";
  name.textContent = "(none)";

  const caret = document.createElement("span");
  caret.className = "fontpicker-caret";
  caret.textContent = "\u25BE";

  btn.appendChild(thumb);
  btn.appendChild(name);
  btn.appendChild(caret);

  const menu = document.createElement("div");
  menu.className = "fontpicker-menu";

  wrap.appendChild(btn);
  wrap.appendChild(menu);

  // Insert picker right after the select
  selectEl.parentNode.insertBefore(wrap, selectEl.nextSibling);

  const previewReq = new WeakMap(); // img -> request id

  function setPreviewImage(imgEl, value) {
    if (!imgEl) return;
    if (!value) {
      imgEl.removeAttribute("src");
      return;
    }
    const reqId = (previewReq.get(imgEl) || 0) + 1;
    previewReq.set(imgEl, reqId);
    Promise.resolve(getPreviewUrl(value))
      .then((url) => {
        if (previewReq.get(imgEl) !== reqId) return;
        if (url) imgEl.src = url;
        else imgEl.removeAttribute("src");
      })
      .catch(() => {
        if (previewReq.get(imgEl) !== reqId) return;
        imgEl.removeAttribute("src");
      });
  }

  function setButtonFromValue(value) {
    const opt = [...selectEl.options].find(o => o.value === value);
    name.textContent = opt ? getLabel(opt) : "(none)";

    if (!value) {
      // Hide the thumbnail completely for the "(none)" option
      thumb.removeAttribute("src");     // important: avoids broken-image icon
      thumb.style.display = "none";     // or use visibility, see below
      return;
    }

    thumb.style.display = "";          // show again for real options
    setPreviewImage(thumb, value);
  }


  function ensureMenuBuilt() {
    if (menu.childElementCount) return;

    for (const opt of selectEl.options) {
      const value = getValue(opt);
      const label = getLabel(opt);

      const row = document.createElement("div");
      row.className = "fontpicker-item";
      row.setAttribute("data-value", value);

      // Only add the thumbnail if this is a real font option
      if (value) {
        const t = document.createElement("img");
        t.className = "fontpicker-thumb";
        t.alt = "";
        setPreviewImage(t, value);

        row.appendChild(t);
      }

      const n = document.createElement("span");
      n.className = "fontpicker-name";
      n.textContent = label;

      row.appendChild(n);
      menu.appendChild(row);

      row.addEventListener("click", () => {
        selectEl.value = value;
        selectEl.dispatchEvent(new Event("change", { bubbles: true }));
        setButtonFromValue(value);
        onChange?.(value);
        wrap.classList.remove("open");
      });
    }
  }

  function refreshMenuPreviews() {
    for (const row of menu.children) {
      const value = row.getAttribute("data-value") || "";
      const img = row.querySelector(".fontpicker-thumb");
      if (img) setPreviewImage(img, value);
    }
  }

  function rebuildMenu() {
    menu.innerHTML = "";
  }


  function closeOnOutside(e) {
    if (!wrap.contains(e.target)) wrap.classList.remove("open");
  }

  btn.addEventListener("click", async () => {
    ensureMenuBuilt();
    wrap.classList.toggle("open");
    if (wrap.classList.contains("open")) {
      refreshMenuPreviews();
    }
  });

  btn.addEventListener("keydown", (e) => {
    const k = e.key;

    // Open/close like a normal control
    if (k === "Enter" || k === " ") {
      e.preventDefault();
      ensureMenuBuilt();
      wrap.classList.toggle("open");
      if (wrap.classList.contains("open")) {
        refreshMenuPreviews();
      }
      return;
    }

    // Arrow keys: cycle options and preview immediately
    if (k === "ArrowDown" || k === "ArrowUp") {
      e.preventDefault();

      const dir = (k === "ArrowDown") ? 1 : -1;
      const max = selectEl.options.length - 1;

      let i = selectEl.selectedIndex;
      if (i < 0) i = 0;

      i = Math.max(0, Math.min(max, i + dir));
      if (i === selectEl.selectedIndex) return;

      selectEl.selectedIndex = i;
      selectEl.dispatchEvent(new Event("change", { bubbles: true }));

      // Keep the custom button UI synced instantly
      setButtonFromValue(selectEl.value);
      onChange?.(selectEl.value);
      return;
    }

    // Escape closes menu
    if (k === "Escape") {
      wrap.classList.remove("open");
    }
  });

  document.addEventListener("mousedown", closeOnOutside);

  // Keep button in sync if something else changes the select
  selectEl.addEventListener("change", () => setButtonFromValue(selectEl.value));

  // Initialize
  setButtonFromValue(selectEl.value);

  const api = {
    refresh: () => {
      setButtonFromValue(selectEl.value);
    },
    rebuild: () => {
      rebuildMenu();
      setButtonFromValue(selectEl.value);
    },
    close: () => wrap.classList.remove("open"),
  };
  selectEl.__fontPickerApi = api;
  return api;
}

async function handleBuffer(buf, label = "loaded.mcm") {
  try {
    baseFont = decodeMCM(buf);
  } catch (err) {
    console.error("decodeMCM failed for", label, err);
    setLoadStatus(`Failed to load: ${label}`, { error: true });
    throw err;
  }

  setSingleSelection(0);
  rebuildResultFont();
  rerenderAll();

  setLoadStatus(`Loaded: ${label}`, { subtext: `${buf.byteLength} bytes` });
  swapTargetPickerApi?.refresh();
  swapSourcePickerApi?.refresh();
}


function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function clampInt(v, lo, hi) {
  v = parseInt(v, 10);
  if (Number.isNaN(v)) v = 0;
  return Math.max(lo, Math.min(hi, v));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;"
  }[c]));
}

function fitCanvasToCSS(canvas, ctx) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * dpr));
  const h = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return dpr;
}

function pxColorViewer(v) {
  // Viewer-only theming (does NOT affect MCM/PNG export)
  const c0 = cssVar("--osd-0", "transparent");
  const c1 = cssVar("--osd-1", "#808080");
  const c2 = cssVar("--osd-2", "#ffffff");
  const c3 = cssVar("--osd-3", "#000000");

  // Normalize:
  // - Many decoded fonts use 0 as "black/dark" and 1 as "gray bg"
  // - Your overlay pipeline uses 3 as "stroke"
  // We want BOTH to show using the themed dark color.
  if (v === 0) return c3;        // treat 0 as dark (viewer)
  if (v === 1) return c1;        // gray bg
  if (v === 2) return c2;        // white
  if (v === 3) return c3;        // dark stroke
  return c0;
}


function pxColorExportStrict(v) {
  // Strict Betaflight sheet rules
  // 0 = transparent (we skip drawing)
  if (v === 1) return "#808080"; // mid gray
  if (v === 2) return "#FFFFFF"; // pure white
  if (v === 3) return "#000000"; // pure black
  return "#000000";
}

function cloneFont(font) {
  return {
    width: font.width,
    height: font.height,
    format: font.format,
    glyphs: font.glyphs.map(g => new Uint8Array(g)),
  };
}

function drawFontPreviewStrip(font, text = "ABC123") {
  const W = font.width;
  const H = font.height;
  const pad = 1;

  const chars = [...text];
  const cw = W + pad;

  const canvas = document.createElement("canvas");
  canvas.width = chars.length * cw;
  canvas.height = H;

  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  // Do not fill the canvas; leave it transparent.

  chars.forEach((ch, i) => {
    const code = ch.charCodeAt(0);
    const g = font.glyphs[code] || font.glyphs[0];

    const ox = i * cw;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = g[y * W + x];

        // Skip background pixels entirely
        if (v === 1) continue;

        ctx.fillStyle = pxColorViewer(v);
        ctx.fillRect(ox + x, y, 1, 1);
      }
    }
  });

  return canvas.toDataURL("image/png");
}

function drawGlyphPreviewStrip(glyphs, width = 12, height = 18, pad = 1) {
  const list = (glyphs || []).filter(Boolean);
  if (!list.length) return "";

  const canvas = document.createElement("canvas");
  canvas.width = list.length * (width + pad);
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  list.forEach((g, gi) => {
    const ox = gi * (width + pad);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = g[y * width + x];
        if (v === 1) continue;
        ctx.fillStyle = pxColorViewer(v);
        ctx.fillRect(ox + x, y, 1, 1);
      }
    }
  });

  return canvas.toDataURL("image/png");
}

function previewIndicesForTarget(target) {
  if (!target) return [];
  if (target.id === "battery_set") return [144, 150, 151]; // full, empty, main
  if (target.id === "crosshair_set") return [114, 115, 116];
  return target.indices || [];
}

function previewGapForTarget(target) {
  if (!target) return 1;
  if (target.id === "crosshair_set") return 0;
  return 1;
}

function getSwapTargetPreviewUrl(targetId) {
  if (!targetId || !baseFont?.glyphs) return "";
  const target = swapTargetsById.get(targetId);
  if (!target) return "";
  const idxs = previewIndicesForTarget(target);
  const glyphs = idxs.map((idx) => baseFont.glyphs[idx]).filter(Boolean);
  return drawGlyphPreviewStrip(
    glyphs,
    baseFont.width || 12,
    baseFont.height || 18,
    previewGapForTarget(target),
  );
}

async function getSwapSourcePreviewUrl(sourceId) {
  if (!sourceId) return "";
  const targetId = swapTargetSelect?.value || SWAP_TARGETS[0]?.id;
  if (!targetId) return "";
  let sourceFont = null;
  try {
    sourceFont = await getSwapSourceFontForTarget(sourceId, targetId);
  } catch {
    return "";
  }
  const target = swapTargetsById.get(targetId);
  const idxs = previewIndicesForTarget(target);
  const glyphs = idxs.map((idx) => sourceFont?.glyphs?.[idx]).filter(Boolean);
  return drawGlyphPreviewStrip(
    glyphs,
    sourceFont?.width || 12,
    sourceFont?.height || 18,
    previewGapForTarget(target),
  );
}



/* -----------------------------
   Selection helpers
------------------------------ */

function updateSelectionCount() {
  if (selCount) selCount.textContent = `Selected: ${selectedSet.size}`;
}

function setSingleSelection(idx) {
  selectedSet = new Set([idx]);
  selectionAnchor = idx;
  selectedIndex = idx;
}

function toggleSelection(idx) {
  if (selectedSet.has(idx)) selectedSet.delete(idx);
  else selectedSet.add(idx);

  selectedIndex = idx;
  selectionAnchor = idx;

  if (selectedSet.size === 0) selectedSet.add(idx);
}

function rangeSelect(toIdx) {
  const lo = Math.min(selectionAnchor, toIdx);
  const hi = Math.max(selectionAnchor, toIdx);

  selectedSet = new Set();
  for (let i = lo; i <= hi; i++) selectedSet.add(i);

  selectedIndex = toIdx;
}

/* -----------------------------
   Nudges
------------------------------ */

function updateReplReadout() {
  if (replNudgeReadout) replNudgeReadout.textContent = `x ${nudge.replaced.x}, y ${nudge.replaced.y}`;
}

function clearSelectionNudges() {
  for (const idx of selectedSet) nudge.perGlyph.delete(idx);
  rebuildResultFont();
  rerenderAll();
}

function applySwapTargetFromFont(targetId, sourceFont) {
  const target = swapTargetsById.get(targetId);
  if (!target || !sourceFont?.glyphs) return { applied: false, changed: 0, total: 0, focusIndex: null };

  let changed = 0;

  for (const idx of target.indices) {
    const g = sourceFont.glyphs[idx];
    if (!g) continue;
    const prev = resultFont?.glyphs?.[idx];
    let isDifferent = true;
    if (prev && prev.length === g.length) {
      isDifferent = false;
      for (let i = 0; i < g.length; i++) {
        if (prev[i] !== g[i]) {
          isDifferent = true;
          break;
        }
      }
    }
    if (isDifferent) changed++;
    swapOverrides.set(idx, new Uint8Array(g));
  }
  rebuildResultFont();
  rerenderAll();
  return {
    applied: true,
    changed,
    total: target.indices.length,
    focusIndex: target.indices[0] ?? null,
  };
}

function clearSwapTarget(targetId) {
  const target = swapTargetsById.get(targetId);
  if (!target) return;
  for (const idx of target.indices) swapOverrides.delete(idx);
  rebuildResultFont();
  rerenderAll();
}

function clearAllSwaps() {
  swapOverrides.clear();
  rebuildResultFont();
  rerenderAll();
}

function glyphDiffCount(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) d++;
  }
  return d;
}

async function getSwapSourceFont(file) {
  if (!file) return null;
  const source = swapSourceRegistry.get(file);
  if (!source) throw new Error(`Unknown swap source: ${file}`);

  if (source.kind === "bf_mcm") {
    if (swapSourceCache.has(file)) return swapSourceCache.get(file);
    const r = await fetch(`fonts/betaflight/${encodeURIComponent(source.file)}`);
    if (!r.ok) throw new Error(`swap source fetch HTTP ${r.status} for ${source.file}`);
    const buf = await r.arrayBuffer();
    const font = decodeMCM(buf);
    swapSourceCache.set(file, font);
    return font;
  }

  throw new Error(`Unsupported swap source kind: ${source.kind}`);
}

function syncSwapSourceSelect() {
  if (!swapSourceSelect) return;
  const prev = swapSourceSelect.value;
  const targetId = swapTargetSelect?.value || "";
  swapSourceSelect.innerHTML = `<option value="">(choose source)</option>`;

  const entries = [...swapSourceRegistry.values()]
    .filter((entry) => {
      // Betaflight defaults are full-font donors; always valid.
      if (entry.kind === "bf_mcm") return true;

      // Custom sources must explicitly support the selected target.
      if (!targetId) return true;
      return !!entry.targets?.[targetId];
    })
    .sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.label.localeCompare(b.label);
    });

  for (const entry of entries) {
    const opt = document.createElement("option");
    opt.value = entry.id;
    opt.textContent = entry.label;
    swapSourceSelect.appendChild(opt);
  }

  if (prev && swapSourceRegistry.has(prev)) {
    swapSourceSelect.value = prev;
  }
  if (!swapSourceSelect.value) {
    swapSourceSelect.value = "";
  }
  swapSourcePickerApi?.rebuild();
  swapSourcePickerApi?.refresh();
}

function colorToGlyphValue(r, g, b, a) {
  if (a < 16) return 1;

  const drg = Math.abs(r - g);
  const dgb = Math.abs(g - b);
  const drb = Math.abs(r - b);
  const maxDiff = Math.max(drg, dgb, drb);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  if (maxDiff <= 18 && lum >= 92 && lum <= 176) return 1;
  if (lum >= 210) return 2;
  return 3;
}

async function decodePngGlyphStrip(url, glyphCount, {
  glyphWidth = 12,
  glyphHeight = 18,
  gap = 0,
} = {}) {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  await img.decode();

  const expectedW = glyphCount * glyphWidth + Math.max(0, glyphCount - 1) * gap;
  if (img.width < expectedW || img.height < glyphHeight) {
    throw new Error(`PNG too small: ${url} (${img.width}x${img.height}, expected at least ${expectedW}x${glyphHeight})`);
  }

  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0);

  const glyphs = [];
  for (let gi = 0; gi < glyphCount; gi++) {
    const sx = gi * (glyphWidth + gap);
    const data = ctx.getImageData(sx, 0, glyphWidth, glyphHeight).data;
    const out = new Uint8Array(glyphWidth * glyphHeight);
    for (let i = 0, p = 0; i < out.length; i++, p += 4) {
      out[i] = colorToGlyphValue(data[p], data[p + 1], data[p + 2], data[p + 3]);
    }
    glyphs.push(out);
  }
  return glyphs;
}

async function getSwapSourceFontForTarget(sourceId, targetId) {
  const target = swapTargetsById.get(targetId);
  if (!target) throw new Error(`Unknown swap target: ${targetId}`);
  const source = swapSourceRegistry.get(sourceId);
  if (!source) throw new Error(`Unknown swap source: ${sourceId}`);

  if (source.kind === "bf_mcm") {
    return getSwapSourceFont(sourceId);
  }

  if (source.kind === "custom_png") {
    const customTarget = source.targets?.[targetId];
    if (!customTarget?.png) {
      throw new Error(`Custom source '${source.label}' has no PNG for target '${targetId}'`);
    }

    const cacheKey = `${sourceId}::${targetId}`;
    if (swapSourceCache.has(cacheKey)) return swapSourceCache.get(cacheKey);

    const glyphsFromPng = await decodePngGlyphStrip(
      customTarget.png,
      target.indices.length,
      {
        glyphWidth: customTarget.glyphWidth ?? source.glyphWidth ?? 12,
        glyphHeight: customTarget.glyphHeight ?? source.glyphHeight ?? 18,
        gap: customTarget.gap ?? source.gap ?? 0,
      },
    );

    const glyphs = new Array(256);
    for (let i = 0; i < target.indices.length; i++) {
      glyphs[target.indices[i]] = glyphsFromPng[i];
    }
    const font = {
      width: source.glyphWidth ?? 12,
      height: source.glyphHeight ?? 18,
      format: "custom_png",
      glyphs,
    };
    swapSourceCache.set(cacheKey, font);
    return font;
  }

  throw new Error(`Unsupported swap source kind: ${source.kind}`);
}

function initSwapUI() {
  if (swapTargetSelect) {
    swapTargetSelect.innerHTML = `<option value="">(choose target)</option>`;
    for (const target of SWAP_TARGETS) {
      const opt = document.createElement("option");
      opt.value = target.id;
      opt.textContent = target.label;
      swapTargetSelect.appendChild(opt);
    }
  }

  swapTargetPickerApi = buildFontPicker({
    selectEl: swapTargetSelect,
    getLabel: (opt) => opt.textContent,
    getValue: (opt) => opt.value,
    getPreviewUrl: (value) => getSwapTargetPreviewUrl(value),
  });

  swapSourcePickerApi = buildFontPicker({
    selectEl: swapSourceSelect,
    getLabel: (opt) => opt.textContent,
    getValue: (opt) => opt.value,
    getPreviewUrl: (value) => getSwapSourcePreviewUrl(value),
  });

  const selectTargetInGrid = (targetId) => {
    const target = swapTargetsById.get(targetId);
    if (!target || !Array.isArray(target.indices) || target.indices.length === 0) return;

    selectedSet = new Set(target.indices);
    selectionAnchor = target.indices[0];
    selectedIndex = target.indices[0];
    rerenderAll();
  };

  const applySwapSelection = async ({ silentIncomplete = false } = {}) => {
    const targetId = swapTargetSelect?.value;
    const sourceId = swapSourceSelect?.value;

    if (!baseFont) {
      if (!silentIncomplete) setLoadStatus("Load a base font first.", { error: true });
      return;
    }

    if (!targetId || !sourceId) {
      if (!silentIncomplete) setLoadStatus("Select swap target + source first.");
      return;
    }

    try {
      // Ensure result view is active while applying swaps.
      holdOriginalPreview = false;
      holdOriginalPreviewBtn?.classList.remove("is-holding");

      const sourceMeta = swapSourceRegistry.get(sourceId);
      const sourceLabel = sourceMeta?.label || sourceId;
      const sourceFont = await getSwapSourceFontForTarget(sourceId, targetId);
      const beforeGlyph = (() => {
        const target = swapTargetsById.get(targetId);
        const idx = target?.indices?.[0];
        return idx == null ? null : resultFont?.glyphs?.[idx];
      })();
      const out = applySwapTargetFromFont(targetId, sourceFont);
      if (!out.applied) {
        setLoadStatus("Swap did not apply.", { error: true });
        return;
      }
      if (out.focusIndex != null) {
        selectedIndex = out.focusIndex;
        rerenderAll();
      }
      if (out.changed === 0) {
        setLoadStatus(`No visible change for ${targetId}; source matches current glyph(s).`);
      } else {
        setLoadStatus(`Applied swap: ${targetId} from ${sourceLabel} (${out.changed}/${out.total} changed)`);
      }
    } catch (err) {
      console.error("Swap apply failed", err);
      setLoadStatus(`Swap failed: ${sourceId}`, { error: true });
    }
  };

  swapTargetSelect?.addEventListener("change", () => {
    selectTargetInGrid(swapTargetSelect.value);
    syncSwapSourceSelect();
    applySwapSelection({ silentIncomplete: true });
  });

  swapSourceSelect?.addEventListener("change", () => {
    applySwapSelection({ silentIncomplete: true });
  });

  // Initialize visual target selection from the default dropdown value.
  if (swapTargetSelect?.value) {
    selectTargetInGrid(swapTargetSelect.value);
  }

  clearSwapTargetBtn?.addEventListener("click", () => {
    holdOriginalPreview = false;
    holdOriginalPreviewBtn?.classList.remove("is-holding");

    const targetId = swapTargetSelect?.value;
    if (!targetId) return;
    clearSwapTarget(targetId);
    setLoadStatus(`Cleared swap: ${targetId}`);
  });

  clearAllSwapsBtn?.addEventListener("click", () => {
    holdOriginalPreview = false;
    holdOriginalPreviewBtn?.classList.remove("is-holding");

    clearAllSwaps();
    setLoadStatus("Cleared all swaps.");
  });
}

function applyReplacedNudge(dx, dy) {
  nudge.replaced.x = clampInt(nudge.replaced.x + dx, -6, 6);
  nudge.replaced.y = clampInt(nudge.replaced.y + dy, -6, 6);
  updateReplReadout();
  rebuildResultFont();
  rerenderAll();
}

function applySelectionNudge(dx, dy) {
  for (const idx of selectedSet) {
    const cur = nudge.perGlyph.get(idx) || { x: 0, y: 0 };
    nudge.perGlyph.set(idx, {
      x: clampInt(cur.x + dx, -6, 6),
      y: clampInt(cur.y + dy, -6, 6),
    });
  }
  rebuildResultFont();
  rerenderAll();
}

// D-pad click/hold repeat
// D-pad click/hold repeat
function initDpads() {
  // Global guard (prevents double-binding even if init() runs twice)
  if (window.__dpadsBound) return;
  window.__dpadsBound = true;

  let holdTimer = null;
  let holdInterval = null;

  function stopHold() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (holdInterval) { clearInterval(holdInterval); holdInterval = null; }
  }

  // Bind ONE handler via event delegation (covers both dpads)
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
        nudge.replaced.x = 0; nudge.replaced.y = 0;
        updateReplReadout();
        rebuildResultFont(); rerenderAll();
        return;
      }
      if (action === "clear" && target === "selection") {
        clearSelectionNudges();
        return;
      }
      if (dx === 0 && dy === 0) return;

      if (target === "replaced") applyReplacedNudge(dx, dy);
      if (target === "selection") applySelectionNudge(dx, dy);
    };

    fire();
    holdTimer = setTimeout(() => {
      holdInterval = setInterval(fire, 60);
    }, 250);
  });

  window.addEventListener("mouseup", stopHold);
  window.addEventListener("mouseleave", stopHold);
}

/* -----------------------------
   Glyph shifting (for per-glyph nudges)
------------------------------ */

function shiftGlyphPixels(glyph, w, h, dx, dy) {
  dx = dx | 0;
  dy = dy | 0;
  if (dx === 0 && dy === 0) return glyph;

  // IMPORTANT: always fill exposed pixels with transparent gray background (1)
  const fill = 1;
  const out = new Uint8Array(w * h);
  out.fill(fill);

  for (let y = 0; y < h; y++) {
    const ny = y + dy;
    if (ny < 0 || ny >= h) continue;

    for (let x = 0; x < w; x++) {
      const nx = x + dx;
      if (nx < 0 || nx >= w) continue;

      out[ny * w + nx] = glyph[y * w + x];
    }
  }

  return out;
}

/* -----------------------------
   Overlay rendering
------------------------------ */

function applyStroke4(cell, w, h) {
  const out = new Uint8Array(cell);
  const idx = (x, y) => y * w + x;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (cell[idx(x, y)] !== 2) continue;

      const neighbors = [
        [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
      ];

      for (const [nx, ny] of neighbors) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = idx(nx, ny);
        if (out[n] === 1) out[n] = 3;
      }
    }
  }

  return out;
}

// Overlay glyph JSON -> 12x18 cell
function renderOverlayToCell(overlayGlyph, targetIdx) {
  const cellW = 12, cellH = 18;
  const out = new Uint8Array(cellW * cellH);
  out.fill(1);

  const [w, h] = overlayGlyph.size;
  const [baseX, baseY] = overlayGlyph.offset;

  const globalX = nudge.replaced.x;
  const globalY = nudge.replaced.y;
  const xoff = baseX + globalX;
  const yoff = baseY + globalY;

  for (let y = 0; y < h; y++) {
    const row = overlayGlyph.rows[y] >>> 0;
    for (let x = 0; x < w; x++) {
      const bit = 1 << (w - 1 - x);
      if (row & bit) {
        const cx = xoff + x;
        const cy = yoff + y;
        if (cx >= 0 && cx < cellW && cy >= 0 && cy < cellH) {
          out[cy * cellW + cx] = 2;
        }
      }
    }
  }

  return applyStroke4(out, cellW, cellH);
}

/* -----------------------------
   Rebuild result font
------------------------------ */

function rebuildResultFont() {
  if (!baseFont) return;

  resultFont = cloneFont(baseFont);

  if (currentOverlay) {
    for (let i = 0; i < 256; i++) {
      if (!isReplaceable(i)) continue;

      const key = `U+${i.toString(16).padStart(4, "0").toUpperCase()}`;
      const og = currentOverlay.glyphs?.[key];
      if (!og) continue;

      resultFont.glyphs[i] = renderOverlayToCell(og, i);
    }
  }

  // Apply explicit swap overrides (single glyphs / sets).
  for (const [idx, glyph] of swapOverrides.entries()) {
    if (idx < 0 || idx > 255) continue;
    resultFont.glyphs[idx] = new Uint8Array(glyph);
  }

  // Apply per-glyph nudges as pixel shifts to ANY glyph (icons included)
  const w = resultFont.width;
  const h = resultFont.height;

  for (const [idx, off] of nudge.perGlyph.entries()) {
    if (idx < 0 || idx > 255) continue;
    const dx = off?.x ?? 0;
    const dy = off?.y ?? 0;
    if (dx === 0 && dy === 0) continue;

    resultFont.glyphs[idx] = shiftGlyphPixels(resultFont.glyphs[idx], w, h, dx, dy);
  }
}

/* load and cache the decoded font for each betaflight file */

const bfPreviewFontCache = new Map(); // file -> decoded font

async function getBetaflightPreviewUrl(file) {
  // file is like "betaflight.mcm"
  let font = bfPreviewFontCache.get(file);
  if (!font) {
    const r = await fetch(`./fonts/betaflight/${encodeURIComponent(file)}`);
    if (!r.ok) throw new Error(`preview fetch HTTP ${r.status} for ${file}`);
    const buf = await r.arrayBuffer();
    font = decodeMCM(buf);
    bfPreviewFontCache.set(file, font);
  }
  return drawFontPreviewStrip(font);
}

function renderOverlayPreviewCell(overlay, ch) {
  const cellW = 12, cellH = 18;
  const out = new Uint8Array(cellW * cellH);
  out.fill(1); // background (ignored later)

  if (!overlay || ch === " ") return out;

  const code = ch.charCodeAt(0);
  const key = `U+${code.toString(16).padStart(4, "0").toUpperCase()}`;
  const og = overlay.glyphs?.[key];
  if (!og) return out;

  const [w, h] = og.size;
  const [offX, offY] = og.offset;

  // draw fill (value 2)
  for (let y = 0; y < h; y++) {
    const row = og.rows[y] >>> 0;
    for (let x = 0; x < w; x++) {
      const bit = 1 << (w - 1 - x);
      if (row & bit) {
        const cx = offX + x;
        const cy = offY + y;
        if (cx >= 0 && cx < cellW && cy >= 0 && cy < cellH) {
          out[cy * cellW + cx] = 2;
        }
      }
    }
  }

  // APPLY THE SAME STROKE AS THE REAL PIPELINE
  return applyStroke4(out, cellW, cellH);
}

function measureCellInkBounds(cell, cellW, cellH) {
  let minX = cellW;
  let maxX = -1;
  for (let y = 0; y < cellH; y++) {
    for (let x = 0; x < cellW; x++) {
      const v = cell[y * cellW + x];
      if (v === 1) continue; // background
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }

  if (maxX < minX) return null; // no ink
  return { minX, maxX, width: maxX - minX + 1 };
}

function drawOverlayPreviewStrip(overlay, text = "ABC123") {
  const cellW = 12, cellH = 18;
  const gap = 2;
  const chars = [...text];

  const cells = chars.map((ch) => renderOverlayPreviewCell(overlay, ch));
  const widths = cells.map((cell, i) => {
    const ch = chars[i];
    const bounds = measureCellInkBounds(cell, cellW, cellH);
    if (bounds) return bounds.width;
    if (ch === " ") return 4;
    return 2;
  });

  const totalWidth =
    widths.reduce((sum, w) => sum + w, 0) + Math.max(0, widths.length - 1) * gap;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, totalWidth);
  canvas.height = cellH;

  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  // transparent background

  let penX = 0;
  chars.forEach((ch, i) => {
    const cell = cells[i];
    const bounds = measureCellInkBounds(cell, cellW, cellH);
    const drawWidth = widths[i];
    const srcX = bounds ? bounds.minX : 0;

    for (let y = 0; y < cellH; y++) {
      for (let x = 0; x < drawWidth; x++) {
        const sx = srcX + x;
        if (sx < 0 || sx >= cellW) continue;
        const vv = cell[y * cellW + sx];

        // skip background
        if (vv === 1) continue;

        ctx.fillStyle = pxColorViewer(vv); // 2 = white, 3 = black stroke
        ctx.fillRect(penX + x, y, 1, 1);
      }
    }

    penX += drawWidth + (i < chars.length - 1 ? gap : 0);
  });

  return canvas.toDataURL("image/png");
}

function renderLoadStatusVisual() {
  if (!loadStatus) return;
  const text = loadStatusText;
  const subtext = loadStatusSubtext;
  const error = loadStatusError;
  loadStatus.classList.toggle("is-error", error);
  loadStatus.textContent = subtext ? `${text} (${subtext})` : text;
}

function setLoadStatus(text, { error = false, subtext = "" } = {}) {
  loadStatusText = String(text ?? "");
  loadStatusSubtext = String(subtext ?? "");
  loadStatusError = !!error;
  renderLoadStatusVisual();
}

async function getOverlayPreviewUrl(file) {
  // file is overlaySelect.value, loaded via your existing cache
  if (!file) return "";
  const overlay = await getOverlayByFile(file);
  return drawOverlayPreviewStrip(overlay);
}


/* -----------------------------
   Rendering: grid + zoom
------------------------------ */

function drawCellGridOverlay(ctx, font) {
  const cellW = font.width * SCALE;
  const cellH = font.height * SCALE;

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;

  for (let c = 0; c <= COLS; c++) {
    const x = c * cellW + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ctx.canvas.height);
    ctx.stroke();
  }

  for (let r = 0; r <= 16; r++) {
    const y = r * cellH + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(ctx.canvas.width, y);
    ctx.stroke();
  }

  ctx.restore();
}

function renderPlaceholderGrid(ctx, canvas, width = 12, height = 18) {
  const rows = Math.ceil(256 / COLS);
  canvas.width = COLS * width * SCALE;
  canvas.height = rows * height * SCALE;

  const matte = cssVar("--osd-matte", "#1f232b");
  ctx.fillStyle = matte;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (showGrids) {
    drawCellGridOverlay(ctx, { width, height });
  }
}

function renderGrid(ctx, canvas, font) {
  const { glyphs, width, height } = font;
  const rows = Math.ceil(glyphs.length / COLS);

  canvas.width = COLS * width * SCALE;
  canvas.height = rows * height * SCALE;

  const matte = cssVar("--osd-matte", "#1f232b");
  ctx.fillStyle = matte;
  ctx.fillRect(0, 0, canvas.width, canvas.height);


  glyphs.forEach((glyph, i) => {
    const gx = i % COLS;
    const gy = Math.floor(i / COLS);
    const ox = gx * width * SCALE;
    const oy = gy * height * SCALE;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = glyph[y * width + x];
        ctx.fillStyle = pxColorViewer(v);
        ctx.fillRect(ox + x * SCALE, oy + y * SCALE, SCALE, SCALE);
      }
    }
  });

  if (showGrids) drawCellGridOverlay(ctx, font);

  // selection boxes
  ctx.save();
  ctx.strokeStyle = getComputedStyle(document.documentElement)
  .getPropertyValue('--accent-0');
  ctx.lineWidth = 1;
  for (const idx of selectedSet) {
    const sgx = idx % COLS;
    const sgy = Math.floor(idx / COLS);
    const sx = sgx * font.width * SCALE;
    const sy = sgy * font.height * SCALE;
    ctx.strokeRect(sx + 0.5, sy + 0.5, font.width * SCALE - 1, font.height * SCALE - 1);
  }
  ctx.restore();
}

function drawZoomPixelGrid(ctx, cellW, cellH, scale, ox, oy) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;

  for (let x = 0; x <= cellW; x++) {
    const xx = ox + x * scale + 0.5;
    ctx.beginPath();
    ctx.moveTo(xx, oy);
    ctx.lineTo(xx, oy + cellH * scale);
    ctx.stroke();
  }

  for (let y = 0; y <= cellH; y++) {
    const yy = oy + y * scale + 0.5;
    ctx.beginPath();
    ctx.moveTo(ox, yy);
    ctx.lineTo(ox + cellW * scale, yy);
    ctx.stroke();
  }

  ctx.restore();
}

function snapZoomCanvasToIntegerScale(canvas, font) {
  if (!canvas || !font) return;
  const rect = canvas.getBoundingClientRect();
  const targetW = Math.max(1, Math.floor(rect.width));
  const cssScale = Math.max(1, Math.floor(targetW / font.width));
  canvas.style.width = `${cssScale * font.width}px`;
  canvas.style.height = `${cssScale * font.height}px`;
}

function renderZoom(ctx, canvas, font, index) {
  snapZoomCanvasToIntegerScale(canvas, font);
  fitCanvasToCSS(canvas, ctx);

  const { glyphs, width, height } = font;
  const glyph = glyphs[index];

  // Fill the whole zoom surface with your themed canvas background (NOT black)
  const matte = cssVar("--osd-matte", "#1f232b");
  ctx.fillStyle = matte;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const scale = Math.max(1, Math.floor(Math.min(canvas.width / width, canvas.height / height)));
  const ox = Math.floor((canvas.width - width * scale) / 2);
  const oy = Math.floor((canvas.height - height * scale) / 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = glyph[y * width + x];
      ctx.fillStyle = pxColorViewer(v);
      ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
    }
  }

  if (showGrids) drawZoomPixelGrid(ctx, width, height, scale, ox, oy);
}

function formatAscii(index) {
  if (!isReplaceable(index)) return null;
  const ch = String.fromCharCode(index);
  const printable = (ch === " ")
    ? "SPACE"
        : `"${escapeHtml(ch)}"`;
  return printable;
}

function formatBetaflight(index) {
  const info = BF_GLYPH_LABELS.labelFor(index);

  // info = { kind, names, note } per your labelFor()
  const names = info.names?.length ? info.names.join(" / ") : "Unnamed";
  const note = info.note ? ` <span style="opacity:.7">(${escapeHtml(info.note)})</span>` : "";

  // For ASCII entries returned by labelFor(), info.note already contains SPACE / "A" etc.
  // For logo tiles, info.note contains the tile description.
  return `${escapeHtml(names)}${note}`;
}

function updateInfoPanel(index) {
  if (!glyphInfo) return;

  const hex = "0x" + index.toString(16).padStart(2, "0").toUpperCase();

  // Decide what to show under the index
  let labelTitle;
  let labelValue;

  const ascii = formatAscii(index); // returns null unless replaceable
  if (ascii) {
    labelTitle = "ASCII";
    labelValue = ascii;
  } else {
    labelTitle = "Betaflight";
    labelValue = formatBetaflight(index);
  }

  glyphInfo.innerHTML = `
    <div><b>Index:</b> ${hex} <span style="opacity:.7">(${index})</span></div>
    <div><b>${labelTitle}:</b> ${labelValue}</div>
  `;
}

function rerenderAll() {
  if (!baseFont || !resultFont) return;
  const displayFont = holdOriginalPreview ? baseFont : resultFont;

  // Only render base panel when compare is enabled
  if (compareMode) {
    renderGrid(baseGridCtx, baseGridCanvas, baseFont);
    if (baseZoomCtx && baseZoomCanvas) {
      renderZoom(baseZoomCtx, baseZoomCanvas, baseFont, selectedIndex);
    }
  }

  renderGrid(resultGridCtx, resultGridCanvas, displayFont);
  renderZoom(resultZoomCtx, resultZoomCanvas, displayFont, selectedIndex);

  updateInfoPanel(selectedIndex);
  updateSelectionCount();
}

/* -----------------------------
   Grid click handling
------------------------------ */

function gridClickToIndex(e, canvas, font) {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  const x = (e.clientX - rect.left) * sx;
  const y = (e.clientY - rect.top) * sy;

  const cellW = font.width * SCALE;
  const cellH = font.height * SCALE;

  const gx = Math.floor(x / cellW);
  const gy = Math.floor(y / cellH);

  const idx = gy * COLS + gx;
  if (idx < 0 || idx >= 256) return null;
  return idx;
}

function handleGridClick(e, canvas, font) {
  const idx = gridClickToIndex(e, canvas, font);
  if (idx == null) return;

  if (e.shiftKey) rangeSelect(idx);
  else if (e.ctrlKey || e.metaKey) toggleSelection(idx);
  else setSingleSelection(idx);

  rerenderAll();
}

/* -----------------------------
   Export helpers
------------------------------ */

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderFontToSheetCanvas(font, scale = 3) {
  const W = font.width;
  const H = font.height;
  const cols = 16, rows = 16;

  const canvas = document.createElement("canvas");
  canvas.width  = cols * W * scale;
  canvas.height = rows * H * scale;

  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  // STRICT export palette
  const GRAY  = "#808080";
  const WHITE = "#ffffff";
  const BLACK = "#000000";

  // Always start gray so the PNG is readable
  ctx.fillStyle = GRAY;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 256; i++) {
    const g = font.glyphs[i];
    const gx = i % cols;
    const gy = Math.floor(i / cols);
    const ox = gx * W * scale;
    const oy = gy * H * scale;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = g[y * W + x];

        // In PNG export:
        // 1 = gray background (already filled)
        // 2 = white
        // 0 or 3 = black (some fonts use 0 for black stroke)
        if (v === 1) continue;

        if (v === 2) ctx.fillStyle = WHITE;
        else if (v === 0 || v === 3) ctx.fillStyle = BLACK;
        else continue;

        ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
      }
    }
  }

  return canvas;
}

function safeBaseName() {
  const overlayName = overlaySelect?.value
    ? overlaySelect.value.replace(/[^a-z0-9._-]+/gi, "_")
    : "no-overlay";
  return `osd_font_lab_${overlayName}`;
}

/* -----------------------------
   Overlay manifest + loading
------------------------------ */

async function loadManifest() {
  if (overlayManifest) return overlayManifest;
  const res = await fetch("fonts/manifest.json");
  if (!res.ok) throw new Error(`manifest.json HTTP ${res.status}`);
  const list = await res.json();
  if (!Array.isArray(list)) throw new Error("manifest.json did not return an array");
  overlayManifest = list;
  return list;
}

async function getOverlayByFile(file) {
  if (overlayCache.has(file)) return overlayCache.get(file);
  const r = await fetch(`fonts/data/${encodeURIComponent(file)}`);
  if (!r.ok) throw new Error(`overlay fetch HTTP ${r.status} for ${file}`);
  const j = await r.json();
  overlayCache.set(file, j);
  return j;
}

async function loadOverlayIndex() {
  if (!overlaySelect) return;

  let list;
  try {
    list = await loadManifest();
  } catch (err) {
    console.error("Failed to load fonts/manifest.json", err);
    overlaySelect.innerHTML = `<option value="">(manifest missing)</option>`;
    return;
  }

  overlaySelect.innerHTML = `<option value="">(none)</option>`;
  for (const entry of list) {
    const opt = document.createElement("option");
    opt.value = entry.file;
    opt.textContent = entry.name;

    if (entry.thumb) opt.dataset.thumb = entry.thumb;
    overlaySelect.appendChild(opt);
  }


  buildFontPicker({
    selectEl: overlaySelect,
    getLabel: (opt) => opt.textContent,
    getValue: (opt) => opt.value,
    getPreviewUrl: (value) => getThumbForValue(overlaySelect, value),
  });

  renderLoadStatusVisual();

  overlaySelect.addEventListener("change", async () => {
    const file = overlaySelect.value;

    if (!file) {
      currentOverlay = null;
      rebuildResultFont();
      rerenderAll();
      return;
    }

    try {
      currentOverlay = await getOverlayByFile(file);
    } catch (err) {
      console.error("Failed to load overlay font:", file, err);
      currentOverlay = null;
    }

    rebuildResultFont();
    rerenderAll();
    renderLoadStatusVisual();
  });
}

/* -----------------------------
   Fun top-right title banner
------------------------------ */

const brandEl = document.getElementById("brandTitle");
const BRAND_TEXT = "OSD Font Lab";

function drawOverlayGlyphToTinyCanvas(ctx, overlay, ch, ink) {
  const cellW = 12, cellH = 18;
  ctx.clearRect(0, 0, cellW, cellH);

  if (ch === " ") return;

  const code = ch.charCodeAt(0);
  const key = `U+${code.toString(16).padStart(4, "0").toUpperCase()}`;
  const og = overlay?.glyphs?.[key];
  if (!og) return;

  const [w, h] = og.size;
  const [offX, offY] = og.offset;

  ctx.fillStyle = ink;

  for (let y = 0; y < h; y++) {
    const row = og.rows[y] >>> 0;
    for (let x = 0; x < w; x++) {
      const bit = 1 << (w - 1 - x);
      if (row & bit) {
        const px = offX + x;
        const py = offY + y;
        if (px >= 0 && px < cellW && py >= 0 && py < cellH) {
          ctx.fillRect(px, py, 1, 1);
        }
      }
    }
  }
}

async function initBrandTitle() {
  if (!brandEl) return;

  let list;
  try {
    list = await loadManifest();
  } catch (err) {
    console.warn("Brand title: no manifest, falling back to text.", err);
    brandEl.textContent = BRAND_TEXT;
    return;
  }

  if (!Array.isArray(list) || list.length === 0) {
    brandEl.textContent = BRAND_TEXT;
    return;
  }

  const chars = [...BRAND_TEXT];
  brandEl.innerHTML = "";

  const getBrandInk = () => cssVar("--brand-ink", cssVar("--accent-0", "#ffffff"));

  // pick random font per non-space char
  const picks = chars.map(ch => {
    if (ch === " ") return null;
    const entry = list[(Math.random() * list.length) | 0];
    return entry.file;
  });

  // load unique overlays used initially
  const unique = [...new Set(picks.filter(Boolean))];
  const overlays = new Map();
  try {
    await Promise.all(
      unique.map(async (file) => overlays.set(file, await getOverlayByFile(file)))
    );
  } catch (err) {
    console.warn("Brand title: failed loading overlays, falling back to text.", err);
    brandEl.textContent = BRAND_TEXT;
    return;
  }

  // build per-char canvases
  const items = [];

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];

    if (ch === " ") {
      const spacer = document.createElement("span");
      spacer.style.width = "10px";
      spacer.style.display = "inline-block";
      brandEl.appendChild(spacer);
      continue;
    }

    const c = document.createElement("canvas");
    c.width = 12;
    c.height = 18;
    c.style.imageRendering = "pixelated";

    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    const file = picks[i];
    const overlay = overlays.get(file);

    const item = {
      el: c,
      ctx,
      ch,
      file,
      overlay,
      phase: i * 0.55,
    };

    drawOverlayGlyphToTinyCanvas(item.ctx, item.overlay, item.ch, getBrandInk());

    items.push(item);
    brandEl.appendChild(c);
  }

  // redraw ONCE, after items exists
  window.__redrawBrandTitle = () => {
    const ink = getBrandInk();
    for (const it of items) {
      drawOverlayGlyphToTinyCanvas(it.ctx, it.overlay, it.ch, ink);
    }
  };

  // Timed full-title glitch reroll
  let rerollBusy = false;
  const GLITCH_MIN_MS = 15000;
  const GLITCH_MAX_MS = 20000;
  const GLITCH_DURATION_MS = 900;
  const nextGlitchDelay = () =>
    GLITCH_MIN_MS + Math.floor(Math.random() * (GLITCH_MAX_MS - GLITCH_MIN_MS + 1));
  let nextGlitchAt = performance.now() + nextGlitchDelay();
  let glitchState = null; // { end, picks, overlays }

  async function beginGlitchReroll() {
    if (rerollBusy || glitchState || items.length === 0) return;
    rerollBusy = true;

    try {
      const picks = items.map(() => list[(Math.random() * list.length) | 0]?.file).filter(Boolean);
      const overlays = await Promise.all(picks.map((file) => getOverlayByFile(file)));
      const now = performance.now();
      glitchState = {
        end: now + GLITCH_DURATION_MS,
        picks,
        overlays,
      };
    } catch (err) {
      console.warn("Brand title glitch reroll failed:", err);
    } finally {
      rerollBusy = false;
    }
  }

  // Sine animation
  const amp = 4;
  const speed = 1.8;
  const t0 = performance.now();

  function tick(now) {
    const t = (now - t0) / 1000;
    const glitchActive = !!glitchState && now < glitchState.end;
    const ink = getBrandInk();

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const y = Math.sin(t * speed + it.phase) * amp;

      if (glitchActive) {
        // Flicker + jitter + temporary overlay swaps for a "static" glitch effect.
        const jx = (Math.random() * 3 - 1.5);
        const jy = (Math.random() * 4 - 2);
        it.el.style.transform = `translate(${jx.toFixed(2)}px, ${(y + jy).toFixed(2)}px)`;
        it.el.style.opacity = (0.55 + Math.random() * 0.45).toFixed(2);
        it.el.style.filter = `contrast(${(125 + Math.random() * 120).toFixed(0)}%) brightness(${(85 + Math.random() * 50).toFixed(0)}%)`;

        const flickerOverlay = (Math.random() < 0.5)
          ? it.overlay
          : glitchState.overlays[i];
        drawOverlayGlyphToTinyCanvas(it.ctx, flickerOverlay, it.ch, ink);
      } else {
        it.el.style.transform = `translateY(${y.toFixed(2)}px)`;
        it.el.style.opacity = "1";
        it.el.style.filter = "none";
      }
    }

    if (glitchState && now >= glitchState.end) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        it.file = glitchState.picks[i];
        it.overlay = glitchState.overlays[i];
        drawOverlayGlyphToTinyCanvas(it.ctx, it.overlay, it.ch, ink);
      }
      glitchState = null;
    }

    if (!rerollBusy && !glitchState && now >= nextGlitchAt) {
      beginGlitchReroll();
      nextGlitchAt = now + nextGlitchDelay();
    }

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}


/* -----------------------------
   File loading + events
------------------------------ */

function getThumbForValue(selectEl, value) {
  if (!selectEl || !value) return "";
  const opt = [...selectEl.options].find(o => o.value === value);
  const rel = opt?.dataset?.thumb;
  return rel ? `./fonts/${rel}` : "";
}

async function handleFile(file) {
  const buf = await file.arrayBuffer();
  await handleBuffer(buf, file.name);
}

async function loadSwapCustomManifest() {
  if (swapCustomManifest) return swapCustomManifest;
  try {
    const res = await fetch("fonts/custom.json");
    if (res.status === 404) {
      swapCustomManifest = [];
      return swapCustomManifest;
    }
    if (!res.ok) throw new Error(`custom.json HTTP ${res.status}`);
    const list = await res.json();
    if (!Array.isArray(list)) throw new Error("custom.json did not return an array");
    swapCustomManifest = list;
    return list;
  } catch (err) {
    console.warn("Failed to load custom.json; continuing with default MCM sources only.", err);
    swapCustomManifest = [];
    return swapCustomManifest;
  }
}

function registerBetaflightSwapSources(list) {
  for (const entry of list) {
    const id = `bf:${entry.file}`;
    swapSourceRegistry.set(id, {
      id,
      kind: "bf_mcm",
      file: entry.file,
      label: `BF ${entry.name}`,
    });
  }
}

function resolveCustomAssetPath(pathLike) {
  if (!pathLike || typeof pathLike !== "string") return "";
  if (/^(?:https?:)?\/\//i.test(pathLike) || pathLike.startsWith("/") || pathLike.startsWith("./") || pathLike.startsWith("../")) {
    return pathLike;
  }
  return `fonts/${pathLike}`;
}

function registerCustomSwapSources(list) {
  for (const entry of list) {
    if (!entry?.id || !entry?.name || !entry?.targets || typeof entry.targets !== "object") continue;
    const normalizedTargets = {};
    for (const [targetId, cfg] of Object.entries(entry.targets)) {
      if (!cfg) continue;
      normalizedTargets[targetId] = {
        ...cfg,
        png: resolveCustomAssetPath(cfg.png),
      };
    }
    const id = `custom:${entry.id}`;
    swapSourceRegistry.set(id, {
      id,
      kind: "custom_png",
      label: entry.name,
      targets: normalizedTargets,
      glyphWidth: entry.glyphWidth ?? 12,
      glyphHeight: entry.glyphHeight ?? 18,
      gap: entry.gap ?? 0,
    });
  }
}

async function loadBetaflightDefaults() {
  if (!bfFontSelect) return;

  let list;
  try {
    const res = await fetch("fonts/bfmanifest.json");
    if (!res.ok) throw new Error(`bfmanifest.json HTTP ${res.status}`);
    list = await res.json();
    if (!Array.isArray(list)) throw new Error("bfmanifest.json did not return an array");
  } catch (err) {
    console.error("Failed to load betaflight defaults manifest", err);
    bfFontSelect.innerHTML = `<option value="">(defaults missing)</option>`;
    return;
  }

  bfFontSelect.innerHTML = `<option value="">(choose default)</option>`;
  swapSourceRegistry.clear();
  for (const entry of list) {
    const opt = document.createElement("option");
    opt.value = entry.file;
    opt.textContent = entry.name;

    if (entry.thumb) opt.dataset.thumb = entry.thumb;
    bfFontSelect.appendChild(opt);
  }
  registerBetaflightSwapSources(list);
  const customList = await loadSwapCustomManifest();
  registerCustomSwapSources(customList);
  syncSwapSourceSelect();


  buildFontPicker({
    selectEl: bfFontSelect,
    getLabel: (opt) => opt.textContent,
    getValue: (opt) => opt.value,
    getPreviewUrl: (value) => getThumbForValue(bfFontSelect, value),
  });


  bfFontSelect.addEventListener("change", async () => {
    const file = bfFontSelect.value;
    if (!file) return;

    try {
      const r = await fetch(`fonts/betaflight/${encodeURIComponent(file)}`);
      if (!r.ok) throw new Error(`default font fetch HTTP ${r.status} for ${file}`);
      const buf = await r.arrayBuffer();
      await handleBuffer(buf, file);
    } catch (err) {
      console.error("Failed to load betaflight default font:", file, err);
    }
  });
}

const COMPARE_KEY = "osdFontLabCompare";
let compareMode = (localStorage.getItem(COMPARE_KEY) ?? "0") === "1";

function applyCompareMode(on) {
  compareMode = !!on;
  localStorage.setItem(COMPARE_KEY, compareMode ? "1" : "0");

  if (compareMode) {
    document.documentElement.setAttribute("data-compare", "1");
  } else {
    document.documentElement.removeAttribute("data-compare");
  }

  rerenderAll();
}

function initEvents() {
  // compare toggle
  if (compareToggle) {
    compareToggle.checked = compareMode;
    applyCompareMode(compareMode); // apply on load

    compareToggle.addEventListener("change", () => {
      applyCompareMode(!!compareToggle.checked);
    });
  } else {
    // still apply from storage even if checkbox missing
    applyCompareMode(compareMode);
  }

  // show grids toggle
  if (showGridsEl) {
    showGridsEl.checked = showGrids;
    showGridsEl.addEventListener("change", () => {
      showGrids = !!showGridsEl.checked;
      localStorage.setItem("showGrids", showGrids ? "1" : "0");
      rerenderAll();
    });
  }

  // Hold-to-preview-original (momentary)
  if (holdOriginalPreviewBtn) {
    const setHold = (on) => {
      if (holdOriginalPreview === on) return;
      holdOriginalPreview = on;
      holdOriginalPreviewBtn.classList.toggle("is-holding", on);
      rerenderAll();
    };

    holdOriginalPreviewBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      setHold(true);
    });
    holdOriginalPreviewBtn.addEventListener("mouseup", () => setHold(false));
    holdOriginalPreviewBtn.addEventListener("mouseleave", () => setHold(false));
    holdOriginalPreviewBtn.addEventListener("touchstart", () => setHold(true), { passive: true });
    holdOriginalPreviewBtn.addEventListener("touchend", () => setHold(false));
    holdOriginalPreviewBtn.addEventListener("touchcancel", () => setHold(false));
    window.addEventListener("mouseup", () => setHold(false));
  }

  // grids click
  baseGridCanvas?.addEventListener("click", (e) => {
    if (!baseFont || !compareMode) return;
    handleGridClick(e, baseGridCanvas, baseFont);
  });

  resultGridCanvas?.addEventListener("click", (e) => {
    if (!resultFont) return;
    handleGridClick(e, resultGridCanvas, resultFont);
  });

  // drop zone + file picker
  drop?.addEventListener("click", () => fileInput?.click());

  fileInput?.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (f) handleFile(f);
  });

  drop?.addEventListener("dragenter", (e) => { e.preventDefault(); drop.classList.add("hot"); });
  drop?.addEventListener("dragover",  (e) => { e.preventDefault(); drop.classList.add("hot"); });
  drop?.addEventListener("dragleave", () => drop.classList.remove("hot"));
  drop?.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("hot");
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  });

  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  window.addEventListener("resize", () => rerenderAll());

  // exports
  exportMCMBtn?.addEventListener("click", () => {
    if (!resultFont) return;
    const text = encodeMCM(resultFont);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    downloadBlob(blob, `${safeBaseName()}.mcm`);
  });

  exportPNGBtn?.addEventListener("click", () => {
    if (!resultFont) return;
    const sheet = renderFontToSheetCanvas(resultFont, 3);
    sheet.toBlob((blob) => {
      if (!blob) return;
      downloadBlob(blob, `${safeBaseName()}.png`);
    }, "image/png");
  });

  // d-pads
  initDpads();
}

/* -----------------------------
   Init
------------------------------ */

function init() {
  // Keep layout stable before any font is loaded.
  if (resultGridCtx && resultGridCanvas) renderPlaceholderGrid(resultGridCtx, resultGridCanvas);
  if (baseGridCtx && baseGridCanvas) renderPlaceholderGrid(baseGridCtx, baseGridCanvas);

  updateReplReadout();
  setLoadStatus(loadStatusText);
  initSwapUI();
  initTheme();
  initEvents();
  loadOverlayIndex();
  loadBetaflightDefaults();
  initBrandTitle();
}

init();

