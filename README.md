# Ruleo — Zero-Trust DeFi Autopilot Agent

<div align="center">

![Ruleo Logo](https://img.shields.io/badge/Ruleo-DeFi%20Autopilot-orange?style=for-the-badge)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MetaMask](https://img.shields.io/badge/MetaMask-Smart%20Accounts-F6851B?logo=metamask)](https://docs.metamask.io/smart-accounts-kit/)
[![1Shot Relayer](https://img.shields.io/badge/1Shot-EIP--7710-blue)](https://relayer.1shotapi.dev)
[![Uniswap V3](https://img.shields.io/badge/Uniswap-V3-FF007A?logo=uniswap)](https://uniswap.org/)
[![License](https://img.shields.io/badge/License-MIT-green)](#license)

[Live TMA Demo](https://f38326ae29c457.lhr.life) • [Quick Start](#-installation--quick-start) • [Architecture](#-architecture) • [Security Model](#-zero-custody-security-model) • [Contact](#-contact)

**Turn plain-English trading strategies into secure, on-chain autonomous agents with zero private-key exposure.**

A non-custodial automation suite built using the MetaMask Smart Accounts Kit, Venice AI, and the 1Shot gasless relayer.

</div>

---

## ✨ Features

- **Non-Custodial Delegations** — No private keys are ever stored or exposed on the backend database. Users sign standard ERC-7715 delegations locally.
- **Natural Language Parsing** — Compile English rules (e.g. *"buy $50 ETH weekly"*) into structured parameters using Venice AI / Groq Llama-3.3-70b.
- **Deterministic Cryptographic Caveats** — Pure, deterministic mapping of intent to smart contract boundaries:
  - **Spending Limits** (e.g. Capped to $69/week)
  - **Temporal Schedules** (e.g. Executing only on Fridays)
  - **Price Floors & Ceilings** (e.g. Checking Chainlink oracle price boundaries like BTC < $61,000)
- **x402 Micropayments Billing** — Integrates a gasless virtual credit ledger to sponsor AI compilation cycles.
- **Uniswap V3 Auto-Routing** — Dynamically queries multi-tier fee pools to lock in optimal swap rates on Base Sepolia.
- **1Shot EIP-7710 Multi-Leg Execution** — Broadcasts gas-abstracted EIP-7710 delegated batches (ERC-20 approvals + swaps + gas-reimbursement) in a single transaction.

---

## 🏗️ Architecture

Ruleo leverages a decentralized intent pipeline to bridge natural language instructions with cryptographically enforced smart accounts:

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Telegram as Telegram Bot
    participant Venice as Venice AI
    participant TMA as Telegram Mini App (MetaMask)
    participant Backend as Ruleo Backend Engine
    participant Relayer as 1Shot EIP-7710 Relayer
    participant Chain as Base Sepolia (Uniswap V3)

    User->>Telegram: Send strategy: "Buy ETH on Fridays if BTC < $61k (Max $69/week)"
    Telegram->>Backend: Deduct x402 credit & forward text
    Backend->>Venice: Parse strategy text
    Venice-->>Backend: Return JSON structure
    Backend-->>Telegram: Reply with parsed confirmation & TMA URL
    User->>TMA: Open App & Connect MetaMask Wallet
    TMA->>Backend: Fetch pending delegation typed-data
    Backend-->>TMA: Return EIP-712 typed parameters
    User->>TMA: Sign delegation (eth_signTypedData_v4)
    TMA->>Backend: Submit signature & destroy session keys
    Backend->>Backend: Register active agent task
    Note over Backend, Chain: Trigger active monitoring loop
    loop Price & Schedule Monitor
        Backend->>Chain: Query BTC/ETH prices & time state
        alt All conditions matched (Friday & BTC < $61k)
            Backend->>Backend: Prepare Swap payload & load Signature
            Backend->>Relayer: Broadcast EIP-7710 sponsored transaction payload
            Relayer->>Chain: Submit batch (Approve + Swap + Fee refund)
            Chain-->>Backend: Success Tx Receipt
            Backend->>Telegram: Notify User with Basescan link
        end
    end
```

---

## 📂 Project Structure

```
vibecode/
├── public/                 // Glassmorphic Mini App client
│   ├── index.html          // Main viewport and UI layout
│   ├── app.js              // MetaMask EIP-712 signer integration
│   └── style.css           // Theme styling, layouts & animations
├── src/
│   ├── metamask/
│   │   ├── smart-account.ts // Counterfactual hybrid wallet initializer
│   │   └── delegation.ts    // ERC-7715 caveat mapper
│   ├── relayer/
│   │   └── one-shot.ts      // Uniswap V3 pathfinder & 1Shot broadcaster
│   └── webhooks/
│       └── oneshot-webhook.ts // Status event callback listener
├── a2a-coordinator.ts      // Core monitoring scheduler & transaction trigger
├── agent-wallet.ts         // Virtual balance ledgers & x402 billing logic
├── caveat-generator.ts     // Converts strategy schema to ERC-7715 caveats
├── formatter.ts            // Bot text visual format utility
├── index.ts                // Main express server & Telegraf runner
├── llm-parser.ts           // Venice/Groq LLM completion compiler
├── rule-schema.ts          // Zod structures definition
├── validator.ts            // Semantic compiler validation rule checks
├── tsconfig.json           // TS compilation config
└── package.json            // Manifest and dependencies
```

---

## 🔒 Zero-Custody Security Model

Traditional autonomous agents require you to share your private keys or seed phrases with the cloud backend to execute trades on your behalf. **Ruleo completely eliminates this attack vector.**

1. **Counterfactual Addressing**: A unique smart account address is derived natively using your EOA. No transactions are initialized until deployment.
2. **Cryptographic Caveats**: You sign a specific, time-bounded permission delegation containing rules (e.g. *you only allow swaps on Uniswap V3, only up to $69, and only on Base Sepolia*).
3. **No Key Storage**: The backend stores the signature (`signedDelegation`) and the caveats. The backend cannot call arbitrary functions, steal your tokens, or run unapproved transactions.

---

## 🚀 Installation & Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/debojyoti10CC/Ruleo.git
cd Ruleo
npm install
```

### 2. Configure Environment

Create a `.env` file in the root directory (or copy the example):

```bash
cp .env.example .env
```

Fill in your respective API keys:
- `BOT_TOKEN`: Your bot credentials from `@BotFather`
- `GROQ_API_KEY` or `VENICE_API_KEY`: Model inference key for compilation
- `PRIVATE_KEY`: A temporary sponsorship gas wallet address

### 3. Spin up local development server

```bash
npm run dev
```

### 4. Expose the server tunnel (For Telegram Mini App)

Since Telegram requires HTTPS to load Mini Apps, run a local tunnel to port `3000`:

```bash
ssh -o StrictHostKeyChecking=no -R 80:localhost:3000 nokey@localhost.run
```

Update your `.env`'s `TUNNEL_URL` parameter with the allocated domain and restart the server.

---

## ⚙️ How It Works (Caveat Setup)

Below is how the parsed text rules map to strict ERC-7715 constraints under the hood:

| User Intent | Mapped Caveat Type | Enforced Parameters |
| :--- | :--- | :--- |
| **Max $69/week** | `erc20-token-periodic` | Period Duration: `604800s`, Allowance: `69.00 USDC` |
| **Only on Fridays** | `temporal` | Day constraint: `friday`, Expiry timestamp calculated |
| **BTC < $61,000** | `price-condition` | Asset: `BTC`, Condition: `priceBelow = 61000` |

---

## 🤝 Contributing

We welcome contributions from the community to expand the boundaries of non-custodial automated trading.

1. **Fork** the repository.
2. Create your **feature branch** (`git checkout -b feature/CoolAutomation`).
3. **Commit** your changes (`git commit -m 'Add support for Limit orders'`).
4. **Push** to the branch (`git push origin feature/CoolAutomation`).
5. Open a **Pull Request**.

---

## 📞 Contact

**IEEE IEM Student Branch / Ruleo Contributors**
* **Repository:** [debojyoti10CC/Ruleo](https://github.com/debojyoti10CC/Ruleo)
* **Demo App:** [Telegram Mini App](https://f38326ae29c457.lhr.life)

---

*Ruleo — DeFi Autopilot with Zero Custody* 🦊⚡
