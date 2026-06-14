import type { Rule } from "./rule-schema";

// ─── ERC-7715 Caveat Types ──────────────────────────────────────────

/** Supported caveat type identifiers aligned with ERC-7715 / MetaMask Delegation Toolkit */
export type CaveatType =
    | "native-token-periodic"
    | "erc20-token-periodic"
    | "erc20-token-allowance"
    | "temporal"
    | "price-condition";

export interface Caveat {
    type: CaveatType;
    /** Human-readable justification for this caveat */
    justification: string;
    /** Caveat-specific parameters */
    params: Record<string, unknown>;
}

export interface CaveatConfig {
    caveats: Caveat[];
    metadata: {
        ruleAction: string;
        generatedAt: string;
    };
}

// ─── Token Addresses (Base Sepolia) ─────────────────────────────────
const TOKEN_ADDRESSES: Record<string, string> = {
    ETH: "0x0000000000000000000000000000000000000000", // native
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    USDT: "0x7169D38820dfd117C3FA1f22a697dBA58d90BA06",
    DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    LINK: "0xE4aB69C077896252FAFBD49EFD26B5D171A32410",
};

// ─── Schedule → Period Duration (seconds) ───────────────────────────
const PERIOD_DURATIONS: Record<string, number> = {
    daily: 86400,          // 24h
    weekly: 604800,        // 7d
    monthly: 2592000,      // 30d
};

// ─── Generate Caveats ───────────────────────────────────────────────
/**
 * Converts a validated Rule into deterministic ERC-7715 caveats.
 *
 * NO AI. Pure code. Every caveat is derived directly from the Rule fields.
 */
export function generateCaveats(rule: Rule): CaveatConfig {
    const caveats: Caveat[] = [];

    // ── 1. Token Transfer Caveat ────────────────────────────────────
    const spendAsset = rule.sourceAsset ?? "USDC";
    const isNative = spendAsset === "ETH";
    const tokenAddress = TOKEN_ADDRESSES[spendAsset] ?? null;

    // Determine the allowance amount
    const weeklyLimit = rule.limits?.maxUsdPerWeek ?? null;
    const monthlyLimit = rule.limits?.maxUsdPerMonth ?? null;
    const amount = rule.amount ?? weeklyLimit ?? monthlyLimit ?? null;

    if (amount != null) {
        // Convert USD to smallest unit (6 decimals for stables, 18 for ETH)
        // This is a placeholder conversion — real implementation needs oracle
        const decimals = isNative ? 18 : 6;
        const rawAmount = BigInt(Math.floor(amount * 10 ** decimals)).toString();

        if (rule.schedule && rule.schedule.type !== "once") {
            // Periodic spending caveat
            const periodDuration =
                PERIOD_DURATIONS[rule.schedule.type] ?? PERIOD_DURATIONS.weekly;

            caveats.push({
                type: isNative ? "native-token-periodic" : "erc20-token-periodic",
                justification: `Allow periodic ${rule.action} of ${spendAsset} — max $${amount} per ${rule.schedule.type === "daily" ? "day" : rule.schedule.type === "weekly" ? "week" : "month"}`,
                params: {
                    ...(tokenAddress && !isNative ? { token: tokenAddress } : {}),
                    allowance: rawAmount,
                    periodDuration,
                    startTime: null, // set at deployment
                },
            });
        } else {
            // One-time allowance caveat
            caveats.push({
                type: isNative ? "native-token-periodic" : "erc20-token-allowance",
                justification: `Allow one-time ${rule.action} spending up to $${amount} of ${spendAsset}`,
                params: {
                    ...(tokenAddress && !isNative ? { token: tokenAddress } : {}),
                    allowance: rawAmount,
                },
            });
        }
    }

    // ── 2. Temporal Caveat ──────────────────────────────────────────
    if (rule.schedule) {
        const expiry = computeExpiryTimestamp(rule.schedule.type);

        caveats.push({
            type: "temporal",
            justification: `Permission expires after ${rule.schedule.type === "once" ? "single execution" : `one ${rule.schedule.type} cycle`}`,
            params: {
                expiry,
                scheduleType: rule.schedule.type,
                ...(rule.schedule.day ? { day: rule.schedule.day } : {}),
            },
        });
    }

    // ── 3. Price Condition Caveat ───────────────────────────────────
    if (rule.conditions?.priceBelow != null || rule.conditions?.priceAbove != null) {
        const conditionAsset = rule.targetAsset ?? rule.sourceAsset ?? "ETH";

        caveats.push({
            type: "price-condition",
            justification: buildPriceJustification(conditionAsset, rule.conditions),
            params: {
                asset: conditionAsset,
                ...(rule.conditions.priceBelow != null
                    ? { priceBelow: rule.conditions.priceBelow }
                    : {}),
                ...(rule.conditions.priceAbove != null
                    ? { priceAbove: rule.conditions.priceAbove }
                    : {}),
                oracleType: "chainlink", // deterministic oracle reference
            },
        });
    }

    return {
        caveats,
        metadata: {
            ruleAction: rule.action,
            generatedAt: new Date().toISOString(),
        },
    };
}

// ─── Helpers ────────────────────────────────────────────────────────

function computeExpiryTimestamp(scheduleType: string): number {
    const now = Math.floor(Date.now() / 1000);
    switch (scheduleType) {
        case "once":
            return now + 86400; // 24h window
        case "daily":
            return now + 86400 * 7; // 7-day rolling
        case "weekly":
            return now + 604800 * 4; // 4 weeks
        case "monthly":
            return now + 2592000 * 3; // 3 months
        default:
            return now + 604800; // default 1 week
    }
}

function buildPriceJustification(
    asset: string,
    conditions: { priceBelow?: number | null; priceAbove?: number | null }
): string {
    const parts: string[] = [];
    if (conditions.priceBelow != null) {
        parts.push(`${asset} < $${conditions.priceBelow.toLocaleString()}`);
    }
    if (conditions.priceAbove != null) {
        parts.push(`${asset} > $${conditions.priceAbove.toLocaleString()}`);
    }
    return `Execute only when ${parts.join(" and ")}`;
}
