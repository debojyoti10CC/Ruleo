import "dotenv/config";
import { Telegraf, Markup } from "telegraf";
import { parseRule } from "./llm-parser";
import { validateRule, ValidationError } from "./validator";
import { formatConfirmation, formatErrors } from "./formatter";
import { generateCaveats, type CaveatConfig } from "./caveat-generator";
import type { Rule } from "./rule-schema";
import { getOrCreateWallet, deductX402Fee, DEFAULT_INFERENCE_FEE, resetWallet } from "./agent-wallet";
import { registerAgent, setServerPort } from "./a2a-coordinator";
import { getSmartAccount } from "./src/metamask/smart-account";
import { deploySmartAccount, toRelayerJson } from "./src/relayer/one-shot";
import { handleWebhook } from "./src/webhooks/oneshot-webhook";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import { baseSepolia } from "viem/chains";
import { 
    getSmartAccountsEnvironment, 
    createDelegation, 
    ScopeType
} from "@metamask/smart-accounts-kit";
import { SIGNABLE_DELEGATION_TYPED_DATA, toDelegationStruct } from "@metamask/smart-accounts-kit/utils";
import { bytesToHex } from "viem/utils";
import { randomBytes } from "crypto";
import { parseUnits } from "viem";

const SWAP_ROUTER_02_ADDRESS = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4";

function prepareSignDelegationTypedData({
    delegation,
    delegationManager,
    chainId,
    name = "DelegationManager",
    version = "1",
    allowInsecureUnrestrictedDelegation = false
}: {
    delegation: any;
    delegationManager: `0x${string}`;
    chainId: number;
    name?: string;
    version?: string;
    allowInsecureUnrestrictedDelegation?: boolean;
}) {
    const delegationStruct = toDelegationStruct({
        ...delegation,
        signature: "0x"
    });
    if (delegationStruct.caveats.length === 0 && !allowInsecureUnrestrictedDelegation) {
        throw new Error(
            "No caveats found. If you definitely want to sign a delegation without caveats, set `allowInsecureUnrestrictedDelegation` to `true`."
        );
    }
    return {
        domain: {
            chainId,
            name,
            version,
            verifyingContract: delegationManager
        },
        types: SIGNABLE_DELEGATION_TYPED_DATA,
        primaryType: "Delegation" as const,
        message: delegationStruct
    };
}

// ─── AI Provider Config ─────────────────────────────────────────────
const isVenice = !!process.env.VENICE_API_KEY;
const aiProvider = isVenice ? "Venice" : "Groq";

// ─── Validate Environment ───────────────────────────────────────────
const token = process.env.BOT_TOKEN;
if (!token) {
    console.error("❌ BOT_TOKEN is missing from .env");
    process.exit(1);
}

const bot = new Telegraf(token);

// In-memory store: chatId → last validated rule & caveats
const pendingRules = new Map<
    number,
    { rule: Rule; caveats: CaveatConfig }
>();

const mockRule: Rule = {
    action: "swap",
    sourceAsset: "USDC",
    targetAsset: "LINK",
    amount: 150,
    schedule: {
        type: "weekly",
        day: "Friday"
    },
    conditions: {
        priceBelow: 15
    },
    limits: {
        maxUsdPerWeek: 150
    }
};
pendingRules.set(999, {
    rule: mockRule,
    caveats: generateCaveats(mockRule)
});

// ─── Example Rules (reusable) ───────────────────────────────────────
const EXAMPLE_RULES = [
    "Buy ETH every Friday if ETH < $2800, max $50/week",
    "Sell SOL monthly if SOL > $200",
    "Swap USDC to LINK once if LINK < $15",
];

// Server Configuration
const PORT = parseInt(process.env.PORT ?? "3000", 10);
function getTunnelUrl() {
    try {
        const envPath = path.join(__dirname, ".env");
        if (fs.existsSync(envPath)) {
            const envContent = fs.readFileSync(envPath, "utf8");
            const match = envContent.match(/^TUNNEL_URL=(.+)$/m);
            if (match && match[1]) {
                return match[1].trim();
            }
        }
    } catch (err) {
        console.error("Error reading dynamic TUNNEL_URL:", err);
    }
    return process.env.TUNNEL_URL || `http://localhost:${PORT}`;
}

