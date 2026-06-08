import assert from "node:assert/strict";
import { inferScreenshotMediaType, parseExtractedOrders, validateExtractedRow } from "../src/imageImport.js";

// ── parseExtractedOrders ──────────────────────────────────────────────────────

// Well-formed JSON array
const wellFormed = JSON.stringify([
  { company: "Ventek", location: "OH", size: 15, family: "HBS", color: "black", grade: "standard", order_type: "bulk", quantity: 1, due_date: "2026-06-13T16:00" }
]);
const { rows: r1, parseError: e1 } = parseExtractedOrders(wellFormed);
assert.equal(e1, null, "well-formed JSON should produce no parseError");
assert.equal(r1.length, 1);
assert.equal(r1[0].company, "Ventek");

// JSON wrapped in code fences (model often does this despite the prompt)
const fenced = "```json\n" + wellFormed + "\n```";
const { rows: r2, parseError: e2 } = parseExtractedOrders(fenced);
assert.equal(e2, null, "code-fenced JSON should be stripped and parsed correctly");
assert.equal(r2.length, 1);

// Fences without language tag
const fenced2 = "```\n" + wellFormed + "\n```";
const { rows: r3, parseError: e3 } = parseExtractedOrders(fenced2);
assert.equal(e3, null, "bare code-fenced JSON should be stripped");
assert.equal(r3.length, 1);

// Malformed JSON
const { rows: r4, parseError: e4 } = parseExtractedOrders("{not valid json}");
assert.ok(e4, "malformed JSON should produce a parseError");
assert.equal(r4.length, 0);

// Non-array valid JSON (object instead of array)
const { rows: r5, parseError: e5 } = parseExtractedOrders('{"company":"Ventek"}');
assert.ok(e5, "non-array JSON should produce a parseError");
assert.equal(r5.length, 0);

// Empty string
const { rows: r6, parseError: e6 } = parseExtractedOrders("");
assert.ok(e6, "empty response should produce a parseError");

// Empty array (model found no orders)
const { rows: r7, parseError: e7 } = parseExtractedOrders("[]");
assert.equal(e7, null, "empty array is valid");
assert.equal(r7.length, 0);

// Valid JSON array with stray text around it
const wrapped = "Here is the data:\n" + wellFormed + "\nDone.";
const { rows: r8, parseError: e8 } = parseExtractedOrders(wrapped);
assert.equal(e8, null, "valid JSON array should be recovered from wrapper text");
assert.equal(r8.length, 1);

// Truncated JSON should produce a specific retry-oriented error
const { rows: r9, parseError: e9 } = parseExtractedOrders('[{"company":"Ventek","size"');
assert.ok(e9?.includes("cut off"), "truncated JSON should be identified clearly");
assert.equal(r9.length, 0);

console.log("parseExtractedOrders: all checks passed");

// ── inferScreenshotMediaType ──────────────────────────────────────────────────

assert.equal(
  inferScreenshotMediaType({ name: "schedule.png", type: "" }),
  "image/png",
  ".png files should be accepted even when the browser omits the MIME type",
);
assert.equal(
  inferScreenshotMediaType({ name: "schedule.PNG", type: "application/octet-stream" }),
  "image/png",
  ".PNG extension should override generic upload MIME types",
);
assert.equal(
  inferScreenshotMediaType({ name: "schedule.txt", type: "text/plain" }),
  "",
  "non-image files should not be accepted",
);
assert.equal(
  inferScreenshotMediaType({ name: "camera-upload", type: "image/jpeg" }),
  "image/jpeg",
  "valid image MIME types should still be accepted without an extension",
);

console.log("inferScreenshotMediaType: all checks passed");

// ── validateExtractedRow ──────────────────────────────────────────────────────

// Fully valid row
const validRow = { company: "Ventek", location: "OH", size: 15, family: "HBS", color: "black", grade: "standard", order_type: "bulk", quantity: 2, due_date: "2026-06-13T16:00" };
const v1 = validateExtractedRow(validRow);
assert.equal(v1.valid, true, "fully valid row should pass validation");
assert.equal(v1.errors.length, 0);
assert.equal(v1.fields.company.flagged, false);
assert.equal(v1.fields.size.value, "15");
assert.equal(v1.fields.color.value, "black");

// Row with all nulls — every field should be flagged
const nullRow = { company: null, location: null, size: null, family: null, color: null, grade: null, order_type: null, quantity: null, due_date: null };
const v2 = validateExtractedRow(nullRow);
assert.equal(v2.valid, false, "all-null row should fail validation");
assert.ok(v2.errors.length >= 6, `expected ≥6 errors, got ${v2.errors.length}`);
assert.equal(v2.fields.company.flagged, true, "null company should be flagged");
assert.equal(v2.fields.size.flagged, true, "null size should be flagged");
assert.equal(v2.fields.color.flagged, true, "null color should be flagged");
assert.equal(v2.fields.quantity.flagged, true, "null quantity should be flagged");
assert.equal(v2.fields.due_date.flagged, true, "null due_date should be flagged");

// Quantity = 0 is invalid
const zeroQty = { ...validRow, quantity: 0 };
const v3 = validateExtractedRow(zeroQty);
assert.equal(v3.valid, false);
assert.equal(v3.fields.quantity.flagged, true);

// Invalid color
const badColor = { ...validRow, color: "purple" };
const v4 = validateExtractedRow(badColor);
assert.equal(v4.valid, false);
assert.equal(v4.fields.color.flagged, true);

// Invalid family
const badFamily = { ...validRow, family: "XYZ" };
const v5 = validateExtractedRow(badFamily);
assert.equal(v5.valid, false);
assert.equal(v5.fields.family.flagged, true);

// Invalid order_type
const badType = { ...validRow, order_type: "pallet" };
const v6 = validateExtractedRow(badType);
assert.equal(v6.valid, false);
assert.equal(v6.fields.order_type.flagged, true);

// Bad date string
const badDate = { ...validRow, due_date: "not-a-date" };
const v7 = validateExtractedRow(badDate);
assert.equal(v7.valid, false);
assert.equal(v7.fields.due_date.flagged, true);

// Date-only values should default to the normal delivery time
const dateOnly = { ...validRow, due_date: "2026-06-14" };
const vDateOnly = validateExtractedRow(dateOnly);
assert.equal(vDateOnly.valid, true);
assert.equal(vDateOnly.fields.due_date.value, "2026-06-14T16:00");

// Partial nulls — only some fields null
const partialNull = { ...validRow, size: null, quantity: null };
const v8 = validateExtractedRow(partialNull);
assert.equal(v8.valid, false);
assert.equal(v8.fields.size.flagged, true);
assert.equal(v8.fields.quantity.flagged, true);
assert.equal(v8.fields.company.flagged, false, "non-null company should not be flagged");

// grade defaults gracefully (null grade → "standard", valid)
const noGrade = { ...validRow, grade: null };
const v9 = validateExtractedRow(noGrade);
assert.equal(v9.valid, true, "null grade should default to standard and pass");
assert.equal(v9.fields.grade.value, "standard");

// location null is fine (optional)
const noLocation = { ...validRow, location: null };
const v10 = validateExtractedRow(noLocation);
assert.equal(v10.valid, true, "null location is allowed");

console.log("validateExtractedRow: all checks passed");
console.log("imageImport acceptance checks passed");
