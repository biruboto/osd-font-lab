const TITLE = "OSD Font Lab";
const LETTERS = [...new Set(TITLE.toUpperCase().replaceAll(" ", ""))];

export function createBrandAnimation({
  root = document.querySelector(".brandCluster"),
  catalogUrl = "fonts/brand-glyphs.json",
  droneUrls = ["drone1.png", "drone2.png"],
  glitchDelay = () => 15000 + Math.floor(Math.random()*5000),
  glitchDuration = 900,
} = {}) {
  if (!root) return { ready: Promise.resolve(), refreshTheme() {}, destroy() {} };
  const title = root.querySelector(".brandTitle");
  const drone = root.querySelector(".brandDrone");
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const abort = new AbortController();
  const items = [];
  let catalog;
  let frames = [];
  let ink;
  let nextTimer = 0;
  let finishTimer = 0;
  let pageActive = true;
  let destroyed = false;
  let dronePixelRatio = 0;
  let droneRasterWidth = 0;
  let droneRasterHeight = 0;
  let droneResolution;

  const canAnimate = () => !destroyed && pageActive && !document.hidden && !motion.matches;

  function syncDronePixels() {
    if (destroyed || !drone) return;
    const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    const width = Math.max(1, Math.round(drone.clientWidth * ratio));
    const height = Math.max(1, Math.round(drone.clientHeight * ratio));
    if (ratio === dronePixelRatio && width === droneRasterWidth && height === droneRasterHeight) return;
    dronePixelRatio = ratio;
    droneRasterWidth = width;
    droneRasterHeight = height;
    // Whole CSS pixels still straddle device pixels at 125%/150% scaling. That
    // changes how many rows of the sprite get painted and makes it pulse in ink
    // coverage. Snap every hover step to one device pixel, keeping ~3 CSS px travel.
    const steps = Math.max(1, Math.round(3 * ratio));
    drone.style.setProperty("--drone-hover-steps", String(steps));
    drone.style.setProperty("--drone-hover-distance", `${steps / ratio}px`);
    droneResolution?.removeEventListener("change", syncDronePixels);
    droneResolution = matchMedia(`(resolution: ${ratio}dppx)`);
    droneResolution.addEventListener("change", syncDronePixels);
    drawDrone();
  }

  function drawGlyph(ctx, choice) {
    ctx.clearRect(0, 0, 12, 18);
    ctx.fillStyle = ink;
    const [top, ...rows] = catalog.glyphs[choice];
    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < 12; x++) {
        if (rows[y] & (1 << (11-x))) ctx.fillRect(x, y+top, 1, 1);
      }
    }
  }

  function refreshTheme() {
    if (destroyed) return;
    const style = getComputedStyle(document.documentElement);
    ink = style.getPropertyValue("--brand-ink").trim() || style.getPropertyValue("--accent-0").trim() || "#ffffff";
    for (const item of items) {
      drawGlyph(item.oldCtx, item.choice);
      if (item.nextChoice !== null) drawGlyph(item.newCtx, item.nextChoice);
    }
    drawDrone();
  }

  function drawDrone() {
    for (const { source, canvas } of frames) {
      // Pre-rasterize once at screen resolution. Scaling the small source sprite
      // during motion can change nearest-neighbor row coverage on narrow layouts.
      if (canvas.width !== droneRasterWidth) canvas.width = droneRasterWidth;
      if (canvas.height !== droneRasterHeight) canvas.height = droneRasterHeight;
      canvas.style.width = `${droneRasterWidth / dronePixelRatio}px`;
      canvas.style.height = `${droneRasterHeight / dronePixelRatio}px`;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "source-in";
      ctx.fillStyle = ink;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "source-over";
    }
  }

  function choose(char) {
    const choices = catalog.choices[char.toUpperCase()];
    return choices[Math.floor(Math.random()*choices.length)];
  }

  function finishGlitch() {
    clearTimeout(finishTimer);
    finishTimer = 0;
    for (const item of items) {
      if (item.nextChoice === null) continue;
      item.choice = item.nextChoice;
      item.nextChoice = null;
      drawGlyph(item.oldCtx, item.choice);
    }
    title?.classList.remove("is-glitching");
  }

  function scheduleGlitch() {
    if (!canAnimate() || !items.length || nextTimer || finishTimer) return;
    nextTimer = setTimeout(() => {
      nextTimer = 0;
      if (!canAnimate()) return;
      for (const item of items) {
        item.nextChoice = choose(item.char);
        drawGlyph(item.newCtx, item.nextChoice);
        item.el.style.setProperty("--glitch-period", `${80+Math.floor(Math.random()*60)}ms`);
      }
      title.classList.add("is-glitching");
      finishTimer = setTimeout(() => {
        finishGlitch();
        scheduleGlitch();
      }, glitchDuration);
    }, glitchDelay());
  }

  function syncMotion() {
    root.classList.toggle("is-paused", !canAnimate());
    root.classList.toggle("is-reduced-motion", motion.matches);
    if (canAnimate()) scheduleGlitch();
    else {
      clearTimeout(nextTimer);
      nextTimer = 0;
      finishGlitch();
    }
  }

  async function loadTitle() {
    if (!title) return;
    title.textContent = TITLE;
    const response = await fetch(catalogUrl, { signal: abort.signal });
    if (!response.ok) throw new Error(`Brand catalog HTTP ${response.status}`);
    const data = await response.json();
    if (destroyed) return;
    if (data.version !== 1 || !data.glyphs?.length || LETTERS.some(c => !data.choices?.[c]?.length)) {
      throw new Error("Invalid brand glyph catalog");
    }
    catalog = data;
    const fragment = document.createDocumentFragment();
    [...TITLE].forEach((char, index) => {
      const el = document.createElement("span");
      el.setAttribute("aria-hidden", "true");
      if (char === " ") el.className = "brand-space";
      else {
        el.className = "brand-letter";
        el.style.setProperty("--brand-delay", `${-index*0.3056}s`);
        const glyph = document.createElement("span");
        glyph.className = "brand-glyph";
        const canvases = ["brand-old", "brand-new"].map(className => {
          const canvas = document.createElement("canvas");
          canvas.width = 12;
          canvas.height = 18;
          canvas.className = className;
          glyph.appendChild(canvas);
          return canvas;
        });
        el.appendChild(glyph);
        const item = { el, char, choice: choose(char), nextChoice: null,
          oldCtx: canvases[0].getContext("2d"), newCtx: canvases[1].getContext("2d") };
        items.push(item);
        drawGlyph(item.oldCtx, item.choice);
      }
      fragment.appendChild(el);
    });
    title.replaceChildren(fragment);
    syncMotion();
  }

  async function loadDrone() {
    if (!drone) return;
    const sources = await Promise.all(droneUrls.map(async url => {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
      await image.decode();
      return image;
    }));
    if (destroyed) return;
    const width = sources[0].naturalWidth, height = sources[0].naturalHeight;
    const makeCanvas = () => Object.assign(document.createElement("canvas"), { width, height });
    const sprites = sources.map(image => {
      const canvas = makeCanvas();
      canvas.getContext("2d").drawImage(image, 0, 0);
      return canvas;
    });
    // Keep common opaque pixels permanently visible. Only propeller changes
    // should switch frames, rather than hiding/replacing the entire drone.
    const body = makeCanvas();
    const ctx = body.getContext("2d");
    const mask = ctx.createImageData(width, height);
    const pixels = sprites.map(c => c.getContext("2d").getImageData(0, 0, width, height).data);
    for (let i = 3; i < mask.data.length; i += 4) {
      if (pixels.every(p => p[i] === 255)) mask.data.fill(255, i-3, i+1);
    }
    ctx.putImageData(mask, 0, 0);
    for (const sprite of sprites) {
      const ctx = sprite.getContext("2d");
      ctx.globalCompositeOperation = "destination-out";
      ctx.drawImage(body, 0, 0);
      ctx.globalCompositeOperation = "source-over";
    }
    frames = [body, ...sprites].map((source, index) => {
      const canvas = makeCanvas();
      canvas.className = `brand-drone-art ${index ? "brand-drone-frame" : "brand-drone-body"}`;
      return { source, canvas };
    });
    drone.replaceChildren(...frames.map(f => f.canvas));
    refreshTheme();
  }

  const onPageHide = () => { pageActive = false; syncMotion(); };
  const onPageShow = () => { pageActive = true; syncMotion(); };
  document.addEventListener("visibilitychange", syncMotion);
  motion.addEventListener("change", syncMotion);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("resize", syncDronePixels);
  syncDronePixels();
  refreshTheme();
  syncMotion();
  const ready = Promise.allSettled([loadTitle(), loadDrone()]).then(results => {
    if (destroyed) return;
    for (const result of results) {
      if (result.status === "rejected") console.warn("Brand artwork unavailable:", result.reason);
    }
  });

  return {
    ready,
    refreshTheme,
    destroy() {
      destroyed = true;
      abort.abort();
      clearTimeout(nextTimer);
      nextTimer = 0;
      finishGlitch();
      root.classList.add("is-paused");
      document.removeEventListener("visibilitychange", syncMotion);
      motion.removeEventListener("change", syncMotion);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("resize", syncDronePixels);
      droneResolution?.removeEventListener("change", syncDronePixels);
    },
  };
}
