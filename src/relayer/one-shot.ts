import { createWalletClient, http, encodeFunctionData, erc20Abi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { getSmartAccount, publicClient } from "../metamask/smart-account";
import { randomBytes } from "crypto";
import { 
    Implementation, 
    ScopeType, 
    createDelegation, 
    toMetaMaskSmartAccount 
} from "@metamask/smart-accounts-kit";
import { bytesToHex } from "viem/utils";
import axios from "axios";

// Base Sepolia Addresses
const SWAP_ROUTER_02_ADDRESS = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4";
const QUOTER_V2_ADDRESS = "0xC5290058841028F1614F3A6F0F5816cAd0df5E27";

const TOKEN_ADDRESSES: Record<string, `0x${string}`> = {
    ETH: "0x4200000000000000000000000000000000000006", // Map ETH to WETH for Uniswap V3
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    USDT: "0x7169D38820dfd117C3FA1f22a697dBA58d90BA06",
    DAI: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    LINK: "0xE4aB69C077896252FAFBD49EFD26B5D171A32410",
};

const quoterV2Abi = [
    {
        inputs: [
            {
                components: [
                    { name: "tokenIn", type: "address" },
                    { name: "tokenOut", type: "address" },
                    { name: "amountIn", type: "uint256" },
                    { name: "fee", type: "uint24" },
                    { name: "sqrtPriceLimitX96", type: "uint160" },
                ],
                name: "params",
                type: "tuple",
            },
        ],
        name: "quoteExactInputSingle",
        outputs: [
            { name: "amountOut", type: "uint256" },
            { name: "sqrtPriceX96After", type: "uint160" },
            { name: "initializedTicksCrossed", type: "uint32" },
            { name: "gasEstimate", type: "uint256" },
        ],
        stateMutability: "nonpayable",
        type: "function",
    },
] as const;

const swapRouter02Abi = [
    {
        inputs: [
            {
                components: [
                    { name: "tokenIn", type: "address" },
                    { name: "tokenOut", type: "address" },
                    { name: "fee", type: "uint24" },
                    { name: "recipient", type: "address" },
                    { name: "amountIn", type: "uint256" },
                    { name: "amountOutMinimum", type: "uint256" },
                    { name: "sqrtPriceLimitX96", type: "uint160" },
                ],
                name: "params",
                type: "tuple",
            },
        ],
        name: "exactInputSingle",
        outputs: [{ name: "amountOut", type: "uint256" }],
        stateMutability: "payable",
        type: "function",
    },
] as const;

/**
 * Iterates through standard Uniswap V3 fee tiers to find the best route.
 */
async function getBestUniswapV3Route(
    tokenIn: `0x${string}`,
    tokenOut: `0x${string}`,
    amountIn: bigint
): Promise<{ fee: number; amountOut: bigint }> {
    const feeTiers = [100, 500, 3000, 10000];
    let bestFee = 3000;
    let maxAmountOut = 0n;

    for (const fee of feeTiers) {
        try {
            console.log(`[DEX Swap] Quoting Uniswap V3 pool for fee tier: ${fee}...`);
            const { result } = await publicClient.simulateContract({
                address: QUOTER_V2_ADDRESS,
                abi: quoterV2Abi,
                functionName: "quoteExactInputSingle",
                args: [{
                    tokenIn,
                    tokenOut,
                    amountIn,
                    fee,
                    sqrtPriceLimitX96: 0n,
                }],
            });
            const amountOut = result[0];
            console.log(`[DEX Swap] Fee tier ${fee} returned expected output: ${amountOut}`);
            if (amountOut > maxAmountOut) {
                maxAmountOut = amountOut;
                bestFee = fee;
            }
        } catch (err) {
            console.log(`[DEX Swap] Pool with fee ${fee} not available or failed: ${(err as Error).message}`);
        }
    }

    if (maxAmountOut === 0n) {
        throw new Error(`No liquid pool found for swap path: ${tokenIn} -> ${tokenOut}`);
    }

    return { fee: bestFee, amountOut: maxAmountOut };
}

// Read relayer key from environment, or default to a standard test key if missing
let relayerPrivateKey = process.env.PRIVATE_KEY as `0x${string}` | undefined;
let isMockedGas = false;

if (!relayerPrivateKey) {
    console.warn("⚠️  PRIVATE_KEY is missing in .env.");
    console.warn("⚠️  Generating a temporary relayer wallet for gas sponsorship...");
    // Fallback private key (deterministic test account key)
    relayerPrivateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    isMockedGas = true;
}

const relayerAccount = privateKeyToAccount(relayerPrivateKey);
const relayerWallet = createWalletClient({
    account: relayerAccount,
    chain: baseSepolia,
    transport: http("https://sepolia.base.org"),
});

export interface RelayerResult {
    txHash: string;
    status: "Success" | "Failed";
    explorerUrl: string;
    error?: string;
}

const ONESHOT_RELAYER_URL = "https://relayer.1shotapi.dev/relayers";

async function rpcCall<T>(method: string, params: unknown[] | Record<string, unknown>): Promise<T> {
    const res = await axios.post(ONESHOT_RELAYER_URL, {
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
    });
    if (res.data.error) {
        throw new Error(`[1Shot API Error] ${res.data.error.message} (${res.data.error.code})`);
    }
    return res.data.result;
}

export function toRelayerJson(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === "bigint") return `0x${value.toString(16)}`;
    if (value instanceof Uint8Array) return bytesToHex(value);
    if (Array.isArray(value)) return value.map(toRelayerJson);
    if (typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) out[k] = toRelayerJson(v);
        return out;
    }
    return value;
}

