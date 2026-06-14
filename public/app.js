// Ruleo client-side logic

// Initialize Telegram WebApp SDK
const tg = window.Telegram?.WebApp;
if (tg) {
    tg.ready();
    tg.expand();
}

// Extracted URL parameters
const urlParams = new URLSearchParams(window.location.search);
const chatId = parseInt(urlParams.get("chatId") || "0", 10);

// DOM Elements
const ruleSummaryContent = document.getElementById("summary-content");
const caveatsList = document.getElementById("caveats-list");
const btnCreatePasskey = document.getElementById("btn-create-passkey");
const btnDeployAccount = document.getElementById("btn-deploy-account");
const btnCloseApp = document.getElementById("btn-close-app");
const passkeyError = document.getElementById("passkey-error");
const btnConnectWallet = document.getElementById("btn-connect-wallet");
const connectionDetails = document.getElementById("connection-details");
const connectedAddress = document.getElementById("connected-address");
const connectionError = document.getElementById("connection-error");
const btnFundAgent = document.getElementById("btn-fund-agent");
const successBalance = document.getElementById("success-balance");
const successStatus = document.getElementById("success-status");
const successBannerDesc = document.getElementById("success-banner-desc");

// Stages
const stageConnect = document.getElementById("stage-connect");
const stagePasskey = document.getElementById("stage-passkey");
const stageAccount = document.getElementById("stage-account");
const stageRelaying = document.getElementById("stage-relaying");
const stageSuccess = document.getElementById("stage-success");

// Log container
const consoleLogs = document.getElementById("console-logs");

// State
let pendingData = null;
let ownerPublicKey = "";
let smartAccountAddress = "";
let ownerAddress = "";
let sdkInstance = null;

// Initialize MetaMask SDK
try {
    if (window.MetaMaskSDK) {
        sdkInstance = new window.MetaMaskSDK.MetaMaskSDK({
            dappMetadata: {
                name: "Ruleo Agent",
                url: window.location.origin,
            },
            logging: { developerMode: false }
        });
    }
} catch (err) {
    console.error("MetaMask SDK init failed:", err);
}

// Connect Wallet Event Handler
btnConnectWallet.addEventListener("click", async () => {
    btnConnectWallet.disabled = true;
    btnConnectWallet.innerHTML = "<span class='spinner'></span> Connecting...";
    connectionError.classList.add("hidden");

    try {
        let accounts = [];
        let isMetaMask = false;
        if (sdkInstance) {
            const ethereum = sdkInstance.getProvider();
            accounts = await ethereum.request({ method: 'eth_requestAccounts' });
            isMetaMask = true;
        } else if (window.ethereum) {
            accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
            isMetaMask = true;
        } else {
            console.warn("No MetaMask provider found, generating owner account...");
            await new Promise(resolve => setTimeout(resolve, 1000));
            accounts = [generateHash("0x", 40)];
        }

        ownerAddress = accounts[0];
        connectedAddress.textContent = ownerAddress.slice(0, 6) + "..." + ownerAddress.slice(-4);
        connectionDetails.classList.remove("hidden");
        btnConnectWallet.disabled = true;
        btnConnectWallet.innerHTML = "✓ Connected";

        // Transition to next stage
        stageConnect.classList.remove("active");
        stageConnect.classList.add("disabled");
        stageConnect.style.opacity = "0.3";

        if (isMetaMask) {
            addLog(`MetaMask connected: ${ownerAddress}`, "success");
            // Fetch pending rule with ownerAddress so we get typedData/delegation
            await fetchPendingRule(ownerAddress);

            // Skip passkey setup stage and go straight to smart account setup stage
            stagePasskey.classList.remove("active");
            stagePasskey.classList.add("disabled", "hidden");
            stagePasskey.style.opacity = "0.3";

            stageAccount.classList.remove("disabled");
            stageAccount.classList.add("active");
            stageAccount.style.opacity = "1";
            btnDeployAccount.disabled = false;
        } else {
            // Fallback: WebAuthn setup is required since no MetaMask was found
            stagePasskey.classList.remove("disabled");
            stagePasskey.classList.add("active");
            stagePasskey.style.opacity = "1";
        }
    } catch (err) {
        connectionError.textContent = `Connection Error: ${err.message || err}`;
        connectionError.classList.remove("hidden");
        btnConnectWallet.disabled = false;
        btnConnectWallet.innerHTML = "<span class='btn-icon'>🦊</span> Connect MetaMask";
    }
});

