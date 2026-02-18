// js/modules/picker.js
export function buildFontPicker({
  selectEl,
  getLabel,          // (optionEl) => string
  getValue,          // (optionEl) => string
  getPreviewUrl,     // (value) => Promise<string> | string URL to png
  onChange,          // (value) => void
  lazyMenuPreviews = false,
}) {
  if (!selectEl) return;

  if (selectEl.__fontPickerApi) {
    selectEl.__fontPickerApi.rebuild();
    selectEl.__fontPickerApi.refresh();
    return selectEl.__fontPickerApi;
  }

  // Hide native select (keep it for accessibility + keyboard logic sync)
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
  btn.title = selectEl.getAttribute("title") || "";

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
  selectEl.parentNode.insertBefore(wrap, selectEl.nextSibling);

  const previewReq = new WeakMap(); // img -> request id
  let menuPreviewRaf = 0;

  function setPreviewImage(imgEl, value) {
    if (!imgEl) return;
    if (!value) {
      imgEl.removeAttribute("src");
      imgEl.removeAttribute("data-loaded");
      return;
    }
    const reqId = (previewReq.get(imgEl) || 0) + 1;
    previewReq.set(imgEl, reqId);
    Promise.resolve(getPreviewUrl(value))
      .then((url) => {
        if (previewReq.get(imgEl) !== reqId) return;
        if (url) {
          imgEl.src = url;
          imgEl.setAttribute("data-loaded", value);
        } else {
          imgEl.removeAttribute("src");
          imgEl.removeAttribute("data-loaded");
        }
      })
      .catch(() => {
        if (previewReq.get(imgEl) !== reqId) return;
        imgEl.removeAttribute("src");
        imgEl.removeAttribute("data-loaded");
      });
  }

  function setButtonFromValue(value) {
    const opt = [...selectEl.options].find((o) => o.value === value);
    name.textContent = opt ? getLabel(opt) : "(none)";

    if (!value) {
      thumb.removeAttribute("src");
      thumb.style.display = "none";
      return;
    }

    thumb.style.display = "";
    setPreviewImage(thumb, value);
  }

  function ensureMenuBuilt() {
    if (menu.childElementCount) return;

    const appendOptionRow = (opt) => {
      const value = getValue(opt);
      const label = getLabel(opt);

      const row = document.createElement("div");
      row.className = "fontpicker-item";
      row.setAttribute("data-value", value);

      if (value) {
        const t = document.createElement("img");
        t.className = "fontpicker-thumb";
        t.alt = "";
        t.setAttribute("data-value", value);
        if (!lazyMenuPreviews) setPreviewImage(t, value);
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
    };

    for (const child of selectEl.children) {
      if (child.tagName === "OPTGROUP") {
        const groupRow = document.createElement("div");
        groupRow.className = "fontpicker-group";
        groupRow.textContent = child.label || "";
        menu.appendChild(groupRow);

        for (const opt of child.children) {
          if (opt.tagName === "OPTION") appendOptionRow(opt);
        }
        continue;
      }
      if (child.tagName === "OPTION") appendOptionRow(child);
    }
  }

  function isRowVisibleInMenu(rowEl) {
    const top = menu.scrollTop;
    const bottom = top + menu.clientHeight;
    const rowTop = rowEl.offsetTop;
    const rowBottom = rowTop + rowEl.offsetHeight;
    return rowBottom >= (top - 24) && rowTop <= (bottom + 24);
  }

  function refreshMenuPreviews({ all = false, maxLazy = 40 } = {}) {
    let loaded = 0;
    for (const row of menu.children) {
      const img = row.querySelector(".fontpicker-thumb");
      if (!img) continue;
      const value = img.getAttribute("data-value") || row.getAttribute("data-value") || "";
      if (!value) continue;
      if (!all && lazyMenuPreviews && !isRowVisibleInMenu(row)) continue;
      if (!all && lazyMenuPreviews && loaded >= maxLazy) break;
      if (img.getAttribute("data-loaded") === value && img.src) continue;
      setPreviewImage(img, value);
      loaded++;
    }
  }

  function scheduleMenuPreviewsRefresh() {
    if (menuPreviewRaf) return;
    menuPreviewRaf = requestAnimationFrame(() => {
      menuPreviewRaf = 0;
      refreshMenuPreviews();
    });
  }

  function rebuildMenu() {
    menu.innerHTML = "";
  }

  function closeOnOutside(e) {
    if (!wrap.contains(e.target)) wrap.classList.remove("open");
  }

  btn.addEventListener("click", () => {
    ensureMenuBuilt();
    wrap.classList.toggle("open");
    if (wrap.classList.contains("open")) refreshMenuPreviews();
  });

  btn.addEventListener("keydown", (e) => {
    const k = e.key;
    if (k === "Enter" || k === " ") {
      e.preventDefault();
      ensureMenuBuilt();
      wrap.classList.toggle("open");
      if (wrap.classList.contains("open")) refreshMenuPreviews();
      return;
    }

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
      setButtonFromValue(selectEl.value);
      onChange?.(selectEl.value);
      return;
    }

    if (k === "Escape") wrap.classList.remove("open");
  });

  document.addEventListener("mousedown", closeOnOutside);
  menu.addEventListener("scroll", () => {
    if (!wrap.classList.contains("open")) return;
    scheduleMenuPreviewsRefresh();
  });
  selectEl.addEventListener("change", () => setButtonFromValue(selectEl.value));

  setButtonFromValue(selectEl.value);

  const api = {
    refresh: () => {
      setButtonFromValue(selectEl.value);
      if (wrap.classList.contains("open")) refreshMenuPreviews();
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
