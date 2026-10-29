// Cost center text field with a suggestion list where favorites (★) float to the top.
// Shared by the popup and the settings page; options and favorites live in chrome.storage.local.
const CostCenterPicker = (() => {
  const MAX_SUGGESTIONS = 100;
  let options = [];
  let favorites = new Set();
  const optionListeners = new Set();

  const init = async () => {
    const stored = await chrome.storage.local.get(["costCenterOptions", "favorites"]);
    options = stored.costCenterOptions || [];
    favorites = new Set(stored.favorites || []);
    chrome.storage.local.onChanged.addListener((changes) => {
      if (changes.favorites) favorites = new Set(changes.favorites.newValue || []);
      if (changes.costCenterOptions) {
        options = changes.costCenterOptions.newValue || [];
        optionListeners.forEach((listener) => listener());
      }
    });
  };

  const toggleFavorite = (name) => {
    if (favorites.has(name)) favorites.delete(name);
    else favorites.add(name);
    chrome.storage.local.set({ favorites: [...favorites] });
  };

  // onChange(value) fires on every edit and whenever a suggestion is picked.
  const create = ({ value, onChange }) => {
    const wrap = document.createElement("div");
    wrap.className = "picker";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = options.length ? "Type or pick a cost center" : "Type a cost center";
    input.value = value || "";
    const star = document.createElement("button");
    star.type = "button";
    star.className = "star";
    star.title = "Favorite";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "clear";
    clear.title = "Clear";
    clear.textContent = "×";
    const list = document.createElement("div");
    list.className = "suggestions";
    list.hidden = true;
    wrap.append(input, clear, star, list);

    const paintStar = () => {
      const name = input.value.trim();
      star.hidden = !options.includes(name);
      star.textContent = favorites.has(name) ? "★" : "☆";
      clear.hidden = !input.value;
      // The star sits at the right edge; the cross moves over when it is showing.
      clear.style.right = star.hidden ? "4px" : "28px";
    };
    const commit = (text) => {
      paintStar();
      onChange(text.trim());
    };
    // Fixed positioning lets the list escape scrolling containers; flip upward when there's no room below.
    const place = () => {
      const rect = input.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom;
      list.style.left = `${rect.left}px`;
      list.style.width = `${rect.width}px`;
      if (below < 180 && rect.top > below) {
        list.style.top = "auto";
        list.style.bottom = `${window.innerHeight - rect.top + 2}px`;
        list.style.maxHeight = `${Math.min(170, rect.top - 8)}px`;
      } else {
        list.style.bottom = "auto";
        list.style.top = `${rect.bottom + 2}px`;
        list.style.maxHeight = `${Math.min(170, below - 8)}px`;
      }
    };
    const renderList = () => {
      place();
      const query = input.value.trim().toLowerCase();
      const matches = options.filter((name) => !query || name.toLowerCase().includes(query));
      // Favorites first, keeping the page's own order inside each group.
      matches.sort((a, b) => Number(favorites.has(b)) - Number(favorites.has(a)));
      list.innerHTML = "";
      if (!matches.length) {
        list.innerHTML = '<div class="empty">No matching cost center</div>';
        return;
      }
      for (const name of matches.slice(0, MAX_SUGGESTIONS)) {
        const item = document.createElement("div");
        item.className = "item";
        const fav = document.createElement("button");
        fav.type = "button";
        fav.className = "fav";
        fav.textContent = favorites.has(name) ? "★" : "☆";
        fav.addEventListener("click", (event) => {
          event.stopPropagation();
          toggleFavorite(name);
          renderList();
          paintStar();
        });
        item.append(fav, name);
        item.addEventListener("click", () => {
          input.value = name;
          list.hidden = true;
          commit(name);
        });
        list.append(item);
      }
    };

    input.addEventListener("focus", () => { list.hidden = false; renderList(); });
    input.addEventListener("input", () => { list.hidden = false; renderList(); commit(input.value); });
    input.addEventListener("blur", () => { list.hidden = true; commit(input.value); });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") list.hidden = true;
      if (event.key === "Enter") {
        const first = list.querySelector(".item");
        if (first && !list.hidden) first.click();
        event.preventDefault();
      }
    });
    // Keep input focus when clicking inside the list so the click isn't lost to blur.
    list.addEventListener("mousedown", (event) => event.preventDefault());
    star.addEventListener("click", () => {
      toggleFavorite(input.value.trim());
      paintStar();
    });
    star.addEventListener("mousedown", (event) => event.preventDefault());
    clear.addEventListener("mousedown", (event) => event.preventDefault());
    clear.addEventListener("click", () => {
      input.value = "";
      commit("");
      input.focus();
      renderList();
      list.hidden = false;
    });
    paintStar();
    return wrap;
  };

  return { init, create, hasOptions: () => options.length > 0, onOptionsChanged: (listener) => optionListeners.add(listener) };
})();

// "1 | 2 | More" radios; More opens a small panel to choose 3..max.
const CostCenterCount = (() => {
  let instances = 0;

  const create = ({ value, max, onChange }) => {
    const name = `ccCount${instances++}`;
    const wrap = document.createElement("div");
    wrap.className = "count-picker";
    const group = document.createElement("div");
    group.className = "segmented";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", "Number of cost centers");

    const radios = {};
    const add = (key, text) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = name;
      input.value = key;
      const span = document.createElement("span");
      span.textContent = text;
      label.append(input, span);
      group.append(label);
      radios[key] = { input, span };
      return input;
    };
    add("1", "1");
    add("2", "2");
    const more = add("more", value > 2 ? `More (${value})` : "More");
    radios[value > 2 ? "more" : String(value)].input.checked = true;

    const panel = document.createElement("div");
    panel.className = "count-panel";
    panel.hidden = true;
    const title = document.createElement("div");
    title.className = "count-title";
    title.textContent = "Number of cost centers";
    const grid = document.createElement("div");
    grid.className = "count-grid";
    for (let n = 3; n <= max; n++) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = n;
      if (n === value) button.className = "current";
      button.addEventListener("click", () => {
        panel.hidden = true;
        onChange(n);
      });
      grid.append(button);
    }
    panel.append(title, grid);
    wrap.append(group, panel);

    const closePanel = () => {
      panel.hidden = true;
      document.removeEventListener("mousedown", onOutside, true);
    };
    const onOutside = (event) => {
      if (!wrap.contains(event.target)) closePanel();
    };
    group.addEventListener("change", (event) => {
      const key = event.target.value;
      if (key !== "more") {
        closePanel();
        onChange(Number(key));
      }
    });
    // "click" (not "change") so choosing More again re-opens the panel while it stays selected.
    more.addEventListener("click", () => {
      panel.hidden = false;
      document.addEventListener("mousedown", onOutside, true);
    });
    return wrap;
  };

  return { create };
})();