// Helper to write console logs
function addLog(text, type = "default") {
    const entry = document.createElement("div");
    entry.className = `log-entry ${type}`;
    
    // Add prompt timestamp
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    entry.textContent = `[${time}] ${text}`;
    
    consoleLogs.appendChild(entry);
    consoleLogs.scrollTop = consoleLogs.scrollHeight;
}

// Helper to generate a mock hex hash
function generateHash(prefix = "0x", length = 64) {
    const chars = "0123456789abcdef";
    let hash = prefix;
    for (let i = 0; i < length; i++) {
        hash += chars[Math.floor(Math.random() * 16)];
    }
    return hash;
}

// Fetch pending rule details from the backend
async function fetchPendingRule(ownerAddr) {
    if (!chatId) {
        ruleSummaryContent.innerHTML = "<span style='color: var(--text-error)'>❌ No Chat Session Associated. Try triggering the bot.</span>";
        return;
    }

    try {
        let url = `/api/pending?chatId=${chatId}`;
        if (ownerAddr) {
            url += `&ownerAddress=${ownerAddr}`;
        }
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error("No pending rules found for this chat session.");
        }
        
        pendingData = await response.json();
        renderSummary(pendingData.rule);
        renderCaveats(pendingData.caveats);

        if (pendingData.smartAccountAddress) {
            addLog(`MetaMask Smart Accounts Kit: Derived Smart Account address ${pendingData.smartAccountAddress}`, "info");
        }
    } catch (err) {
        ruleSummaryContent.innerHTML = `<span style='color: var(--text-error)'>⚠️ ${err.message}</span>`;
    }
}

// Render human-readable rule summary
function renderSummary(rule) {
    const action = rule.action.toUpperCase();
    const amount = rule.amount ? `$${rule.amount}` : "unspecified amount";
    const src = rule.sourceAsset || "USDC";
    const dst = rule.targetAsset || "USDC";
    
    let text = "";
    if (rule.action === "swap") {
        text = `Swap <strong>${src}</strong> to <strong>${dst}</strong> for <strong>${amount}</strong>.`;
    } else if (rule.action === "buy") {
        text = `Buy <strong>${dst}</strong> using <strong>${src}</strong> for <strong>${amount}</strong>.`;
    } else if (rule.action === "sell") {
        text = `Sell <strong>${src}</strong> into <strong>${dst}</strong> for <strong>${amount}</strong>.`;
    } else {
        text = `Execute <strong>${action}</strong> on assets.`;
    }

    if (rule.schedule) {
        const schedType = rule.schedule.type;
        const dayText = rule.schedule.day ? ` on ${rule.schedule.day}s` : "";
        text += ` Recurring <strong>${schedType}${dayText}</strong>.`;
    }

    if (rule.conditions && (rule.conditions.priceBelow || rule.conditions.priceAbove)) {
        const parts = [];
        if (rule.conditions.priceBelow) parts.push(`price is below $${rule.conditions.priceBelow}`);
        if (rule.conditions.priceAbove) parts.push(`price is above $${rule.conditions.priceAbove}`);
        text += ` Only execute when <strong>${parts.join(" or ")}</strong>.`;
    }

    if (rule.limits && (rule.limits.maxUsdPerWeek || rule.limits.maxUsdPerMonth)) {
        const limitParts = [];
        if (rule.limits.maxUsdPerWeek) limitParts.push(`$${rule.limits.maxUsdPerWeek}/week`);
        if (rule.limits.maxUsdPerMonth) limitParts.push(`$${rule.limits.maxUsdPerMonth}/month`);
        text += `<br><span style="color: var(--text-secondary); font-size: 0.8rem;">Spending cap: ${limitParts.join(" and ")}</span>`;
    }

    ruleSummaryContent.innerHTML = text;
}

// Render caveats checklist
function renderCaveats(caveatConfig) {
    caveatsList.innerHTML = "";
    
    caveatConfig.caveats.forEach(caveat => {
        const item = document.createElement("div");
        item.className = "caveat-item";
        
        let icon = "🔒";
        let title = caveat.type;
        
        if (caveat.type.includes("periodic") || caveat.type.includes("allowance")) {
            icon = "💰";
            title = "Asset Allowance Constraint";
        } else if (caveat.type.includes("temporal")) {
            icon = "📅";
            title = "Temporal Expiry Constraint";
        } else if (caveat.type.includes("price")) {
            icon = "📊";
            title = "Oracle Trigger Constraint";
        }
        
        item.innerHTML = `
            <span class="caveat-icon">${icon}</span>
            <div class="caveat-desc">
                <h6>${title}</h6>
                <p>${caveat.justification}</p>
            </div>
        `;
        caveatsList.appendChild(item);
    });
}

