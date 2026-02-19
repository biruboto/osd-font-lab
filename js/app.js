// js/app.js
import { decodeMCM, encodeMCM } from "./mcm.js";
import { buildFontPicker } from "./modules/picker.js";
import { currentThemeId, initThemeControls } from "./modules/theme.js";
import {
  applyStroke4,
  applyStroke8,
  drawFontPreviewStrip,
  drawGlyphPreviewStrip,
  drawOverlayPreviewStrip,
} from "./modules/preview.js";
import {
  clampInt,
  cssVar,
  downloadBlob,
  escapeHtml,
  fitCanvasToCSS,
} from "./modules/dom-utils.js";
import {
  createSelectionState,
  rangeSelect as rangeSelectState,
  setSingleSelection as setSingleSelectionState,
  toggleSelection as toggleSelectionState,
  updateSelectionCount as updateSelectionCountView,
} from "./modules/selection.js";
import {
  registerBetaflightSwapSources,
  registerCustomSwapSources,
} from "./modules/swap-registry.js";
import { initDpadControls } from "./modules/dpad.js";
import { createWorkspaceRenderer } from "./modules/workspace-render.js";
import { cloneHudLayoutDefaults, createHudRenderer } from "./modules/hud-render.js";
import { parseYaffToOverlay } from "./modules/yaff.js";

/* -----------------------------
   DOM
------------------------------ */
const drop = document.getElementById("drop");
const fileInput = document.getElementById("file");
const yaffFileInput = document.getElementById("yaffFile");
const yaffImportBtn = document.getElementById("yaffImportBtn");
const bootSplashImportBtn = document.getElementById("bootSplashImportBtn");
const bootSplashFileInput = document.getElementById("bootSplashFile");
const loadStatus = document.getElementById("loadStatus");

const themeRadios = [...document.querySelectorAll('input[name="siteTheme"]')];

const bfFontSelect = document.getElementById("bfFontSelect");

const baseGridCanvas = document.getElementById("baseGrid");
const resultGridCanvas = document.getElementById("resultGrid");
const resultHudCanvas = document.getElementById("resultHud");
const bootSplashPreviewCanvas = document.getElementById("bootSplashPreview");
const baseGridCtx = baseGridCanvas?.getContext("2d");
const resultGridCtx = resultGridCanvas?.getContext("2d");
const resultHudCtx = resultHudCanvas?.getContext("2d");
const bootSplashPreviewCtx = bootSplashPreviewCanvas?.getContext("2d");
if (baseGridCtx) baseGridCtx.imageSmoothingEnabled = false;
if (resultGridCtx) resultGridCtx.imageSmoothingEnabled = false;
if (resultHudCtx) resultHudCtx.imageSmoothingEnabled = false;
if (bootSplashPreviewCtx) bootSplashPreviewCtx.imageSmoothingEnabled = false;

const resultZoomCanvas = document.getElementById("resultZoom");
const resultZoomCtx = resultZoomCanvas?.getContext("2d");
if (resultZoomCtx) resultZoomCtx.imageSmoothingEnabled = false;

const glyphInfo = document.getElementById("glyphInfo");
const editorPalette = document.getElementById("editorPalette");
const editorColorButtons = [...document.querySelectorAll(".editor-color-btn")];
const editorUndoBtn = document.getElementById("editorUndoBtn");
const zoomModeInspectorBtn = document.getElementById("zoomModeInspector");
const zoomModeEditorBtn = document.getElementById("zoomModeEditor");
const overlaySelect = document.getElementById("overlaySelect");
const strokeStyle4Btn = document.getElementById("strokeStyle4Btn");
const strokeStyle8Btn = document.getElementById("strokeStyle8Btn");
const swapTargetSelect = document.getElementById("swapTargetSelect");
const swapSourceSelect = document.getElementById("swapSourceSelect");
const clearSwapTargetBtn = document.getElementById("clearSwapTargetBtn");
const clearAllSwapsBtn = document.getElementById("clearAllSwapsBtn");
const specialEmojiPicker = document.getElementById("specialEmojiPicker");
const specialEmojiBtn = document.getElementById("specialEmojiBtn");
const specialEmojiThumb = document.getElementById("specialEmojiThumb");
const specialEmojiLabel = document.getElementById("specialEmojiLabel");
const specialEmojiMenu = document.getElementById("specialEmojiMenu");
const clearSpecialCharBtn = document.getElementById("clearSpecialCharBtn");
const specialSafeOnBtn = document.getElementById("specialSafeOnBtn");
const specialSafeOffBtn = document.getElementById("specialSafeOffBtn");

const selCount = document.getElementById("selCount");

const showGridsEl = document.getElementById("showGrids");
const hudShowGuidesEl = document.getElementById("hudShowGuides");
const hudFormatNtscBtn = document.getElementById("hudFormatNtscBtn");
const hudFormatPalBtn = document.getElementById("hudFormatPalBtn");
const hudResetDefaultsBtn = document.getElementById("hudResetDefaultsBtn");
const hudElementToggles = [...document.querySelectorAll(".hud-element-toggle")];
const hudPilotNameInput = document.getElementById("hudPilotNameInput");
const hudCraftNameInput = document.getElementById("hudCraftNameInput");
const holdOriginalPreviewBtn = document.getElementById("holdOriginalPreview");
const viewModeSheetBtn = document.getElementById("viewModeSheet");
const viewModeHudBtn = document.getElementById("viewModeHud");
const servingFontCountEl = document.getElementById("servingFontCount");
const themeCodeLabelEl = document.getElementById("themeCodeLabel");
const kofiBadgeIconEl = document.getElementById("kofiBadgeIcon");

const exportMCMBtn = document.getElementById("exportMCM");
const exportPNG1xBtn = document.getElementById("exportPNG1x");
const exportPNG3xBtn = document.getElementById("exportPNG3x");

/* -----------------------------
   Constants / State
------------------------------ */

// Replaceable ASCII characters (exact mcmedit list)
const REPLACE_CHARS = ` !"#%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`;
const REPLACE_SET = new Set([...REPLACE_CHARS].map(c => c.charCodeAt(0)));
const isReplaceable = (idx) => REPLACE_SET.has(idx);
const SPECIAL_EMOJI_MANIFEST_PATH = "fonts/manifest-emoji-pixels.json";
const SPECIAL_EMOJI_DATA_DIR = "fonts/data/emoji-pixels";
const SPECIAL_EMOJI_ORDER_PATH = "fonts/emoji-order-firstcp.json";
const SPECIAL_EMOJI_SYMBOLS_PATH = "fonts/emoji-symbol-codepoints.json";
const SPECIAL_SAFE_MODE_KEY = "osdSpecialSafeMode";
const SPECIAL_SAFE_CHARS = `!"#%&',;=?`;
const SPECIAL_SAFE_SET = new Set([...SPECIAL_SAFE_CHARS].map((c) => c.charCodeAt(0)));

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
  { id: "fahrenheit", label: "° Fahrenheit", indices: [13] },
  { id: "celsius", label: "° Celsius", indices: [14] },
  { id: "amp", label: "A / Amp", indices: [154] },
  { id: "thermometer", label: "Thermometer", indices: [122] },
  { id: "lq", label: "LQ", indices: [123] },
  { id: "on_m", label: "On Timer", indices: [155] },
  { id: "fly_m", label: "Fly Timer", indices: [156] },
  { id: "battery_set", label: "Batteries", indices: [144, 145, 146, 147, 148, 149, 150, 151] },
  { id: "crosshair_set", label: "Crosshairs", indices: [114, 115, 116] },
];

const swapTargetsById = new Map(SWAP_TARGETS.map((t) => [t.id, t]));
const swapSourceCache = new Map(); // sourceId(+target) -> decoded glyph source
const swapSourceRegistry = new Map(); // sourceId -> source descriptor
const swapOverrides = new Map(); // idx -> Uint8Array glyph
let swapTargetPickerApi = null;
let swapSourcePickerApi = null;
let overlayPickerApi = null;
let bfPickerApi = null;
let overlaySelectChangeBound = false;
let specialEmojiManifest = [];
let selectedSpecialEmojiFile = "";
let specialEmojiOrderByFirstCodepoint = null;
let specialEmojiNameByFirstCodepoint = null;
let specialEmojiSymbolCodepoints = null;
const specialEmojiPreviewUrlCache = new Map();
const specialEmojiGlyphCache = new Map();
let specialEmojiMenuBuilt = false;
const specialEmojiPreviewPending = new Set();
let specialEmojiVisiblePreloadRaf = 0;
let specialEmojiButtonSyncReqId = 0;
let specialEmojiMenuEventsBound = false;
const SPECIAL_EMOJI_PREVIEW_CONCURRENCY = 2;
let specialEmojiPreviewInFlight = 0;
let specialEmojiPreviewDrainRaf = 0;
const specialEmojiPreviewTasks = [];
let specialEmojiPrewarmStarted = false;
const specialCharEmojiAssignments = new Map(); // idx -> emoji file
let specialSafeMode = localStorage.getItem(SPECIAL_SAFE_MODE_KEY) !== "off";

const selection = createSelectionState(0);

const nudge = {
  replaced: { x: 0, y: 0 },   // global replacement offset
  perGlyph: new Map(),        // idx -> {x,y}
};
const replacedOverlayIndices = new Set(); // indices actually replaced by current overlay

// Shared overlay cache (used by dropdown + title banner)
const overlayCache = new Map(); // file -> overlay JSON
let overlayManifest = null;     // active library manifest list [{file,name,id,...}]
let swapCustomManifest = null;  // cached list from fonts/custom.json
const overlayPreviewUrlCache = new Map(); // `${theme}|${file}` -> dataURL
const bfPreviewUrlCache = new Map();      // `${theme}|${file}` -> dataURL
const OVERLAY_LIBRARY_KEY = "osdOverlayLibrary";
const OVERLAY_STROKE_STYLE_KEY = "osdOverlayStrokeStyle";
const LIB_SELECT_PREFIX = "__lib:";
const OVERLAY_LIBRARIES = [
  {
    id: "atari",
    label: "Atari Eight Bit",
    manifestPath: "fonts/manifest-atari.json",
    dataDir: "fonts/data/atari",
  },
  {
    id: "cpc",
    label: "Amstrad CPC",
    manifestPath: "fonts/manifest-cpc.json",
    dataDir: "fonts/data/cpc",
  },
  {
    id: "zx",
    label: "ZX Spectrum",
    manifestPath: "fonts/manifest-zx.json",
    dataDir: "fonts/data/zx",
  },
  {
    id: "bbc",
    label: "BBC Micro",
    manifestPath: "fonts/manifest-bbc.json",
    dataDir: "fonts/data/bbc",
  },
  {
    id: "dg",
    label: "Damien Guard",
    manifestPath: "fonts/manifest-dg.json",
    dataDir: "fonts/data/dg",
  },
  {
    id: "oldschool-pc",
    label: "Oldschool PC",
    manifestPath: "fonts/manifest-oldschool-pc.json",
    dataDir: "fonts/data/oldschool-pc",
  },
  {
    id: "arcade-font-engine",
    label: "NFG's Arcade Font Engine",
    manifestPath: "fonts/manifest-arcade-font-engine.json",
    dataDir: "fonts/data/arcade-font-engine",
  },
];
const overlayManifestCache = new Map(); // library id -> manifest list
const overlayLibraryCounts = new Map(); // library id -> entry count
let currentOverlayLibraryId = localStorage.getItem(OVERLAY_LIBRARY_KEY) || OVERLAY_LIBRARIES[0].id;
if (currentOverlayLibraryId === "pcfon") currentOverlayLibraryId = "oldschool-pc";
let overlayStrokeStyle = (localStorage.getItem(OVERLAY_STROKE_STYLE_KEY) === "8") ? "8" : "4";

// showGrids persisted
let showGrids = (localStorage.getItem("showGrids") ?? "1") === "1";
const VIEW_MODE_KEY = "osdViewMode";
const VIEW_MODE_SHEET = "sheet";
const VIEW_MODE_HUD = "hud";
const ZOOM_MODE_INSPECTOR = "inspector";
const ZOOM_MODE_EDITOR = "editor";
let viewMode = (localStorage.getItem(VIEW_MODE_KEY) === VIEW_MODE_HUD) ? VIEW_MODE_HUD : VIEW_MODE_SHEET;
let zoomMode = ZOOM_MODE_INSPECTOR;
let editorColorValue = 3;
const HUD_VIDEO_FORMAT_KEY = "osdHudVideoFormat";
const HUD_VIDEO_FORMAT_VERSION_KEY = "osdHudVideoFormatVersion";
const HUD_VIDEO_FORMAT_SCHEMA_VERSION = 2;
let hudVideoFormat = loadHudVideoFormatFromStorage();
const HUD_ELEMENTS_KEY = "osdHudElements";
const HUD_ELEMENTS_VERSION_KEY = "osdHudElementsVersion";
const HUD_ELEMENTS_SCHEMA_VERSION = 4;
const HUD_LAYOUT_KEY = "osdHudLayout";
const HUD_LAYOUT_VERSION_KEY = "osdHudLayoutVersion";
const HUD_LAYOUT_SCHEMA_VERSION = 1;
const HUD_LABELS_KEY = "osdHudLabels";
const HUD_LABELS_VERSION_KEY = "osdHudLabelsVersion";
const HUD_LABELS_SCHEMA_VERSION = 2;
const HUD_ELEMENT_IDS = [
  "crosshair",
  "compass",
  "rssi",
  "link_quality",
  "main_voltage",
  "throttle",
  "current_draw",
  "mah_drawn",
  "gps_sats",
  "vtx_channel",
  "home_distance",
  "speed",
  "flight_mode",
  "flight_time",
  "on_time",
  "warnings",
  "pilot_name",
  "craft_name",
];
const HUD_DEFAULT_ACTIVE_IDS = [
  "crosshair",
  "rssi",
  "link_quality",
  "vtx_channel",
  "flight_mode",
  "main_voltage",
  "throttle",
  "flight_time",
  "warnings",
  "craft_name",
];
const DEFAULT_HUD_ELEMENT_SET = new Set(HUD_DEFAULT_ACTIVE_IDS);
const HUD_LABEL_DEFAULTS = Object.freeze({
  pilot_name: "PILOT",
  craft_name: "ICARUS",
});
const BOOT_SPLASH_START_INDEX = 0xA0;
const BOOT_SPLASH_GLYPH_COUNT = 96;
const BOOT_SPLASH_COLS = 24;
const BOOT_SPLASH_ROWS = BOOT_SPLASH_GLYPH_COUNT / BOOT_SPLASH_COLS;
const BOOT_SPLASH_PNG_WIDTH = 288;
const BOOT_SPLASH_PNG_HEIGHT = 72;
let enabledHudElements = loadHudElementsFromStorage();
let hudLayout = loadHudLayoutFromStorage();
let hudLabels = loadHudLabelsFromStorage();
let hudRenderState = null;
const hudDrag = {
  active: false,
  id: "",
  startPointerX: 0,
  startPointerY: 0,
  startCol: 0,
  startRow: 0,
  cellsWide: 1,
  cellsHigh: 1,
};
const zoomPaint = {
  active: false,
  dirty: false,
  startGlyph: null,
  startIndex: -1,
};
const editorUndo = {
  glyph: null,
  index: -1,
};
const editorOverrideIndices = new Set();
let rerenderRafPending = false;

