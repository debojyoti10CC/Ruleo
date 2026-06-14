import axios from "axios";
import { addExecutionTx, getOrCreateWallet } from "./agent-wallet";
import type { Rule } from "./rule-schema";
import { executeTrade } from "./src/relayer/one-shot";

export interface DeployedAgent {
    chatId: number;
    agentId: string;
    rule: Rule;
    deployedAt: string;
}

// Active deployed agents
const activeAgents = new Map<string, DeployedAgent>();

// Mock prices for monitoring
const currentPrices: Record<string, number> = {
    ETH: 3000,
    BTC: 65000,
    SOL: 150,
    LINK: 15,
};

let monitoringInterval: NodeJS.Timeout | null = null;
let serverPort = 3000; // default, will be updated by index.ts

export function setServerPort(port: number) {
    serverPort = port;
}

/**
 * Register a newly deployed agent
 */
export function registerAgent(chatId: number, agentId: string, rule: Rule): void {
    activeAgents.set(agentId, {
        chatId,
        agentId,
        rule,
        deployedAt: new Date().toISOString(),
    });

    console.log(`[A2A Coordinator] Deployed agent registered: ${agentId} for Chat: ${chatId}`);

    // If monitoring loop isn't running, start it
    if (!monitoringInterval) {
        startMonitoringLoop();
    }
}

/**
 * Stop agent and remove from active list
 */
export function unregisterAgent(agentId: string): void {
    activeAgents.delete(agentId);
    console.log(`[A2A Coordinator] Agent unregistered: ${agentId}`);
    if (activeAgents.size === 0 && monitoringInterval) {
        clearInterval(monitoringInterval);
        monitoringInterval = null;
    }
}

/**
 * Get active agent by id
 */
export function getAgent(agentId: string): DeployedAgent | undefined {
    return activeAgents.get(agentId);
}

/**
 * Return all active agents
 */
export function getActiveAgents(): DeployedAgent[] {
    return Array.from(activeAgents.values());
}

/**
 * Get current prices
 */
export function getCurrentPrices(): Record<string, number> {
    return { ...currentPrices };
}

async function fetchRealPrices(): Promise<void> {
    const assets = ["ETH", "BTC", "SOL", "LINK"];
    for (const asset of assets) {
        try {
            const res = await axios.get(`https://api.coinbase.com/v2/prices/${asset}-USD/spot`, { timeout: 4000 });
            if (res.data?.data?.amount) {
                currentPrices[asset] = parseFloat(res.data.data.amount);
            }
        } catch (err) {
            console.warn(`[A2A Coordinator] Could not fetch real-time price for ${asset}, using simulated walk: ${(err as Error).message}`);
            const changePercent = (Math.random() - 0.5) * 0.01;
            currentPrices[asset] = parseFloat((currentPrices[asset] * (1 + changePercent)).toFixed(2));
        }
    }
}

/**
 * Simulated price monitoring loop (A2A flow)
 * "Price-check agent" monitors prices and signals the "Execution agent"
 */
function startMonitoringLoop(): void {
    console.log("[A2A Coordinator] Starting Price-Check Agent monitoring loop...");

    monitoringInterval = setInterval(async () => {
        // 1. Fetch real market prices from Coinbase API
        await fetchRealPrices();

        console.log(`[A2A Coordinator] Price update: ETH: $${currentPrices.ETH} | SOL: $${currentPrices.SOL}`);

        // 2. Check conditions for all active agents
        for (const agent of activeAgents.values()) {
            const wallet = getOrCreateWallet(agent.chatId);
            if (wallet.status !== "active") {
                console.log(`[A2A Coordinator] Agent ${agent.agentId} is not active (Status: ${wallet.status}). Skipping price check.`);
                continue;
            }

            const rule = agent.rule;
            const asset = rule.targetAsset ?? rule.sourceAsset ?? "ETH";
            const price = currentPrices[asset.toUpperCase()];

            if (!price) continue;

            let conditionTriggered = false;

            if (rule.conditions) {
                const { priceBelow, priceAbove } = rule.conditions;
                if (priceBelow != null && price < priceBelow) {
                    conditionTriggered = true;
                    console.log(`[A2A Coordinator] Agent ${agent.agentId} trigger matched: ${asset} price ($${price}) < target ($${priceBelow})`);
                }
                if (priceAbove != null && price > priceAbove) {
                    conditionTriggered = true;
                    console.log(`[A2A Coordinator] Agent ${agent.agentId} trigger matched: ${asset} price ($${price}) > target ($${priceAbove})`);
                }
            } else {
                // If there are no price conditions, just execute on a periodic tick (e.g. daily/weekly simulated trigger)
                // For demonstration purposes, we trigger it randomly 10% of the time on monitoring ticks
                if (Math.random() < 0.15) {
                    conditionTriggered = true;
                    console.log(`[A2A Coordinator] Agent ${agent.agentId} periodic execution triggered by scheduler.`);
                }
            }

            if (conditionTriggered) {
                // Trigger execution agent!
                await executeAgentTrade(agent, price);
            }
        }
    }, 15000); // Check every 15 seconds
}

/**
 * Executes the trade and hits the 1Shot Webhook
 */
async function executeAgentTrade(agent: DeployedAgent, currentPrice: number): Promise<void> {
    const { agentId, chatId, rule } = agent;

    console.log(`[A2A Coordinator] Execution Agent: Triggering execution for ${agentId}...`);

    // Determine execution details
    const spendAsset = rule.sourceAsset ?? "USDC";
    const targetAsset = rule.targetAsset ?? "ETH";
    const tradeAmountUsd = rule.amount ?? 50.0; // default $50 if not specified

    // Get the user's smart account address
    const wallet = getOrCreateWallet(chatId);
    
    if (wallet.balanceUsd < tradeAmountUsd) {
        console.warn(`[A2A Coordinator] Execution skipped for agent ${agentId}: Insufficient balance ($${wallet.balanceUsd} < required $${tradeAmountUsd})`);
        return;
    }

    const result = await executeTrade(
        wallet.address,
        rule.action,
        tradeAmountUsd,
        spendAsset,
        targetAsset,
        currentPrice,
        wallet.signedDelegation
    );

    if (result.status === "Success") {
        // Add to wallet history
        addExecutionTx(chatId, tradeAmountUsd, `Executed: Swap ${spendAsset} to ${targetAsset} (Rate: $${currentPrice})`, result.txHash);

        // Call the oneshot webhook route to notify the user
        try {
            await axios.post(`http://localhost:${serverPort}/api/webhook/oneshot`, {
                txHash: result.txHash,
                status: "Success",
                chatId
            });
            
            // Remove one-time rules after execution
            if (rule.schedule?.type === "once") {
                unregisterAgent(agentId);
            }
        } catch (err) {
            console.error(`[A2A Coordinator] Error posting to oneshot Webhook: ${(err as Error).message}`);
        }
    } else {
        console.error(`[A2A Coordinator] Relayer execution failed for agent ${agentId}`);
    }
}