// ─── /start ─────────────────────────────────────────────────────────
bot.start((ctx) => {
    const name = ctx.from?.first_name ?? "there";

    ctx.reply(
        `Hey ${name} 👋\n\n` +
            `Welcome to *Ruleo* — your DeFi autopilot.\n\n` +
            `Tell me a trading rule in plain English and I'll turn it into a secure, on-chain agent.\n\n` +
            `━━━━━━━━━━━━━━━━━━━\n` +
            `⚡ *How it works*\n\n` +
            `1️⃣  You describe a rule\n` +
            `2️⃣  AI parses your intent (x402 micro-gas)\n` +
            `3️⃣  You review & confirm\n` +
            `4️⃣  Agent deploys on Base Sepolia\n\n` +
            `━━━━━━━━━━━━━━━━━━━\n` +
            `💡 *Try tapping an example below* or just type your own rule.`,
        {
            parse_mode: "Markdown",
            ...Markup.inlineKeyboard([
                [Markup.button.callback("📈 Buy ETH weekly", "example_0")],
                [Markup.button.callback("📉 Sell SOL monthly", "example_1")],
                [Markup.button.callback("🔄 Swap USDC → LINK", "example_2")],
                [Markup.button.callback("❓ Help & Commands", "show_help")],
            ]),
        }
    );
});

// ─── /reset ──────────────────────────────────────────────────────────
bot.command("reset", async (ctx) => {
    const chatId = ctx.chat.id;
    resetWallet(chatId);
    pendingRules.delete(chatId);
    await ctx.reply(
        `🔄 *Demo Wallet Reset!*\n\n` +
        `Your previous agent mapping and deployment state have been cleared from memory.\n` +
        `You now have a fresh *$10.00 USD* virtual x402 compilation credit.\n\n` +
        `Try sending your trading rule again!`,
        { parse_mode: "Markdown" }
    );
});

// ─── Example Button Handlers ────────────────────────────────────────
bot.action(/^example_(\d)$/, async (ctx) => {
    const idx = parseInt(ctx.match[1], 10);
    const example = EXAMPLE_RULES[idx];
    if (!example) return ctx.answerCbQuery("Unknown example");

    await ctx.answerCbQuery(`Processing: "${example}"`);
    await ctx.reply(`📝 *Your rule:*\n\n_"${example}"_`, { parse_mode: "Markdown" });

    const wallet = getOrCreateWallet(ctx.chat!.id);
    const deduction = deductX402Fee(ctx.chat!.id);

    if (!deduction.success) {
        await ctx.reply(
            `❌ *Insufficient Agent Balance*\n\n` +
                `An x402 compilation fee of $${DEFAULT_INFERENCE_FEE} is required to parse rules.\n` +
                `Your current balance is *$${wallet.balanceUsd} USD*.\n\n` +
                `Please deposit funds on Base Sepolia to your agent address:\n\`${wallet.address}\``,
            { parse_mode: "Markdown" }
        );
        return;
    }

    await ctx.reply(
        `🔍 Understanding your rule...\n` +
            `• x402 charge: -$${DEFAULT_INFERENCE_FEE} USD\n` +
            `• Agent wallet: \`${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}\`\n` +
            `• Remaining Balance: $${deduction.balance} USD`
    );

    try {
        const rawRule = await parseRule(example);
        const rule = validateRule(rawRule);
        const caveats = generateCaveats(rule);
        pendingRules.set(ctx.chat!.id, { rule, caveats });

        const tmaUrl = `${getTunnelUrl()}?chatId=${ctx.chat!.id}`;

        await ctx.reply(
            formatConfirmation(rule),
            Markup.inlineKeyboard([
                [
                    Markup.button.webApp("🚀 Deploy Agent", tmaUrl),
                    Markup.button.callback("📋 View Caveats", "view_caveats"),
                ],
                [Markup.button.callback("❌ Cancel", "cancel_rule")],
            ])
        );
    } catch (err) {
        if (err instanceof ValidationError) {
            await ctx.reply(formatErrors(err.reasons));
        } else {
            console.error("Example pipeline error:", (err as Error).message);
            await ctx.reply("❌ Could not process the example. Please try typing your own rule.");
        }
    }
});