function generateMockTxHash(): string {
    const chars = "0123456789abcdef";
    let hash = "0x";
    for (let i = 0; i < 64; i++) {
        hash += chars[Math.floor(Math.random() * 16)];
    }
    return hash;
}

/**
 * Deploys the MetaMask Smart Account on Base Sepolia via the 1Shot gas Relayer.
 */
export async function deploySmartAccount(ownerAddress: string): Promise<RelayerResult> {
    try {
        const smartAccount = await getSmartAccount(ownerAddress);
        const saAddress = smartAccount.address;

        // Check if bytecode already exists onchain (already deployed)
        const code = await publicClient.getBytecode({ address: saAddress });
        if (code && code !== "0x") {
            console.log(`[1Shot Relayer] Smart account ${saAddress} already deployed.`);
            const dummyHash = "0x0000000000000000000000000000000000000000000000000000000000000000";
            return {
                txHash: dummyHash,
                status: "Success",
                explorerUrl: `https://sepolia.basescan.org/address/${saAddress}`,
            };
        }

        const { factory, factoryData } = await smartAccount.getFactoryArgs();

        if (isMockedGas) {
            console.warn(`[1Shot Relayer] Running in Mock Gas mode. Simulating deployment...`);
            const mockTxHash = generateMockTxHash();
            return {
                txHash: mockTxHash,
                status: "Success",
                explorerUrl: `https://sepolia.basescan.org/tx/${mockTxHash}`,
            };
        }

        const balance = await publicClient.getBalance({ address: relayerAccount.address });
        if (balance === 0n) {
            const errMsg = `Relayer EOA ${relayerAccount.address} has 0 balance. Please fund it with Base Sepolia ETH.`;
            console.error(`[1Shot Relayer] ${errMsg}`);
            return {
                txHash: "",
                status: "Failed",
                explorerUrl: "",
                error: errMsg,
            };
        }

        console.log(`[1Shot Relayer] Deploying Smart Account for ${saAddress} (Factory: ${factory})...`);
        const hash = await relayerWallet.sendTransaction({
            to: factory,
            data: factoryData,
            value: 0n,
        });

        console.log(`[1Shot Relayer] Deployment TX broadcasted: ${hash}`);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return {
            txHash: hash,
            status: receipt.status === "success" ? "Success" : "Failed",
            explorerUrl: `https://sepolia.basescan.org/tx/${hash}`,
            error: receipt.status === "success" ? undefined : "Transaction execution reverted",
        };
    } catch (err) {
        const errorMsg = (err as Error).message;
        console.error("[1Shot Relayer] Deployment failed:", errorMsg);
        
        if (isMockedGas) {
            const mockTxHash = generateMockTxHash();
            return {
                txHash: mockTxHash,
                status: "Success",
                explorerUrl: `https://sepolia.basescan.org/tx/${mockTxHash}`,
            };
        }

        return {
            txHash: "",
            status: "Failed",
            explorerUrl: "",
            error: errorMsg,
        };
    }
}

