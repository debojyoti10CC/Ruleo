import { z } from "zod";

// ─── Schedule Schema ────────────────────────────────────────────────
export const ScheduleSchema = z.object({
    type: z.enum(["once", "daily", "weekly", "monthly"]),
    day: z.string().nullable().optional(),
});

// ─── Conditions Schema ──────────────────────────────────────────────
export const ConditionsSchema = z.object({
    priceBelow: z.number().positive().nullable().optional(),
    priceAbove: z.number().positive().nullable().optional(),
});

// ─── Limits Schema ──────────────────────────────────────────────────
export const LimitsSchema = z.object({
    maxUsdPerWeek: z.number().positive().nullable().optional(),
    maxUsdPerMonth: z.number().positive().nullable().optional(),
});

// ─── Rule Schema ────────────────────────────────────────────────────
export const RuleSchema = z.object({
    action: z.enum(["buy", "sell", "swap", "rebalance"]),
    sourceAsset: z.string().nullable().optional(),
    targetAsset: z.string().nullable().optional(),
    amount: z.number().positive().nullable().optional(),
    schedule: ScheduleSchema.nullable().optional(),
    conditions: ConditionsSchema.nullable().optional(),
    limits: LimitsSchema.nullable().optional(),
});

// ─── Inferred TypeScript Type ───────────────────────────────────────
export type Rule = z.infer<typeof RuleSchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;
export type Conditions = z.infer<typeof ConditionsSchema>;
export type Limits = z.infer<typeof LimitsSchema>;