// ─── Help ───────────────────────────────────────────────────────────
bot.action("show_help", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(
        `📖 *Ruleo Commands & Tips*\n\n` +
            `*/start* — Show welcome screen\n` +
            `*/help* — Show this help message\n\n` +
            `✏️ *Writing Rules*\n\n` +
            `Just type naturally. Ruleo understands:\n\n` +
            `• *Actions:* buy, sell, swap, rebalance\n` +
            `• *Assets:* ETH, BTC, SOL, USDC, LINK, UNI, AAVE…\n` +
            `• *Schedules:* once, daily, weekly, monthly\n` +
            `• *Conditions:* "if ETH < $2800", "if SOL > $200"\n` +
            `• *Limits:* "max $50/week", "max $500/month"\n\n` +
            `🔒 *Safety*\n\n` +
            `AI only extracts intent — all on-chain actions are validated by deterministic code with ERC-7715 caveats.`,
        { parse_mode: "Markdown" }
    );
});

bot.command("help", (ctx) => {
    ctx.reply(
        `📖 *Ruleo Commands & Tips*\n\n` +
            `*/start* — Show welcome screen\n` +
            `*/help* — Show this help message\n\n` +
            `✏️ Just type a DeFi rule in plain English!\n\n` +
            `Example:\n_"Buy ETH every Friday if ETH < $2800, max $50/week"_`,
        { parse_mode: "Markdown" }
    );
});

// ─── Text Handler — Full Pipeline ───────────────────────────────────
bot.on("text", async (ctx) => {
    const userText = ctx.message.text;

    // Ignore commands
    if (userText.startsWith("/")) return;

    const wallet = getOrCreateWallet(ctx.chat.id);
    const deduction = deductX402Fee(ctx.chat.id);

    if (!deduction.success) {
        await ctx.reply(
            `❌ *Insufficient Agent Balance*\n\n` +
                `An x402 compilation fee of $${DEFAULT_INFERENCE_FEE} is required to parse rules.\n` +
                `Your current balance is *$${wallet.balanceUsd} USD*.\n\n` +
                `Please deposit funds on Base Sepolia to your agent address:\n\`${wallet.address}\``,
            { parse_mode: "Markdown" }
        );
        return;
    }

    await ctx.reply(
        `🔍 Understanding your rule...\n` +
            `• x402 charge: -$${DEFAULT_INFERENCE_FEE} USD\n` +
            `• Agent wallet: \`${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}\`\n` +
            `• Remaining Balance: $${deduction.balance} USD`
    );

    try {
        // Step 1: LLM Parse
        const rawRule = await parseRule(userText);

        // Step 2: Validate
        const rule = validateRule(rawRule);

        // Step 3: Generate caveats (deterministic, no AI)
        const caveats = generateCaveats(rule);

        // Store for deploy callback
        pendingRules.set(ctx.chat.id, { rule, caveats });

        // Step 4: Format confirmation
        const confirmation = formatConfirmation(rule);

        const tmaUrl = `${getTunnelUrl()}?chatId=${ctx.chat.id}`;

        // Step 5: Show confirmation with deploy button (webApp)
        await ctx.reply(
            confirmation,
            Markup.inlineKeyboard([
                [
                    Markup.button.webApp("🚀 Deploy Agent", tmaUrl),
                    Markup.button.callback("📋 View Caveats", "view_caveats"),
                ],
                [Markup.button.callback("❌ Cancel", "cancel_rule")],
            ])
        );
    } catch (err) {
        if (err instanceof ValidationError) {
            await ctx.reply(formatErrors(err.reasons));
        } else if (err instanceof Error) {
            console.error("Pipeline error:", err.message);
            await ctx.reply(
                `❌ Could not parse your rule.\n\nReason: ${err.message}\n\nPlease try rephrasing.`
            );
        } else {
            console.error("Unknown error:", err);
            await ctx.reply("❌ Something went wrong. Please try again.");
        }
    }
});

// ─── Deploy Agent Callback (Fallback callback if needed) ────────────
bot.action("deploy_agent", async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId || !pendingRules.has(chatId)) {
        await ctx.editMessageText("⚠️ No pending rule found. Please submit a new rule.");
        return;
    }
    const tmaUrl = `${getTunnelUrl()}?chatId=${chatId}`;
    await ctx.editMessageText(
        "⚡ Please launch the Ruleo Mini App to secure your owner passkey and deploy.",
        Markup.inlineKeyboard([[Markup.button.webApp("🚀 Launch Mini App", tmaUrl)]])
    );
});