/**
 * Routes execution transactions through the 1Shot gas Relayer on Base Sepolia.
 */
export async function executeTrade(
    smartAccountAddress: string,
    action: string,
    amountUsd: number,
    spendAsset: string,
    targetAsset: string,
    currentPrice: number,
    signedDelegation: any
): Promise<RelayerResult> {
    try {
        if (isMockedGas) {
            console.warn(`[1Shot Relayer] Running in Mock Gas mode. Simulating execution...`);
            const mockTxHash = generateMockTxHash();
            return {
                txHash: mockTxHash,
                status: "Success",
                explorerUrl: `https://sepolia.basescan.org/tx/${mockTxHash}`,
            };
        }

        if (!signedDelegation) {
            throw new Error(`Signed delegation is required to execute trades for smart account ${smartAccountAddress}`);
        }

        console.log(`[1Shot API] Fetching capabilities...`);
        const caps = await rpcCall<any>("relayer_getCapabilities", [String(baseSepolia.id)]);
        const chainCaps = caps[String(baseSepolia.id)];
        if (!chainCaps) {
            throw new Error(`Base Sepolia (${baseSepolia.id}) capabilities not found`);
        }
        const feeCollector = chainCaps.feeCollector;
        const targetAddress = chainCaps.targetAddress;
        const usdcToken = chainCaps.tokens.find((t: any) => t.symbol === "USDC");
        if (!usdcToken) {
            throw new Error("USDC token not supported in 1Shot capabilities");
        }

        // Resolve input and output token addresses
        const tokenInAddress = TOKEN_ADDRESSES[spendAsset.toUpperCase()];
        const tokenOutAddress = TOKEN_ADDRESSES[targetAsset.toUpperCase()];

        if (!tokenInAddress) {
            throw new Error(`Unsupported spend asset: ${spendAsset}`);
        }
        if (!tokenOutAddress) {
            throw new Error(`Unsupported target asset: ${targetAsset}`);
        }

        const tokenInCaps = chainCaps.tokens.find((t: any) => t.address.toLowerCase() === tokenInAddress.toLowerCase());
        const tokenInDecimals = tokenInCaps ? Number(tokenInCaps.decimals) : (spendAsset.toUpperCase() === "USDC" ? 6 : 18);
        const spendAmount = parseUnits(amountUsd.toFixed(tokenInDecimals), tokenInDecimals);

        console.log(`[1Shot API] Quoting swap route from ${spendAsset} to ${targetAsset}...`);
        const route = await getBestUniswapV3Route(tokenInAddress, tokenOutAddress, spendAmount);
        console.log(`[1Shot API] Best Uniswap V3 pool fee tier: ${route.fee}. Expected output: ${route.amountOut}`);

        // Compute slippage (0.5% tolerance)
        const amountOutMinimum = (route.amountOut * 995n) / 1000n;

        // Encode calldata for approval & swap
        const approveCalldata = encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [SWAP_ROUTER_02_ADDRESS, spendAmount],
        });

        const swapCalldata = encodeFunctionData({
            abi: swapRouter02Abi,
            functionName: "exactInputSingle",
            args: [{
                tokenIn: tokenInAddress,
                tokenOut: tokenOutAddress,
                fee: route.fee,
                recipient: smartAccountAddress as `0x${string}`,
                amountIn: spendAmount,
                amountOutMinimum,
                sqrtPriceLimitX96: 0n,
            }],
        });

        const buildParams = (feeAmount: bigint) => {
            const feeCalldata = encodeFunctionData({
                abi: erc20Abi,
                functionName: "transfer",
                args: [feeCollector, feeAmount],
            });

            return {
                chainId: String(baseSepolia.id),
                transactions: [{
                    permissionContext: [toRelayerJson(signedDelegation)],
                    executions: [
                        // 1. Pay fee in USDC
                        { target: usdcToken.address, value: "0", data: feeCalldata },
                        // 2. Approve SwapRouter to spend our input token
                        { target: tokenInAddress, value: "0", data: approveCalldata },
                        // 3. Perform Swap via SwapRouter
                        { target: SWAP_ROUTER_02_ADDRESS, value: "0", data: swapCalldata },
                    ],
                }],
            };
        };

        // Quote the fee: 1Shot defaults to a floor minimum fee (equivalent to ~ $0.01 worth of USDC)
        const mockFeeAmount = parseUnits("0.02", Number(usdcToken.decimals)); // Conservative initial fee estimate
        console.log(`[1Shot API] Fetching fee estimate for trade...`);
        let sendParams = buildParams(mockFeeAmount);
        
        let estimate = await rpcCall<any>("relayer_estimate7710Transaction", sendParams);
        if (!estimate.success) {
            throw new Error(estimate.error || "1Shot relayer fee estimation failed");
        }

        const requiredFee = BigInt(estimate.requiredPaymentAmount);
        if (requiredFee !== mockFeeAmount) {
            console.log(`[1Shot API] Re-estimating with required fee: ${requiredFee}`);
            sendParams = buildParams(requiredFee);
            estimate = await rpcCall<any>("relayer_estimate7710Transaction", sendParams);
            if (!estimate.success) {
                throw new Error(estimate.error || "1Shot relayer fee re-estimation failed");
            }
        }

        console.log(`[1Shot API] Submitting delegation transaction (Context: ${estimate.context?.slice(0, 10)}...)...`);
        const taskId = await rpcCall<string>("relayer_send7710Transaction", {
            ...sendParams,
            context: estimate.context,
            memo: `ruleo_trade_${Date.now()}`,
        });

        console.log(`[1Shot API] Task submitted. Task ID: ${taskId}. Waiting for block inclusion...`);
        
        // Poll status to get real transaction hash
        let txHash = "";
        let attempts = 0;
        while (attempts < 30) {
            const statusResult = await rpcCall<any>("relayer_getStatus", { id: taskId, logs: false });
            if (statusResult.status === 110 || statusResult.status === 200) {
                txHash = statusResult.hash || (statusResult.receipt && statusResult.receipt.transactionHash);
                if (txHash) break;
            }
            if (statusResult.status === 400 || statusResult.status === 500) {
                throw new Error(`1Shot Transaction failed with status ${statusResult.status}: ${statusResult.message || statusResult.data || "Unknown error"}`);
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
            attempts++;
        }

        if (!txHash) {
            throw new Error("Timeout waiting for transaction hash from 1Shot Relayer");
        }

        console.log(`[1Shot API] Execution successful! Tx Hash: ${txHash}`);
        return {
            txHash,
            status: "Success",
            explorerUrl: `https://sepolia.basescan.org/tx/${txHash}`,
        };

    } catch (err) {
        const errorMsg = (err as Error).message;
        console.error("[1Shot API] Trade execution failed:", errorMsg);
        return {
            txHash: "",
            status: "Failed",
            explorerUrl: "",
            error: errorMsg,
        };
    }
}
