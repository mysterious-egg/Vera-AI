import "dotenv/config";

import { generate } from "./src/services/gemini.service.js";

const result = await generate(`
Return ONLY this JSON:

{
  "message":"Hello",
  "cta":"Visit",
  "send_as":"whatsapp",
  "suppression_key":"test",
  "rationale":"Testing"
}
`);

console.log(result);