// ─── View Caveats Callback ──────────────────────────────────────────
bot.action("view_caveats", async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (!chatId || !pendingRules.has(chatId)) {
        await ctx.editMessageText("⚠️ No pending rule found. Please submit a new rule.");
        return;
    }

    const { caveats } = pendingRules.get(chatId)!;

    let text = "📋 ERC-7715 Caveat Configuration\n\n";
    for (const [i, caveat] of caveats.caveats.entries()) {
        text += `${i + 1}. [${caveat.type}]\n`;
        text += `   ${caveat.justification}\n\n`;
    }
    text += `Generated: ${caveats.metadata.generatedAt}`;

    const tmaUrl = `${getTunnelUrl()}?chatId=${chatId}`;

    // Keep the buttons
    await ctx.editMessageText(
        text,
        Markup.inlineKeyboard([
            [
                Markup.button.webApp("🚀 Deploy Agent", tmaUrl),
                Markup.button.callback("❌ Cancel", "cancel_rule"),
            ],
        ])
    );
});

// ─── Cancel Callback ────────────────────────────────────────────────
bot.action("cancel_rule", async (ctx) => {
    await ctx.answerCbQuery();
    const chatId = ctx.chat?.id;
    if (chatId) pendingRules.delete(chatId);
    await ctx.editMessageText("🗑️ Rule cancelled. Send a new rule whenever you're ready.");
});

