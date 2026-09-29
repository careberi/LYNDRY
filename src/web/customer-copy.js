'use strict';

// Vendor details belong in employee tools, not customer or laundromat copy.
// Apply at display boundaries; never rewrite integration identifiers or payloads.
const vendorName = /\b(?:shipday|uber(?:\s*direct)?|door\s*dash|stripe|twilio|telnyx|supabase|anthropic|openai|google|railway)\b/i;
function customerText(value, fallback) {
  const text = String(value || '');
  return !text || vendorName.test(text) ? fallback : text;
}
module.exports = { customerText };
