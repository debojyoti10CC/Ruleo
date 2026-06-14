import { RuleSchema, type Rule } from "./rule-schema";

// ─── Configuration ──────────────────────────────────────────────────
const SUPPORTED_ASSETS = new Set([
    "ETH",
    "BTC",
    "SOL",
    "USDC",
    "USDT",
    "DAI",
    "WETH",
    "WBTC",
    "ARB",
    "OP",
    "MATIC",
    "AVAX",
    "LINK",
    "UNI",
    "AAVE",
]);

const MAX_USD_PER_WEEK = 1000;
const MAX_USD_PER_MONTH = 5000;

// ─── Validation Error ───────────────────────────────────────────────
export class ValidationError extends Error {
    public readonly reasons: string[];

    constructor(reasons: string[]) {
        super(`Validation failed: ${reasons.join("; ")}`);
        this.name = "ValidationError";
        this.reasons = reasons;
    }
}

// ─── Validate Rule ──────────────────────────────────────────────────
export function validateRule(raw: unknown): Rule {
    // 1. Zod schema validation
    const result = RuleSchema.safeParse(raw);
    if (!result.success) {
        const issues = result.error.issues.map(
            (i) => `${i.path.join(".")}: ${i.message}`
        );
        throw new ValidationError(issues);
    }

    const rule = result.data;
    const errors: string[] = [];

    // 2. Asset validation
    if (rule.sourceAsset && !SUPPORTED_ASSETS.has(rule.sourceAsset.toUpperCase())) {
        errors.push(`Unsupported source asset: "${rule.sourceAsset}". Supported: ${[...SUPPORTED_ASSETS].join(", ")}`);
    }

    if (rule.targetAsset && !SUPPORTED_ASSETS.has(rule.targetAsset.toUpperCase())) {
        errors.push(`Unsupported target asset: "${rule.targetAsset}". Supported: ${[...SUPPORTED_ASSETS].join(", ")}`);
    }

    // 3. Action-specific asset checks
    if (rule.action === "buy" && !rule.targetAsset) {
        errors.push('Action "buy" requires a targetAsset');
    }

    if (rule.action === "sell" && !rule.sourceAsset) {
        errors.push('Action "sell" requires a sourceAsset');
    }

    if (rule.action === "swap") {
        if (!rule.sourceAsset) errors.push('Action "swap" requires a sourceAsset');
        if (!rule.targetAsset) errors.push('Action "swap" requires a targetAsset');
    }

    // 4. Limit validation — enforce max caps
    if (rule.limits?.maxUsdPerWeek != null && rule.limits.maxUsdPerWeek > MAX_USD_PER_WEEK) {
        errors.push(
            `Weekly limit $${rule.limits.maxUsdPerWeek} exceeds maximum allowed ($${MAX_USD_PER_WEEK})`
        );
    }

    if (rule.limits?.maxUsdPerMonth != null && rule.limits.maxUsdPerMonth > MAX_USD_PER_MONTH) {
        errors.push(
            `Monthly limit $${rule.limits.maxUsdPerMonth} exceeds maximum allowed ($${MAX_USD_PER_MONTH})`
        );
    }

    // 5. Conflicting conditions
    if (
        rule.conditions?.priceBelow != null &&
        rule.conditions?.priceAbove != null &&
        rule.conditions.priceBelow <= rule.conditions.priceAbove
    ) {
        errors.push(
            `Conflicting conditions: priceBelow ($${rule.conditions.priceBelow}) must be greater than priceAbove ($${rule.conditions.priceAbove})`
        );
    }

    // 6. Schedule day validation for weekly
    if (rule.schedule?.type === "weekly" && !rule.schedule.day) {
        errors.push('Weekly schedule requires a "day" (e.g. "friday")');
    }

    if (errors.length > 0) {
        throw new ValidationError(errors);
    }

    return rule;
}
