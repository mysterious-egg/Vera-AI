import { SYSTEM_PROMPT } from "./system.prompt.js";

function section(title, value) {
    return `## ${title}\n${value}`;
}

function formatObject(obj) {
    return JSON.stringify(obj, null, 2);
}

function formatKnowledge(knowledge = []) {
    if (!knowledge.length) {
        return "None";
    }

    return knowledge
        .map((chunk, index) => {
            return [
                `Chunk ${index + 1}`,
                `Title: ${chunk.title ?? ""}`,
                `Summary: ${chunk.summary ?? ""}`,
                `Source: ${chunk.source ?? ""}`
            ].join("\n");
        })
        .join("\n\n");
}

export function buildPrompt({
    merchant,
    trigger,
    category,
    customer,
    knowledge = []
}) {
    const parts = [];

    parts.push(section("SYSTEM ROLE", SYSTEM_PROMPT));

    parts.push(
        section(
            "TASK",
            [
                "Determine the best next merchant message.",
                "Use only the supplied context.",
                "Remain fully grounded."
            ].join("\n")
        )
    );

    parts.push(
        section(
            "MERCHANT CONTEXT",
            formatObject(merchant)
        )
    );

    if (category) {
        parts.push(
            section(
                "CATEGORY CONTEXT",
                formatObject(category)
            )
        );
    }

    if (trigger) {
        parts.push(
            section(
                "TRIGGER",
                formatObject(trigger)
            )
        );
    }

    if (customer) {
        parts.push(
            section(
                "CUSTOMER CONTEXT",
                formatObject(customer)
            )
        );
    }

    parts.push(
        section(
            "RETRIEVED KNOWLEDGE",
            formatKnowledge(knowledge)
        )
    );

    parts.push(
        section(
            "RULES",
            `
- Use only supplied information.
- Never hallucinate.
- Never invent offers.
- Never invent merchant metrics.
- Return only valid JSON.
- No markdown.
- No explanations.
`.trim()
        )
    );

    parts.push(
        section(
            "EXPECTED JSON OUTPUT",
            `{
  "message": "...",
  "cta": "...",
  "send_as": "...",
  "suppression_key": "...",
  "rationale": "..."
}`
        )
    );

    return parts.join("\n\n");
}

// ── Reply Prompt ──────────────────────────────────────────────────────────────

/**
 * Format a conversation history array into a readable transcript.
 *
 * @param {Array<{from: string, msg?: string, body?: string, message?: string}>} history
 * @returns {string}
 */
function formatConversation(history = []) {
    if (!history || !history.length) return 'None';
    return history
        .map((turn, i) => {
            const speaker = turn.from ?? turn.from_role ?? 'unknown';
            const text = turn.msg ?? turn.body ?? turn.message ?? '';
            return `Turn ${i + 1} [${speaker}]: ${text}`;
        })
        .join('\n');
}

/**
 * Build a prompt for /v1/reply.
 *
 * Vera has already sent a message; the merchant/customer has replied.
 * Vera must now decide: send a follow-up, wait, or gracefully end.
 *
 * @param {object}   opts
 * @param {object}   opts.merchant          Merchant context payload.
 * @param {object}   [opts.category]        Category context payload (optional).
 * @param {object}   [opts.trigger]         Trigger context payload (optional).
 * @param {object}   [opts.customer]        Customer context payload (optional).
 * @param {string}   opts.fromRole          Who sent the incoming reply ('merchant'|'customer').
 * @param {string}   opts.incomingMessage   The actual reply text.
 * @param {number}   opts.turnNumber        Current turn number in the conversation.
 * @param {Array}    [opts.conversationHistory]  Prior turns, oldest first.
 * @param {object[]} [opts.knowledge]       Retrieved knowledge chunks.
 * @returns {string}
 */
