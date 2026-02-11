// js/modules/swap-registry.js
export function registerBetaflightSwapSources(registry, list) {
  for (const entry of list) {
    const id = `bf:${entry.file}`;
    registry.set(id, {
      id,
      kind: "bf_mcm",
      file: entry.file,
      label: entry.name,
    });
  }
}

export function resolveCustomAssetPath(pathLike) {
  if (!pathLike || typeof pathLike !== "string") return "";
  if (
    /^(?:https?:)?\/\//i.test(pathLike)
    || pathLike.startsWith("/")
    || pathLike.startsWith("./")
    || pathLike.startsWith("../")
  ) {
    return pathLike;
  }
  return `fonts/${pathLike}`;
}

export function registerCustomSwapSources(registry, list) {
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
    registry.set(id, {
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
