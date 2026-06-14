import type { Rule } from "./rule-schema";

// ─── Format Confirmation ────────────────────────────────────────────
export function formatConfirmation(rule: Rule): string {
    const lines: string[] = [];

    lines.push("✅ Rule Understood\n");

    // Action + Asset
    const actionLabel = rule.action.charAt(0).toUpperCase() + rule.action.slice(1);
    if (rule.action === "swap") {
        lines.push(`Action: ${actionLabel} ${rule.sourceAsset ?? "?"} → ${rule.targetAsset ?? "?"}`);
    } else if (rule.action === "buy") {
        lines.push(`Action: ${actionLabel} ${rule.targetAsset ?? "?"}`);
        if (rule.sourceAsset && rule.sourceAsset !== "USDC") {
            lines.push(`Using: ${rule.sourceAsset}`);
        }
    } else if (rule.action === "sell") {
        lines.push(`Action: ${actionLabel} ${rule.sourceAsset ?? "?"}`);
        if (rule.targetAsset && rule.targetAsset !== "USDC") {
            lines.push(`Into: ${rule.targetAsset}`);
        }
    } else {
        lines.push(`Action: ${actionLabel}`);
        if (rule.targetAsset) lines.push(`Target: ${rule.targetAsset}`);
        if (rule.sourceAsset) lines.push(`Source: ${rule.sourceAsset}`);
    }

    // Amount
    if (rule.amount != null) {
        lines.push(`Amount: $${rule.amount}`);
    }

    // Schedule
    if (rule.schedule) {
        lines.push("");
        lines.push("📅 Schedule:");
        switch (rule.schedule.type) {
            case "once":
                lines.push("  One-time execution");
                break;
            case "daily":
                lines.push("  Every day");
                break;
            case "weekly":
                lines.push(`  Every ${capitalize(rule.schedule.day ?? "week")}`);
                break;
            case "monthly":
                lines.push(`  Monthly${rule.schedule.day ? ` on the ${rule.schedule.day}` : ""}`);
                break;
        }
    }

    // Conditions
    if (rule.conditions && (rule.conditions.priceBelow != null || rule.conditions.priceAbove != null)) {
        lines.push("");
        lines.push("📊 Conditions:");
        const asset = rule.targetAsset ?? rule.sourceAsset ?? "Asset";
        if (rule.conditions.priceBelow != null) {
            lines.push(`  ${asset} < $${rule.conditions.priceBelow.toLocaleString()}`);
        }
        if (rule.conditions.priceAbove != null) {
            lines.push(`  ${asset} > $${rule.conditions.priceAbove.toLocaleString()}`);
        }
    }

    // Limits
    if (rule.limits && (rule.limits.maxUsdPerWeek != null || rule.limits.maxUsdPerMonth != null)) {
        lines.push("");
        lines.push("💰 Limits:");
        if (rule.limits.maxUsdPerWeek != null) {
            lines.push(`  $${rule.limits.maxUsdPerWeek}/week`);
        }
        if (rule.limits.maxUsdPerMonth != null) {
            lines.push(`  $${rule.limits.maxUsdPerMonth}/month`);
        }
    }

    return lines.join("\n");
}

// ─── Format Validation Errors ───────────────────────────────────────
export function formatErrors(reasons: string[]): string {
    const lines = ["❌ Rule Validation Failed\n"];
    for (const reason of reasons) {
        lines.push(`• ${reason}`);
    }
    lines.push("\nPlease rephrase your rule and try again.");
    return lines.join("\n");
}

// ─── Helpers ────────────────────────────────────────────────────────
function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