export function buildReplyPrompt({
    merchant,
    category = null,
    trigger = null,
    customer = null,
    fromRole,
    incomingMessage,
    turnNumber,
    conversationHistory = [],
    knowledge = [],
}) {
    const parts = [];

    parts.push(section('SYSTEM ROLE', SYSTEM_PROMPT));

    parts.push(
        section(
            "TASK",
            [
                "You are continuing an existing conversation.",
                "",
                "Your primary objective is NOT to keep the conversation alive.",
                "",
                "Your primary objective is to choose the MOST APPROPRIATE next action.",
                "",
                "Sometimes the correct decision is SEND.",
                "Sometimes the correct decision is WAIT.",
                "Sometimes the correct decision is END.",
                "",
                "Continue the conversation ONLY if it creates value for the merchant.",
                "",
                "Avoid unnecessary clarification questions.",
                "Avoid prolonging conversations.",
                "Remain fully grounded in the supplied context."
            ].join("\n")
        )
    );

    parts.push(section('MERCHANT CONTEXT', formatObject(merchant)));

    if (category) parts.push(section('CATEGORY CONTEXT', formatObject(category)));
    if (trigger) parts.push(section('TRIGGER CONTEXT', formatObject(trigger)));
    if (customer) parts.push(section('CUSTOMER CONTEXT', formatObject(customer)));

    parts.push(
        section(
            'CONVERSATION HISTORY',
            formatConversation(conversationHistory),
        ),
    );

    parts.push(
        section(
            'INCOMING REPLY',
            `Turn: ${turnNumber}\nFrom: ${fromRole}\nMessage: ${incomingMessage}`,
        ),
    );

    parts.push(section('RETRIEVED KNOWLEDGE', formatKnowledge(knowledge)));

    parts.push(
        section(
            "CONVERSATION DECISION RULES",
            `
Choose exactly ONE action:

- send
- wait
- end

1. Automatic Replies

If the incoming message is clearly an automatic acknowledgement, auto responder, or system-generated reply such as:

- Thank you for contacting us
- We have received your request
- Our team will respond shortly
- This is an automated response

Do NOT continue the conversation.

Prefer:

{
  "action":"end"
}

or

{
  "action":"wait"
}

--------------------------------------------------

2. Merchant Commitment

If the merchant says:

- yes
- ok
- sounds good
- let's do it
- what's next
- please proceed

Immediately transition into execution.

Do NOT ask unnecessary questions.

Provide the next step.

--------------------------------------------------

3. Hostile Messages

If the merchant says:

- stop messaging me
- spam
- leave me alone
- not interested
- don't contact me again

Immediately end the conversation politely.

Never attempt another sales message.

--------------------------------------------------

4. Direct Questions

If the merchant asks a direct question,

answer it first.

--------------------------------------------------

5. Existing Context

If enough information already exists,

never ask for information already available.

--------------------------------------------------

6. Grounding

Never invent:

- offers
- merchant metrics
- discounts
- research
- customer information

Use ONLY supplied context.

--------------------------------------------------

Return ONLY valid JSON.

No markdown.

No explanations.
`.trim()
        )
    );
    parts.push(
        section(
            "EXAMPLES",
            `
Example 1

Merchant:
"Thank you for contacting us. Our team will respond shortly."

Correct:

{
  "action":"end",
  "rationale":"This is an automatic acknowledgement."
}

--------------------------------------------------

Example 2

Merchant:
"Ok let's do it."

Correct:

{
  "action":"send",
  "body":"Great! Here's the next step...",
  "cta":"open_ended",
  "rationale":"Merchant has already committed."
}

--------------------------------------------------

Example 3

Merchant:
"Stop messaging me."

Correct:

{
  "action":"end",
  "rationale":"Merchant requested no further communication."
}

--------------------------------------------------

Example 4

Merchant:
"Can I offer 20% instead?"

Correct:

{
  "action":"send",
  "body":"Yes, you can update your offer...",
  "cta":"open_ended",
  "rationale":"Merchant asked a direct operational question."
}
`
        )
    );

    parts.push(
        section(
            'EXPECTED JSON OUTPUT',
            `One of:\n{ "action": "send", "body": "...", "cta": "open_ended", "rationale": "..." }\n{ "action": "wait", "wait_seconds": 1800, "rationale": "..." }\n{ "action": "end", "rationale": "..." }`,
        ),
    );

    return parts.join('\n\n');
}
