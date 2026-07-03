import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

const MODEL = "gemini-2.5-flash";
const MAX_RETRIES = 2;

const REQUIRED_FIELDS = [
    "message",
    "cta",
    "send_as",
    "suppression_key",
    "rationale",
];

export class GeminiError extends Error {
    constructor(message) {
        super(message);
        this.name = "GeminiError";
    }
}

export class JsonParseError extends GeminiError {
    constructor(message) {
        super(message);
        this.name = "JsonParseError";
    }
}

export class ValidationError extends GeminiError {
    constructor(message) {
        super(message);
        this.name = "ValidationError";
    }
}

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
    throw new GeminiError("Missing GEMINI_API_KEY");
}

const ai = new GoogleGenAI({
    apiKey,
});

export function extractJson(text) {
    if (typeof text !== "string") {
        throw new JsonParseError("Gemini response is not text.");
    }

    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");

    if (start === -1 || end === -1 || end < start) {
        throw new JsonParseError("Could not locate JSON object.");
    }

    const jsonText = text.slice(start, end + 1);

    try {
        return JSON.parse(jsonText);
    } catch {
        throw new JsonParseError("Invalid JSON returned by Gemini.");
    }
}

export function validateResponse(data) {
    if (!data || typeof data !== "object") {
        throw new ValidationError("Response must be an object.");
    }

    for (const field of REQUIRED_FIELDS) {
        if (!(field in data)) {
            throw new ValidationError(`Missing field: ${field}`);
        }

        if (typeof data[field] !== "string") {
            throw new ValidationError(`${field} must be a string`);
        }

        if (!data[field].trim()) {
            throw new ValidationError(`${field} cannot be empty`);
        }
    }

    return data;
}
function shouldRetry(error) {
    const message = error?.message?.toLowerCase() || "";

    return (
        message.includes("429") ||
        message.includes("rate") ||
        message.includes("timeout") ||
        message.includes("deadline") ||
        message.includes("503") ||
        message.includes("unavailable")
    );
}
async function callGemini(prompt) {
    const response = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
            temperature: 0,
            responseMimeType: "application/json",
        },
    });

    return response.text;
}
export async function generate(prompt) {
    if (typeof prompt !== "string" || !prompt.trim()) {
        throw new ValidationError("Prompt must be a non-empty string.");
    }

    let attempt = 0;

    while (true) {
        try {
            const raw = await callGemini(prompt);

            const parsed = extractJson(raw);

            return validateResponse(parsed);
        } catch (error) {
            // Never retry validation or parsing failures
            if (
                error instanceof ValidationError ||
                error instanceof JsonParseError
            ) {
                throw error;
            }

            // Invalid API key
            const message = error?.message?.toLowerCase() || "";

            if (
                message.includes("api key") ||
                message.includes("unauthorized") ||
                message.includes("permission")
            ) {
                throw new GeminiError("Invalid Gemini API key.");
            }

            // Retry transient failures
            if (shouldRetry(error) && attempt < MAX_RETRIES) {
                attempt++;

                await new Promise((resolve) =>
                    setTimeout(resolve, 1000 * attempt)
                );

                continue;
            }

            throw new GeminiError(error.message || "Gemini request failed.");
        }
    }
}

// ── Reply-specific validation ─────────────────────────────────────────────────

const VALID_ACTIONS = new Set(['send', 'wait', 'end']);

/**
 * Validate Gemini's JSON response for the /v1/reply schema.
 *
 * Valid shapes:
 *   { action: "send", body: string, cta: string, rationale: string }
 *   { action: "wait", wait_seconds: number, rationale: string }
 *   { action: "end",  rationale: string }
 *
 * @param {object} data  Parsed JSON from Gemini.
 * @returns {object}     Validated response object.
 * @throws {ValidationError} if required fields are missing or invalid.
 */
export function validateReplyResponse(data) {
    if (!data || typeof data !== 'object') {
        throw new ValidationError('Reply response must be an object.');
    }

    const action = data.action;
    if (!VALID_ACTIONS.has(action)) {
        throw new ValidationError(
            `Invalid action "${action}". Must be one of: send, wait, end.`,
        );
    }

    if (typeof data.rationale !== 'string' || !data.rationale.trim()) {
        throw new ValidationError('Reply response missing or empty: rationale');
    }

    if (action === 'send') {
        if (typeof data.body !== 'string' || !data.body.trim()) {
            throw new ValidationError('send action requires a non-empty body');
        }
    }

    if (action === 'wait') {
        if (typeof data.wait_seconds !== 'number' || data.wait_seconds <= 0) {
            throw new ValidationError('wait action requires positive wait_seconds');
        }
    }

    return data;
}

/**
 * Call Gemini and validate the response against the /v1/reply schema.
 * Inherits the retry logic of generate() by calling callGemini directly.
 *
 * @param {string} prompt
 * @returns {Promise<object>}  Validated reply action object.
 * @throws {ValidationError|JsonParseError|GeminiError}
 */
export async function generateReply(prompt) {
    if (typeof prompt !== 'string' || !prompt.trim()) {
        throw new ValidationError('Prompt must be a non-empty string.');
    }

    let attempt = 0;

    while (true) {
        try {
            const raw    = await callGemini(prompt);
            const parsed = extractJson(raw);
            return validateReplyResponse(parsed);
        } catch (error) {
            if (
                error instanceof ValidationError ||
                error instanceof JsonParseError
            ) {
                throw error;
            }

            const message = error?.message?.toLowerCase() || '';

            if (
                message.includes('api key') ||
                message.includes('unauthorized') ||
                message.includes('permission')
            ) {
                throw new GeminiError('Invalid Gemini API key.');
            }

            if (shouldRetry(error) && attempt < MAX_RETRIES) {
                attempt++;
                await new Promise((resolve) =>
                    setTimeout(resolve, 1000 * attempt),
                );
                continue;
            }

            throw new GeminiError(error.message || 'Gemini request failed.');
        }
    }
}