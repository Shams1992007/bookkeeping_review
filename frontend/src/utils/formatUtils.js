import { parseMaybeAmount, parseMaybeDate } from "./importUtils";

export function getFormatSortOptions(headers = []) {
  const opts = [];
  const seen = new Set();

  for (const h of headers) {
    const lower = h.toLowerCase();
    if (lower.includes("date") && !seen.has("date")) {
      opts.push({ value: h, label: "Date" });
      seen.add("date");
    } else if (lower.includes("name") && !seen.has("name")) {
      opts.push({ value: h, label: "Name" });
      seen.add("name");
    } else if (lower.includes("amount") && !seen.has("amount")) {
      opts.push({ value: h, label: "Amount" });
      seen.add("amount");
    }
  }

  return opts;
}

export function compareFormattedRows(a, b, field) {
  const av = a?.[field];
  const bv = b?.[field];

  const ad = parseMaybeDate(av);
  const bd = parseMaybeDate(bv);
  if (ad != null && bd != null) return ad - bd;

  const aa = parseMaybeAmount(av);
  const ba = parseMaybeAmount(bv);
  if (aa != null && ba != null) return aa - ba;

  return String(av ?? "").localeCompare(String(bv ?? ""), undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

export function buildFormattedRows(rows = [], mapping = {}, formatHeaders = []) {
  return rows.map((r) => {
    const out = { __rowKey: r.row_index };

    for (const h of formatHeaders) {
      const src = mapping?.[h];
      out[h] = src ? (r?.data?.[src] ?? "") : "";
    }

    return out;
  });
}

// Generic accounting/report words that appear in many format labels (and file
// names) and therefore carry no signal about *which* format a file is. Only the
// distinctive tokens left after removing these — e.g. a client name like
// "Bel Inizio" or "Miritel" — are used for filename-based identification.
const GENERIC_LABEL_TOKENS = new Set([
  "qbo", "lgl", "invoice", "recon", "reconciliation", "due", "bill",
  "report", "transaction", "export", "statement", "the", "and", "of", "to",
]);

const tokenize = (s) => String(s ?? "").toLowerCase().match(/[a-z0-9]+/g) || [];

// Pick the format that best matches the uploaded file — regardless of which slot
// (A/B) it was uploaded into. Two signals, in priority order:
//
//  1. Filename identity. A format's distinctive label tokens (client name, after
//     stripping generic words like "QBO"/"Invoice"/"Recon") appearing in the
//     file name strongly identify the format. This disambiguates formats that
//     share generic QBO/LGL columns (Date/Num/Name/Amount) and would otherwise
//     tie — or lose — on raw header overlap. (A "Bel Inizio" QBO export is a
//     structurally-perfect "Miritel QBO Invoice Recon" too; only the file name
//     says it's Bel Inizio.)
//  2. Header overlap. How many of the format's `headers` appear in the file.
//
// Only formats that clear the same meaningful-overlap bar (>= 2 columns) are
// candidates, so a filename hint never selects a structurally-irrelevant format.
// Returns `fallbackKey` when nothing clears the bar, and keeps `fallbackKey`
// when it ties the winner so we don't switch gratuitously.
export function detectFormatKey(
  sourceHeaders = [],
  formats = [],
  fallbackKey = "",
  fileName = ""
) {
  const src = new Set(sourceHeaders.map((h) => String(h).trim().toLowerCase()));
  const fileTokens = new Set(tokenize(fileName));

  const headerScoreOf = (f) =>
    (Array.isArray(f?.headers) ? f.headers : []).reduce(
      (n, h) => n + (src.has(String(h).trim().toLowerCase()) ? 1 : 0),
      0
    );

  const nameScoreOf = (f) => {
    const distinctive = tokenize(f?.label).filter(
      (t) => t.length > 1 && !GENERIC_LABEL_TOKENS.has(t)
    );
    return new Set(distinctive).size
      ? distinctive.filter((t) => fileTokens.has(t)).length
      : 0;
  };

  // Rank candidates by filename identity first, header overlap second.
  const better = (a, b) =>
    a.name > b.name || (a.name === b.name && a.header > b.header);

  let best = null;
  let bestScore = { name: 0, header: 0 };
  for (const f of formats) {
    const header = headerScoreOf(f);
    if (header < 2) continue; // must overlap meaningfully to be a candidate
    const score = { name: nameScoreOf(f), header };
    if (best === null || better(score, bestScore)) {
      bestScore = score;
      best = f.key;
    }
  }

  if (best === null) return fallbackKey;

  const fallback = formats.find((f) => f.key === fallbackKey);
  if (fallback) {
    const fbScore = { name: nameScoreOf(fallback), header: headerScoreOf(fallback) };
    if (fbScore.header >= 2 && !better(bestScore, fbScore)) return fallbackKey;
  }

  return best;
}

export function getSavedPanel(importMeta, panelKey) {
  const arr = Array.isArray(importMeta?.savedMappings)
    ? importMeta.savedMappings
    : [];

  return arr.find((x) => x.panelKey === panelKey) || null;
}