let loadStatusText = "No file loaded.";
let loadStatusSubtext = "";
let loadStatusError = false;
let kofiIconData = null;

const THEME_SHORT_LABELS = {
  dusk: "DUSK",
  crt: "CRT",
  "amber-terminal": "AMBR",
  "cold-phosphor": "PHSPHR",
  "lavender-circuit": "LVNDR",
};

function updateThemeCodeLabel(themeId) {
  if (!themeCodeLabelEl) return;
  themeCodeLabelEl.textContent = THEME_SHORT_LABELS[themeId] || String(themeId || "DUSK").toUpperCase();
}

function setViewMode(nextMode) {
  viewMode = nextMode === VIEW_MODE_HUD ? VIEW_MODE_HUD : VIEW_MODE_SHEET;
  localStorage.setItem(VIEW_MODE_KEY, viewMode);
  document.documentElement.setAttribute("data-view-mode", viewMode);
  viewModeSheetBtn?.classList.toggle("is-active", viewMode === VIEW_MODE_SHEET);
  viewModeHudBtn?.classList.toggle("is-active", viewMode === VIEW_MODE_HUD);
  if (viewMode !== VIEW_MODE_HUD) setHudCanvasCursor("default");
  syncZoomModeUI();
  // Repaint once more after layout settles to avoid stale canvas sizing.
  requestAnimationFrame(() => rerenderAll());
}

function syncZoomModeUI() {
  const isInspector = zoomMode === ZOOM_MODE_INSPECTOR;
  zoomModeInspectorBtn?.classList.toggle("is-active", isInspector);
  zoomModeEditorBtn?.classList.toggle("is-active", !isInspector);
  if (glyphInfo) glyphInfo.hidden = !isInspector;
  if (editorPalette) editorPalette.hidden = isInspector;
  if (resultZoomCanvas) resultZoomCanvas.classList.toggle("is-editor", !isInspector && viewMode === VIEW_MODE_SHEET);
}

function setZoomMode(nextMode) {
  zoomMode = nextMode === ZOOM_MODE_EDITOR ? ZOOM_MODE_EDITOR : ZOOM_MODE_INSPECTOR;
  syncZoomModeUI();
  rerenderAll();
}

function setEditorColor(nextValue) {
  const v = Number(nextValue);
  if (v !== 1 && v !== 2 && v !== 3) return;
  editorColorValue = v;
  for (const btn of editorColorButtons) {
    btn.classList.toggle("is-active", Number(btn.getAttribute("data-editor-color")) === editorColorValue);
  }
}

function clearEditorPixelOverrides() {
  if (!editorOverrideIndices.size) return;
  for (const idx of editorOverrideIndices) {
    swapOverrides.delete(idx);
  }
  editorOverrideIndices.clear();
  editorUndo.glyph = null;
  editorUndo.index = -1;
}

function loadHudElementsFromStorage() {
  try {
    const version = Number(localStorage.getItem(HUD_ELEMENTS_VERSION_KEY) || 0);
    const raw = localStorage.getItem(HUD_ELEMENTS_KEY);
    if (version !== HUD_ELEMENTS_SCHEMA_VERSION || !raw) {
      localStorage.setItem(HUD_ELEMENTS_VERSION_KEY, String(HUD_ELEMENTS_SCHEMA_VERSION));
      localStorage.setItem(HUD_ELEMENTS_KEY, JSON.stringify(HUD_DEFAULT_ACTIVE_IDS));
      return new Set(DEFAULT_HUD_ELEMENT_SET);
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      localStorage.setItem(HUD_ELEMENTS_KEY, JSON.stringify(HUD_DEFAULT_ACTIVE_IDS));
      return new Set(DEFAULT_HUD_ELEMENT_SET);
    }
    const filtered = parsed.filter((id) => HUD_ELEMENT_IDS.includes(id));
    if (!filtered.length) return new Set(DEFAULT_HUD_ELEMENT_SET);
    return new Set(filtered);
  } catch {
    return new Set(DEFAULT_HUD_ELEMENT_SET);
  }
}

function saveHudElementsToStorage() {
  localStorage.setItem(HUD_ELEMENTS_KEY, JSON.stringify([...enabledHudElements]));
}

function clampHudLayoutEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const col = clampInt(Number(entry.col), 0, 29);
  const row = clampInt(Number(entry.row), 0, 15);
  return { col, row };
}

function loadHudLayoutFromStorage() {
  const defaults = cloneHudLayoutDefaults();
  try {
    const version = Number(localStorage.getItem(HUD_LAYOUT_VERSION_KEY) || 0);
    const raw = localStorage.getItem(HUD_LAYOUT_KEY);
    if (version !== HUD_LAYOUT_SCHEMA_VERSION || !raw) {
      localStorage.setItem(HUD_LAYOUT_VERSION_KEY, String(HUD_LAYOUT_SCHEMA_VERSION));
      localStorage.setItem(HUD_LAYOUT_KEY, JSON.stringify(defaults));
      return defaults;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      localStorage.setItem(HUD_LAYOUT_KEY, JSON.stringify(defaults));
      return defaults;
    }
    for (const id of HUD_ELEMENT_IDS) {
      const clamped = clampHudLayoutEntry(parsed[id]);
      if (clamped) defaults[id] = clamped;
    }
    return defaults;
  } catch {
    return defaults;
  }
}

function saveHudLayoutToStorage() {
  localStorage.setItem(HUD_LAYOUT_KEY, JSON.stringify(hudLayout));
}

function sanitizeHudLabel(value) {
  const text = String(value ?? "")
    .toUpperCase()
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ");
  return text.slice(0, 16);
}

function loadHudLabelsFromStorage() {
  const defaults = { pilot_name: "", craft_name: "" };
  try {
    const version = Number(localStorage.getItem(HUD_LABELS_VERSION_KEY) || 0);
    const raw = localStorage.getItem(HUD_LABELS_KEY);
    if (version !== HUD_LABELS_SCHEMA_VERSION || !raw) {
      localStorage.setItem(HUD_LABELS_VERSION_KEY, String(HUD_LABELS_SCHEMA_VERSION));
      localStorage.setItem(HUD_LABELS_KEY, JSON.stringify(defaults));
      return defaults;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      localStorage.setItem(HUD_LABELS_KEY, JSON.stringify(defaults));
      return defaults;
    }
    return {
      pilot_name: sanitizeHudLabel(parsed.pilot_name),
      craft_name: sanitizeHudLabel(parsed.craft_name),
    };
  } catch {
    return defaults;
  }
}

function saveHudLabelsToStorage() {
  localStorage.setItem(HUD_LABELS_KEY, JSON.stringify(hudLabels));
}

function syncHudLabelInputs() {
  if (hudPilotNameInput) hudPilotNameInput.value = hudLabels.pilot_name;
  if (hudCraftNameInput) hudCraftNameInput.value = hudLabels.craft_name;
}

function resetHudDefaults() {
  enabledHudElements = new Set(DEFAULT_HUD_ELEMENT_SET);
  saveHudElementsToStorage();

  hudLayout = cloneHudLayoutDefaults();
  saveHudLayoutToStorage();

  hudLabels = { pilot_name: "", craft_name: "" };
  saveHudLabelsToStorage();
  syncHudLabelInputs();

  hudVideoFormat = "NTSC";
  localStorage.setItem(HUD_VIDEO_FORMAT_KEY, hudVideoFormat);
  syncHudFormatUI();

  showGrids = true;
  localStorage.setItem("showGrids", "1");
  if (showGridsEl) showGridsEl.checked = true;
  if (hudShowGuidesEl) hudShowGuidesEl.checked = true;

  syncHudElementToggleUI();
  rerenderAll();
}

function syncHudFormatUI() {
  hudFormatNtscBtn?.classList.toggle("is-active", hudVideoFormat === "NTSC");
  hudFormatPalBtn?.classList.toggle("is-active", hudVideoFormat === "PAL");
}

function remapHudLayoutRowsForFormatSwitch(fromFormat, toFormat) {
  if (fromFormat === toFormat) return;
  const shift = (fromFormat === "NTSC" && toFormat === "PAL") ? 1
    : (fromFormat === "PAL" && toFormat === "NTSC") ? -1
      : 0;
  if (!shift) return;
  for (const id of HUD_ELEMENT_IDS) {
    const p = hudLayout[id];
    if (!p) continue;
    hudLayout[id] = {
      col: clampInt(Number(p.col), 0, 29),
      row: clampInt(Number(p.row) + shift, 0, 15),
    };
  }
}

function loadHudVideoFormatFromStorage() {
  try {
    const version = Number(localStorage.getItem(HUD_VIDEO_FORMAT_VERSION_KEY) || 0);
    const raw = localStorage.getItem(HUD_VIDEO_FORMAT_KEY);
    if (version !== HUD_VIDEO_FORMAT_SCHEMA_VERSION || (raw !== "PAL" && raw !== "NTSC")) {
      localStorage.setItem(HUD_VIDEO_FORMAT_VERSION_KEY, String(HUD_VIDEO_FORMAT_SCHEMA_VERSION));
      localStorage.setItem(HUD_VIDEO_FORMAT_KEY, "NTSC");
      return "NTSC";
    }
    return raw;
  } catch {
    return "NTSC";
  }
}

function syncHudElementToggleUI() {
  for (const el of hudElementToggles) {
    const id = el.getAttribute("data-hud-element");
    if (!id) continue;
    el.checked = enabledHudElements.has(id);
  }
}

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

    0x08: { names: ["SYM_STICK_OVERLAY_SPRITE_HIGH"], note: "" },
    0x09: { names: ["SYM_STICK_OVERLAY_SPRITE_MID"], note: "" },
    0x0A: { names: ["SYM_STICK_OVERLAY_SPRITE_LOW"], note: "" },
    0x0B: { names: ["SYM_STICK_OVERLAY_CENTER"], note: "" },

    0x0C: { names: ["SYM_M"], note: "Meters" },
    0x0D: { names: ["SYM_F"], note: "Fahrenheit" },
    0x0E: { names: ["SYM_C"], note: "Celsius" },
    0x0F: { names: ["SYM_FT"], note: "Feet" },

    0x10: { names: ["SYM_BBLOG"], note: "Black Box Log" },
    0x11: { names: ["SYM_HOMEFLAG"], note: "" },
    0x12: { names: ["SYM_RPM"], note: "" },
    0x13: { names: ["SYM_AH_DECORATION"], note: "Horizon Sidebars" },
    0x14: { names: ["SYM_ROLL"], note: "" },
    0x15: { names: ["SYM_PITCH"], note: "" },
    0x16: { names: ["SYM_STICK_OVERLAY_VERTICAL"], note: "" },
    0x17: { names: ["SYM_STICK_OVERLAY_HORIZONTAL"], note: "" },

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
    0x61: { names: ["SYM_ARROW_2"], note: "" },
    0x62: { names: ["SYM_ARROW_3"], note: "" },
    0x63: { names: ["SYM_ARROW_4"], note: "" },
    0x64: { names: ["SYM_ARROW_EAST"], note: "" },
    0x65: { names: ["SYM_ARROW_6"], note: "" },
    0x66: { names: ["SYM_ARROW_7"], note: "" },
    0x67: { names: ["SYM_ARROW_8"], note: "" },
    0x68: { names: ["SYM_ARROW_NORTH"], note: "" },
    0x69: { names: ["SYM_ARROW_10"], note: "" },
    0x6A: { names: ["SYM_ARROW_11"], note: "" },
    0x6B: { names: ["SYM_ARROW_12"], note: "" },
    0x6C: { names: ["SYM_ARROW_WEST"], note: "" },
    0x6D: { names: ["SYM_ARROW_14"], note: "" },
    0x6E: { names: ["SYM_ARROW_15"], note: "" },
    0x6F: { names: ["SYM_ARROW_16"], note: "" },

    // 0x70..0x9F
    0x70: { names: ["SYM_SPEED"], note: "" },
    0x71: { names: ["SYM_TOTAL_DISTANCE"], note: "" },
    0x72: { names: ["SYM_AH_CENTER_LINE"], note: "Crosshairs" },
    0x73: { names: ["SYM_AH_CENTER"], note: "Crosshairs" },
    0x74: { names: ["SYM_AH_CENTER_LINE_RIGHT"], note: "Crosshairs" },

    0x7A: { names: ["SYM_TEMPERATURE"], note: "" },
    0x7B: { names: ["SYM_LQ"], note: "Link Quality" },
    0x7F: { names: ["SYM_ALTITUDE"], note: "" },

    0x80: { names: ["SYM_AH_BAR9_0"], note: "" },
    0x81: { names: ["SYM_AH_BAR9_1"], note: "" },
    0x82: { names: ["SYM_AH_BAR9_2"], note: "" },
    0x83: { names: ["SYM_AH_BAR9_3"], note: "" },
    0x84: { names: ["SYM_AH_BAR9_4"], note: "" },
    0x85: { names: ["SYM_AH_BAR9_5"], note: "" },
    0x86: { names: ["SYM_AH_BAR9_6"], note: "" },
    0x87: { names: ["SYM_AH_BAR9_7"], note: "" },
    0x88: { names: ["SYM_AH_BAR9_8"], note: "" },

    0x89: { names: ["SYM_LAT"], note: "" },
    0x8A: { names: ["SYM_PB_START"], note: "" },
    0x8B: { names: ["SYM_PB_FULL"], note: "" },
    0x8C: { names: ["SYM_PB_HALF"], note: "" },
    0x8D: { names: ["SYM_PB_EMPTY"], note: "" },
    0x8E: { names: ["SYM_PB_END"], note: "" },
    0x8F: { names: ["SYM_PB_CLOSE"], note: "" },

    0x90: { names: ["SYM_BATT_FULL"], note: "" },
    0x91: { names: ["SYM_BATT_5"], note: "" },
    0x92: { names: ["SYM_BATT_4"], note: "" },
    0x93: { names: ["SYM_BATT_3"], note: "" },
    0x94: { names: ["SYM_BATT_2"], note: "" },
    0x95: { names: ["SYM_BATT_1"], note: "" },
    0x96: { names: ["SYM_BATT_EMPTY"], note: "" },

    0x97: { names: ["SYM_MAIN_BATT"], note: "" },
    0x98: { names: ["SYM_LON"], note: "" },
    0x99: { names: ["SYM_FTPS"], note: "ft per second (vario)" },
    0x9A: { names: ["SYM_AMP"], note: "" },
    0x9B: { names: ["SYM_ON_M"], note: "On Timer" },
    0x9C: { names: ["SYM_FLY_M"], note: "Fly Timer" },
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
function clearDynamicPreviewCaches() {
  overlayPreviewUrlCache.clear();
  bfPreviewUrlCache.clear();
  specialEmojiPreviewUrlCache.clear();
}

