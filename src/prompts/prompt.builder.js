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
            const text    = turn.msg ?? turn.body ?? turn.message ?? '';
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
    category   = null,
    trigger    = null,
    customer   = null,
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
            'TASK',
            [
                'You are mid-conversation with a merchant or customer who has just replied.',
                'Decide the BEST next move: send a follow-up message, wait, or end the conversation.',
                'Use only the supplied context.',
                'Remain fully grounded.',
            ].join('\n'),
        ),
    );

    parts.push(section('MERCHANT CONTEXT', formatObject(merchant)));

    if (category) parts.push(section('CATEGORY CONTEXT', formatObject(category)));
    if (trigger)  parts.push(section('TRIGGER CONTEXT',  formatObject(trigger)));
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
            'RULES',
            `- Use only supplied information.\n- Never hallucinate.\n- Return only valid JSON.\n- Choose exactly one action: send, wait, or end.\n- No markdown. No explanations.`.trim(),
        ),
    );

    parts.push(
        section(
            'EXPECTED JSON OUTPUT',
            `One of:\n{ "action": "send", "body": "...", "cta": "open_ended", "rationale": "..." }\n{ "action": "wait", "wait_seconds": 1800, "rationale": "..." }\n{ "action": "end", "rationale": "..." }`,
        ),
    );

    return parts.join('\n\n');
}
