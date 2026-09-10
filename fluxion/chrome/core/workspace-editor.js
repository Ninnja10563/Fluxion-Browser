(function exposeWorkspaceEditor(scope) {
  "use strict";

  // DOM state belongs to a workspace ID, not its current position or label.
  function attach(list, { create, select, mark, update, move, remove, note, scrollContainer }) {
    const document = list.ownerDocument;
    const records = new Map();
    let reconciling = false, destroyed = false;
    const live = record => !destroyed && !reconciling && records.get(record.model.id) === record;
    function build(model) {
      const record = { model, dirty: false };
      const item = create("section", "fluxion-settings-workspace-row");
      item.dataset.workspaceId = model.id;
      item.setAttribute("role", "listitem");
      const identity = create("div", "fluxion-settings-workspace-identity");
      const name = create("input", "fluxion-settings-control fluxion-settings-workspace-name");
      name.type = "text"; name.maxLength = 32;
      name.addEventListener("input", () => {
        if (live(record)) record.dirty = name.value !== record.model.name;
      });
      name.addEventListener("change", () => {
        if (!live(record)) return;
        record.dirty = false;
        const updated = update(record.model.id, { name: name.value });
        name.value = updated ? updated.name : record.model.name;
        note(updated ? `Renamed workspace to ${updated.name}.` : "Workspace names cannot be empty.");
      });
      const state = create("span", "fluxion-settings-workspace-current");
      const glyph = mark(model.icon, model.accent);
      identity.append(glyph, name, state);
      const controls = create("div", "fluxion-settings-workspace-controls");
      const choice = (key, choices) => {
        const field = select(choices, model[key], value => {
          if (!live(record)) return;
          update(record.model.id, { [key]: value });
          note(`${record.model.name} ${key === "icon" ? "symbol" : "accent"} updated.`);
        });
        field.classList.add("fluxion-settings-control");
        return field;
      };
      const symbol = choice("icon", [["circle", "Circle"], ["diamond", "Diamond"], ["square", "Square"], ["arc", "Arc"], ["grid", "Grid"]]);
      const accent = choice("accent", [["slate", "Slate"], ["blue", "Blue"], ["ochre", "Ochre"], ["sage", "Sage"], ["rose", "Rose"]]);
      const actions = create("div", "fluxion-settings-workspace-actions");
      const button = (label, action, danger = false) => {
        const field = create("button", `fluxion-settings-button${danger ? " danger" : ""}`, label);
        field.type = "button";
        field.addEventListener("click", () => { if (live(record)) action(); });
        return field;
      };
      const shift = direction => {
        move(record.model.id, direction);
        if (item.contains(document.activeElement)) document.activeElement.scrollIntoView?.({ block: "nearest", behavior: "instant" });
      };
      const up = button("Up", () => shift(-1));
      const down = button("Down", () => shift(1));
      const deletion = button("Delete", () => {
        const previousName = record.model.name;
        if (remove(record.model.id)) note(`${previousName} deleted; its tabs were moved safely.`);
      }, true);
      actions.append(up, down, deletion);
      controls.append(symbol, accent, actions);
      item.append(identity, controls);
      return Object.assign(record, { item, identity, glyph, name, state, symbol, accent, up, down, deletion });
    }

    function sync(items, currentId) {
      if (destroyed) return;
      const focused = document?.activeElement;
      const owner = [...records.values()].find(record => record.item.contains(focused));
      const oldIndex = owner ? [...list.children].indexOf(owner.item) : -1;
      const selection = owner && focused === owner.name ?
        [focused.selectionStart, focused.selectionEnd, focused.selectionDirection] : null;
      const scrollTop = scrollContainer?.scrollTop;
      reconciling = true;
      try {
        const wanted = new Set(items.map(item => item.id));
        for (const [id, record] of records) {
          if (!wanted.has(id)) { records.delete(id); record.item.remove(); }
        }
        for (const [index, model] of items.entries()) {
          let record = records.get(model.id);
          if (!record) { record = build(model); records.set(model.id, record); }
          if (record.model.icon !== model.icon || record.model.accent !== model.accent) {
            const glyph = mark(model.icon, model.accent);
            record.glyph.replaceWith(glyph); record.glyph = glyph;
          }
          record.model = model;
          if (!record.dirty && record.name.value !== model.name) record.name.value = model.name;
          if (record.symbol.value !== model.icon) record.symbol.value = model.icon;
          if (record.accent.value !== model.accent) record.accent.value = model.accent;
          record.name.setAttribute("aria-label", `Name for ${model.name}`);
          record.symbol.setAttribute("aria-label", `Symbol for ${model.name}`);
          record.accent.setAttribute("aria-label", `Accent for ${model.name}`);
          record.up.setAttribute("aria-label", `Move ${model.name} earlier`);
          record.down.setAttribute("aria-label", `Move ${model.name} later`);
          record.deletion.setAttribute("aria-label", `Delete ${model.name}`);
          record.up.disabled = index === 0;
          record.down.disabled = index === items.length - 1;
          record.deletion.disabled = items.length === 1;
          record.state.textContent = model.id === currentId ? "Current" : "";
          const before = list.children[index] || null;
          if (before !== record.item) {
            // Gecko's state-preserving move keeps focus, selection and IME
            // composition live. Older engines use an owned-focus fallback.
            if (record.item.parentNode === list && typeof list.moveBefore === "function") list.moveBefore(record.item, before);
            else list.insertBefore(record.item, before);
          }
        }
        if (owner) {
          const retained = records.get(owner.model.id) === owner;
          let target = retained ? focused : records.get(items[Math.min(oldIndex, items.length - 1)]?.id)?.name;
          if (target?.disabled) target = target === owner.up && !owner.down.disabled ? owner.down :
            target === owner.down && !owner.up.disabled ? owner.up : owner.name;
          const active = document.activeElement;
          if (target && (active === focused || active === document.body || active === document.documentElement || !active)) {
            if (active !== target) {
              target.focus({ preventScroll: true });
              if (retained && target === owner.name && selection?.every(value => value !== undefined)) {
                target.setSelectionRange(...selection);
              }
            }
          }
        }
        if (scrollContainer && scrollTop !== undefined) scrollContainer.scrollTop = scrollTop;
      } finally { reconciling = false; }
    }
    return Object.freeze({ sync, destroy() { destroyed = true; records.clear(); } });
  }
  const api = Object.freeze({ attach });
  scope.FluxionWorkspaceEditor = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
