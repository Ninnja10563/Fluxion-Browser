(function exposeTabLinks(scope) {
  "use strict";

  function shareableURL(spec) {
    if (typeof spec !== "string" || !/^https?:\/\//i.test(spec) || /[\s\\\u0000-\u001f\u007f]/.test(spec)) return null;
    try {
      const parsed = new URL(spec);
      if (!parsed.hostname || !["http:", "https:"].includes(parsed.protocol)) return null;
      // Validate with URL, but never serialize it: native escape sequences,
      // query ordering, empty delimiters and fragments must stay byte-exact.
      const start = spec.indexOf("://") + 3;
      const end = spec.slice(start).search(/[/?#]/);
      const authorityEnd = end < 0 ? spec.length : start + end;
      if (authorityEnd === start) return null;
      const at = spec.slice(start, authorityEnd).lastIndexOf("@");
      if (at < 0 && (parsed.username || parsed.password)) return null;
      return at < 0 ? spec : spec.slice(0, start) + spec.slice(start + at + 1);
    } catch (_) { return null; }
  }

  scope.FluxionTabLinksCore = Object.freeze({ shareableURL });
  if (typeof module !== "undefined" && module.exports) module.exports = scope.FluxionTabLinksCore;
})(typeof globalThis === "object" ? globalThis : this);
