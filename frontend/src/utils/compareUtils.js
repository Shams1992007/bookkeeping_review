function lower(v) {
  return String(v ?? "").trim().toLowerCase();
}

export function normalizeText(v) {
  return lower(v).replace(/\s+/g, " ");
}

export function normalizeDate(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";

  const m1 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m1) {
    const mm = Number(m1[1]);
    const dd = Number(m1[2]);
    const yy = Number(m1[3]);
    const yyyy = yy >= 70 ? 1900 + yy : 2000 + yy;
    return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }

  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) {
    const mm = Number(m2[1]);
    const dd = Number(m2[2]);
    const yyyy = Number(m2[3]);
    return `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  }

  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  return normalizeText(s);
}

export function normalizeAmount(v) {
  const s = String(v ?? "").replace(/[$, ]/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function normalizeCategory(v) {
  let s = normalizeText(v);

  if (!s) return "";

  s = s
    .replace(/&/g, " and ")
    .replace(/-/g, " ")
    .replace(/\b\d{4}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // If category has colon-separated prefixes, keep the most meaningful tail
  // Example:
  // "Contributions:Individual Contributions:4007 Individuals - Recurring"
  // -> "Individuals - Recurring"
  if (s.includes(":")) {
    const parts = s
      .split(":")
      .map((x) => x.trim())
      .filter(Boolean);

    s = parts[parts.length - 1] || s;
  }

  // Remove leading numeric code if still present
  // Example: "4007 Individuals - Recurring" -> "Individuals - Recurring"
  s = s.replace(/^\d+\s+/, "").trim();

  // Normalize some common wording differences
  s = s
    .replace(/^individual contributions\s+/i, "")
    .replace(/^contributions\s+/i, "")
    .replace(/^peer to peer fundraising\s+/i, "")
    .replace(/^event income\s+/i, "")
    .replace(/^grants\s+/i, "")
    .replace(/^other operating income\s+/i, "")
    .trim();

  // Optional aliases for known business-equivalent labels
  const aliases = {
    "misc event income": "event income",
    "unrestricted grants": "unrestricted grants",
    "individuals - non-recurring": "individuals - non-recurring",
    "individuals - non-recurring ": "individuals - non-recurring",
  };

  return aliases[s] || s;
}

export function normalizeNameLike(v) {
  return normalizeText(v)
    .replace(/[.,:;]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Word-token overlap test: two normalized name-like strings count as a partial
// match when they share at least one whole word of length >= MIN_NAME_TOKEN_LEN.
// "Shell Oil" vs "Shell" → match on "Shell". "John" vs "Johnson" → no match
// (tokens differ as whole words). Defensive against single-letter coincidences.
const MIN_NAME_TOKEN_LEN = 3;

function nameTokens(s) {
  if (!s) return [];
  return s.split(/\s+/).filter((t) => t.length >= MIN_NAME_TOKEN_LEN);
}

function sharesNameToken(a, b) {
  const at = nameTokens(a);
  if (!at.length) return null;
  const bt = new Set(nameTokens(b));
  if (!bt.size) return null;
  for (const t of at) if (bt.has(t)) return t;
  return null;
}

// The employer/organization column is not always literally named
// "Employer/Organization" — e.g. the QBO format stores it under the header
// "Description". Callers pass the resolved per-panel field names; both default
// to "Employer/Organization" so older callers keep working.
export function namesMatchWithFallback(
  rowA,
  rowB,
  leftField,
  rightField,
  leftEmployerField = "Employer/Organization",
  rightEmployerField = "Employer/Organization"
) {
  const leftName = normalizeNameLike(getFieldValue(rowA, leftField));
  const rightName = normalizeNameLike(getFieldValue(rowB, rightField));

  const rightEmployer = normalizeNameLike(getFieldValue(rowB, rightEmployerField));
  const leftEmployer = normalizeNameLike(getFieldValue(rowA, leftEmployerField));

  // Pass 1: strict equality (preferred — keeps Truth highlights clean).
  if (leftName && rightName && leftName === rightName) {
    return { ok: true, mode: "name_to_name", reason: "Exact name match" };
  }
  if (leftName && rightEmployer && leftName === rightEmployer) {
    return {
      ok: true,
      mode: "left_name_to_right_employer",
      reason: "Matched because left Name = right Employer/Organization",
    };
  }
  if (rightName && leftEmployer && rightName === leftEmployer) {
    return {
      ok: true,
      mode: "right_name_to_left_employer",
      reason: "Matched because right Name = left Employer/Organization",
    };
  }

  // Pass 2: word-token overlap. Catches "Shell Oil" ↔ "Shell" and similar
  // cases where one side carries a fuller form of the same entity. All
  // partial matches surface as Conditional Truth in the UI.
  const nameNameShared = sharesNameToken(leftName, rightName);
  if (nameNameShared) {
    return {
      ok: true,
      mode: "name_to_name_partial",
      reason: `Names share the word "${nameNameShared}"`,
    };
  }
  const leftNameRightEmployerShared = sharesNameToken(leftName, rightEmployer);
  if (leftNameRightEmployerShared) {
    return {
      ok: true,
      mode: "left_name_to_right_employer_partial",
      reason: `Left Name and right Employer/Organization share the word "${leftNameRightEmployerShared}"`,
    };
  }
  const rightNameLeftEmployerShared = sharesNameToken(rightName, leftEmployer);
  if (rightNameLeftEmployerShared) {
    return {
      ok: true,
      mode: "right_name_to_left_employer_partial",
      reason: `Right Name and left Employer/Organization share the word "${rightNameLeftEmployerShared}"`,
    };
  }

  return {
    ok: false,
    mode: "no_match",
    reason: "Name did not match Name or Employer/Organization",
  };
}

export function valuesEqual(fieldType, a, b, options = {}) {
  const {
    rowA = null,
    rowB = null,
    leftField = "",
    rightField = "",
    label = "",
    leftEmployerField = "Employer/Organization",
    rightEmployerField = "Employer/Organization",
  } = options;

  if (fieldType === "date") {
    const na = normalizeDate(a);
    const nb = normalizeDate(b);
    if (!na || !nb) {
      return {
        ok: false,
        mode: "date_mismatch",
        reason: "Date missing on one or both sides",
      };
    }
    const ok = na === nb;
    return {
      ok,
      mode: ok ? "date_match" : "date_mismatch",
      reason: ok ? "Dates matched" : "Dates did not match",
    };
  }

  if (fieldType === "amount") {
    const aa = normalizeAmount(a);
    const bb = normalizeAmount(b);
    const ok = aa != null && bb != null && Math.abs(aa - bb) < 0.000001;

    return {
      ok,
      mode: ok ? "amount_match" : "amount_mismatch",
      reason: ok ? "Amounts matched" : "Amounts did not match",
    };
  }

  if (fieldType === "category") {
    const aa = normalizeCategory(a);
    const bb = normalizeCategory(b);

    if (!aa || !bb) {
      return {
        ok: false,
        mode: "category_mismatch",
        reason: "Category missing or not comparable",
      };
    }

    if (aa === bb || aa.includes(bb) || bb.includes(aa)) {
      return {
        ok: true,
        mode: "category_match",
        reason: "Categories matched after normalization",
      };
    }

    return {
      ok: false,
      mode: "category_mismatch",
      reason: "Categories did not match",
    };
  }

  if (lower(label) === "name" && rowA && rowB) {
    return namesMatchWithFallback(
      rowA,
      rowB,
      leftField,
      rightField,
      leftEmployerField,
      rightEmployerField
    );
  }

  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) {
    return {
      ok: false,
      mode: "text_mismatch",
      reason: "Text missing on one or both sides",
    };
  }
  const ok = na === nb;
  return {
    ok,
    mode: ok ? "text_match" : "text_mismatch",
    reason: ok ? "Texts matched" : "Texts did not match",
  };
}

export function getFieldValue(row, fieldName) {
  return row?.[fieldName] ?? "";
}

// Resolve which projected header holds the Employer/Organization value for a
// panel. Rows are keyed by *format header*, but the employer column's header
// varies per format (QBO → "Description", LGL → "Employer/Organization"). We
// find it via the format's parallel `labels` array (label "Employer/Organization"),
// then fall back to a header literally named that, then to the literal default.
export function resolveEmployerField(panel) {
  const labels = panel?.labels || [];
  const headers = panel?.headers || [];
  const idx = labels.findIndex((l) => lower(l) === "employer/organization");
  if (idx >= 0 && headers[idx]) return headers[idx];
  const direct = headers.find((h) => lower(h) === "employer/organization");
  return direct || "Employer/Organization";
}

// Attach the resolved per-panel employer field names to the Name compare field
// so the name fallback (Name ↔ Employer/Organization, either direction) works
// regardless of how each format labels its employer column. Other fields are
// left untouched. Extra props on the Name field are inert for display/export.
export function withEmployerFields(compareFields = [], leftPanel, rightPanel) {
  const leftEmployerField = resolveEmployerField(leftPanel);
  const rightEmployerField = resolveEmployerField(rightPanel);
  return compareFields.map((f) =>
    lower(f.label) === "name"
      ? { ...f, leftEmployerField, rightEmployerField }
      : f
  );
}

export function getComparisonFieldType(label = "") {
  const s = lower(label);

  if (s.includes("date")) return "date";
  if (s.includes("amount")) return "amount";
  if (s.includes("category")) return "category";
  return "text";
}

export function scorePair(rowA, rowB, compareFields) {
  let matches = 0;
  const detail = {};

  for (const f of compareFields) {
    const type = getComparisonFieldType(f.label);
    const a = getFieldValue(rowA, f.leftField);
    const b = getFieldValue(rowB, f.rightField);

    const result = valuesEqual(type, a, b, {
      rowA,
      rowB,
      leftField: f.leftField,
      rightField: f.rightField,
      label: f.label,
      leftEmployerField: f.leftEmployerField,
      rightEmployerField: f.rightEmployerField,
    });

    detail[f.key] = result;
    if (result.ok) matches += 1;
  }

  return { matches, detail };
}

export function amountDifference(rowA, rowB, amountLeftField, amountRightField) {
  const a = normalizeAmount(getFieldValue(rowA, amountLeftField));
  const b = normalizeAmount(getFieldValue(rowB, amountRightField));
  // For standalone / one-sided rows (and any pair where only one side has an
  // amount) treat the missing side as 0 so the diff reflects the full present
  // amount. The raw amount cell stays blank — we don't substitute 0 there.
  // Only when BOTH sides are missing do we leave the diff blank.
  if (a == null && b == null) return "";
  return ((a ?? 0) - (b ?? 0)).toFixed(2);
}

// The Required/Optional flag now controls *display* only — Required = column shown
// in the Results table, Optional = column hidden. Pair eligibility no longer depends
// on it; see MIN_MATCHES_FOR_PAIR below.
export function isFieldRequired(field) {
  return field?.required !== false;
}

// A pair is shown side-by-side in Results when at least this many compare fields
// match. Ticks (Required/Optional) do NOT affect this gate.
export const MIN_MATCHES_FOR_PAIR = 2;

export function buildCompareRows({
  leftRows = [],
  rightRows = [],
  compareFields = [],
}) {
  const minMatches = Math.min(MIN_MATCHES_FOR_PAIR, compareFields.length);

  // Score every candidate pair up front, then assign best-first (highest score
  // wins its rows before weaker candidates). A plain left-to-right greedy lets an
  // early left row with a weak 2-field match steal a right row that is a perfect
  // 4-field match for a later left row, which cascades into a chain of wrong
  // pairings. Assigning strongest-first breaks that cascade: perfect pairs claim
  // their partners before mediocre ones ever look.
  const candidates = [];
  for (let li = 0; li < leftRows.length; li++) {
    for (let ri = 0; ri < rightRows.length; ri++) {
      const { matches, detail } = scorePair(
        leftRows[li],
        rightRows[ri],
        compareFields
      );
      if (matches < minMatches) continue;
      candidates.push({ li, ri, matches, detail });
    }
  }

  // Highest score first; ties resolve by original row order (left, then right)
  // so the assignment stays deterministic.
  candidates.sort(
    (a, b) => b.matches - a.matches || a.li - b.li || a.ri - b.ri
  );

  const usedLeft = new Set();
  const usedRight = new Set();
  const assigned = [];
  for (const c of candidates) {
    if (usedLeft.has(c.li) || usedRight.has(c.ri)) continue;
    usedLeft.add(c.li);
    usedRight.add(c.ri);
    assigned.push(c);
  }

  // Emit results in original left-row order for a stable display/export.
  const results = assigned
    .sort((a, b) => a.li - b.li)
    .map((c) => {
      const leftRow = leftRows[c.li];
      const rightRow = rightRows[c.ri];
      return {
        id: `pair-${leftRow.__rowKey}-${rightRow.__rowKey}`,
        leftRow,
        rightRow,
        matchDetail: c.detail,
        matchedCount: c.matches,
        manualPair: false,
      };
    });

  const unmatchedLeft = leftRows.filter(
    (l) => !results.some((x) => x.leftRow?.__rowKey === l.__rowKey)
  );

  const unmatchedRight = rightRows.filter(
    (r) => !results.some((x) => x.rightRow?.__rowKey === r.__rowKey)
  );

  return {
    matchedRows: results,
    unmatchedLeft,
    unmatchedRight,
  };
}

// A row is "fully filled" when every compare field on its side has a non-empty
// value. Used to decide whether an unmatched row deserves a standalone slot in
// the Results table.
export function isFullyFilled(row, compareFields, side) {
  if (!row || !compareFields?.length) return false;
  const key = side === "left" ? "leftField" : "rightField";
  return compareFields.every((f) => {
    const val = row[f[key]];
    return val !== undefined && val !== null && String(val).trim() !== "";
  });
}

// Fully-filled rows (every compare field non-empty on that side) that didn't
// auto-match or get manually paired appear in Results as standalone "False"
// rows — one side filled, the other side blank. They stay in the Unmatched
// list too, so they can still be manually paired; pairing one drops it from
// `unmatchedLeft`/`unmatchedRight`, which removes its standalone entry on the
// next render.
export function addStandalonePairs({
  matchedRows = [],
  unmatchedLeft = [],
  unmatchedRight = [],
  compareFields = [],
}) {
  if (!compareFields.length) {
    return { matchedRows, unmatchedLeft, unmatchedRight };
  }

  const standaloneLeft = unmatchedLeft.filter((r) => isFullyFilled(r, compareFields, "left"));
  const standaloneRight = unmatchedRight.filter((r) => isFullyFilled(r, compareFields, "right"));

  if (!standaloneLeft.length && !standaloneRight.length) {
    return { matchedRows, unmatchedLeft, unmatchedRight };
  }

  const emptyDetail = (reason) => {
    const detail = {};
    for (const f of compareFields) {
      detail[f.key] = { ok: false, mode: "standalone", reason };
    }
    return detail;
  };

  const newPairs = [
    ...standaloneLeft.map((leftRow) => ({
      id: `standalone-L-${leftRow.__rowKey}`,
      leftRow,
      rightRow: {},
      matchDetail: emptyDetail("Row has no counterpart on the right side"),
      matchedCount: 0,
      manualPair: false,
      isStandalone: true,
      standaloneSide: "left",
    })),
    ...standaloneRight.map((rightRow) => ({
      id: `standalone-R-${rightRow.__rowKey}`,
      leftRow: {},
      rightRow,
      matchDetail: emptyDetail("Row has no counterpart on the left side"),
      matchedCount: 0,
      manualPair: false,
      isStandalone: true,
      standaloneSide: "right",
    })),
  ];

  return {
    matchedRows: [...matchedRows, ...newPairs],
    unmatchedLeft,
    unmatchedRight,
  };
}

export function applyManualPairs({
  baseMatchedRows = [],
  unmatchedLeft = [],
  unmatchedRight = [],
  manualPairs = [],
  compareFields = [],
}) {
  const leftMap = new Map(unmatchedLeft.map((r) => [r.__rowKey, r]));
  const rightMap = new Map(unmatchedRight.map((r) => [r.__rowKey, r]));

  const usedLeft = new Set();
  const usedRight = new Set();
  const manualMatchedRows = [];

  for (const p of manualPairs) {
    const l = leftMap.get(p.leftRowKey);
    const r = rightMap.get(p.rightRowKey);
    if (!l || !r) continue;
    if (usedLeft.has(l.__rowKey) || usedRight.has(r.__rowKey)) continue;

    const { matches, detail } = scorePair(l, r, compareFields);

    manualMatchedRows.push({
      id: `manual-${l.__rowKey}-${r.__rowKey}`,
      leftRow: l,
      rightRow: r,
      matchDetail: detail,
      matchedCount: matches,
      manualPair: true,
    });

    usedLeft.add(l.__rowKey);
    usedRight.add(r.__rowKey);
  }

  const finalUnmatchedLeft = unmatchedLeft.filter((x) => !usedLeft.has(x.__rowKey));
  const finalUnmatchedRight = unmatchedRight.filter((x) => !usedRight.has(x.__rowKey));

  return {
    matchedRows: [...baseMatchedRows, ...manualMatchedRows],
    unmatchedLeft: finalUnmatchedLeft,
    unmatchedRight: finalUnmatchedRight,
  };
}

export function getDefaultCompareFields(leftHeaders = [], rightHeaders = []) {
  const fields = [];

  const dateLeft = leftHeaders.find((h) => lower(h).includes("date"));
  const dateRight = rightHeaders.find((h) => lower(h).includes("date"));
  if (dateLeft && dateRight) {
    fields.push({
      key: "date",
      label: "Date",
      leftField: dateLeft,
      rightField: dateRight,
      required: true,
    });
  }

  const nameLeft = leftHeaders.find((h) => lower(h) === "name" || lower(h).includes("name"));
  const nameRight = rightHeaders.find((h) => lower(h) === "name" || lower(h).includes("name"));
  if (nameLeft && nameRight) {
    fields.push({
      key: "name",
      label: "Name",
      leftField: nameLeft,
      rightField: nameRight,
      required: true,
    });
  }

  const categoryLeft = leftHeaders.find((h) => lower(h).includes("category"));
  const categoryRight = rightHeaders.find((h) => lower(h).includes("category"));
  if (categoryLeft && categoryRight) {
    fields.push({
      key: "category",
      label: "Category",
      leftField: categoryLeft,
      rightField: categoryRight,
      required: true,
    });
  }

  const isAmountHeader = (h) => {
    const s = lower(h);
    return s.includes("amount") || s.includes("balance");
  };
  const amountLeft = leftHeaders.find(isAmountHeader);
  const amountRight = rightHeaders.find(isAmountHeader);
  if (amountLeft && amountRight) {
    fields.push({
      key: "amount",
      label: "Amount",
      leftField: amountLeft,
      rightField: amountRight,
      required: true,
    });
  }

  return fields;
}

export function compareBoolClass(v) {
  return v?.ok ? "compareTrue" : "compareFalse";
}