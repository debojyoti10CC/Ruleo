import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { toMetaMaskSmartAccount, Implementation } from "@metamask/smart-accounts-kit";

// Setup Base Sepolia public client
export const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http("https://sepolia.base.org"),
});

/**
 * Initializes a MetaMask Smart Account instance counterfactually for a given owner.
 */
export async function getSmartAccount(ownerAddress: string) {
    if (!ownerAddress.startsWith("0x")) {
        throw new Error("Invalid owner address: must start with 0x");
    }

    const smartAccount = await toMetaMaskSmartAccount({
        client: publicClient as any,
        implementation: Implementation.Hybrid,
        deployParams: [ownerAddress as `0x${string}`, [], [], []],
        deploySalt: "0x0000000000000000000000000000000000000000000000000000000000000000",
    });

    return smartAccount;
}
