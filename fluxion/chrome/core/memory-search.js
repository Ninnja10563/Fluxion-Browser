/* global globalThis */
(function exposeMemorySearch(scope) {
  "use strict";
  const fields = Object.freeze(["title", "url", "description", "headings", "content"]);
  const batchSize = 50;

  // Persisted search data cannot depend on the machine's current locale.
  // This deliberately matches ranker folding, not transliteration or stemming.
  function fold(value) {
    return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().trim().replace(/\s+/g, " ");
  }

  function foldedFields(page) {
    return Object.fromEntries(fields.map(field => [`search_${field}`, fold(page[field])]));
  }

  async function migrateV1(db, yieldControl = () => Promise.resolve()) {
    // DDL, backfill and version advance are one transaction: interruption rolls
    // everything back to v1. Only one small keyset batch enters JS at a time.
    await db.executeTransaction(async () => {
      for (const field of fields) {
        await db.execute(`ALTER TABLE pages ADD COLUMN search_${field} TEXT NOT NULL DEFAULT ''`);
      }
      let cursor = 0;
      while (true) {
        const rows = await db.executeCached(`SELECT id, ${fields.join(", ")} FROM pages
          WHERE id > :cursor ORDER BY id LIMIT :limit`, { cursor, limit: batchSize });
        if (!rows.length) break;
        for (const row of rows) {
          const page = Object.fromEntries(fields.map(field => [field, row.getResultByName(field)]));
          cursor = row.getResultByName("id");
          await db.executeCached(`UPDATE pages SET ${fields.map(field => `search_${field}=:search_${field}`).join(", ")}
            WHERE id=:id`, { id: cursor, ...foldedFields(page) });
        }
        await yieldControl();
      }
      await db.setSchemaVersion(2);
    });
  }

  const api = Object.freeze({ fields, fold, foldedFields, migrateV1 });
  scope.FluxionMemorySearch = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis === "object" ? globalThis : this);
