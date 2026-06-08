/**
 * imageImport.js — vision extraction helpers for the screenshot import feature.
 *
 * The API key never lives here or in the browser.  Images are POSTed to a
 * Cloudflare Worker (configured via Settings → "Screenshot import service
 * address") which holds the key as a secret and calls the vision model.
 */

// ── Worker call ───────────────────────────────────────────────────────────────

export const SUPPORTED_IMAGE_MEDIA_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

const MEDIA_TYPE_BY_EXTENSION = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export function inferScreenshotMediaType(file) {
  const explicitType = String(file?.type || "").trim().toLowerCase();
  if (SUPPORTED_IMAGE_MEDIA_TYPES.has(explicitType)) return explicitType;

  const name = String(file?.name || "").trim().toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() : "";
  return MEDIA_TYPE_BY_EXTENSION[ext] || "";
}

function findJsonArrayCandidate(text) {
  const start = text.indexOf("[");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
    } else if (ch === "[") {
      depth++;
    } else if (ch === "]") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }

  return null;
}

/**
 * POST a base64 image to the configured Worker and return the raw model text.
 * Throws a plain-language Error on network failure, non-OK response, or missing text.
 */
export async function extractViaWorker(imageBase64, mediaType, workerUrl) {
  let response;
  try {
    response = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: imageBase64, mediaType }),
    });
  } catch (networkErr) {
    throw new Error(
      "Could not reach the screenshot service — check your internet connection and try again. " +
      "You can still use the spreadsheet import or enter orders manually.",
    );
  }

  if (!response.ok) {
    let errMsg = `Service error ${response.status}`;
    try {
      const body = await response.json();
      errMsg = body.error || errMsg;
    } catch { /* ignore */ }
    throw new Error(
      `${errMsg} — try again, or use the spreadsheet import or manual entry instead.`,
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "The screenshot service returned an unexpected response. " +
      "Try again, or use the spreadsheet import or manual entry instead.",
    );
  }

  if (!data.text) {
    throw new Error(
      "The screenshot service returned an empty response. " +
      "Try a clearer image, or use the spreadsheet import or manual entry instead.",
    );
  }

  return data.text;
}

// ── JSON parsing ──────────────────────────────────────────────────────────────

/**
 * Parse the raw text the Worker got from the vision model.
 * Returns { rows: Array, parseError: string|null }.
 * Never throws.
 */
