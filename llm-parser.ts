import axios from "axios";
import { RuleSchema, type Rule } from "./rule-schema";

// ─── Configuration ──────────────────────────────────────────────────
// Default: Groq (free, no credit card, OpenAI-compatible)
// Override via env vars to use any OpenAI-compatible provider
const isVenice = !!process.env.VENICE_API_KEY;

const LLM_API_URL =
    process.env.LLM_API_URL ||
    (isVenice
        ? "https://api.venice.ai/api/v1/chat/completions"
        : "https://api.groq.com/openai/v1/chat/completions");

const LLM_MODEL =
    process.env.LLM_MODEL ||
    (isVenice ? "llama-3.3-70b" : "llama-3.3-70b-versatile");

const LLM_API_KEY =
    process.env.VENICE_API_KEY || process.env.GROQ_API_KEY || "";

// ─── System Prompt ──────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a DeFi automation rule compiler.

Your ONLY job is to convert a user's natural-language trading rule into a JSON object.

Return ONLY valid JSON. No markdown, no explanation, no code fences.

Follow this schema EXACTLY:

{
  "action": "buy" | "sell" | "swap" | "rebalance",
  "sourceAsset": string | null,
  "targetAsset": string | null,
  "amount": number | null,
  "schedule": {
    "type": "once" | "daily" | "weekly" | "monthly",
    "day": string | null
  } | null,
  "conditions": {
    "priceBelow": number | null,
    "priceAbove": number | null
  } | null,
  "limits": {
    "maxUsdPerWeek": number | null,
    "maxUsdPerMonth": number | null
  } | null
}

Rules:
- Use UPPERCASE ticker symbols for assets (ETH, BTC, USDC, etc.)
- For "buy" actions, set targetAsset to the asset being bought and sourceAsset to "USDC" if not specified.
- For "sell" actions, set sourceAsset to the asset being sold and targetAsset to "USDC" if not specified.
- For "swap" actions, set both sourceAsset and targetAsset.
- Use null for any value that is not explicitly stated by the user. NEVER invent values.
- The "day" field should be a lowercase day name (e.g. "friday") or null.
- Return ONLY the JSON object. Nothing else.`;

// ─── JSON Extraction ────────────────────────────────────────────────
function extractJSON(raw: string): unknown {
    // Try direct parse first
    try {
        return JSON.parse(raw);
    } catch {
        // noop — fall through to extraction
    }

    // Strip markdown code fences if present
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
        try {
            return JSON.parse(fenceMatch[1].trim());
        } catch {
            // noop
        }
    }

    // Try to find a JSON object in the string
    const objectMatch = raw.match(/\{[\s\S]*\}/);
    if (objectMatch) {
        try {
            return JSON.parse(objectMatch[0]);
        } catch {
            // noop
        }
    }

    throw new Error("Could not extract valid JSON from LLM response");
}

// ─── Parse Rule ─────────────────────────────────────────────────────
export async function parseRule(userText: string): Promise<Rule> {
    if (!LLM_API_KEY) {
        throw new Error(
            "LLM API key is not configured. Set VENICE_API_KEY or GROQ_API_KEY in your .env file."
        );
    }

    const response = await axios.post(
        LLM_API_URL,
        {
            model: LLM_MODEL,
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userText },
            ],
            temperature: 0,
            max_tokens: 512,
        },
        {
            headers: {
                Authorization: `Bearer ${LLM_API_KEY}`,
                "Content-Type": "application/json",
            },
            timeout: 30000,
        }
    );

    const rawContent: string =
        response.data?.choices?.[0]?.message?.content ?? "";

    if (!rawContent.trim()) {
        throw new Error("LLM returned an empty response");
    }

    const parsed = extractJSON(rawContent);

    // Validate against Zod schema
    const result = RuleSchema.safeParse(parsed);
    if (!result.success) {
        const issues = result.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ");
        throw new Error(`LLM output does not match Rule schema: ${issues}`);
    }

    return result.data;
}
