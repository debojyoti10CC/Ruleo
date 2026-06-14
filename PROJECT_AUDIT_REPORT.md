# Technical Audit & Project Status Report: Ruleo Autopilot
**Date:** June 12, 2026  
**Status:** Alpha / Proof-of-Concept  
**Auditor:** Antigravity (AI Coding Assistant)  

---

## 1. Executive Summary
Ruleo is a DeFi automated trading agent bot designed for the Base Sepolia Testnet. It translates plain-English rules (e.g., *"Buy ETH weekly if price is under $2800"*) into automated smart account executions using **MetaMask Smart Accounts (Hybrid/Stateless EIP-7702 implementation)** and the **1Shot EIP-7710 JSON-RPC Relayer**.

While the project successfully integrates real cryptographic smart account derivation, real gas-sponsored contract deployments, real-time price feeds, and real EIP-7710 JSON-RPC relayer calls, **it is still a Proof-of-Concept (PoC)**. Crucial elements of a production-grade automated trading system—most notably **actual DEX swap routing** and **proper state persistence**—are either simulated or heavily simplified.

---

## 2. Real vs. Mocked Connection Audit

| Component | Status | Implementation Details (Honest & Brutal) |
| :--- | :--- | :--- |
| **AI Rule Parser** | **REAL** | Uses a real LLM integration (**Groq API** or **Venice API**) to parse unstructured English text into a structured JSON schema (`Rule` format). |
| **Smart Account Derivation** | **REAL** | Counterfactually derives a real **MetaMask Smart Account** contract address on Base Sepolia using `@metamask/smart-accounts-kit`. The calculation is deterministic and purely cryptographic. |
| **Smart Account Deployment** | **REAL** | The server EOA (`0x5D3f35...`) broadcasts a real transaction on Base Sepolia to the factory contract to deploy the smart contract wallet if it is not already deployed. |
| **Market Data Observer** | **REAL (Hybrid)** | Queries **live, real-time spot prices** for `ETH`, `BTC`, `SOL`, and `LINK` directly from the Coinbase public API every 15 seconds. If the API is rate-limited or offline, it falls back to a simulated random walk. |
| **Gasless Relayer** | **REAL** | Communicates with the actual **1Shot JSON-RPC Relayer** (`https://relayer.1shotapi.dev/relayers`). It queries capabilities, signs EIP-7710 delegation messages using the owner's private key, submits the payload to the estimate and broadcast endpoints, and polls for on-chain block inclusion. |
| **Trade Execution / DEX Swaps** | **MOCKED / SIMULATED** | **Brutal Truth:** There is no actual Uniswap/SushiSwap integration. When a rule is triggered, the relayer simply executes a **poke transaction** (a 0-value call with `0x` data sent to the smart account contract itself). It registers a real transaction hash on Base Sepolia, but **no tokens are actually swapped**. |
| **Ledger Balances** | **MOCKED / SIMULATED** | The user's USD wallet balance ($100.00 virtual deposit) is stored purely in-memory on the backend Node.js process. It does not read actual USDC/USDT balances from the blockchain. |
| **Wallet Funding** | **HYBRID** | Clicking "Fund Agent" in the Mini App prompts a real MetaMask transaction to deposit `0.01 ETH` on Base Sepolia to the smart account address. However, if the user declines or lacks MetaMask, it falls back to a mock transaction hash to proceed with the testing flow. |
| **State Persistence** | **MOCKED / SIMULATED** | All active agents, pending rules, and user wallet data are stored in-memory (`Map` structures). **If the Node.js server restarts, all deployed agents and trade histories are wiped out.** |

---

## 3. Detailed Component Review & Critiques

### A. The "Swap" Illusion (The Biggest Mock)
*   **The Code:** In `src/relayer/one-shot.ts`, `executeTrade` constructs an EIP-7710 transaction that is relayed to the blockchain. 
*   **The Brutal Reality:** The transaction executing the "work" does this:
    ```typescript
    const workCalldata = "0x";
    // Target is the smart account itself
    { target: smartAccountAddress, value: "0", data: workCalldata }
    ```
    This is just a hollow transaction that pokes the smart account contract so it emits a transaction hash. In a production system, `workCalldata` must contain encoded call data targeting a swap router (like Uniswap V3 SwapRouter) to swap `USDC` for `ETH` on Uniswap, including path arrays, deadline, and slippage calculations.

### B. Security & Private Key Custody
*   **The Code:** To enable automated background trading, the frontend extracts the private key of the passkey-backed owner wallet from the browser's `localStorage` and sends it to the server `/api/deploy` endpoint.
*   **The Critique:** Storing the private key in-memory on the server (`wallets` map) is acceptable for a development testnet sandbox, but it is **highly insecure** for a mainnet deployment. If the server is compromised, all owner private keys are exposed.
*   **Production Fix:** Implement a proper non-custodial delegation flow where the user signs an EIP-7710 delegation restricted to *only* call swap functions up to a certain allowance, and the server only stores the signed delegation—**never the private key**.

### C. State Loss on Restart
*   **The Code:**
    ```typescript
    const activeAgents = new Map<string, DeployedAgent>();
    const wallets = new Map<number, AgentWallet>();
    ```
*   **The Critique:** Because all data is kept in-memory, restarting the development server kills all price monitoring loops and wipes out the user's trading ledger.
*   **Production Fix:** Integrate a persistent database (e.g., PostgreSQL or SQLite) to persist `DeployedAgent` schemas, `AgentWallet` records, and transactions.

---

## 4. Production Roadmap (Next Steps)
To convert this Proof-of-Concept into a real-world mainnet DeFi autopilot:

1.  **DEX Swap Integration:**
    *   Integrate `UniswapV3Router` or a DEX aggregator like **1inch API** to fetch real swap routes and generate real execution calldata.
    *   Add token approval steps (`approve`) so the Smart Account allows the swap router to spend its USDC.
2.  **Database Integration:**
    *   Install Prisma/Sequelize and save state to a database so agents survive server crashes.
3.  **Strict Delegation Safety:**
    *   Restructure the app so the client browser wallet signs the EIP-7715 caveats and sends the signed delegation context to the backend. The backend should never see the owner EOA's private key.
