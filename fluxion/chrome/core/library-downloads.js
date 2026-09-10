(function exposeLibraryDownloads(scope) {
  "use strict";

  function canReview(download) {
    const error = download.error;
    return Boolean(download.hasBlockedData && error?.becauseBlockedByReputationCheck &&
      !error.becauseBlockedByParentalControls && !error.becauseBlockedByContentAnalysis);
  }

  function describe(download) {
    const blocked = Boolean(download.hasBlockedData || download.error?.becauseBlocked);
    let status;
    if (blocked) status = "Blocked";
    else if (download.succeeded) status = download.target?.exists === false ? "File moved or missing" : "Finished";
    else if (download.error) status = "Failed";
    else if (download.canceled) status = download.hasPartialData ? "Paused" : "Canceled";
    else if (download.stopped) status = download.hasPartialData ? "Paused" : "Stopped";
    else if (download.hasProgress && download.totalBytes > 0) {
      status = `${Math.max(0, Math.min(100, Math.round(download.currentBytes / download.totalBytes * 100)))}%`;
    } else status = "Downloading";
    return {
      status,
      open: !blocked && Boolean(download.succeeded) && download.target?.exists !== false,
      cancel: !blocked && !download.stopped,
      retry: !blocked && Boolean(download.stopped) && !download.succeeded,
      retryLabel: download.hasPartialData ? "Resume" : "Retry",
      blocked,
      review: canReview(download),
    };
  }

  async function review(download, { confirm }) {
    if (!canReview(download)) return "unavailable";
    const error = download.error;
    const verdict = error.reputationCheckVerdict;
    const action = await confirm({ verdict, becauseBlockedByReputationCheck: true, dialogType: "chooseUnblock" });
    if (action !== "unblock" && action !== "confirmBlock") return "cancel";
    // A native dialog can remain open while another controller removes or
    // retries this item. Never apply an old decision to a new download state.
    if (!canReview(download) || download.error !== error || error.reputationCheckVerdict !== verdict) return "stale";
    if (action === "unblock") await download.unblock();
    else await download.confirmBlock();
    return action;
  }

  async function remove(download, list) {
    // Match Gecko's blocked-data cleanup, including the policy response that
    // ordinary partial-file finalization does not provide.
    if (download.hasBlockedData) await download.confirmBlock();
    else if (download.error?.becauseBlockedByContentAnalysis) await download.respondToContentAnalysisWarnWithBlock();
    // Finalize prevents another controller restarting during asynchronous
    // cancellation and clears abandoned partial data, not a completed file.
    await download.finalize(true);
    await list.remove(download);
  }

  function createRefreshQueue({ refresh, setTimer, clearTimer, reportError, delay = 100 }) {
    let timer = null;
    let running = false;
    let dirty = false;
    let closed = false;
    function schedule() {
      if (closed) return;
      dirty = true;
      if (timer !== null || running) return;
      timer = setTimer(async () => {
        timer = null;
        if (closed) return;
        dirty = false;
        running = true;
        try { await refresh(); } catch (error) { reportError(error); }
        finally {
          running = false;
          if (dirty && !closed) schedule();
        }
      }, delay);
    }
    function close() {
      closed = true;
      dirty = false;
      if (timer !== null) clearTimer(timer);
      timer = null;
    }
    return Object.freeze({ schedule, close });
  }

  const api = Object.freeze({ describe, review, remove, createRefreshQueue });
  scope.FluxionLibraryDownloads = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