async function loadKofiIconData() {
  if (kofiIconData) return kofiIconData;
  const res = await fetch("fonts/data/kofi-icon.json");
  if (!res.ok) throw new Error(`kofi-icon.json HTTP ${res.status}`);
  const data = await res.json();
  if (!data || !Number.isInteger(data.width) || !Number.isInteger(data.height)) {
    throw new Error("Invalid kofi-icon.json format");
  }

  let pixels = null;
  if (Array.isArray(data.rows)) {
    if (data.rows.length !== data.height || data.rows.some((row) => !Array.isArray(row) || row.length !== data.width)) {
      throw new Error("kofi-icon.json rows must be a height x width grid");
    }
    pixels = data.rows.flat().map((v) => v | 0);
  } else if (Array.isArray(data.pixels)) {
    if (data.pixels.length === data.width * data.height) {
      pixels = data.pixels.map((v) => v | 0);
    } else if (
      data.pixels.length === data.height &&
      data.pixels.every((row) => Array.isArray(row) && row.length === data.width)
    ) {
      pixels = data.pixels.flat().map((v) => v | 0);
    } else {
      throw new Error(`kofi-icon.json pixel count mismatch (${data.pixels.length} != ${data.width * data.height})`);
    }
  } else {
    throw new Error("kofi-icon.json requires either 'rows' or 'pixels'");
  }

  kofiIconData = {
    width: data.width,
    height: data.height,
    pixels,
  };
  return kofiIconData;
}

async function renderKofiBadgeIcon() {
  if (!kofiBadgeIconEl) return;
  try {
    const icon = await loadKofiIconData();
    const c = document.createElement("canvas");
    c.width = icon.width;
    c.height = icon.height;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, icon.width, icon.height);

    const c0 = "rgba(0,0,0,0)";
    const c1 = cssVar("--osd-3", "#000000");   // black pixels -> themed dark
    const c2 = cssVar("--text-0", "#e6e1d6");  // white pixels -> default text color
    const c3 = cssVar("--accent-0", "#62b6a6"); // heart -> accent
    const palette = [c0, c1, c2, c3];

    for (let y = 0; y < icon.height; y++) {
      for (let x = 0; x < icon.width; x++) {
        const v = icon.pixels[y * icon.width + x] | 0;
        const color = palette[v] || c0;
        if (v === 0) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    kofiBadgeIconEl.src = c.toDataURL("image/png");
  } catch (err) {
    console.warn("Failed to render Ko-fi badge icon", err);
  }
}

function initTheme() {
  initThemeControls({
    themeRadios,
    onThemeChange: () => {
      const activeTheme = currentThemeId();
      updateThemeCodeLabel(activeTheme);
      clearDynamicPreviewCaches();
      invalidateSpecialEmojiMenuPreviews();
      rerenderAll();
      renderLoadStatusVisual();
      window.__redrawBrandTitle?.();
      window.__redrawBrandDrone?.();
      overlayPickerApi?.refresh();
      bfPickerApi?.refresh();
      swapTargetPickerApi?.refresh();
      swapSourcePickerApi?.refresh();
      syncSpecialEmojiButton();
      renderKofiBadgeIcon();
    },
  });
}

async function handleBuffer(buf, label = "loaded.mcm") {
  let decoded;
  try {
    decoded = decodeMCM(buf);
  } catch (err) {
    console.error("decodeMCM failed for", label, err);
    setLoadStatus(`Failed to load: ${label}`, { error: true });
    throw err;
  }

  baseFont = decoded;
  clearEditorPixelOverrides();
  setSingleSelection(0);
  rebuildResultFont();
  rerenderAll();

  setLoadStatus(`Loaded: ${label}`, { subtext: `${buf.byteLength} bytes` });
  syncSwapTargetSelect();
  swapTargetPickerApi?.refresh();
  swapSourcePickerApi?.refresh();
}

async function decodePngFontSheet(file, {
  glyphWidth = 12,
  glyphHeight = 18,
  cols = 16,
  rows = 16,
} = {}) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();

    const unitW = cols * glyphWidth;
    const unitH = rows * glyphHeight;
    if (img.width % unitW !== 0 || img.height % unitH !== 0) {
      throw new Error(
        `Expected dimensions to be multiples of ${unitW}x${unitH}; got ${img.width}x${img.height}`,
      );
    }

    const scaleX = img.width / unitW;
    const scaleY = img.height / unitH;
    if (scaleX !== scaleY || scaleX < 1 || !Number.isInteger(scaleX)) {
      throw new Error(`Expected integer square export scale; got ${scaleX}x${scaleY}`);
    }
    const scale = scaleX;

    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);

    const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
    const glyphs = new Array(cols * rows);
    const sampleOffset = Math.floor(scale / 2);

    for (let idx = 0; idx < cols * rows; idx++) {
      const gx = idx % cols;
      const gy = Math.floor(idx / cols);
      const out = new Uint8Array(glyphWidth * glyphHeight);
      for (let y = 0; y < glyphHeight; y++) {
        for (let x = 0; x < glyphWidth; x++) {
          const sx = gx * glyphWidth * scale + x * scale + sampleOffset;
          const sy = gy * glyphHeight * scale + y * scale + sampleOffset;
          const p = ((sy * c.width) + sx) * 4;
          out[y * glyphWidth + x] = colorToGlyphValue(
            pixels[p],
            pixels[p + 1],
            pixels[p + 2],
            pixels[p + 3],
          );
        }
      }
      glyphs[idx] = out;
    }

    return {
      width: glyphWidth,
      height: glyphHeight,
      format: "png",
      glyphs,
      _importMeta: {
        scale,
        width: img.width,
        height: img.height,
      },
    };
  } finally {
    URL.revokeObjectURL(url);
  }
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


const workspaceRenderer = createWorkspaceRenderer({
  scale: SCALE,
  cols: COLS,
  cssVar,
  pxColorViewer,
  fitCanvasToCSS,
  getAccentColor: () => getComputedStyle(document.documentElement).getPropertyValue("--accent-0"),
});

const hudRenderer = createHudRenderer({
  fitCanvasToCSS,
  cssVar,
  pxColorViewer,
  backgroundImagePath: "fpv.jpg",
  requestRerender: () => rerenderAll(),
});

function cloneFont(font) {
  return {
    width: font.width,
    height: font.height,
    format: font.format,
    glyphs: font.glyphs.map(g => new Uint8Array(g)),
  };
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
    pxColorViewer,
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
    pxColorViewer,
  );
}



/* -----------------------------
   Selection helpers
------------------------------ */

function updateSelectionCount() {
  updateSelectionCountView(selCount, selection);
}

function setSingleSelection(idx) {
  setSingleSelectionState(selection, idx);
}

function toggleSelection(idx) {
  toggleSelectionState(selection, idx);
}

function rangeSelect(toIdx) {
  rangeSelectState(selection, toIdx);
}

/* -----------------------------
   Nudges
------------------------------ */

function updateReplReadout() {
  // Readout removed from UI; keep stub so existing calls remain harmless.
}

