export interface AgentTx {
    id: string;
    type: "inference_fee" | "execution" | "funding";
    amountUsd: number;
    description: string;
    timestamp: string;
    txHash?: string;
}

export interface AgentWallet {
    chatId: number;
    address: string;
    balanceUsd: number;
    status: "needs_funding" | "active";
    transactions: AgentTx[];
    ownerPrivateKey?: string;
    signedDelegation?: any;
}

// In-memory wallet store
const wallets = new Map<number, AgentWallet>();

export const DEFAULT_INFERENCE_FEE = 0.003; // x402 cost per AI decision
export const INITIAL_FUNDING = 10.0;        // $10 virtual balance for pre-deploy rule compilation

/**
 * Generate a mock smart account address
 */
export function generateSmartAccountAddress(): string {
    const chars = "0123456789abcdef";
    let addr = "0x";
    for (let i = 0; i < 40; i++) {
        addr += chars[Math.floor(Math.random() * 16)];
    }
    return addr;
}

/**
 * Create or get a smart account agent wallet
 */
export function getOrCreateWallet(chatId: number, address?: string, ownerPrivateKey?: string): AgentWallet {
    if (!wallets.has(chatId)) {
        wallets.set(chatId, {
            chatId,
            address: address ?? generateSmartAccountAddress(),
            balanceUsd: INITIAL_FUNDING,
            status: "active",
            transactions: [
                {
                    id: `tx_${Math.random().toString(36).slice(2, 9)}`,
                    type: "funding",
                    amountUsd: INITIAL_FUNDING,
                    description: "Initial Compilation Credits (Base Sepolia)",
                    timestamp: new Date().toISOString(),
                }
            ],
            ownerPrivateKey,
        });
    } else if (ownerPrivateKey) {
        wallets.get(chatId)!.ownerPrivateKey = ownerPrivateKey;
    }
    return wallets.get(chatId)!;
}

/**
 * Reset and delete an agent wallet from memory
 */
export function resetWallet(chatId: number): void {
    wallets.delete(chatId);
}

/**
 * Deduct x402 inference micropayment from agent wallet
 */
export function deductX402Fee(chatId: number, fee: number = DEFAULT_INFERENCE_FEE): {
    success: boolean;
    balance: number;
    fee: number;
    txId?: string;
} {
    const wallet = getOrCreateWallet(chatId);
    if (wallet.balanceUsd < fee) {
        return { success: false, balance: wallet.balanceUsd, fee };
    }

    wallet.balanceUsd -= fee;
    // Round to 4 decimals
    wallet.balanceUsd = Math.round(wallet.balanceUsd * 10000) / 10000;

    const txId = `tx_x402_${Math.random().toString(36).slice(2, 9)}`;
    const tx: AgentTx = {
        id: txId,
        type: "inference_fee",
        amountUsd: fee,
        description: `x402 Micropayment: AI Inference Call`,
        timestamp: new Date().toISOString(),
    };
    wallet.transactions.push(tx);

    return { success: true, balance: wallet.balanceUsd, fee, txId };
}

/**
 * Add an execution transaction (e.g. trading)
 */
export function addExecutionTx(
    chatId: number,
    amountUsd: number,
    description: string,
    txHash: string
): void {
    const wallet = getOrCreateWallet(chatId);
    wallet.balanceUsd -= amountUsd;
    wallet.balanceUsd = Math.round(wallet.balanceUsd * 10000) / 10000;

    wallet.transactions.push({
        id: `tx_exec_${Math.random().toString(36).slice(2, 9)}`,
        type: "execution",
        amountUsd,
        description,
        timestamp: new Date().toISOString(),
        txHash,
    });
}
