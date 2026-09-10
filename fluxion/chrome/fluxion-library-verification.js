/* global Services, SessionStore, ChromeUtils, Cu */
(function initialiseFluxionLibraryVerification(window) {
  "use strict";

  if (Services.env.get("FLUXION_LIBRARY_SCALE_TEST") !== "1") return;
  const { document } = window;
  const prefix = "fluxion.library.verification";
  const report = { historySeeded: 0, bookmarksSeeded: 0, pages: [], assertions: [] };
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const delay = ms => new Promise(resolve => window.setTimeout(resolve, ms));
  const waitFor = async (predicate, message) => {
    const deadline = Date.now() + 20000;
    do {
      if (predicate()) return;
      await delay(25);
    } while (Date.now() < deadline);
    throw new Error(message);
  };
  let root;
  let input;
  const titles = () => [...root.querySelectorAll(".fluxion-library-row-title")].map(node => node.textContent);
  const ready = () => root.dataset.queryState === "ready" &&
    root.querySelector(".fluxion-library-list").getAttribute("aria-busy") !== "true";
  const search = value => {
    assert(!root.hidden && input.getBoundingClientRect().height > 0, "Library search is not actually visible");
    input.focus();
    input.value = value;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  async function query(value, expected) {
    search(value);
    await waitFor(() => ready() && expected(titles()), `Library query did not settle correctly: ${value}`);
  }
  async function pages(section, count) {
    const first = titles();
    assert(first.length === 100, `${section} first page should contain100 rows, got ${first.length}`);
    assert(new Set(first).size === first.length, `${section} first page contains duplicates`);
    const previous = root.querySelector('[aria-label="Previous Library page"]');
    const next = root.querySelector('[aria-label="Next Library page"]');
    const listNode = root.querySelector(".fluxion-library-list");
    assert(previous?.disabled && next && !next.disabled, `${section} first-page controls are incorrect`);
    const seen = new Set(first);
    let page = 1;
    while (!next.disabled) {
      const old = titles().join("\n");
      next.focus();
      assert(document.activeElement === next, `${section} Next button could not receive keyboard focus`);
      next.click();
      page += 1;
      await waitFor(() => ready() && titles().join("\n") !== old &&
        root.querySelector(".fluxion-library-page-label")?.textContent === `Page ${page}`,
      `${section} next page ${page} did not settle`);
      assert(document.activeElement === (next.disabled ? listNode : next),
        `${section} Next page ${page} lost focus${next.disabled ? " instead of moving it to results" : " on its enabled control"}`);
      const current = titles();
      assert(current.length > 0 && current.length <= 100, `${section} invalid page size`);
      for (const title of current) {
        assert(!seen.has(title), `${section} pagination repeated ${title}`);
        seen.add(title);
      }
      assert(page <= Math.ceil(count / 100), `${section} pagination did not terminate`);
    }
    assert(seen.size === count, `${section} paging omitted records: ${seen.size}/${count}`);
    while (page > 1) {
      assert(!previous.disabled, `${section} previous page unexpectedly disabled`);
      previous.focus();
      assert(document.activeElement === previous, `${section} Previous button could not receive keyboard focus`);
      previous.click();
      page -= 1;
      await waitFor(() => ready() && root.querySelector(".fluxion-library-page-label")?.textContent === `Page ${page}`,
        `${section} previous page ${page} did not settle`);
      assert(document.activeElement === (previous.disabled ? listNode : previous),
        `${section} Previous page ${page} lost focus${previous.disabled ? " instead of moving it to results" : " on its enabled control"}`);
    }
    assert(JSON.stringify(titles()) === JSON.stringify(first), `${section} tied-date first page changed on return`);
    report.pages.push({ section, uniqueRows: seen.size, pageCount: Math.ceil(count / 100), stableFirstPage: true, keyboardFocusPreserved: true });
  }

  async function run() {
    await SessionStore.promiseAllWindowsRestored;
    assert(window.FluxionLibrary, "Native Library did not initialise");
    const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
    const { PlacesBrowserStartup } = ChromeUtils.importESModule(
      "moz-src:///browser/components/places/PlacesBrowserStartup.sys.mjs"
    );
    // Window restoration precedes the fresh-profile default bookmark import,
    // whose replace:true transaction would erase a newly seeded fixture folder.
    await waitFor(() => PlacesBrowserStartup._placesBrowserInitComplete,
      "Firefox Places startup did not finish before Library seeding");
    report.placesStartupComplete = true;
    const recent = new Date(Date.now() - 86400000);
    const old = new Date(Date.now() - 90 * 86400000);
    const historyTarget = "Fluxion Archive — Cedar ÉCOLE MÉMOIRE Café history";
    const bookmarkTarget = "Fluxion Archive — Cedar ÉCOLE MÉMOIRE Café bookmark";
    const history = Array.from({ length: 360 }, (_, index) => ({
      url: `https://library-fixture.invalid/history/${index}`,
      title: index === 0 ? historyTarget : `Fluxion Archive history ${String(index).padStart(3, "0")}`,
      visits: [{ date: index === 0 ? old : recent, transition: PlacesUtils.history.TRANSITIONS.LINK }],
    }));
    await PlacesUtils.history.insertMany(history);
    report.historySeeded = history.length;
    const folder = await PlacesUtils.bookmarks.insert({
      parentGuid: PlacesUtils.bookmarks.unfiledGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      title: "Fluxion Archive Research",
    });
    let oldBookmark;
    for (let index = 0; index < 550; index += 1) {
      const bookmark = await PlacesUtils.bookmarks.insert({
        parentGuid: folder.guid,
        url: `https://library-fixture.invalid/bookmark/${index}`,
        title: index === 0 ? bookmarkTarget : `Fluxion Archive bookmark ${String(index).padStart(3, "0")}`,
        dateAdded: index === 0 ? old : recent,
      });
      if (index === 0) oldBookmark = bookmark;
      report.bookmarksSeeded += 1;
    }
    await PlacesUtils.bookmarks.insert({
      parentGuid: PlacesUtils.bookmarks.toolbarGuid,
      url: "https://library-fixture.invalid/other-folder",
      title: "Fluxion Archive — Cedar ÉCOLE MÉMOIRE Café wrong folder",
    });
    window.FluxionLibrary.open("history");
    root = document.getElementById("fluxion-library");
    input = root?.querySelector(".fluxion-library-search");
    assert(input, "Library search input is unavailable");
    await query("Fluxion Archive", rows => rows.length === 100);
    await pages("history", 360);
    await query("cedar", rows => rows.length === 1 && rows[0] === historyTarget);
    report.assertions.push("old-history-outside-300-record-cap");
    await query("école mémoire café", rows => rows.length === 1 && rows[0] === historyTarget);
    report.assertions.push("native-unicode-case-search");

    // Dispatch a second user query while the first real Places request is outstanding.
    search("Fluxion Archive");
    assert(root.dataset.queryState === "loading", "First search did not enter a genuine pending state");
    search("no-such-fluxion-record");
    search("cedar");
    await waitFor(() => ready() && titles().length === 1 && titles()[0] === historyTarget,
      "Latest back-to-back query did not win");
    await delay(350);
    assert(ready() && titles().length === 1 && titles()[0] === historyTarget,
      "An earlier pending result overwrote the final query");
    report.assertions.push("latest-query-wins-real-places-requests");
    await PlacesUtils.history.remove(history[0].url);
    await waitFor(() => ready() && titles().length === 0,
      "External history deletion did not update visible Library results");
    report.assertions.push("live-external-history-removal");

    window.FluxionLibrary.open("bookmarks");
    const select = root.querySelector(".fluxion-library-folder-select");
    await waitFor(() => [...select.options].some(option => option.value === folder.guid), "Seeded bookmark folder is missing");
    select.value = folder.guid;
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
    await query("Fluxion Archive", rows => rows.length === 100 && rows.every(title => title.includes("bookmark")));
    await pages("bookmarks", 550);
    const content = root.querySelector(".fluxion-library-content");
    const next = root.querySelector('[aria-label="Next Library page"]');
    content.scrollTop = 1800;
    await delay(80);
    const scrollRect = content.getBoundingClientRect();
    const nextRect = next.getBoundingClientRect();
    assert(nextRect.top >= scrollRect.top && nextRect.bottom <= scrollRect.bottom,
      "Sticky pager is clipped outside the actual deep-scroll viewport");
    report.assertions.push("sticky-pager-visible-after-deep-scroll");

    const readingRow = root.querySelectorAll(".fluxion-library-row")[25];
    const readingGuid = readingRow._fluxionLibraryId;
    const readingTitle = readingRow.querySelector(".fluxion-library-row-title").textContent;
    const readingControl = readingRow.querySelector(".fluxion-library-open");
    readingControl.focus({ preventScroll: true });
    const readingScroll = content.scrollTop;
    await PlacesUtils.bookmarks.update({ guid: readingGuid, title: `${readingTitle} — refreshed` });
    await waitFor(() => ready() && titles().includes(`${readingTitle} — refreshed`),
      "Background bookmark update did not refresh the current reading page");
    assert(document.activeElement?.closest(".fluxion-library-row")?._fluxionLibraryId === readingGuid,
      "Background bookmark update lost the user's focused row");
    assert(Math.abs(content.scrollTop - readingScroll) <= 1,
      "Background bookmark update moved the reading scroll position");
    report.assertions.push("background-places-update-preserves-reading-focus-and-scroll");

    const oldWidth = window.outerWidth, oldHeight = window.outerHeight;
    try {
      window.resizeTo(920, 800);
      content.scrollTop = 0;
      await delay(150);
      const rect = content.getBoundingClientRect();
      const tools = root.querySelector(".fluxion-library-section-tools");
      for (const control of tools.querySelectorAll("button, select")) {
        if (control.hidden) continue;
        const bounds = control.getBoundingClientRect();
        assert(bounds.width > 0 && bounds.left >= rect.left && bounds.right <= rect.right,
          "Narrow bookmark section clips an actionable control");
      }
      assert(content.scrollWidth <= content.clientWidth + 1, "Narrow bookmark controls cause horizontal overflow");
      report.assertions.push("narrow-bookmark-controls-remain-visible");
    } finally {
      window.resizeTo(oldWidth, oldHeight);
    }
    await query("école mémoire café", rows => rows.length === 1 && rows[0] === bookmarkTarget);
    assert(select.value === folder.guid, "Bookmark search lost its selected folder");
    report.assertions.push("old-bookmark-outside-500-record-cap", "folder-filter-before-limit");
    const renamed = `${bookmarkTarget} — revised`;
    await PlacesUtils.bookmarks.update({ guid: oldBookmark.guid, title: renamed });
    await waitFor(() => ready() && titles().length === 1 && titles()[0] === renamed,
      "External bookmark rename did not update visible Library results");
    await PlacesUtils.bookmarks.remove(oldBookmark.guid);
    await waitFor(() => ready() && titles().length === 0,
      "External bookmark removal did not update visible Library results");
    report.assertions.push("live-external-bookmark-rename", "live-external-bookmark-removal");
    // Leave a populated, real Library page visible for the optional release screenshot.
    await query("Fluxion Archive", rows => rows.length === 100 && rows.every(title => title.includes("bookmark")));
    input.blur();
  }

  run().then(() => {
    Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report));
    Services.prefs.setStringPref(`${prefix}.health`, "full-places-search-and-pagination-verified");
  }).catch(error => {
    report.failureState = {
      query: input?.value, state: root?.dataset.queryState, hidden: root?.hidden,
      page: root?.querySelector(".fluxion-library-page-label")?.textContent,
      titles: root ? titles().slice(0, 4) : [],
    };
    Services.prefs.setStringPref(`${prefix}.report`, JSON.stringify(report));
    Services.prefs.setStringPref(`${prefix}.error`, `${error?.message || error}\n${error?.stack || ""}`);
    Cu.reportError(error);
  }).finally(() => Services.prefs.savePrefFile(null));
})(window);