function clearSelectionNudges() {
  for (const idx of selection.selectedSet) nudge.perGlyph.delete(idx);
  rebuildResultFont();
  rerenderAll({ renderBase: false, renderBootSplash: false });
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
  specialCharEmojiAssignments.clear();
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
  if (!baseFont) {
    swapSourceSelect.innerHTML = `<option value="">(load font first)</option>`;
    swapSourcePickerApi?.rebuild();
    swapSourcePickerApi?.refresh();
    return;
  }
  const prev = swapSourceSelect.value;
  const targetId = swapTargetSelect?.value || "";
  if (!targetId) {
    swapSourceSelect.innerHTML = `<option value="">(choose target first)</option>`;
    swapSourcePickerApi?.rebuild();
    swapSourcePickerApi?.refresh();
    return;
  }
  swapSourceSelect.innerHTML = `<option value="">(choose source)</option>`;

  const entries = [...swapSourceRegistry.values()]
    .filter((entry) => {
      // Betaflight defaults are full-font donors; always valid.
      if (entry.kind === "bf_mcm") return true;

      // Custom sources must explicitly support the selected target.
      return !!entry.targets?.[targetId];
    })
    .sort((a, b) => {
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
      return a.label.localeCompare(b.label);
    });

  const bfGroup = document.createElement("optgroup");
  bfGroup.label = "Betaflight Defaults";
  const customGroup = document.createElement("optgroup");
  customGroup.label = "OSD Font Lab";

  for (const entry of entries) {
    const opt = document.createElement("option");
    opt.value = entry.id;
    opt.textContent = entry.label;
    if (entry.kind === "bf_mcm") bfGroup.appendChild(opt);
    else customGroup.appendChild(opt);
  }

  if (bfGroup.children.length) swapSourceSelect.appendChild(bfGroup);
  if (customGroup.children.length) swapSourceSelect.appendChild(customGroup);

  if (swapSourceSelect.options.length <= 1) {
    swapSourceSelect.innerHTML = `<option value="">(no sources for target)</option>`;
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

function syncSwapTargetSelect() {
  if (!swapTargetSelect) return;
  const prev = swapTargetSelect.value;
  if (!baseFont) {
    swapTargetSelect.innerHTML = `<option value="">(load font first)</option>`;
    swapTargetPickerApi?.rebuild();
    swapTargetPickerApi?.refresh();
    syncSwapSourceSelect();
    return;
  }

  swapTargetSelect.innerHTML = `<option value="">(choose target)</option>`;
  const singleGroup = document.createElement("optgroup");
  singleGroup.label = "Single Glyph";
  const setGroup = document.createElement("optgroup");
  setGroup.label = "Glyph Sets";

  for (const target of SWAP_TARGETS) {
    const opt = document.createElement("option");
    opt.value = target.id;
    opt.textContent = target.label;
    if ((target.indices?.length || 0) > 1) setGroup.appendChild(opt);
    else singleGroup.appendChild(opt);
  }

  if (singleGroup.children.length) swapTargetSelect.appendChild(singleGroup);
  if (setGroup.children.length) swapTargetSelect.appendChild(setGroup);

  if (prev && [...swapTargetSelect.options].some((o) => o.value === prev)) {
    swapTargetSelect.value = prev;
  } else {
    swapTargetSelect.value = "";
  }
  swapTargetPickerApi?.rebuild();
  swapTargetPickerApi?.refresh();
  syncSwapSourceSelect();
}

function firstCodepointFromEmojiEntry(entry) {
  const rawId = String(entry?.id || "");
  const rawFile = String(entry?.file || "");
  const src = rawId || rawFile;
  const m = src.match(/u([0-9a-f]{4,6})/i);
  return m ? parseInt(m[1], 16) : Number.NaN;
}

function firstCodepointHexFromEmojiEntry(entry) {
  const cp = firstCodepointFromEmojiEntry(entry);
  if (!Number.isFinite(cp)) return "";
  return cp.toString(16).toLowerCase();
}

function titleCaseEmojiName(raw) {
  const s = String(raw || "").trim();
  if (!s) return s;
  return s
    .split(/\s+/)
    .map((word) => {
      if (!word) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

function getSpecialEmojiCategoryRanges(list) {
  const robotCp = 0x1F916; // 🤖
  const waveCp = 0x1F44B;  // 👋
  const flexCp = 0x1F4AA;  // 💪

  let robotIdx = -1;
  let waveIdx = -1;
  let flexIdx = -1;

  for (let i = 0; i < list.length; i++) {
    const cp = firstCodepointFromEmojiEntry(list[i]);
    if (!Number.isFinite(cp)) continue;
    if (cp === robotCp && robotIdx < 0) robotIdx = i;
    if (cp === waveCp && waveIdx < 0) waveIdx = i;
    if (cp === flexCp && flexIdx < 0) flexIdx = i;
  }

  return { robotIdx, waveIdx, flexIdx };
}

function categoryForSpecialEmojiIndex(i, ranges) {
  const { robotIdx, waveIdx, flexIdx } = ranges;
  if (waveIdx >= 0 && flexIdx >= waveIdx && i >= waveIdx && i <= flexIdx) {
    return "HANDS";
  }
  if (flexIdx >= 0 && i > flexIdx) {
    return "ANIMALS AND NATURE";
  }
  if (robotIdx >= 0 && i <= robotIdx) {
    return "SMILEYS";
  }
  return "SMILEYS";
}

function getSpecialCharTargetIndex() {
  const idx = selection?.selectedIndex;
  if (!Number.isInteger(idx) || idx < 0 || idx > 255) return null;
  return idx;
}

function isSpecialSafeTarget(idx) {
  return SPECIAL_SAFE_SET.has(idx);
}

function syncSpecialSafeModeUi() {
  specialSafeOnBtn?.classList.toggle("is-active", !!specialSafeMode);
  specialSafeOffBtn?.classList.toggle("is-active", !specialSafeMode);
}

async function getSpecialEmojiPreviewUrl(file) {
  if (!file) return "";
  const cacheKey = `${currentThemeId()}|${overlayStrokeStyle}|${file}`;
  const cached = specialEmojiPreviewUrlCache.get(cacheKey);
  if (cached) return cached;
  const data = await getSpecialEmojiGlyphByFile(file);
  const rendered = renderSpecialEmojiGlyph(data.glyph, data.width, data.height);
  const url = drawGlyphPreviewStrip([rendered], data.width, data.height, 0, pxColorViewer);
  specialEmojiPreviewUrlCache.set(cacheKey, url);
  return url;
}

function getCachedSpecialEmojiPreviewUrl(file) {
  if (!file) return "";
  const cacheKey = `${currentThemeId()}|${overlayStrokeStyle}|${file}`;
  return specialEmojiPreviewUrlCache.get(cacheKey) || "";
}

function syncSpecialEmojiMenuActive() {
  if (!specialEmojiMenu) return;
  for (const el of specialEmojiMenu.querySelectorAll(".special-emoji-option")) {
    const isActive = el.getAttribute("data-file") === selectedSpecialEmojiFile;
    el.classList.toggle("is-active", isActive);
  }
}

function invalidateSpecialEmojiMenuPreviews() {
  if (!specialEmojiMenu) return;
  specialEmojiPreviewPending.clear();
  for (const img of specialEmojiMenu.querySelectorAll(".special-emoji-option-thumb")) {
    img.removeAttribute("src");
  }
}

function queueSpecialEmojiPreview(img) {
  if (!img || img.src) return;
  const file = img.getAttribute("data-file");
  if (!file || specialEmojiPreviewPending.has(file)) return;
  const cached = getCachedSpecialEmojiPreviewUrl(file);
  if (cached) {
    img.src = cached;
    return;
  }
  specialEmojiPreviewPending.add(file);
  specialEmojiPreviewTasks.push({ img, file });
  scheduleSpecialEmojiPreviewDrain();
}

function scheduleSpecialEmojiPreviewDrain() {
  if (specialEmojiPreviewDrainRaf) return;
  specialEmojiPreviewDrainRaf = requestAnimationFrame(() => {
    specialEmojiPreviewDrainRaf = 0;
    drainSpecialEmojiPreviewQueue();
  });
}

function drainSpecialEmojiPreviewQueue() {
  while (
    specialEmojiPreviewInFlight < SPECIAL_EMOJI_PREVIEW_CONCURRENCY &&
    specialEmojiPreviewTasks.length
  ) {
    const task = specialEmojiPreviewTasks.shift();
    const img = task?.img;
    const file = task?.file;
    if (!img || !file) continue;
    if (!img.isConnected || img.src) {
      specialEmojiPreviewPending.delete(file);
      continue;
    }

    specialEmojiPreviewInFlight++;
    Promise.resolve(getSpecialEmojiPreviewUrl(file))
      .then((url) => {
        if (url && img.isConnected && !img.src) img.src = url;
      })
      .catch(() => {})
      .finally(() => {
        specialEmojiPreviewPending.delete(file);
        specialEmojiPreviewInFlight = Math.max(0, specialEmojiPreviewInFlight - 1);
        if (specialEmojiPreviewTasks.length) scheduleSpecialEmojiPreviewDrain();
      });
  }
}

function prewarmSpecialEmojiPreviews({ limit = 96 } = {}) {
  if (specialEmojiPrewarmStarted) return;
  if (!specialEmojiManifest.length) return;
  specialEmojiPrewarmStarted = true;
  const files = specialEmojiManifest
    .slice(0, Math.max(0, limit))
    .map((e) => e?.file)
    .filter(Boolean);
  let i = 0;
  const tick = () => {
    if (i >= files.length) return;
    const file = files[i++];
    Promise.resolve(getSpecialEmojiPreviewUrl(file))
      .catch(() => {})
      .finally(() => {
        if (typeof requestIdleCallback === "function") {
          requestIdleCallback(() => tick(), { timeout: 120 });
        } else {
          setTimeout(tick, 16);
        }
      });
  };
  tick();
}

function preloadVisibleSpecialEmojiThumbs({ margin = 24, max = null } = {}) {
  if (!specialEmojiMenu || !specialEmojiPicker?.classList.contains("open")) return;
  const menuRect = specialEmojiMenu.getBoundingClientRect();
  const thumbs = [...specialEmojiMenu.querySelectorAll(".special-emoji-option-thumb")];
  const cols = specialEmojiGridColumns();
  const approxRowsVisible = Math.max(1, Math.ceil(menuRect.height / 42));
  const dynamicLimit = Math.max(32, (approxRowsVisible + 2) * cols);
  const limit = Number.isFinite(max) ? max : dynamicLimit;
  let loaded = 0;
  for (const img of thumbs) {
    if (img.src) continue;
    const rect = img.getBoundingClientRect();
    const inView = rect.bottom >= (menuRect.top - margin) && rect.top <= (menuRect.bottom + margin);
    if (!inView) continue;
    queueSpecialEmojiPreview(img);
    loaded++;
    if (loaded >= limit) break;
  }
}

function scheduleVisibleSpecialEmojiPreload() {
  if (specialEmojiVisiblePreloadRaf) return;
  specialEmojiVisiblePreloadRaf = requestAnimationFrame(() => {
    specialEmojiVisiblePreloadRaf = 0;
    preloadVisibleSpecialEmojiThumbs();
  });
}

function getSpecialEmojiOptionButtons() {
  if (!specialEmojiMenu) return [];
  return [...specialEmojiMenu.querySelectorAll(".special-emoji-option")];
}

function specialEmojiGridColumns() {
  if (!specialEmojiMenu) return 1;
  const style = window.getComputedStyle(specialEmojiMenu);
  const cols = String(style.gridTemplateColumns || "")
    .split(" ")
    .map((s) => s.trim())
    .filter(Boolean).length;
  return Math.max(1, cols || 1);
}

function closeSpecialEmojiMenu() {
  specialEmojiPicker?.classList.remove("open");
  specialEmojiBtn?.setAttribute("aria-expanded", "false");
}

async function chooseSpecialEmojiFile(file, { apply = true } = {}) {
  if (!file) return;
  selectedSpecialEmojiFile = file;
  await syncSpecialEmojiButton();
  if (apply) await applySpecialCharSelection({ silentIncomplete: true });
}

async function cycleSpecialEmojiSelection(dir) {
  if (!specialEmojiManifest.length) return;
  const list = specialEmojiManifest;
  let idx = list.findIndex((e) => e.file === selectedSpecialEmojiFile);
  if (idx < 0) idx = dir > 0 ? -1 : 0;
  idx = (idx + (dir > 0 ? 1 : -1) + list.length) % list.length;
  const file = list[idx]?.file;
  if (!file) return;
  await chooseSpecialEmojiFile(file, { apply: true });
}

async function syncSpecialEmojiButton() {
  if (!specialEmojiLabel || !specialEmojiThumb) return;
  const reqId = ++specialEmojiButtonSyncReqId;
  if (!selectedSpecialEmojiFile) {
    specialEmojiLabel.textContent = "(choose emoji)";
    specialEmojiThumb.removeAttribute("src");
    specialEmojiThumb.style.display = "none";
    syncSpecialEmojiMenuActive();
    return;
  }
  const meta = specialEmojiManifest.find((entry) => entry.file === selectedSpecialEmojiFile);
  specialEmojiLabel.textContent = meta?.name || selectedSpecialEmojiFile;
  const fileAtRequest = selectedSpecialEmojiFile;

  // Instant visual continuity: reuse menu thumb if it is already rendered.
  let menuThumb = null;
  if (specialEmojiMenu) {
    for (const img of specialEmojiMenu.querySelectorAll(".special-emoji-option-thumb")) {
      if (img.getAttribute("data-file") === fileAtRequest) {
        menuThumb = img;
        break;
      }
    }
  }
  if (menuThumb?.src) {
    specialEmojiThumb.src = menuThumb.src;
    specialEmojiThumb.style.display = "block";
  }

  try {
    const url = await getSpecialEmojiPreviewUrl(fileAtRequest);
    if (reqId !== specialEmojiButtonSyncReqId || fileAtRequest !== selectedSpecialEmojiFile) return;
    if (!url) throw new Error("preview unavailable");
    specialEmojiThumb.src = url;
    specialEmojiThumb.style.display = "block";
  } catch {
    if (reqId !== specialEmojiButtonSyncReqId || fileAtRequest !== selectedSpecialEmojiFile) return;
    specialEmojiThumb.removeAttribute("src");
    specialEmojiThumb.style.display = "none";
  }
  syncSpecialEmojiMenuActive();
}

async function loadSpecialEmojiManifest() {
  try {
    specialEmojiPrewarmStarted = false;
    specialEmojiGlyphCache.clear();
    specialEmojiPreviewUrlCache.clear();
    specialEmojiMenuBuilt = false;
    const res = await fetch(SPECIAL_EMOJI_MANIFEST_PATH);
    if (!res.ok) throw new Error(`${SPECIAL_EMOJI_MANIFEST_PATH} HTTP ${res.status}`);
    const list = await res.json();
    if (!Array.isArray(list)) throw new Error(`${SPECIAL_EMOJI_MANIFEST_PATH} did not return an array`);
    specialEmojiManifest = Array.isArray(list) ? [...list] : [];
    try {
      const orderRes = await fetch(SPECIAL_EMOJI_ORDER_PATH);
      if (orderRes.ok) {
        const orderDoc = await orderRes.json();
        const orderObj = orderDoc?.orderByFirstCodepoint && typeof orderDoc.orderByFirstCodepoint === "object"
          ? orderDoc.orderByFirstCodepoint
          : (orderDoc && typeof orderDoc === "object" ? orderDoc : null);
        const nameObj = orderDoc?.nameByFirstCodepoint && typeof orderDoc.nameByFirstCodepoint === "object"
          ? orderDoc.nameByFirstCodepoint
          : null;
        specialEmojiOrderByFirstCodepoint = orderObj;
        specialEmojiNameByFirstCodepoint = nameObj;
      }
    } catch {
      specialEmojiOrderByFirstCodepoint = null;
      specialEmojiNameByFirstCodepoint = null;
    }
    try {
      const symbolsRes = await fetch(SPECIAL_EMOJI_SYMBOLS_PATH);
      if (symbolsRes.ok) {
        const symbolsDoc = await symbolsRes.json();
        const list = Array.isArray(symbolsDoc?.codepoints) ? symbolsDoc.codepoints : [];
        specialEmojiSymbolCodepoints = new Set(
          list.map((v) => String(v || "").toLowerCase()).filter(Boolean),
        );
      } else {
        specialEmojiSymbolCodepoints = null;
      }
    } catch {
      specialEmojiSymbolCodepoints = null;
    }
    const cpFromEntry = (entry) => {
      const rawId = String(entry?.id || "");
      const rawFile = String(entry?.file || "");
      const src = rawId || rawFile;
      const m = src.match(/u([0-9a-f]{4,6})/i);
      return m ? parseInt(m[1], 16) : Number.POSITIVE_INFINITY;
    };
    const rankFromEntry = (entry) => {
      if (!specialEmojiOrderByFirstCodepoint) return Number.POSITIVE_INFINITY;
      const cp = cpFromEntry(entry);
      if (!Number.isFinite(cp)) return Number.POSITIVE_INFINITY;
      const key = cp.toString(16).toLowerCase();
      const rankRaw = specialEmojiOrderByFirstCodepoint[key];
      const rank = Number(rankRaw);
      return Number.isFinite(rank) ? rank : Number.POSITIVE_INFINITY;
    };
    const normalizeName = (entry) => {
      const rawName = String(entry?.name || "").trim();
      const placeholder = rawName === "" || /^emoji[ _]\d+$/i.test(rawName);
      if (!placeholder || !specialEmojiNameByFirstCodepoint) return rawName;
      const cp = cpFromEntry(entry);
      if (!Number.isFinite(cp)) return rawName;
      const key = cp.toString(16).toLowerCase();
      const canonical = String(specialEmojiNameByFirstCodepoint[key] || "").trim();
      return canonical || rawName;
    };
    specialEmojiManifest = specialEmojiManifest.map((entry) => ({
      ...entry,
      name: titleCaseEmojiName(normalizeName(entry)),
    }));
    specialEmojiManifest.sort((a, b) => {
      const ra = rankFromEntry(a);
      const rb = rankFromEntry(b);
      if (ra !== rb) return ra - rb;
      const ca = cpFromEntry(a);
      const cb = cpFromEntry(b);
      if (ca !== cb) return ca - cb;
      return String(a?.name || "").localeCompare(String(b?.name || ""), undefined, { sensitivity: "base" });
    });
    prewarmSpecialEmojiPreviews();
  } catch (err) {
    console.warn("Failed to load emoji manifest", err);
    specialEmojiManifest = [];
    specialEmojiMenuBuilt = false;
  }
}

async function getSpecialEmojiGlyphByFile(file) {
  if (!file) throw new Error("Missing emoji file");
  if (specialEmojiGlyphCache.has(file)) return specialEmojiGlyphCache.get(file);
  const res = await fetch(`${SPECIAL_EMOJI_DATA_DIR}/${encodeURIComponent(file)}`);
  if (!res.ok) throw new Error(`special emoji fetch HTTP ${res.status} for ${file}`);
  const j = await res.json();
  const width = Number(j?.width);
  const height = Number(j?.height);
  const glyphRaw = Array.isArray(j?.glyph) ? j.glyph : null;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid dimensions in ${file}`);
  }
  if (!glyphRaw || glyphRaw.length !== width * height) {
    throw new Error(`Invalid glyph payload in ${file}`);
  }
  const glyph = new Uint8Array(glyphRaw.map((v) => {
    const n = Number(v) | 0;
    if (n === 1 || n === 2 || n === 3) return n;
    return 1;
  }));
  const data = { width, height, glyph };
  specialEmojiGlyphCache.set(file, data);
  return data;
}

function renderSpecialEmojiGlyph(sourceGlyph, w, h) {
  const fillMask = new Uint8Array(w * h);
  fillMask.fill(1);
  for (let i = 0; i < fillMask.length; i++) {
    const p = sourceGlyph[i] | 0;
    if (p === 2 || p === 3) fillMask[i] = 2;
  }

  const stroked = overlayStrokeStyle === "8"
    ? applyStroke8(fillMask, w, h)
    : applyStroke4(fillMask, w, h);

  // Preserve intended fill details after stroke pass, including internal black pools.
  for (let i = 0; i < stroked.length; i++) {
    const p = sourceGlyph[i] | 0;
    if (p === 2) stroked[i] = 2;
    else if (p === 3) stroked[i] = 3;
  }
  return stroked;
}

async function refreshSpecialCharEmojiAssignments({ rerender = true } = {}) {
  if (!baseFont || specialCharEmojiAssignments.size === 0) return;
  let changed = false;
  for (const [targetIdx, file] of specialCharEmojiAssignments.entries()) {
    if (!Number.isInteger(targetIdx) || targetIdx < 0 || targetIdx > 255 || !file) continue;
    try {
      const data = await getSpecialEmojiGlyphByFile(file);
      if (data.width !== baseFont.width || data.height !== baseFont.height) continue;
      swapOverrides.set(targetIdx, renderSpecialEmojiGlyph(data.glyph, data.width, data.height));
      changed = true;
    } catch (err) {
      console.warn("Failed to refresh special emoji assignment", targetIdx, file, err);
    }
  }
  if (changed && rerender) {
    rebuildResultFont();
    rerenderAll();
  }
}

async function buildSpecialEmojiMenu() {
  if (!specialEmojiMenu) return;
  if (specialEmojiMenuBuilt) {
    syncSpecialEmojiMenuActive();
    return;
  }
  specialEmojiMenu.innerHTML = "";

  if (!specialEmojiManifest.length) {
    const empty = document.createElement("div");
    empty.className = "fontpicker-group";
    empty.textContent = "No emoji loaded";
    specialEmojiMenu.appendChild(empty);
    return;
  }

  const regularEntries = [];
  const symbolEntries = [];
  for (const entry of specialEmojiManifest) {
    const cpHex = firstCodepointHexFromEmojiEntry(entry);
    if (cpHex && specialEmojiSymbolCodepoints?.has(cpHex)) symbolEntries.push(entry);
    else regularEntries.push(entry);
  }

  const fragment = document.createDocumentFragment();

  const appendGroupHeader = (text) => {
    const group = document.createElement("div");
    group.className = "fontpicker-group";
    group.textContent = text;
    fragment.appendChild(group);
  };

  const appendEntry = (entry) => {
    const file = entry?.file;
    if (!file) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "special-emoji-option";
    btn.setAttribute("data-file", file);
    btn.title = entry?.name || file;

    const img = document.createElement("img");
    img.className = "special-emoji-option-thumb";
    img.alt = "";
    img.setAttribute("data-file", file);
    btn.appendChild(img);

    fragment.appendChild(btn);
  };

  if (regularEntries.length) {
    const ranges = getSpecialEmojiCategoryRanges(regularEntries);
    let lastCategory = "";
    for (let i = 0; i < regularEntries.length; i++) {
      const entry = regularEntries[i];
      const category = categoryForSpecialEmojiIndex(i, ranges);
      if (category !== lastCategory) {
        appendGroupHeader(category);
        lastCategory = category;
      }
      appendEntry(entry);
    }
  }

  if (symbolEntries.length) {
    appendGroupHeader("SYMBOLS");
    for (const entry of symbolEntries) {
      appendEntry(entry);
    }
  }

  specialEmojiMenu.appendChild(fragment);
  syncSpecialEmojiMenuActive();
  specialEmojiMenuBuilt = true;
}

async function applySpecialCharSelection({ silentIncomplete = false } = {}) {
  const targetIdx = getSpecialCharTargetIndex();
  if (!baseFont) {
    if (!silentIncomplete) setLoadStatus("Load a base font first.", { error: true });
    return;
  }
  if (targetIdx == null || !selectedSpecialEmojiFile) {
    if (!silentIncomplete) setLoadStatus("Select a glyph in preview + emoji first.");
    return;
  }
  if (specialSafeMode && !isSpecialSafeTarget(targetIdx)) {
    const ch = String.fromCharCode(targetIdx);
    const cp = `U+${targetIdx.toString(16).toUpperCase().padStart(4, "0")}`;
    setLoadStatus(`Safe mode is ON. ${ch} (${cp}) is not in the safe set (! " # % & ' , ; = ?).`, { error: true });
    return;
  }

  try {
    const data = await getSpecialEmojiGlyphByFile(selectedSpecialEmojiFile);
    if (data.width !== baseFont.width || data.height !== baseFont.height) {
      setLoadStatus(
        `Emoji size ${data.width}x${data.height} does not match base font ${baseFont.width}x${baseFont.height}.`,
        { error: true },
      );
      return;
    }
    const renderedGlyph = renderSpecialEmojiGlyph(data.glyph, data.width, data.height);
    swapOverrides.set(targetIdx, renderedGlyph);
    specialCharEmojiAssignments.set(targetIdx, selectedSpecialEmojiFile);
    selection.selectedSet = new Set([targetIdx]);
    selection.selectionAnchor = targetIdx;
    selection.selectedIndex = targetIdx;
    holdOriginalPreview = false;
    holdOriginalPreviewBtn?.classList.remove("is-holding");
    rebuildResultFont();
    rerenderAll();
    const targetChar = String.fromCharCode(targetIdx);
    const sourceMeta = specialEmojiManifest.find((entry) => entry.file === selectedSpecialEmojiFile);
    setLoadStatus(`Applied special character: ${targetChar} from ${sourceMeta?.name || selectedSpecialEmojiFile}`);
  } catch (err) {
    console.error("Special character apply failed", err);
    setLoadStatus("Failed to apply special character.", { error: true });
  }
}

async function initSpecialCharUI() {
  if (!specialEmojiBtn || !specialEmojiMenu) return;

  await loadSpecialEmojiManifest();
  await syncSpecialEmojiButton();
  syncSpecialSafeModeUi();

  specialEmojiBtn.addEventListener("click", async () => {
    const opening = !specialEmojiPicker.classList.contains("open");
    if (opening) {
      await buildSpecialEmojiMenu();
    }
    specialEmojiPicker.classList.toggle("open", opening);
    specialEmojiBtn.setAttribute("aria-expanded", opening ? "true" : "false");
    if (opening) {
      scheduleVisibleSpecialEmojiPreload();
      setTimeout(() => scheduleVisibleSpecialEmojiPreload(), 60);
    }
  });

  specialEmojiBtn.addEventListener("keydown", async (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (specialEmojiPicker?.classList.contains("open")) {
        const first = getSpecialEmojiOptionButtons()[0];
        first?.focus();
        queueSpecialEmojiPreview(first?.querySelector(".special-emoji-option-thumb"));
      } else {
        await cycleSpecialEmojiSelection(1);
      }
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (specialEmojiPicker?.classList.contains("open")) {
        const options = getSpecialEmojiOptionButtons();
        const last = options[options.length - 1];
        last?.focus();
        queueSpecialEmojiPreview(last?.querySelector(".special-emoji-option-thumb"));
      } else {
        await cycleSpecialEmojiSelection(-1);
      }
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const opening = !specialEmojiPicker.classList.contains("open");
      if (opening) {
        await buildSpecialEmojiMenu();
        specialEmojiPicker.classList.add("open");
        specialEmojiBtn.setAttribute("aria-expanded", "true");
        scheduleVisibleSpecialEmojiPreload();
        const options = getSpecialEmojiOptionButtons();
        const current = options.find((o) => o.getAttribute("data-file") === selectedSpecialEmojiFile);
        const target = current || options[0];
        target?.focus();
      } else {
        closeSpecialEmojiMenu();
      }
      return;
    }
    if (e.key === "Escape") {
      closeSpecialEmojiMenu();
    }
  });

  specialEmojiMenu.addEventListener("scroll", scheduleVisibleSpecialEmojiPreload, { passive: true });
  window.addEventListener("resize", scheduleVisibleSpecialEmojiPreload);

  if (!specialEmojiMenuEventsBound) {
    specialEmojiMenu.addEventListener("mouseover", (e) => {
      const btn = e.target?.closest?.(".special-emoji-option");
      if (!btn || !specialEmojiMenu.contains(btn)) return;
      queueSpecialEmojiPreview(btn.querySelector(".special-emoji-option-thumb"));
    });
    specialEmojiMenu.addEventListener("focusin", (e) => {
      const btn = e.target?.closest?.(".special-emoji-option");
      if (!btn || !specialEmojiMenu.contains(btn)) return;
      queueSpecialEmojiPreview(btn.querySelector(".special-emoji-option-thumb"));
    });
    specialEmojiMenu.addEventListener("click", async (e) => {
      const btn = e.target?.closest?.(".special-emoji-option");
      if (!btn || !specialEmojiMenu.contains(btn)) return;
      const file = btn.getAttribute("data-file") || "";
      if (!file) return;
      closeSpecialEmojiMenu();
      await chooseSpecialEmojiFile(file, { apply: true });
    });
    specialEmojiMenu.addEventListener("keydown", async (e) => {
      const btn = e.target?.closest?.(".special-emoji-option");
      if (!btn || !specialEmojiMenu.contains(btn)) return;
      const options = getSpecialEmojiOptionButtons();
      if (!options.length) return;
      const cur = options.indexOf(btn);
      const cols = specialEmojiGridColumns();
      let next = cur;

      if (e.key === "Escape") {
        e.preventDefault();
        closeSpecialEmojiMenu();
        specialEmojiBtn?.focus();
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const file = btn.getAttribute("data-file") || "";
        if (!file) return;
        closeSpecialEmojiMenu();
        await chooseSpecialEmojiFile(file, { apply: true });
        return;
      }
      if (e.key === "ArrowRight") next = Math.min(options.length - 1, cur + 1);
      else if (e.key === "ArrowLeft") next = Math.max(0, cur - 1);
      else if (e.key === "ArrowDown") next = Math.min(options.length - 1, cur + cols);
      else if (e.key === "ArrowUp") next = Math.max(0, cur - cols);
      else return;

      e.preventDefault();
      options[next]?.focus();
      queueSpecialEmojiPreview(options[next]?.querySelector(".special-emoji-option-thumb"));
    });
    specialEmojiMenuEventsBound = true;
  }

  document.addEventListener("mousedown", (event) => {
    if (!specialEmojiPicker?.contains(event.target)) {
      specialEmojiPicker?.classList.remove("open");
      specialEmojiBtn?.setAttribute("aria-expanded", "false");
    }
  });

  clearSpecialCharBtn?.addEventListener("click", () => {
    const targetIdx = getSpecialCharTargetIndex();
    if (targetIdx == null) return;
    swapOverrides.delete(targetIdx);
    specialCharEmojiAssignments.delete(targetIdx);
    rebuildResultFont();
    rerenderAll();
    const targetChar = String.fromCharCode(targetIdx);
    setLoadStatus(`Cleared special character: ${targetChar}`);
  });

  specialSafeOnBtn?.addEventListener("click", () => {
    if (specialSafeMode) return;
    specialSafeMode = true;
    localStorage.setItem(SPECIAL_SAFE_MODE_KEY, "on");
    syncSpecialSafeModeUi();
    setLoadStatus("Safe mode: ON (only safe characters: ! \" # % & ' , ; = ?)");
  });
  specialSafeOffBtn?.addEventListener("click", () => {
    if (!specialSafeMode) return;
    specialSafeMode = false;
    localStorage.setItem(SPECIAL_SAFE_MODE_KEY, "off");
    syncSpecialSafeModeUi();
    setLoadStatus("Safe mode: OFF (any character can be replaced)");
  });
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

function colorToGlyphValueSplash(r, g, b, a) {
  if (a < 16) return 1;
  if (r <= 24 && g >= 232 && b <= 24) return 1; // Betaflight transparent green (#00FF00)
  return colorToGlyphValue(r, g, b, a);
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

async function decodeBootSplashPng(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();

    if (img.width !== BOOT_SPLASH_PNG_WIDTH || img.height !== BOOT_SPLASH_PNG_HEIGHT) {
      throw new Error(`Expected ${BOOT_SPLASH_PNG_WIDTH}x${BOOT_SPLASH_PNG_HEIGHT}; got ${img.width}x${img.height}`);
    }

    const glyphWidth = BOOT_SPLASH_PNG_WIDTH / BOOT_SPLASH_COLS;
    const glyphHeight = BOOT_SPLASH_PNG_HEIGHT / BOOT_SPLASH_ROWS;
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    const glyphs = new Array(BOOT_SPLASH_GLYPH_COUNT);
    for (let tile = 0; tile < BOOT_SPLASH_GLYPH_COUNT; tile++) {
      const col = tile % BOOT_SPLASH_COLS;
      const row = Math.floor(tile / BOOT_SPLASH_COLS);
      const sx = col * glyphWidth;
      const sy = row * glyphHeight;
      const out = new Uint8Array(glyphWidth * glyphHeight);
      for (let y = 0; y < glyphHeight; y++) {
        for (let x = 0; x < glyphWidth; x++) {
          const p = (((sy + y) * canvas.width) + (sx + x)) * 4;
          out[y * glyphWidth + x] = colorToGlyphValueSplash(
            pixels[p],
            pixels[p + 1],
            pixels[p + 2],
            pixels[p + 3],
          );
        }
      }
      glyphs[tile] = out;
    }

    return glyphs;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function applyBootSplashFile(file) {
  if (!baseFont) {
    setLoadStatus("Load a base font first.", { error: true });
    return;
  }
  if (!isPngFile(file) && !isBmpFile(file)) {
    setLoadStatus("Please choose a .png or .bmp file for boot splash import.", { error: true });
    return;
  }
  if ((baseFont.width || 12) !== 12 || (baseFont.height || 18) !== 18) {
    setLoadStatus("Boot splash import requires a 12x18 font cell size.", { error: true });
    return;
  }

  let splashGlyphs;
  try {
    splashGlyphs = await decodeBootSplashPng(file);
  } catch (err) {
    console.error("Boot splash PNG import failed for", file.name, err);
    setLoadStatus(`Failed boot splash import: ${file.name}`, { error: true, subtext: err?.message || "" });
    return;
  }

  for (let tile = 0; tile < BOOT_SPLASH_GLYPH_COUNT; tile++) {
    swapOverrides.set(BOOT_SPLASH_START_INDEX + tile, splashGlyphs[tile]);
  }
  holdOriginalPreview = false;
  holdOriginalPreviewBtn?.classList.remove("is-holding");
  rebuildResultFont();
  rerenderAll();
  setLoadStatus(`Loaded boot splash image: ${file.name}`, { subtext: `${BOOT_SPLASH_GLYPH_COUNT} glyphs` });
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
  syncOverlayStrokeStyleUI();
  strokeStyle4Btn?.addEventListener("click", () => setOverlayStrokeStyle("4"));
  strokeStyle8Btn?.addEventListener("click", () => setOverlayStrokeStyle("8"));

  if (swapTargetSelect) {
    swapTargetSelect.innerHTML = `<option value="">(load font first)</option>`;
  }

  swapTargetPickerApi = buildFontPicker({
    selectEl: swapTargetSelect,
    getLabel: (opt) => opt.textContent,
    getValue: (opt) => opt.value,
    getPreviewUrl: (value) => getSwapTargetPreviewUrl(value),
    lazyMenuPreviews: true,
  });

  swapSourcePickerApi = buildFontPicker({
    selectEl: swapSourceSelect,
    getLabel: (opt) => opt.textContent,
    getValue: (opt) => opt.value,
    getPreviewUrl: (value) => getSwapSourcePreviewUrl(value),
    lazyMenuPreviews: true,
  });

  const selectTargetInGrid = (targetId) => {
    const target = swapTargetsById.get(targetId);
    if (!target || !Array.isArray(target.indices) || target.indices.length === 0) return;

    selection.selectedSet = new Set(target.indices);
    selection.selectionAnchor = target.indices[0];
    selection.selectedIndex = target.indices[0];
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
        selection.selectedIndex = out.focusIndex;
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

  syncSwapTargetSelect();

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
  rerenderAll({ renderBase: false, renderBootSplash: false });
}

function applySelectionNudge(dx, dy) {
  for (const idx of selection.selectedSet) {
    const cur = nudge.perGlyph.get(idx) || { x: 0, y: 0 };
    nudge.perGlyph.set(idx, {
      x: clampInt(cur.x + dx, -6, 6),
      y: clampInt(cur.y + dy, -6, 6),
    });
  }
  rebuildResultFont();
  rerenderAll({ renderBase: false, renderBootSplash: false });
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

  return overlayStrokeStyle === "8"
    ? applyStroke8(out, cellW, cellH)
    : applyStroke4(out, cellW, cellH);
}

function overlayGlyphHasInk(overlayGlyph) {
  if (!overlayGlyph || !Array.isArray(overlayGlyph.size) || !Array.isArray(overlayGlyph.rows)) {
    return false;
  }
  const w = overlayGlyph.size[0] | 0;
  const h = overlayGlyph.size[1] | 0;
  if (w <= 0 || h <= 0) return false;
  for (let y = 0; y < h; y++) {
    const row = (overlayGlyph.rows[y] >>> 0);
    if (row !== 0) return true;
  }
  return false;
}

/* -----------------------------
   Rebuild result font
------------------------------ */

function rebuildResultFont() {
  if (!baseFont) return;

  resultFont = cloneFont(baseFont);
  replacedOverlayIndices.clear();

  if (currentOverlay) {
    for (let i = 0; i < 256; i++) {
      if (!isReplaceable(i)) continue;

      const key = `U+${i.toString(16).padStart(4, "0").toUpperCase()}`;
      const og = currentOverlay.glyphs?.[key];
      if (!og) continue;
      // Keep base/default glyph when overlay slot is blank (common in arcade sets),
      // but allow U+0020 space to remain blank by design.
      if (i !== 0x20 && !overlayGlyphHasInk(og)) continue;

      resultFont.glyphs[i] = renderOverlayToCell(og, i);
      replacedOverlayIndices.add(i);
    }
  }

  // Apply explicit swap overrides (single glyphs / sets).
  for (const [idx, glyph] of swapOverrides.entries()) {
    if (idx < 0 || idx > 255) continue;
    resultFont.glyphs[idx] = new Uint8Array(glyph);
  }

  // Apply "Nudge replaced" to ASCII glyphs edited in pixel editor so they
  // continue behaving like replaced characters.
  const replacedDx = nudge.replaced.x | 0;
  const replacedDy = nudge.replaced.y | 0;
  if ((replacedDx !== 0 || replacedDy !== 0) && editorOverrideIndices.size) {
    for (const idx of editorOverrideIndices) {
      if (idx < 0 || idx > 255 || !replacedOverlayIndices.has(idx)) continue;
      resultFont.glyphs[idx] = shiftGlyphPixels(resultFont.glyphs[idx], resultFont.width, resultFont.height, replacedDx, replacedDy);
    }
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
  if (!file) return "";
  const cacheKey = `${currentThemeId()}|${file}`;
  const cached = bfPreviewUrlCache.get(cacheKey);
  if (cached) return cached;

  // file is like "betaflight.mcm"
  let font = bfPreviewFontCache.get(file);
  if (!font) {
    const r = await fetch(`./fonts/betaflight/${encodeURIComponent(file)}`);
    if (!r.ok) throw new Error(`preview fetch HTTP ${r.status} for ${file}`);
    const buf = await r.arrayBuffer();
    font = decodeMCM(buf);
    bfPreviewFontCache.set(file, font);
  }
  const url = drawFontPreviewStrip(font, "ABC123", pxColorViewer);
  bfPreviewUrlCache.set(cacheKey, url);
  return url;
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
  const cacheKey = `${currentThemeId()}|${overlayStrokeStyle}|${file}`;
  const cached = overlayPreviewUrlCache.get(cacheKey);
  if (cached) return cached;
  const overlay = await getOverlayByFile(file);
  const url = drawOverlayPreviewStrip(overlay, overlayPreviewText(overlay), pxColorViewer, overlayStrokeStyle);
  overlayPreviewUrlCache.set(cacheKey, url);
  return url;
}

function overlayPreviewText(overlay) {
  const preferred = "ABC123";
  const glyphs = overlay?.glyphs;
  if (!glyphs || typeof glyphs !== "object") return preferred;

  const hasGlyph = (cp) => Object.prototype.hasOwnProperty.call(glyphs, `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`);
  if ([...preferred].every((ch) => hasGlyph(ch.charCodeAt(0)))) return preferred;

  const cps = Object.keys(glyphs)
    .map((k) => {
      const m = /^U\+([0-9A-Fa-f]{4,6})$/.exec(k);
      if (!m) return null;
      const cp = parseInt(m[1], 16);
      return Number.isFinite(cp) ? cp : null;
    })
    .filter((cp) => cp != null && cp >= 0x20 && cp <= 0xFFFF && cp !== 0x7F)
    .sort((a, b) => a - b);

  const sample = [];
  for (const cp of cps) {
    try {
      const ch = String.fromCodePoint(cp);
      if (!ch.trim() && cp !== 0x20) continue;
      sample.push(ch);
      if (sample.length >= 6) break;
    } catch {
      // skip invalid codepoints
    }
  }

  return sample.length ? sample.join("") : preferred;
}

function syncOverlayStrokeStyleUI() {
  strokeStyle4Btn?.classList.toggle("is-active", overlayStrokeStyle === "4");
  strokeStyle8Btn?.classList.toggle("is-active", overlayStrokeStyle === "8");
}

function setOverlayStrokeStyle(nextStyle) {
  const style = nextStyle === "8" ? "8" : "4";
  if (overlayStrokeStyle === style) return;
  overlayStrokeStyle = style;
  localStorage.setItem(OVERLAY_STROKE_STYLE_KEY, overlayStrokeStyle);
  syncOverlayStrokeStyleUI();
  clearDynamicPreviewCaches();
  invalidateSpecialEmojiMenuPreviews();
  overlayPickerApi?.refresh();
  syncSpecialEmojiButton();
  if (specialCharEmojiAssignments.size > 0) {
    Promise.resolve(refreshSpecialCharEmojiAssignments({ rerender: false }))
      .catch(() => {})
      .finally(() => {
        rebuildResultFont();
        rerenderAll();
      });
  } else {
    rebuildResultFont();
    rerenderAll();
  }
  setLoadStatus(`Stroke style: ${style === "8" ? "8-way" : "4-way"}`);
}


/* -----------------------------
   Rendering: grid + zoom
------------------------------ */


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

function renderBootSplashPreview(font) {
  if (!bootSplashPreviewCanvas || !bootSplashPreviewCtx) return;

  const glyphWidth = Math.max(1, font?.width || 12);
  const glyphHeight = Math.max(1, font?.height || 18);
  const canvasWidth = BOOT_SPLASH_COLS * glyphWidth;
  const canvasHeight = BOOT_SPLASH_ROWS * glyphHeight;

  if (bootSplashPreviewCanvas.width !== canvasWidth) bootSplashPreviewCanvas.width = canvasWidth;
  if (bootSplashPreviewCanvas.height !== canvasHeight) bootSplashPreviewCanvas.height = canvasHeight;
  bootSplashPreviewCtx.clearRect(0, 0, canvasWidth, canvasHeight);

  if (!font?.glyphs) return;

  for (let tile = 0; tile < BOOT_SPLASH_GLYPH_COUNT; tile++) {
    const glyph = font.glyphs[BOOT_SPLASH_START_INDEX + tile];
    if (!glyph) continue;

    const col = tile % BOOT_SPLASH_COLS;
    const row = Math.floor(tile / BOOT_SPLASH_COLS);
    const ox = col * glyphWidth;
    const oy = row * glyphHeight;

    for (let y = 0; y < glyphHeight; y++) {
      for (let x = 0; x < glyphWidth; x++) {
        const v = glyph[y * glyphWidth + x];
        if (v === 1) continue;
        bootSplashPreviewCtx.fillStyle = pxColorViewer(v);
        bootSplashPreviewCtx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  }
}

function rerenderAll({ renderBase = true, renderBootSplash = true } = {}) {
  const hasBase = !!baseFont;
  const hasResult = !!resultFont;
  const displayFont = (hasBase && hasResult)
    ? (holdOriginalPreview ? baseFont : resultFont)
    : (resultFont || baseFont || null);

  if (renderBase && hasBase && viewMode !== VIEW_MODE_HUD) {
    workspaceRenderer.renderGrid(baseGridCtx, baseGridCanvas, baseFont, { showGrids, selectedSet: selection.selectedSet });
  } else if (renderBase && baseGridCtx && baseGridCanvas && viewMode !== VIEW_MODE_HUD) {
    workspaceRenderer.renderPlaceholderGrid(baseGridCtx, baseGridCanvas, 12, 18, { showGrids });
  }

  if (viewMode === VIEW_MODE_HUD) {
    hudRenderState = hudRenderer.renderHud(resultHudCtx, resultHudCanvas, displayFont, {
      showGuides: showGrids,
      enabledElements: enabledHudElements,
      videoFormat: hudVideoFormat,
      layout: hudLayout,
      labels: hudLabels,
    });
  } else {
    hudRenderState = null;
    if (displayFont) {
      workspaceRenderer.renderGrid(resultGridCtx, resultGridCanvas, displayFont, { showGrids, selectedSet: selection.selectedSet });
    } else if (resultGridCtx && resultGridCanvas) {
      workspaceRenderer.renderPlaceholderGrid(resultGridCtx, resultGridCanvas, 12, 18, { showGrids });
    }
  }

  if (displayFont) {
    if (viewMode !== VIEW_MODE_HUD) {
      workspaceRenderer.renderZoom(resultZoomCtx, resultZoomCanvas, displayFont, selection.selectedIndex, { showGrids });
      updateInfoPanel(selection.selectedIndex);
    }
    updateSelectionCount();
  } else {
    if (glyphInfo) glyphInfo.textContent = "(Load a font, then click a glyph.)";
    updateSelectionCount();
  }
  if (renderBootSplash) {
    renderBootSplashPreview(resultFont || baseFont || null);
  }
}

function scheduleRerender() {
  if (rerenderRafPending) return;
  rerenderRafPending = true;
  requestAnimationFrame(() => {
    rerenderRafPending = false;
    rerenderAll();
  });
}

function hudCanvasPoint(e) {
  if (!resultHudCanvas) return null;
  const rect = resultHudCanvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const sx = resultHudCanvas.width / rect.width;
  const sy = resultHudCanvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * sx,
    y: (e.clientY - rect.top) * sy,
  };
}

function hitTestHudElement(x, y) {
  if (!hudRenderState?.elementRects || !hudRenderState?.elementOrder?.length) return null;
  for (let i = hudRenderState.elementOrder.length - 1; i >= 0; i--) {
    const id = hudRenderState.elementOrder[i];
    const r = hudRenderState.elementRects[id];
    if (!r) continue;
    if (x >= r.x && x <= (r.x + r.w) && y >= r.y && y <= (r.y + r.h)) return { id, rect: r };
  }
  return null;
}

function setHudCanvasCursor(cursor) {
  if (!resultHudCanvas) return;
  resultHudCanvas.style.cursor = cursor;
}

/* -----------------------------
   Grid click handling
------------------------------ */

function handleGridClick(e, canvas, font) {
  const idx = workspaceRenderer.gridClickToIndex(e, canvas, font);
  if (idx == null) return;

  if (e.shiftKey) rangeSelect(idx);
  else if (e.ctrlKey || e.metaKey) toggleSelection(idx);
  else setSingleSelection(idx);

  rerenderAll();
}

function zoomEventToPixel(e, canvas, font) {
  if (!canvas || !font) return null;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  const x = (e.clientX - rect.left) * sx;
  const y = (e.clientY - rect.top) * sy;

  const zoomScale = Math.max(1, Math.floor(Math.min(canvas.width / font.width, canvas.height / font.height)));
  const ox = Math.floor((canvas.width - font.width * zoomScale) / 2);
  const oy = Math.floor((canvas.height - font.height * zoomScale) / 2);
  if (x < ox || y < oy) return null;
  if (x >= ox + font.width * zoomScale || y >= oy + font.height * zoomScale) return null;

  const px = Math.floor((x - ox) / zoomScale);
  const py = Math.floor((y - oy) / zoomScale);
  if (px < 0 || py < 0 || px >= font.width || py >= font.height) return null;
  return { x: px, y: py };
}

function applyEditorPixel(e) {
  if (viewMode !== VIEW_MODE_SHEET || zoomMode !== ZOOM_MODE_EDITOR) return;
  if (!baseFont || !resultFont) return;
  const idx = selection.selectedIndex;
  if (idx == null || idx < 0 || idx > 255) return;
  const p = zoomEventToPixel(e, resultZoomCanvas, resultFont);
  if (!p) return;

  const src = resultFont.glyphs?.[idx];
  if (!src) return;
  const next = new Uint8Array(src);
  const pos = p.y * resultFont.width + p.x;
  const value = editorColorValue | 0;
  if (next[pos] === value) return;
  next[pos] = value;

  holdOriginalPreview = false;
  holdOriginalPreviewBtn?.classList.remove("is-holding");
  swapOverrides.set(idx, next);
  editorOverrideIndices.add(idx);
  resultFont.glyphs[idx] = next;
  workspaceRenderer.renderZoom(resultZoomCtx, resultZoomCanvas, resultFont, selection.selectedIndex, { showGrids });
  zoomPaint.dirty = true;
}

function commitZoomPaintIfNeeded() {
  if (zoomPaint.dirty && zoomPaint.startGlyph && zoomPaint.startIndex >= 0) {
    editorUndo.glyph = new Uint8Array(zoomPaint.startGlyph);
    editorUndo.index = zoomPaint.startIndex;
  }
  zoomPaint.active = false;
  zoomPaint.dirty = false;
  zoomPaint.startGlyph = null;
  zoomPaint.startIndex = -1;
  rerenderAll({ renderBase: false, renderBootSplash: false });
}

function applyEditorUndo() {
  if (!baseFont || !resultFont) return;
  if (!editorUndo.glyph || editorUndo.index < 0 || editorUndo.index > 255) return;

  holdOriginalPreview = false;
  holdOriginalPreviewBtn?.classList.remove("is-holding");
  swapOverrides.set(editorUndo.index, new Uint8Array(editorUndo.glyph));
  editorOverrideIndices.add(editorUndo.index);
  resultFont.glyphs[editorUndo.index] = new Uint8Array(editorUndo.glyph);
  setSingleSelection(editorUndo.index);
  rerenderAll({ renderBase: false, renderBootSplash: false });

  editorUndo.glyph = null;
  editorUndo.index = -1;
}

/* -----------------------------
   Export helpers
------------------------------ */

function safeBaseName() {
  const overlayName = overlaySelect?.value
    ? overlaySelect.value
        .replace(/\.[^.]+$/i, "")
        .replace(/[^a-z0-9._-]+/gi, "_")
    : "no-overlay";
  return `osd_font_lab_${overlayName}`;
}

/* -----------------------------
   Overlay manifest + loading
------------------------------ */

async function loadManifest() {
  const lib = OVERLAY_LIBRARIES.find((l) => l.id === currentOverlayLibraryId) || OVERLAY_LIBRARIES[0];
  currentOverlayLibraryId = lib.id;
  if (overlayManifestCache.has(lib.id)) {
    overlayManifest = overlayManifestCache.get(lib.id);
    return overlayManifest;
  }
  const res = await fetch(lib.manifestPath);
  if (!res.ok) throw new Error(`${lib.manifestPath} HTTP ${res.status}`);
  const list = await res.json();
  if (!Array.isArray(list)) throw new Error(`${lib.manifestPath} did not return an array`);
  overlayManifestCache.set(lib.id, list);
  overlayManifest = list;
  return list;
}

async function loadManifestForLibrary(libraryId) {
  const lib = OVERLAY_LIBRARIES.find((l) => l.id === libraryId);
  if (!lib) return [];
  if (overlayManifestCache.has(lib.id)) {
    return overlayManifestCache.get(lib.id);
  }
  const res = await fetch(lib.manifestPath);
  if (!res.ok) throw new Error(`${lib.manifestPath} HTTP ${res.status}`);
  const list = await res.json();
  if (!Array.isArray(list)) throw new Error(`${lib.manifestPath} did not return an array`);
  overlayManifestCache.set(lib.id, list);
  return list;
}

async function loadAllOverlayManifests() {
  const all = [];
  for (const lib of OVERLAY_LIBRARIES) {
    try {
      let list = overlayManifestCache.get(lib.id);
      if (!list) {
        const res = await fetch(lib.manifestPath);
        if (!res.ok) throw new Error(`${lib.manifestPath} HTTP ${res.status}`);
        list = await res.json();
        if (!Array.isArray(list)) throw new Error(`${lib.manifestPath} did not return an array`);
        overlayManifestCache.set(lib.id, list);
      }
      for (const entry of list) {
        all.push({ ...entry, __libraryId: lib.id });
      }
    } catch (err) {
      console.warn(`Brand title: skipping unavailable library ${lib.id}`, err);
    }
  }
  return all;
}

async function updateServingFontCount() {
  if (!servingFontCountEl) return;
  servingFontCountEl.textContent = "...";
  try {
    const all = await loadAllOverlayManifests();
    servingFontCountEl.textContent = String(all.length);
  } catch (err) {
    console.warn("Failed to compute serving font count", err);
    servingFontCountEl.textContent = "?";
  }
}

function isLibrarySelectValue(value) {
  return typeof value === "string" && value.startsWith(LIB_SELECT_PREFIX);
}

function libraryIdFromSelectValue(value) {
  if (!isLibrarySelectValue(value)) return "";
  return value.slice(LIB_SELECT_PREFIX.length);
}

function buildOverlaySelectOptionsBase(placeholderText = "(load font library)") {
  if (!overlaySelect) return;
  overlaySelect.innerHTML = `<option value="">${placeholderText}</option>`;
  const group = document.createElement("optgroup");
  group.label = "Libraries";
  const libsSorted = [...OVERLAY_LIBRARIES].sort((a, b) =>
    String(a.label || "").localeCompare(String(b.label || ""), undefined, { sensitivity: "base" }),
  );
  for (const lib of libsSorted) {
    const opt = document.createElement("option");
    opt.value = `${LIB_SELECT_PREFIX}${lib.id}`;
    const count = overlayLibraryCounts.get(lib.id);
    opt.textContent = Number.isInteger(count) ? `${lib.label} (${count})` : lib.label;
    group.appendChild(opt);
  }
  overlaySelect.appendChild(group);
}

async function preloadOverlayLibraryCounts() {
  await Promise.all(
    OVERLAY_LIBRARIES.map(async (lib) => {
      try {
        let list = overlayManifestCache.get(lib.id);
        if (!list) {
          const res = await fetch(lib.manifestPath);
          if (!res.ok) throw new Error(`${lib.manifestPath} HTTP ${res.status}`);
          list = await res.json();
          if (!Array.isArray(list)) throw new Error(`${lib.manifestPath} did not return an array`);
          overlayManifestCache.set(lib.id, list);
        }
        overlayLibraryCounts.set(lib.id, list.length);
      } catch (err) {
        console.warn(`Overlay library count unavailable for ${lib.id}`, err);
        overlayLibraryCounts.set(lib.id, 0);
      }
    }),
  );
}

async function buildOverlayFontOptionsForCurrentLibrary(selectedValue = "", placeholderText = "(load font library)") {
  if (!overlaySelect) return;
  buildOverlaySelectOptionsBase(placeholderText);

  let list;
  try {
    list = await loadManifest();
  } catch (err) {
    const lib = OVERLAY_LIBRARIES.find((l) => l.id === currentOverlayLibraryId) || OVERLAY_LIBRARIES[0];
    console.error(`Failed to load ${lib.manifestPath}`, err);
    overlaySelect.innerHTML = `<option value="">(${placeholderText}: manifest missing)</option>`;
    return;
  }

  const overlayGroup = document.createElement("optgroup");
  overlayGroup.label = `${(OVERLAY_LIBRARIES.find((l) => l.id === currentOverlayLibraryId) || OVERLAY_LIBRARIES[0]).label} Fonts`;
  for (const entry of list) {
    const opt = document.createElement("option");
    opt.value = entry.file;
    opt.textContent = entry.name;
    overlayGroup.appendChild(opt);
  }
  if (overlayGroup.children.length) overlaySelect.appendChild(overlayGroup);
  if (selectedValue && [...overlaySelect.options].some((o) => o.value === selectedValue)) {
    overlaySelect.value = selectedValue;
  } else {
    overlaySelect.value = "";
  }
}

async function getOverlayByFileFromLibrary(libraryId, file) {
  const lib = OVERLAY_LIBRARIES.find((l) => l.id === libraryId) || OVERLAY_LIBRARIES[0];
  const cacheKey = `${lib.id}::${file}`;
  if (overlayCache.has(cacheKey)) return overlayCache.get(cacheKey);
  const r = await fetch(`${lib.dataDir}/${encodeURIComponent(file)}`);
  if (!r.ok) throw new Error(`overlay fetch HTTP ${r.status} for ${file}`);
  const j = await r.json();
  overlayCache.set(cacheKey, j);
  return j;
}

async function getOverlayByFile(file) {
  return getOverlayByFileFromLibrary(currentOverlayLibraryId, file);
}

async function loadOverlayIndex() {
  if (!overlaySelect) return;
  if (!OVERLAY_LIBRARIES.some((l) => l.id === currentOverlayLibraryId)) {
    currentOverlayLibraryId = OVERLAY_LIBRARIES[0].id;
  }
  await preloadOverlayLibraryCounts();
  // Start with libraries only; fonts are loaded after explicit library selection.
  buildOverlaySelectOptionsBase();

  
  overlayPickerApi = buildFontPicker({
    selectEl: overlaySelect,
    getLabel: (opt) => opt.textContent,
    getValue: (opt) => opt.value,
    getPreviewUrl: (value) => isLibrarySelectValue(value) ? "" : getOverlayPreviewUrl(value),
    lazyMenuPreviews: true,
  });

  renderLoadStatusVisual();

  if (!overlaySelectChangeBound) {
    overlaySelect.addEventListener("change", async () => {
      const value = overlaySelect.value;

      if (isLibrarySelectValue(value)) {
        const nextLib = libraryIdFromSelectValue(value);
        if (!OVERLAY_LIBRARIES.some((l) => l.id === nextLib)) return;
        const nextLibLabel = (OVERLAY_LIBRARIES.find((l) => l.id === nextLib) || OVERLAY_LIBRARIES[0]).label;
        currentOverlayLibraryId = nextLib;
        localStorage.setItem(OVERLAY_LIBRARY_KEY, currentOverlayLibraryId);
        currentOverlay = null;
        clearEditorPixelOverrides();
        overlayPreviewUrlCache.clear();
        await buildOverlayFontOptionsForCurrentLibrary("", nextLibLabel);
        overlayPickerApi?.rebuild();
        overlayPickerApi?.refresh();
        rebuildResultFont();
        rerenderAll();
        setLoadStatus(`Loaded font library: ${nextLibLabel}`);
        return;
      }

      const file = value;

      if (!file) {
        currentOverlay = null;
        clearEditorPixelOverrides();
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

      clearEditorPixelOverrides();
      rebuildResultFont();
      rerenderAll();
      renderLoadStatusVisual();
    });
    overlaySelectChangeBound = true;
  }
}

/* -----------------------------
   Fun top-right title banner
------------------------------ */

const brandEl = document.getElementById("brandTitle");
const brandDroneCanvas = document.getElementById("brandDrone");
const brandDroneCtx = brandDroneCanvas?.getContext?.("2d") || null;
if (brandDroneCtx) brandDroneCtx.imageSmoothingEnabled = false;
const BRAND_TEXT = "OSD Font Lab";
const DRONE_FRAME_PATHS = ["drone1.png", "drone2.png"];
let droneSourceFrames = null;
let droneTintFrames = [];
let droneFrameIdx = 0;
let droneAnimRaf = 0;
let droneAnimLastTs = 0;
let droneVisibilityBound = false;
const DRONE_FRAME_INTERVAL_MS = 45;

function drawOverlayGlyphToTinyCanvas(ctx, overlay, ch, ink) {
  const cellW = 12, cellH = 18;
  ctx.clearRect(0, 0, cellW, cellH);

  if (ch === " ") return;

  // Force uppercase glyph lookup so branding is stable across mixed-case font mappings.
  const lookupChar = /[a-z]/i.test(ch) ? ch.toUpperCase() : ch;
  const code = lookupChar.charCodeAt(0);
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
    list = await loadAllOverlayManifests();
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
    return { libraryId: entry.__libraryId || currentOverlayLibraryId, file: entry.file };
  });

  // load unique overlays used initially
  const unique = [...new Set(picks.filter(Boolean).map((p) => `${p.libraryId}::${p.file}`))];
  const overlays = new Map();
  try {
    await Promise.all(
      unique.map(async (key) => {
        const [libraryId, ...rest] = key.split("::");
        const file = rest.join("::");
        overlays.set(key, await getOverlayByFileFromLibrary(libraryId, file));
      })
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

    const pick = picks[i];
    const file = pick.file;
    const libraryId = pick.libraryId;
    const overlay = overlays.get(`${libraryId}::${file}`);

    const item = {
      el: c,
      ctx,
      ch,
      libraryId,
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
      const picks = items
        .map(() => {
          const entry = list[(Math.random() * list.length) | 0];
          if (!entry?.file) return null;
          return { libraryId: entry.__libraryId || currentOverlayLibraryId, file: entry.file };
        })
        .filter(Boolean);
      const overlays = await Promise.all(
        picks.map((p) => getOverlayByFileFromLibrary(p.libraryId, p.file))
      );
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
  let frameHandle = 0;

  function tick(now) {
    frameHandle = 0;
    if (document.hidden) return;
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
        it.libraryId = glitchState.picks[i].libraryId;
        it.file = glitchState.picks[i].file;
        it.overlay = glitchState.overlays[i];
        drawOverlayGlyphToTinyCanvas(it.ctx, it.overlay, it.ch, ink);
      }
      glitchState = null;
    }

    if (!rerollBusy && !glitchState && now >= nextGlitchAt) {
      beginGlitchReroll();
      nextGlitchAt = now + nextGlitchDelay();
    }

    frameHandle = requestAnimationFrame(tick);
  }

  const onVisibilityChange = () => {
    if (document.hidden) {
      if (frameHandle) {
        cancelAnimationFrame(frameHandle);
        frameHandle = 0;
      }
      return;
    }
    if (!frameHandle) frameHandle = requestAnimationFrame(tick);
  };
  document.addEventListener("visibilitychange", onVisibilityChange, { passive: true });
  frameHandle = requestAnimationFrame(tick);
}

async function loadDroneSourceFrames() {
  if (droneSourceFrames) return droneSourceFrames;
  const frames = [];
  for (const path of DRONE_FRAME_PATHS) {
    const img = new Image();
    img.decoding = "async";
    img.src = path;
    await img.decode();
    frames.push(img);
  }
  droneSourceFrames = frames;
  return frames;
}

function tintDroneFrameToCanvas(sourceImg, ink) {
  const c = document.createElement("canvas");
  c.width = sourceImg.naturalWidth || sourceImg.width;
  c.height = sourceImg.naturalHeight || sourceImg.height;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.drawImage(sourceImg, 0, 0);
  // Keep source alpha, replace color with themed ink.
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = ink;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = "source-over";
  return c;
}

function drawBrandDroneFrame(index = 0) {
  if (!brandDroneCanvas || !brandDroneCtx || !droneTintFrames.length) return;
  const frame = droneTintFrames[index % droneTintFrames.length];
  if (!frame) return;
  if (brandDroneCanvas.width !== frame.width || brandDroneCanvas.height !== frame.height) {
    brandDroneCanvas.width = frame.width;
    brandDroneCanvas.height = frame.height;
    brandDroneCtx.imageSmoothingEnabled = false;
  }
  brandDroneCtx.clearRect(0, 0, brandDroneCanvas.width, brandDroneCanvas.height);
  brandDroneCtx.drawImage(frame, 0, 0);
}

async function renderBrandDroneFrames() {
  if (!brandDroneCanvas || !brandDroneCtx) return;
  const frames = await loadDroneSourceFrames();
  const ink = cssVar("--brand-ink", cssVar("--accent-0", "#ffffff"));
  const prevIdx = droneFrameIdx;
  droneTintFrames = frames.map((img) => tintDroneFrameToCanvas(img, ink));
  if (droneTintFrames.length) {
    droneFrameIdx = Math.min(prevIdx, droneTintFrames.length - 1);
    drawBrandDroneFrame(droneFrameIdx);
  }
}

function stopDroneAnimation() {
  if (!droneAnimRaf) return;
  cancelAnimationFrame(droneAnimRaf);
  droneAnimRaf = 0;
}

function droneTick(now) {
  droneAnimRaf = 0;
  if (document.hidden || !droneTintFrames.length) return;
  if (!droneAnimLastTs) droneAnimLastTs = now;
  if (now - droneAnimLastTs >= DRONE_FRAME_INTERVAL_MS) {
    droneAnimLastTs = now;
    droneFrameIdx = (droneFrameIdx + 1) % droneTintFrames.length;
    drawBrandDroneFrame(droneFrameIdx);
  }
  droneAnimRaf = requestAnimationFrame(droneTick);
}

function ensureDroneAnimationRunning() {
  if (droneAnimRaf || document.hidden || !droneTintFrames.length) return;
  droneAnimLastTs = 0;
  droneAnimRaf = requestAnimationFrame(droneTick);
}

async function initBrandDrone() {
  if (!brandDroneCanvas || !brandDroneCtx) return;
  try {
    await renderBrandDroneFrames();
  } catch (err) {
    console.warn("Brand drone: failed to initialize.", err);
    return;
  }

  ensureDroneAnimationRunning();

  if (!droneVisibilityBound) {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        stopDroneAnimation();
        return;
      }
      ensureDroneAnimationRunning();
    }, { passive: true });
    droneVisibilityBound = true;
  }

  window.__redrawBrandDrone = () => {
    renderBrandDroneFrames().catch((err) => {
      console.warn("Brand drone: failed to redraw.", err);
    });
  };
}


/* -----------------------------
   File loading + events
------------------------------ */

async function handleFile(file) {
  const name = String(file?.name || "").toLowerCase();
  if (name.endsWith(".yaff")) {
    const text = await file.text();
    const overlay = parseYaffToOverlay(text);
    const count = Object.keys(overlay?.glyphs || {}).length;
    const stats = overlay?._importStats || {};
    if (!count) {
      const bits = [];
      if (stats.blocksFound) bits.push(`${stats.blocksFound} blocks`);
      if (stats.labelsUnsupported) bits.push(`${stats.labelsUnsupported} unsupported labels`);
      if (stats.oversizeSkipped) bits.push(`${stats.oversizeSkipped} oversize skipped`);
      const subtext = bits.join(", ");
      setLoadStatus(`YAFF import failed: no usable glyphs in ${file.name}`, { error: true, subtext });
      return;
    }
    currentOverlay = overlay;
    clearEditorPixelOverrides();
    if (overlaySelect) overlaySelect.value = "";
    rebuildResultFont();
    rerenderAll();
    const diag = [];
    diag.push(`${count} glyphs`);
    if (stats.oversizeSkipped) diag.push(`${stats.oversizeSkipped} oversize skipped`);
    if (stats.labelsUnsupported) diag.push(`${stats.labelsUnsupported} unsupported labels`);
    setLoadStatus(`Loaded YAFF overlay: ${file.name}`, { subtext: diag.join(", ") });
    return;
  }

  if (name.endsWith(".png")) {
    let font;
    try {
      font = await decodePngFontSheet(file);
    } catch (err) {
      console.error("PNG import failed for", file.name, err);
      setLoadStatus(`Failed to import PNG: ${file.name}`, { error: true, subtext: err?.message || "" });
      return;
    }

    baseFont = font;
    clearEditorPixelOverrides();
    setSingleSelection(0);
    rebuildResultFont();
    rerenderAll();
    const meta = font._importMeta || {};
    const subtext = `${meta.width || "?"}x${meta.height || "?"} @${meta.scale || "?"}x`;
    setLoadStatus(`Loaded PNG font: ${file.name}`, { subtext });
    syncSwapTargetSelect();
    swapTargetPickerApi?.refresh();
    swapSourcePickerApi?.refresh();
    return;
  }

  const buf = await file.arrayBuffer();
  await handleBuffer(buf, file.name);
}

function isYaffFile(file) {
  const name = String(file?.name || "").toLowerCase();
  return name.endsWith(".yaff");
}

function isMcmFile(file) {
  const name = String(file?.name || "").toLowerCase();
  return name.endsWith(".mcm");
}

function isPngFile(file) {
  const name = String(file?.name || "").toLowerCase();
  return name.endsWith(".png");
}

function isBmpFile(file) {
  const name = String(file?.name || "").toLowerCase();
  return name.endsWith(".bmp");
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
    bfFontSelect.appendChild(opt);
  }
  registerBetaflightSwapSources(swapSourceRegistry, list);
  const customList = await loadSwapCustomManifest();
  registerCustomSwapSources(swapSourceRegistry, customList);
  syncSwapSourceSelect();


  bfPickerApi = buildFontPicker({
    selectEl: bfFontSelect,
    getLabel: (opt) => opt.textContent,
    getValue: (opt) => opt.value,
    getPreviewUrl: (value) => getBetaflightPreviewUrl(value),
    lazyMenuPreviews: true,
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

function initEvents() {
  setEditorColor(editorColorValue);
  setZoomMode(ZOOM_MODE_INSPECTOR);
  zoomModeInspectorBtn?.addEventListener("click", () => setZoomMode(ZOOM_MODE_INSPECTOR));
  zoomModeEditorBtn?.addEventListener("click", () => setZoomMode(ZOOM_MODE_EDITOR));
  for (const btn of editorColorButtons) {
    btn.addEventListener("click", () => setEditorColor(btn.getAttribute("data-editor-color")));
  }
  editorUndoBtn?.addEventListener("click", () => {
    applyEditorUndo();
  });

  viewModeSheetBtn?.addEventListener("click", () => {
    setViewMode(VIEW_MODE_SHEET);
  });

  viewModeHudBtn?.addEventListener("click", () => {
    setViewMode(VIEW_MODE_HUD);
  });

  // show grids toggle
  if (showGridsEl) {
    showGridsEl.checked = showGrids;
    showGridsEl.addEventListener("change", () => {
      showGrids = !!showGridsEl.checked;
      if (hudShowGuidesEl) hudShowGuidesEl.checked = showGrids;
      localStorage.setItem("showGrids", showGrids ? "1" : "0");
      rerenderAll();
    });
  }
  if (hudShowGuidesEl) {
    hudShowGuidesEl.checked = showGrids;
    hudShowGuidesEl.addEventListener("change", () => {
      showGrids = !!hudShowGuidesEl.checked;
      if (showGridsEl) showGridsEl.checked = showGrids;
      localStorage.setItem("showGrids", showGrids ? "1" : "0");
      rerenderAll();
    });
  }
  syncHudFormatUI();
  hudFormatNtscBtn?.addEventListener("click", () => {
    const nextFormat = "NTSC";
    if (hudVideoFormat === nextFormat) return;
    remapHudLayoutRowsForFormatSwitch(hudVideoFormat, nextFormat);
    hudVideoFormat = nextFormat;
    localStorage.setItem(HUD_VIDEO_FORMAT_KEY, hudVideoFormat);
    saveHudLayoutToStorage();
    syncHudFormatUI();
    rerenderAll();
  });
  hudFormatPalBtn?.addEventListener("click", () => {
    const nextFormat = "PAL";
    if (hudVideoFormat === nextFormat) return;
    remapHudLayoutRowsForFormatSwitch(hudVideoFormat, nextFormat);
    hudVideoFormat = nextFormat;
    localStorage.setItem(HUD_VIDEO_FORMAT_KEY, hudVideoFormat);
    saveHudLayoutToStorage();
    syncHudFormatUI();
    rerenderAll();
  });
  hudResetDefaultsBtn?.addEventListener("click", () => {
    resetHudDefaults();
  });
  syncHudElementToggleUI();
  for (const el of hudElementToggles) {
    el.addEventListener("change", () => {
      const id = el.getAttribute("data-hud-element");
      if (!id) return;
      if (el.checked) enabledHudElements.add(id);
      else enabledHudElements.delete(id);
      saveHudElementsToStorage();
      rerenderAll();
    });
  }
  syncHudLabelInputs();
  hudPilotNameInput?.addEventListener("input", () => {
    hudLabels.pilot_name = sanitizeHudLabel(hudPilotNameInput.value);
    hudPilotNameInput.value = hudLabels.pilot_name;
    saveHudLabelsToStorage();
    rerenderAll();
  });
  hudCraftNameInput?.addEventListener("input", () => {
    hudLabels.craft_name = sanitizeHudLabel(hudCraftNameInput.value);
    hudCraftNameInput.value = hudLabels.craft_name;
    saveHudLabelsToStorage();
    rerenderAll();
  });

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
    if (!baseFont) return;
    handleGridClick(e, baseGridCanvas, baseFont);
  });

  resultGridCanvas?.addEventListener("click", (e) => {
    if (!resultFont || viewMode !== VIEW_MODE_SHEET) return;
    handleGridClick(e, resultGridCanvas, resultFont);
  });
  resultZoomCanvas?.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (viewMode !== VIEW_MODE_SHEET || zoomMode !== ZOOM_MODE_EDITOR || !resultFont) return;
    const idx = selection.selectedIndex;
    const glyph = resultFont.glyphs?.[idx];
    if (!glyph || idx == null || idx < 0 || idx > 255) return;
    zoomPaint.active = true;
    zoomPaint.dirty = false;
    zoomPaint.startGlyph = new Uint8Array(glyph);
    zoomPaint.startIndex = idx;
    applyEditorPixel(e);
    e.preventDefault();
  });
  resultZoomCanvas?.addEventListener("pointermove", (e) => {
    if (!zoomPaint.active) return;
    applyEditorPixel(e);
  });
  resultZoomCanvas?.addEventListener("pointerup", () => {
    if (!zoomPaint.active) return;
    commitZoomPaintIfNeeded();
  });
  resultZoomCanvas?.addEventListener("pointerleave", () => {
    if (!zoomPaint.active) return;
    commitZoomPaintIfNeeded();
  });
  resultZoomCanvas?.addEventListener("pointercancel", () => {
    if (!zoomPaint.active) return;
    commitZoomPaintIfNeeded();
  });

  resultHudCanvas?.addEventListener("mousedown", (e) => {
    if (viewMode !== VIEW_MODE_HUD) return;
    const p = hudCanvasPoint(e);
    if (!p) return;
    const hit = hitTestHudElement(p.x, p.y);
    if (!hit) return;
    const entry = hudLayout[hit.id];
    if (!entry) return;
    hudDrag.active = true;
    hudDrag.id = hit.id;
    hudDrag.startPointerX = p.x;
    hudDrag.startPointerY = p.y;
    hudDrag.startCol = entry.col;
    hudDrag.startRow = entry.row;
    hudDrag.cellsWide = Math.max(1, hit.rect.cellsWide || 1);
    hudDrag.cellsHigh = Math.max(1, hit.rect.cellsHigh || 1);
    setHudCanvasCursor("move");
    e.preventDefault();
  });

  resultHudCanvas?.addEventListener("mousemove", (e) => {
    if (viewMode !== VIEW_MODE_HUD) return;
    const p = hudCanvasPoint(e);
    if (!p) return;
    if (hudDrag.active) {
      const grid = hudRenderState?.grid;
      if (!grid || !hudDrag.id) return;
      const dxCells = Math.round((p.x - hudDrag.startPointerX) / grid.cellW);
      const dyCells = Math.round((p.y - hudDrag.startPointerY) / Math.max(1, grid.rowStep));
      const maxCol = Math.max(0, grid.cols - hudDrag.cellsWide);
      const maxRow = Math.max(0, grid.rows - hudDrag.cellsHigh);
      const nextCol = clampInt(hudDrag.startCol + dxCells, 0, maxCol);
      const nextRow = clampInt(hudDrag.startRow + dyCells, 0, maxRow);
      const cur = hudLayout[hudDrag.id];
      if (cur && (cur.col !== nextCol || cur.row !== nextRow)) {
        hudLayout[hudDrag.id] = { col: nextCol, row: nextRow };
        scheduleRerender();
      }
      setHudCanvasCursor("move");
      return;
    }
    const hit = hitTestHudElement(p.x, p.y);
    setHudCanvasCursor(hit ? "move" : "default");
  });

  resultHudCanvas?.addEventListener("mouseleave", () => {
    if (hudDrag.active) return;
    setHudCanvasCursor("default");
  });

  window.addEventListener("mouseup", () => {
    if (!hudDrag.active) return;
    hudDrag.active = false;
    if (hudDrag.id) saveHudLayoutToStorage();
    hudDrag.id = "";
    setHudCanvasCursor("default");
  });

  // drop zone + file picker
  drop?.addEventListener("click", () => {
    if (fileInput) fileInput.value = "";
    fileInput?.click();
  });
  yaffImportBtn?.addEventListener("click", () => yaffFileInput?.click());
  bootSplashImportBtn?.addEventListener("click", () => bootSplashFileInput?.click());

  fileInput?.addEventListener("change", async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    if (!isMcmFile(f) && !isPngFile(f)) {
      setLoadStatus("Please choose a .mcm or exported .png file here. Use Import .yaff for YAFF files.", { error: true });
      fileInput.value = "";
      return;
    }
    try {
      await handleFile(f);
    } catch (err) {
      console.error("Local file import failed:", err);
      setLoadStatus(`Failed to load: ${f.name}`, { error: true, subtext: err?.message || "" });
    } finally {
      fileInput.value = "";
    }
  });

  yaffFileInput?.addEventListener("change", () => {
    const f = yaffFileInput.files?.[0];
    if (!f) return;
    if (!isYaffFile(f)) {
      setLoadStatus("Please choose a .yaff file.", { error: true });
      return;
    }
    handleFile(f);
  });

  bootSplashFileInput?.addEventListener("change", () => {
    const f = bootSplashFileInput.files?.[0];
    if (!f) return;
    applyBootSplashFile(f);
    bootSplashFileInput.value = "";
  });

  drop?.addEventListener("dragenter", (e) => { e.preventDefault(); drop.classList.add("hot"); });
  drop?.addEventListener("dragover",  (e) => { e.preventDefault(); drop.classList.add("hot"); });
  drop?.addEventListener("dragleave", () => drop.classList.remove("hot"));
  drop?.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("hot");
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    if (!isMcmFile(f) && !isPngFile(f)) {
      if (isYaffFile(f)) {
        setLoadStatus("Use the Import .yaff button for YAFF overlays.", { error: true });
      } else {
        setLoadStatus("Unsupported file type. Drop a .mcm or exported .png file here.", { error: true });
      }
      return;
    }
    handleFile(f);
  });

  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());

  window.addEventListener("resize", () => scheduleRerender());

  // exports
  exportMCMBtn?.addEventListener("click", () => {
    if (!resultFont) return;
    const text = encodeMCM(resultFont);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    downloadBlob(blob, `${safeBaseName()}.mcm`);
  });

  exportPNG1xBtn?.addEventListener("click", () => {
    if (!resultFont) return;
    const sheet = workspaceRenderer.renderFontToSheetCanvas(resultFont, 1);
    sheet.toBlob((blob) => {
      if (!blob) return;
      downloadBlob(blob, `${safeBaseName()}_1x.png`);
    }, "image/png");
  });

  exportPNG3xBtn?.addEventListener("click", () => {
    if (!resultFont) return;
    const sheet = workspaceRenderer.renderFontToSheetCanvas(resultFont, 3);
    sheet.toBlob((blob) => {
      if (!blob) return;
      downloadBlob(blob, `${safeBaseName()}_3x.png`);
    }, "image/png");
  });

  // d-pads
  initDpadControls({
    onResetReplaced: () => {
      nudge.replaced.x = 0;
      nudge.replaced.y = 0;
      updateReplReadout();
      rebuildResultFont();
      rerenderAll();
    },
    onClearSelection: () => {
      clearSelectionNudges();
    },
    onNudgeReplaced: (dx, dy) => {
      applyReplacedNudge(dx, dy);
    },
    onNudgeSelection: (dx, dy) => {
      applySelectionNudge(dx, dy);
    },
  });
}

/* -----------------------------
   Init
------------------------------ */

function init() {
  // Keep layout stable before any font is loaded.
  setViewMode(viewMode);
  if (resultGridCanvas) workspaceRenderer.reserveGridCanvasSpace(resultGridCanvas);
  if (baseGridCanvas) workspaceRenderer.reserveGridCanvasSpace(baseGridCanvas);

  updateReplReadout();
  setLoadStatus(loadStatusText);
  initSwapUI();
  initSpecialCharUI();
  initTheme();
  renderKofiBadgeIcon();
  initEvents();
  loadOverlayIndex();
  loadBetaflightDefaults();
  updateServingFontCount();
  initBrandDrone();
  initBrandTitle();
}

init();