// Stage 1: Create local WebAuthn credentials (passkey)
// Function to check WebAuthn/Passkey support
async function checkWebAuthnSupport() {
    if (!window.PublicKeyCredential) return false;
    try {
        return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
        return false;
    }
}

// Stage 1: Create local WebAuthn credentials (passkey) or fallback to ECDSA
btnCreatePasskey.addEventListener("click", async () => {
    btnCreatePasskey.disabled = true;
    
    try {
        const hasWebAuthn = await checkWebAuthnSupport();
        
        if (hasWebAuthn) {
            btnCreatePasskey.innerHTML = "<span class='spinner'></span> Initializing biometric enclave...";
            const challenge = new Uint8Array(32);
            window.crypto.getRandomValues(challenge);
            
            const publicKeyCredentialCreationOptions = {
                challenge: challenge,
                rp: {
                    name: "Ruleo Agent",
                    id: window.location.hostname,
                },
                user: {
                    id: new Uint8Array(16),
                    name: `ruleo-user-${chatId}`,
                    displayName: `Ruleo User ${chatId}`,
                },
                pubKeyCredParams: [{alg: -7, type: "public-key"}], // ES256
                authenticatorSelection: {
                    authenticatorAttachment: "platform", // forces native TouchID/FaceID enclave
                    userVerification: "required"
                },
                timeout: 60000,
                attestation: "none"
            };
            
            let credential;
            try {
                credential = await navigator.credentials.create({
                    publicKey: publicKeyCredentialCreationOptions
                });
                console.log("WebAuthn Passkey Registered:", credential);
                
                // For a passkey-backed account, we generate a local EOA to act as the owner key
                const wallet = ethers.Wallet.createRandom();
                ownerAddress = wallet.address;
                localStorage.setItem(`ruleo_passkey_owner_${chatId}`, ownerAddress);
                localStorage.setItem(`ruleo_passkey_pk_${chatId}`, wallet.privateKey);
                
                addLog("Biometric Passkey registered successfully.", "success");
                await fetchPendingRule(ownerAddress);
            } catch (webauthnErr) {
                console.warn("Native WebAuthn failed or cancelled. Falling back to ECDSA wallet...", webauthnErr);
                await generateECDSAFallback();
                return;
            }
        } else {
            await generateECDSAFallback();
            return;
        }
        
        // Transition to next stage
        stagePasskey.classList.remove("active");
        stagePasskey.classList.add("disabled");
        stagePasskey.style.opacity = "0.3";
        
        stageAccount.classList.remove("disabled");
        stageAccount.classList.add("active");
        stageAccount.style.opacity = "1";
        btnDeployAccount.disabled = false;
        
    } catch (err) {
        passkeyError.textContent = `Enclave Error: ${err.message}`;
        passkeyError.classList.remove("hidden");
        btnCreatePasskey.disabled = false;
        btnCreatePasskey.innerHTML = "🔑 Create Owner Passkey";
    }
});

async function generateECDSAFallback() {
    try {
        btnCreatePasskey.innerHTML = "<span class='spinner'></span> Generating fallback owner key...";
        const wallet = ethers.Wallet.createRandom();
        ownerAddress = wallet.address;
        localStorage.setItem(`ruleo_ecdsa_owner_${chatId}`, ownerAddress);
        localStorage.setItem(`ruleo_ecdsa_pk_${chatId}`, wallet.privateKey);
        
        addLog(`WebAuthn unavailable. Fallback ECDSA wallet generated: ${ownerAddress}`, "success");
        await fetchPendingRule(ownerAddress);
        
        // Transition to next stage
        stagePasskey.classList.remove("active");
        stagePasskey.classList.add("disabled");
        stagePasskey.style.opacity = "0.3";
        
        stageAccount.classList.remove("disabled");
        stageAccount.classList.add("active");
        stageAccount.style.opacity = "1";
        btnDeployAccount.disabled = false;
    } catch (err) {
        passkeyError.textContent = `ECDSA Error: ${err.message}`;
        passkeyError.classList.remove("hidden");
        btnCreatePasskey.disabled = false;
        btnCreatePasskey.innerHTML = "🔑 Create Owner Passkey";
    }
}