// ─── Web Server definition ──────────────────────────────────────────
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "", `http://${req.headers.host}`);

    // Serve static files from 'public' directory
    if (
        req.method === "GET" &&
        (url.pathname === "/" ||
            url.pathname === "/index.html" ||
            url.pathname === "/style.css" ||
            url.pathname === "/app.js")
    ) {
        const file = url.pathname === "/" ? "/index.html" : url.pathname;
        const filePath = path.join(__dirname, "public", file);

        if (fs.existsSync(filePath)) {
            let contentType = "text/html";
            if (filePath.endsWith(".css")) contentType = "text/css";
            if (filePath.endsWith(".js")) contentType = "application/javascript";

            res.writeHead(200, { "Content-Type": contentType });
            fs.createReadStream(filePath).pipe(res);
            return;
        }
    }

    // API GET /api/pending?chatId=...&ownerAddress=...
    if (req.method === "GET" && url.pathname === "/api/pending") {
        const chatId = parseInt(url.searchParams.get("chatId") ?? "0", 10);
        const ownerAddress = url.searchParams.get("ownerAddress");
        const data = pendingRules.get(chatId);
        
        if (data) {
            if (ownerAddress && ownerAddress.startsWith("0x")) {
                try {
                    console.log(`[Server] Generating counterfactual smart account address for owner: ${ownerAddress}...`);
                    const smartAccount = await getSmartAccount(ownerAddress);
                    const smartAccountAddress = smartAccount.address;

                    console.log(`[Server] Fetching relayer capabilities on Base Sepolia...`);
                    const capsRes = await axios.post("https://relayer.1shotapi.dev/relayers", {
                        jsonrpc: "2.0",
                        id: Date.now(),
                        method: "relayer_getCapabilities",
                        params: [String(baseSepolia.id)],
                    });
                    const caps = capsRes.data.result;
                    const chainCaps = caps[String(baseSepolia.id)];
                    if (!chainCaps) {
                        throw new Error(`Base Sepolia (${baseSepolia.id}) capabilities not found`);
                    }
                    const targetAddress = chainCaps.targetAddress;
                    const usdcToken = chainCaps.tokens.find((t: any) => t.symbol === "USDC");
                    if (!usdcToken) {
                        throw new Error("USDC token not supported in 1Shot capabilities");
                    }

                    const usdcAddress = usdcToken.address;
                    
                    // Cap weekly allowance (limit or default)
                    const weeklyLimit = data.rule.limits?.maxUsdPerWeek ?? data.rule.amount ?? 1000;
                    const weeklyLimitAtoms = parseUnits(weeklyLimit.toFixed(6), 6); // USDC decimals is 6
                    
                    const environment = getSmartAccountsEnvironment(baseSepolia.id);
                    
                    const allowedTargets = [
                        usdcAddress.toLowerCase(),
                        SWAP_ROUTER_02_ADDRESS.toLowerCase()
                    ] as `0x${string}`[];

                    const delegation = createDelegation({
                        to: targetAddress,
                        from: smartAccountAddress as `0x${string}`,
                        environment,
                        salt: bytesToHex(Uint8Array.from(randomBytes(32))) as `0x${string}`,
                        scope: {
                            type: ScopeType.FunctionCall,
                            targets: allowedTargets,
                            selectors: [
                                "transfer(address,uint256)",
                                "approve(address,uint256)",
                                "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))"
                            ]
                        },
                        caveats: [
                            {
                                type: "erc20PeriodTransfer",
                                tokenAddress: usdcAddress,
                                periodAmount: weeklyLimitAtoms,
                                periodDuration: 604800, // 1 week
                                startDate: Math.floor(Date.now() / 1000)
                            }
                        ]
                    });

                    // Generate EIP-712 typed data parameters
                    const typedData = prepareSignDelegationTypedData({
                        delegation,
                        delegationManager: environment.DelegationManager,
                        chainId: baseSepolia.id,
                    });

                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify(toRelayerJson({
                        rule: data.rule,
                        caveats: data.caveats,
                        smartAccountAddress,
                        delegation,
                        typedData
                    })));
                } catch (err) {
                    console.error("[Server] Pending rule delegation generation failed:", (err as Error).message);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: (err as Error).message }));
                }
            } else {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(data));
            }
        } else {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Not found" }));
        }
        return;
    }

    // API GET /api/wallet?chatId=...
    if (req.method === "GET" && url.pathname === "/api/wallet") {
        const chatId = parseInt(url.searchParams.get("chatId") ?? "0", 10);
        const wallet = getOrCreateWallet(chatId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(wallet));
        return;
    }

    // API POST /api/deploy
    if (req.method === "POST" && url.pathname === "/api/deploy") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
            try {
                const { chatId, ownerAddress, signature, delegation } = JSON.parse(body);
                const data = pendingRules.get(chatId);
                if (!data) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "No pending rule found" }));
                    return;
                }

                console.log(`[Server] Generating counterfactual smart account address for owner: ${ownerAddress}...`);
                const smartAccount = await getSmartAccount(ownerAddress);
                const smartAccountAddress = smartAccount.address;

                console.log(`[Server] Deploying MetaMask smart account ${smartAccountAddress} via 1Shot Relayer...`);
                const deployResult = await deploySmartAccount(ownerAddress);
                const txHash = deployResult.txHash;

                if (deployResult.status === "Failed") {
                    throw new Error(deployResult.error || "Smart Account deployment transaction failed on Base Sepolia");
                }

                // Construct signed delegation
                const signedDelegation = { ...delegation, signature };

                pendingRules.delete(chatId);
                const agentId = `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

                // Save smart account, set balance to 0, status to needs_funding, and store signedDelegation (no private key)
                const wallet = getOrCreateWallet(chatId, smartAccountAddress);
                wallet.address = smartAccountAddress;
                wallet.balanceUsd = 0.0;
                wallet.status = "needs_funding";
                wallet.signedDelegation = signedDelegation;
                delete wallet.ownerPrivateKey; // Ensure private key is deleted/never stored

                wallet.transactions = [
                    {
                        id: `tx_deploy_${Date.now()}`,
                        type: "funding",
                        amountUsd: 0.0,
                        description: "MetaMask Smart Account Deployed",
                        timestamp: new Date().toISOString(),
                        txHash: txHash
                    }
                ];

                registerAgent(chatId, agentId, data.rule);

                // Send bot message confirmation to user
                try {
                    await bot.telegram.sendMessage(
                        chatId,
                        `🚀 *Smart Account Created*\n\n` +
                            `*Address:*\n\`${smartAccountAddress}\`\n\n` +
                            `*Delegation:*\nActive\n\n` +
                            `*Network:*\nBase Sepolia\n\n` +
                            `*Deployment Tx:* [Base Sepolia Scan](https://sepolia.basescan.org/tx/${txHash})\n\n` +
                            `⏳ Your agent is deployed but *Needs Funding* to start trading. Fund it in the Mini App!`,
                        { parse_mode: "Markdown" }
                    );
                } catch (botErr) {
                    console.warn(`[Server] Failed to send Telegram bot message for deployment: ${(botErr as Error).message}`);
                }

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ success: true, smartAccountAddress, txHash }));
            } catch (err) {
                console.error("[Server] Deploy handler failed:", (err as Error).message);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: (err as Error).message }));
            }
        });
        return;
    }

    // API POST /api/fund
    if (req.method === "POST" && url.pathname === "/api/fund") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
            try {
                const { chatId, amount, txHash } = JSON.parse(body);
                const wallet = getOrCreateWallet(chatId);
                const fundAmount = amount ?? 100.0;

                wallet.balanceUsd += fundAmount;
                wallet.balanceUsd = Math.round(wallet.balanceUsd * 10000) / 10000;
                wallet.status = "active";

                wallet.transactions.push({
                    id: `tx_fund_${Math.random().toString(36).slice(2, 9)}`,
                    type: "funding",
                    amountUsd: fundAmount,
                    description: "Agent Wallet Funded (USDC Base Sepolia)",
                    timestamp: new Date().toISOString(),
                    txHash: txHash || `0x${Math.random().toString(16).slice(2, 10)}${Math.random().toString(16).slice(2, 10)}`,
                });

                // Send bot message confirmation to user
                try {
                    await bot.telegram.sendMessage(
                        chatId,
                        `💰 *Agent Smart Account Funded*\n\n` +
                            `*Deposit:* +$${fundAmount.toFixed(2)} USD\n` +
                            `*New Balance:* $${wallet.balanceUsd.toFixed(2)} USD\n\n` +
                            `🚀 *Status:* Active & Operating. It is now monitoring market conditions.`,
                        { parse_mode: "Markdown" }
                    );
                } catch (botErr) {
                    console.warn(`[Server] Failed to send Telegram bot message for funding: ${(botErr as Error).message}`);
                }

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ success: true, balance: wallet.balanceUsd, status: wallet.status }));
            } catch (err) {
                console.error("[Server] Fund handler failed:", (err as Error).message);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: (err as Error).message }));
            }
        });
        return;
    }

    // API POST /api/webhook/oneshot
    if (req.method === "POST" && url.pathname === "/api/webhook/oneshot") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", async () => {
            try {
                const payload = JSON.parse(body);
                const { chatId } = payload;
                deductX402Fee(chatId);
                
                await handleWebhook(bot, payload);
                
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: (err as Error).message }));
            }
        });
        return;
    }

    // API POST /api/webhook/1shot (1Shot Relayer callback)
    if (req.method === "POST" && url.pathname === "/api/webhook/1shot") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
            try {
                const payload = JSON.parse(body);
                const {
                    chatId,
                    txHash,
                    tradeAmountUsd,
                    action,
                    sourceAsset,
                    targetAsset,
                    currentPrice,
                } = payload;

                // Deduct x402 inference fee for the automated execution evaluation decision
                deductX402Fee(chatId);
                const wallet = getOrCreateWallet(chatId);

                // Bot execution notification
                const msg =
                    `⚡ *Ruleo Agent Executed Trade!*\n\n` +
                    `*Action:* ${action.toUpperCase()} ${targetAsset} using ${sourceAsset}\n` +
                    `*Amount:* $${tradeAmountUsd}\n` +
                    `*Current Price:* $${currentPrice.toLocaleString()} per ${targetAsset}\n` +
                    `*Relayed via:* 1Shot Bundler (Gas sponsored)\n` +
                    `*Transaction:* [Base Sepolia Scan](https://sepolia.basescan.org/tx/${txHash})\n\n` +
                    `💰 *Agent Account Status:*\n` +
                    `• Remaining Balance: *$${wallet.balanceUsd} USD*\n` +
                    `• x402 Micropayment: *-$${DEFAULT_INFERENCE_FEE} USD* deducted for ${aiProvider} AI inference.`;

                bot.telegram.sendMessage(chatId, msg, { parse_mode: "Markdown" });

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ success: true }));
            } catch (err) {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: (err as Error).message }));
            }
        });
        return;
    }

    res.writeHead(404);
    res.end("Not found");
});

// ─── Launch Server and Bot ──────────────────────────────────────────
bot.launch();
console.log("🤖 Ruleo bot running...");

server.listen(PORT, () => {
    console.log(`🤖 Web Server listening on port ${PORT}`);
    console.log(`🌍 Mini App serving at ${getTunnelUrl()}`);
    setServerPort(PORT);
});

// Graceful shutdown
process.once("SIGINT", () => {
    bot.stop("SIGINT");
    server.close();
});
process.once("SIGTERM", () => {
    bot.stop("SIGTERM");
    server.close();
});