export function parseExtractedOrders(rawText) {
  let text = String(rawText || "").trim();

  // Strip markdown code fences the model may have included despite the prompt
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  // Strip any stray <think>…</think> reasoning tags
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  if (!text) {
    return {
      rows: [],
      parseError:
        "The service returned an empty response. Try uploading a clearer image, " +
        "or use the spreadsheet import or manual entry instead.",
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const candidate = findJsonArrayCandidate(text);
    if (candidate && candidate !== text) {
      try {
        parsed = JSON.parse(candidate);
      } catch {
        parsed = null;
      }
      if (Array.isArray(parsed)) return { rows: parsed, parseError: null };
    }

    const looksTruncated = text.startsWith("[") && !findJsonArrayCandidate(text);
    if (looksTruncated) {
      return {
        rows: [],
        parseError:
          "The screenshot service response was cut off before all order data came back. " +
          "Try extracting again; if it keeps happening, split the schedule into a smaller screenshot.",
      };
    }

    const preview = text.slice(0, 200);
    return {
      rows: [],
      parseError:
        `The service response couldn't be read as order data. ` +
        `Try again with a clearer image, or use the spreadsheet import or manual entry instead. ` +
        `(Received: "${preview}")`,
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      rows: [],
      parseError:
        "Expected a list of orders but got something else. " +
        "Try again with a clearer image, or use the spreadsheet import or manual entry instead.",
    };
  }

  return { rows: parsed, parseError: null };
}

// ── Row validation ────────────────────────────────────────────────────────────

const VALID_COLORS = ["black", "white", "green", "yellow"];
const VALID_FAMILIES = ["HBS", "HBR"];
const VALID_GRADES = ["standard", "ESD"];
const VALID_ORDER_TYPES = ["bag", "bulk"];

/**
 * Validate one extracted row.
 * Returns { fields: { [name]: { value, flagged } }, errors: string[], valid: bool }.
 * `flagged` means the model returned null/unreadable — distinct from an invalid value.
 */
export function validateExtractedRow(row) {
  const fields = {};
  const errors = [];

  const company = String(row.company || "").trim();
  fields.company = { value: company, flagged: !company };
  if (!company) errors.push("Company is required — couldn't read it from the image");

  const location = String(row.location || "").trim();
  fields.location = { value: location, flagged: false };

  const sizeRaw = row.size;
  const size = sizeRaw !== null && sizeRaw !== undefined ? Number(sizeRaw) : null;
  const sizeOk = size !== null && !isNaN(size) && size > 0;
  fields.size = { value: sizeOk ? String(size) : "", flagged: !sizeOk };
  if (!sizeOk) {
    errors.push(
      sizeRaw === null || sizeRaw === undefined
        ? "Size couldn't be read — please fill it in"
        : `Size "${sizeRaw}" is not a valid number`,
    );
  }

  const familyRaw = String(row.family || "").trim().toUpperCase();
  const familyOk = VALID_FAMILIES.includes(familyRaw);
  fields.family = { value: familyOk ? familyRaw : "", flagged: !familyOk };
  if (!familyOk) {
    errors.push(
      row.family === null || row.family === undefined
        ? "Product family (HBS or HBR) couldn't be read — please fill it in"
        : `Family "${familyRaw}" is not recognized (use HBS or HBR)`,
    );
  }

  const colorRaw = String(row.color || "").trim().toLowerCase();
  const colorOk = VALID_COLORS.includes(colorRaw);
  fields.color = { value: colorOk ? colorRaw : "", flagged: !colorOk };
  if (!colorOk) {
    errors.push(
      row.color === null || row.color === undefined
        ? "Color couldn't be read — please fill it in (black, white, green, or yellow)"
        : `Color "${colorRaw}" is not recognized (use black, white, green, or yellow)`,
    );
  }

  const gradeRaw = String(row.grade || "standard").trim();
  const gradeOk = VALID_GRADES.includes(gradeRaw);
  fields.grade = { value: gradeOk ? gradeRaw : "standard", flagged: false };

  const orderTypeRaw = String(row.order_type || "").trim().toLowerCase();
  const orderTypeOk = VALID_ORDER_TYPES.includes(orderTypeRaw);
  fields.order_type = { value: orderTypeOk ? orderTypeRaw : "", flagged: !orderTypeOk };
  if (!orderTypeOk) {
    errors.push(
      row.order_type === null || row.order_type === undefined
        ? "Order type couldn't be read — please fill it in (bag or bulk)"
        : `Order type "${orderTypeRaw}" is not recognized (use bag or bulk)`,
    );
  }

  const qtyRaw = row.quantity;
  const qty = qtyRaw !== null && qtyRaw !== undefined ? Number(qtyRaw) : null;
  const qtyOk = qty !== null && !isNaN(qty) && qty >= 1;
  fields.quantity = { value: qtyOk ? String(qty) : "", flagged: !qtyOk };
  if (!qtyOk) {
    errors.push(
      qtyRaw === null || qtyRaw === undefined
        ? "Quantity couldn't be read — never leave this blank"
        : `Quantity "${qtyRaw}" must be a whole number ≥ 1`,
    );
  }

  const dueDateRaw = String(row.due_date || "").trim();
  const dueDateOk = Boolean(dueDateRaw) && !isNaN(new Date(dueDateRaw).getTime());
  fields.due_date = { value: dueDateRaw, flagged: !dueDateOk };
  if (!dueDateOk) {
    errors.push(
      dueDateRaw
        ? `Due date "${dueDateRaw}" is not a valid date (use format 2026-06-13T16:00)`
        : "Due date couldn't be read — please fill it in",
    );
  }

  return { fields, errors, valid: errors.length === 0 };
}
