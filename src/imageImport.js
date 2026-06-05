export const VISION_MODEL = "claude-opus-4-5";
const API_ENDPOINT = "https://api.anthropic.com/v1/messages";

const EXTRACTION_PROMPT = `Extract every production order row from this logistics schedule image.
Return ONLY a valid JSON array — no markdown fences, no explanation, just the raw JSON array.
Each element must be an object with exactly these fields:

{
  "company": string or null,
  "location": string or null,
  "size": number or null,
  "family": "HBS" or "HBR" or null,
  "color": "black" or "white" or "green" or "yellow" or null,
  "grade": "standard" or "ESD" or null,
  "order_type": "bag" or "bulk" or null,
  "quantity": number or null,
  "due_date": string or null
}

Rules you must follow:
- Never guess a quantity — if you cannot read it clearly, set quantity to null.
- Never guess a size — if you cannot read it clearly, set size to null.
- due_date must be ISO format like "2026-06-13T16:00" or null if unreadable.
- Set any field you cannot read confidently to null.
- If the image contains no order data at all, return an empty array: []
- Return nothing except the JSON array itself.`;

export async function extractOrdersFromImage(imageBase64, mediaType, apiKey) {
  let response;
  try {
    response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        max_tokens: 2048,
        messages: [{
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: imageBase64 }
            },
            { type: "text", text: EXTRACTION_PROMPT }
          ]
        }]
      })
    });
  } catch (networkErr) {
    throw new Error("Could not reach the Anthropic API — check your internet connection and try again.");
  }

  if (!response.ok) {
    let errMsg;
    try {
      const body = await response.json();
      errMsg = body.error?.message;
    } catch {
      errMsg = null;
    }
    if (response.status === 401) throw new Error("Invalid API key. Check the key you entered and try again.");
    if (response.status === 400) throw new Error(`The image could not be processed (${errMsg || "bad request"}). Try a clearer image or use CSV import.`);
    if (response.status === 529) throw new Error("The AI service is temporarily overloaded. Wait a moment and try again.");
    throw new Error(errMsg || `API error ${response.status}. Try again or use CSV import.`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || "";
}

export function parseExtractedOrders(rawText) {
  let text = String(rawText || "").trim();
  // Strip markdown code fences
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  if (!text) {
    return { rows: [], parseError: "The model returned an empty response. Try uploading a clearer image or use CSV import." };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const preview = text.slice(0, 200);
    return { rows: [], parseError: `The model's response couldn't be read as structured data. Try again with a clearer image, or use CSV import. (Received: "${preview}")` };
  }

  if (!Array.isArray(parsed)) {
    return { rows: [], parseError: "Expected a list of orders but got something else. Try again with a clearer image, or use CSV import." };
  }

  return { rows: parsed, parseError: null };
}

const VALID_COLORS = ["black", "white", "green", "yellow"];
const VALID_FAMILIES = ["HBS", "HBR"];
const VALID_GRADES = ["standard", "ESD"];
const VALID_ORDER_TYPES = ["bag", "bulk"];

export function validateExtractedRow(row) {
  const fields = {};
  const errors = [];

  const company = String(row.company || "").trim();
  fields.company = { value: company, flagged: !company };
  if (!company) errors.push("Company is required — couldn't read it from the image");

  const location = String(row.location || "").trim();
  fields.location = { value: location, flagged: false };

  const sizeRaw = row.size;
  const size = (sizeRaw !== null && sizeRaw !== undefined) ? Number(sizeRaw) : null;
  const sizeOk = size !== null && !isNaN(size) && size > 0;
  fields.size = { value: sizeOk ? String(size) : "", flagged: !sizeOk };
  if (!sizeOk) {
    errors.push(sizeRaw === null || sizeRaw === undefined
      ? "Size couldn't be read — please fill it in"
      : `Size "${sizeRaw}" is not a valid number`);
  }

  const familyRaw = String(row.family || "").trim().toUpperCase();
  const familyOk = VALID_FAMILIES.includes(familyRaw);
  fields.family = { value: familyOk ? familyRaw : "", flagged: !familyOk };
  if (!familyOk) {
    errors.push(row.family === null || row.family === undefined
      ? "Product family (HBS or HBR) couldn't be read — please fill it in"
      : `Family "${familyRaw}" is not recognized (use HBS or HBR)`);
  }

  const colorRaw = String(row.color || "").trim().toLowerCase();
  const colorOk = VALID_COLORS.includes(colorRaw);
  fields.color = { value: colorOk ? colorRaw : "", flagged: !colorOk };
  if (!colorOk) {
    errors.push(row.color === null || row.color === undefined
      ? "Color couldn't be read — please fill it in (black, white, green, or yellow)"
      : `Color "${colorRaw}" is not recognized (use black, white, green, or yellow)`);
  }

  const gradeRaw = String(row.grade || "standard").trim();
  const gradeOk = VALID_GRADES.includes(gradeRaw);
  fields.grade = { value: gradeOk ? gradeRaw : "standard", flagged: false };

  const orderTypeRaw = String(row.order_type || "").trim().toLowerCase();
  const orderTypeOk = VALID_ORDER_TYPES.includes(orderTypeRaw);
  fields.order_type = { value: orderTypeOk ? orderTypeRaw : "", flagged: !orderTypeOk };
  if (!orderTypeOk) {
    errors.push(row.order_type === null || row.order_type === undefined
      ? "Order type couldn't be read — please fill it in (bag or bulk)"
      : `Order type "${orderTypeRaw}" is not recognized (use bag or bulk)`);
  }

  const qtyRaw = row.quantity;
  const qty = (qtyRaw !== null && qtyRaw !== undefined) ? Number(qtyRaw) : null;
  const qtyOk = qty !== null && !isNaN(qty) && qty >= 1;
  fields.quantity = { value: qtyOk ? String(qty) : "", flagged: !qtyOk };
  if (!qtyOk) {
    errors.push(qtyRaw === null || qtyRaw === undefined
      ? "Quantity couldn't be read — never leave this blank"
      : `Quantity "${qtyRaw}" must be a whole number ≥ 1`);
  }

  const dueDateRaw = String(row.due_date || "").trim();
  const dueDateOk = Boolean(dueDateRaw) && !isNaN(new Date(dueDateRaw).getTime());
  fields.due_date = { value: dueDateRaw, flagged: !dueDateOk };
  if (!dueDateOk) {
    errors.push(dueDateRaw
      ? `Due date "${dueDateRaw}" is not a valid date (use format 2026-06-13T16:00)`
      : "Due date couldn't be read — please fill it in");
  }

  return { fields, errors, valid: errors.length === 0 };
}