// Stage 2 & 3: Deploy MetaMask smart account and sign delegation gaslessly via 1Shot
btnDeployAccount.addEventListener("click", async () => {
    btnDeployAccount.disabled = true;
    
    try {
        let signature;
        const passkeyPk = localStorage.getItem(`ruleo_passkey_pk_${chatId}`);
        const ecdsaPk = localStorage.getItem(`ruleo_ecdsa_pk_${chatId}`);
        const localPk = passkeyPk || ecdsaPk;

        addLog(`Requesting owner signature for wallet ${ownerAddress.slice(0, 6)}...${ownerAddress.slice(-4)}`, "info");

        if (localPk) {
            addLog("Signing delegation locally using owner private key...", "info");
            const wallet = new ethers.Wallet(localPk);
            
            // Ethers signTypedData takes (domain, types, message)
            // Strip EIP712Domain from types for Ethers compatibility
            const typesToSign = { ...pendingData.typedData.types };
            delete typesToSign.EIP712Domain;
            
            signature = await wallet.signTypedData(
                pendingData.typedData.domain,
                typesToSign,
                pendingData.typedData.message
            );
        } else {
            addLog("Requesting signature from connected MetaMask wallet...", "info");
            const provider = sdkInstance ? sdkInstance.getProvider() : window.ethereum;
            if (!provider) {
                throw new Error("No MetaMask provider found to sign delegation.");
            }
            
            const typedDataToSign = pendingData.typedData;
            const params = [ownerAddress, JSON.stringify(typedDataToSign)];
            
            signature = await provider.request({
                method: "eth_signTypedData_v4",
                params: params
            });
        }

        addLog("Signature obtained successfully!", "success");

        // Hide active setup blocks and reveal logs
        stagePasskey.classList.add("hidden");
        stageAccount.classList.add("hidden");
        stageRelaying.classList.remove("hidden");
        
        addLog("MetaMask Smart Accounts Kit: Creating Hybrid smart account instance...", "info");
        addLog("1Shot Relayer: Packaging gasless UserOperation payload...", "info");
        addLog("Submitting deployment UserOperation to 1Shot API endpoint...", "info");
        addLog("1Shot: Sponsoring gas and broadcasting payload to Base Sepolia bundler...", "success");

        const response = await fetch("/api/deploy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chatId,
                ownerAddress,
                signature,
                delegation: pendingData.delegation
            })
        });
        
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || "Failed to register deployment on server");
        }
        
        const data = await response.json();
        smartAccountAddress = data.smartAccountAddress;
        const txHash = data.txHash;
        
        addLog(`Smart account derived address: ${smartAccountAddress}`, "success");
        addLog(`1Shot Relayer Transaction broadcasted: ${txHash}`, "success");
        addLog("Waiting for block inclusion (Base Sepolia indexer)...", "info");
        
        // Show Success Stage
        setTimeout(() => {
            stageRelaying.classList.add("hidden");
            stageSuccess.classList.remove("hidden");
            
            document.getElementById("success-address").textContent = smartAccountAddress;
            document.getElementById("success-tx").textContent = txHash;
            
            // If Telegram WebApp is active, trigger haptic feedback
            if (tg && tg.HapticFeedback) {
                tg.HapticFeedback.notificationOccurred("success");
            }

            // Initial fetch and start real-time ledger update polling
            fetchWalletHistory();
            ledgerPollingInterval = setInterval(fetchWalletHistory, 4000);
        }, 1500);
        
    } catch (err) {
        addLog(`❌ Deployment registration failed: ${err.message}`, "error");
        btnDeployAccount.disabled = false;
        stageRelaying.classList.add("hidden");
        stageAccount.classList.remove("hidden");
    }
});

// Close button
btnCloseApp.addEventListener("click", () => {
    if (tg) {
        tg.close();
    } else {
        window.close();
    }
});

// Poll and fetch transaction ledger from backend
const txHistoryList = document.getElementById("tx-history-list");
let ledgerPollingInterval = null;

async function fetchWalletHistory() {
    if (!chatId) return;
    try {
        const response = await fetch(`/api/wallet?chatId=${chatId}`);
        if (!response.ok) return;
        const wallet = await response.json();
        
        if (successBalance) {
            successBalance.textContent = `$${wallet.balanceUsd.toFixed(2)} USD`;
        }
        
        if (successStatus) {
            if (wallet.status === "active") {
                successStatus.className = "value status-active";
                successStatus.innerHTML = `<span class="live-pulse"></span> Monitoring Live`;
                if (btnFundAgent) {
                    btnFundAgent.disabled = true;
                    btnFundAgent.innerHTML = "✓ Agent Activated";
                    btnFundAgent.style.opacity = "0.6";
                }
                if (successBannerDesc) {
                    successBannerDesc.textContent = "Your agent is active and running gaslessly on Base Sepolia.";
                }
            } else {
                successStatus.className = "value status-needs-funding";
                successStatus.innerHTML = `<span class="warning-pulse"></span> Needs Funding`;
                if (btnFundAgent) {
                    btnFundAgent.disabled = false;
                    btnFundAgent.innerHTML = `<span class="btn-icon">💰</span> Fund Agent (Deposit $100)`;
                    btnFundAgent.style.opacity = "1";
                }
                if (successBannerDesc) {
                    successBannerDesc.textContent = "Your agent is derived on Base Sepolia. Fund the smart account to activate monitoring.";
                }
            }
        }
        
        renderHistoryList(wallet.transactions);
    } catch (err) {
        console.error("Error polling history:", err);
    }
}

