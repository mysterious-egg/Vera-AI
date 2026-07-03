import assert from "node:assert";
import { buildPrompt } from "./src/prompts/prompt.builder.js";

const merchant = {
    name: "ABC Cafe",
    city: "Bangalore"
};

const trigger = {
    type: "LOW_ORDERS"
};

const category = {
    name: "Restaurant"
};

const customer = {
    firstName: "Rahul"
};

const knowledge = [
    {
        title: "Lunch Campaign",
        summary: "Lunch campaigns increase repeat visits.",
        source: "Magicpin Playbook"
    }
];

const prompt1 = buildPrompt({
    merchant,
    trigger,
    category,
    customer,
    knowledge
});

const prompt2 = buildPrompt({
    merchant,
    trigger,
    category,
    customer,
    knowledge
});

assert.strictEqual(prompt1, prompt2);

assert(prompt1.includes("SYSTEM ROLE"));

assert(prompt1.includes("TASK"));

assert(prompt1.includes("MERCHANT CONTEXT"));

assert(prompt1.includes("CATEGORY CONTEXT"));

assert(prompt1.includes("TRIGGER"));

assert(prompt1.includes("CUSTOMER CONTEXT"));

assert(prompt1.includes("RETRIEVED KNOWLEDGE"));

assert(prompt1.includes("Lunch Campaign"));

assert(prompt1.includes('"message"'));

assert(prompt1.includes('"cta"'));

assert(prompt1.includes('"send_as"'));

assert(prompt1.includes('"suppression_key"'));

assert(prompt1.includes('"rationale"'));

const noCustomerPrompt = buildPrompt({
    merchant,
    trigger,
    category,
    knowledge
});

assert(!noCustomerPrompt.includes("CUSTOMER CONTEXT"));

console.log("✅ Prompt Builder tests passed");