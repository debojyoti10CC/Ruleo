import { Telegraf } from "telegraf";

interface WebhookPayload {
    txHash: string;
    status: "Success" | "Failed";
    chatId: number;
}

/**
 * Handles incoming status updates from the 1Shot Relayer.
 * Sends a Telegram notification to the user upon transaction success.
 */
export async function handleWebhook(bot: Telegraf, payload: WebhookPayload): Promise<void> {
    const { txHash, status, chatId } = payload;

    if (status === "Success" || status.toLowerCase() === "success") {
        const msg =
            `⚡ *Agent Executed*\n\n` +
            `*Transaction:*\n\`${txHash}\`\n\n` +
            `*Status:*\n\`Success\`\n\n` +
            `🔗 [View Transaction](https://sepolia.basescan.org/tx/${txHash})`;

        await bot.telegram.sendMessage(chatId, msg, {
            parse_mode: "Markdown",
            link_preview_options: { is_disabled: true }
        } as any);
    }
}