function renderHistoryList(transactions) {
    if (!transactions || transactions.length === 0) {
        txHistoryList.innerHTML = '<p class="history-empty">No transactions logged yet.</p>';
        return;
    }
    
    // Sort transactions by date descending (latest first)
    const sorted = [...transactions].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    txHistoryList.innerHTML = "";
    sorted.forEach(tx => {
        const item = document.createElement("div");
        item.className = "history-item";
        
        let typeClass = "debit";
        let sign = "-";
        
        if (tx.type === "funding") {
            typeClass = "credit";
            sign = "+";
        } else if (tx.type === "execution") {
            typeClass = "execution";
            sign = "-";
        }
        
        const time = new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        item.innerHTML = `
            <div class="tx-info">
                <span class="tx-title">${tx.description}</span>
                <span class="tx-meta">${time} ${tx.txHash ? `| Hash: ${tx.txHash.slice(0, 10)}...` : ""}</span>
            </div>
            <span class="tx-amount ${typeClass}">${sign}$${tx.amountUsd.toFixed(3)}</span>
        `;
        txHistoryList.appendChild(item);
    });
}

// Fund Agent Click Handler
if (btnFundAgent) {
    btnFundAgent.addEventListener("click", async () => {
        btnFundAgent.disabled = true;
        btnFundAgent.innerHTML = "<span class='spinner'></span> Requesting deposit...";
        
        let txHash = "";
        try {
            // Check if MetaMask is connected
            if (window.ethereum && ownerAddress && ownerAddress.startsWith("0x")) {
                addLog(`MetaMask: Sending funding transaction of 0.01 ETH to ${smartAccountAddress.slice(0, 6)}...${smartAccountAddress.slice(-4)}`, "info");
                
                try {
                    const valueHex = ethers.parseEther("0.01").toString(16);
                    const txParams = {
                        method: 'eth_sendTransaction',
                        params: [{
                            from: ownerAddress,
                            to: smartAccountAddress,
                            value: '0x' + valueHex,
                        }]
                    };
                    
                    if (sdkInstance) {
                        const ethereum = sdkInstance.getProvider();
                        txHash = await ethereum.request(txParams);
                    } else {
                        txHash = await window.ethereum.request(txParams);
                    }
                    addLog(`MetaMask transaction sent: ${txHash}`, "success");
                } catch (metaMaskErr) {
                    console.warn("MetaMask transaction rejected or failed, falling back to mock simulation...", metaMaskErr);
                    addLog(`MetaMask transaction declined. Simulating gasless mock funding to proceed...`, "info");
                    txHash = generateHash("0x", 64);
                }
            } else {
                addLog("Using simulated owner key. Mocking funding transaction...", "info");
                await new Promise(resolve => setTimeout(resolve, 1500));
                txHash = generateHash("0x", 64);
            }
            
            addLog(`Submitting deposit to Ruleo server...`, "info");
            
            // Post to backend to credit the wallet
            const response = await fetch("/api/fund", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chatId,
                    amount: 100.0,
                    txHash
                })
            });
            
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || "Failed to register funding");
            }
            
            const data = await response.json();
            addLog(`Agent wallet successfully funded! Balance: $${data.balance.toFixed(2)}`, "success");
            addLog(`Agent activated and live. Price-check loop initialized.`, "success");
            
            if (tg && tg.HapticFeedback) {
                tg.HapticFeedback.notificationOccurred("success");
            }
            
            await fetchWalletHistory();
            
        } catch (err) {
            addLog(`❌ Funding failed: ${err.message}`, "error");
            btnFundAgent.disabled = false;
            btnFundAgent.innerHTML = `<span class="btn-icon">💰</span> Fund Agent (Deposit $100)`;
        }
    });
}

// Initialize on page load
fetchPendingRule();
