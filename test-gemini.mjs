import assert from "node:assert";

import {
    extractJson,
    validateResponse,
    JsonParseError,
    ValidationError,
} from "./src/services/gemini.service.js";

const valid = {
    message: "Hello!",
    cta: "Visit today",
    send_as: "whatsapp",
    suppression_key: "promo",
    rationale: "Grounded response",
};

// --------------------------
// JSON extraction
// --------------------------

const wrapped = `
Some explanation...

\`\`\`json
${JSON.stringify(valid)}
\`\`\`

Thanks.
`;

const parsed = extractJson(wrapped);

assert.deepStrictEqual(parsed, valid);

// --------------------------
// Validation success
// --------------------------

assert.deepStrictEqual(validateResponse(valid), valid);

// --------------------------
// Missing field
// --------------------------

assert.throws(() => {
    validateResponse({
        message: "Hello",
    });
}, ValidationError);

// --------------------------
// Invalid JSON
// --------------------------

assert.throws(() => {
    extractJson("this isn't json");
}, JsonParseError);

console.log("✅ Gemini service tests passed");