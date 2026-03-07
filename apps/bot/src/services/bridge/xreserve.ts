/**
 * Circle xReserve Bridge Service
 * Handles USDCx bridging between Canton Network and Ethereum
 *
 * Documentation:
 * - https://developers.circle.com/xreserve
 * - https://docs.digitalasset.com/usdc/xreserve/workflows.html
 */

import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, keccak256, toBytes } from 'viem';
import { sepolia, mainnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { createLogger } from '@repo/shared/logger';

const logger = createLogger('xreserve-bridge');

// Contract Addresses
export const XRESERVE_CONFIG = {
  // Testnet (Sepolia)
  testnet: {
    xReserveContract: '0x008888878f94C0d87defdf0B07f46B93C1934442' as `0x${string}`,
    usdcContract: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as `0x${string}`,
    chain: sepolia,
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
  },
  // Mainnet - Contract address required for production
  mainnet: {
    // Circle xReserve contract for Canton mainnet
    // IMPORTANT: Set XRESERVE_MAINNET_CONTRACT env var before mainnet deployment
    xReserveContract: (process.env.XRESERVE_MAINNET_CONTRACT || '') as `0x${string}`,
    usdcContract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as `0x${string}`,
    chain: mainnet,
    rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://ethereum-rpc.publicnode.com',
  },
};

/**
 * Validate mainnet xReserve configuration.
 * Throws if mainnet is selected but required config is missing.
 */
export function validateMainnetConfig(): void {
  if (!XRESERVE_CONFIG.mainnet.xReserveContract || XRESERVE_CONFIG.mainnet.xReserveContract === '0x') {
    throw new Error('XRESERVE_MAINNET_CONTRACT env var is required for mainnet deployment');
  }
}

// Domain IDs for xReserve
export const DOMAIN_IDS = {
  canton: 10001,
  ethereum: 0,
};

// USDC has 6 decimals
const USDC_DECIMALS = 6;

// ABI for xReserve contract
const XRESERVE_ABI = [
  {
    name: 'depositToRemote',
    type: 'function',
    inputs: [
      { name: 'value', type: 'uint256' },
      { name: 'remoteDomain', type: 'uint32' },
      { name: 'remoteRecipient', type: 'bytes32' },
      { name: 'localToken', type: 'address' },
      { name: 'maxFee', type: 'uint256' },
      { name: 'hookData', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

// ABI for ERC20 (USDC)
const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'allowance',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

export interface BridgeDepositParams {
  amount: string; // Amount in USDC (e.g., "100.00")
  cantonPartyId: string; // Canton Network party ID
  ethereumPrivateKey: string; // User's Ethereum private key for signing
  isTestnet?: boolean;
}

export interface BridgeWithdrawParams {
  amount: string; // Amount in USDCx
  ethereumAddress: string; // Destination Ethereum address
  cantonPartyId: string; // Canton Network party ID
}

export interface BridgeQuote {
  fromAmount: string;
  toAmount: string;
  fee: string;
  feePercentage: number;
  estimatedTime: string;
  route: string;
}

export interface BridgeTransaction {
  id: string;
  type: 'deposit' | 'withdrawal';
  status: 'pending' | 'confirming' | 'completed' | 'failed';
  fromChain: 'canton' | 'ethereum';
  toChain: 'canton' | 'ethereum';
  fromAmount: string;
  toAmount: string;
  txHash?: string;
  attestation?: string;
  createdAt: Date;
  completedAt?: Date;
}

/**
 * Get bridge quote for Canton <-> Ethereum
 */
export function getBridgeQuote(
  amount: string,
  fromChain: 'canton' | 'ethereum',
  _toChain: 'canton' | 'ethereum' // Reserved for future use when chains have different fees
): BridgeQuote {
  const numAmount = parseFloat(amount);

  // xReserve fee is approximately 0.1-0.2%
  const feePercentage = 0.2;
  const fee = (numAmount * feePercentage / 100).toFixed(6);
  const toAmount = (numAmount - parseFloat(fee)).toFixed(6);

  return {
    fromAmount: amount,
    toAmount,
    fee,
    feePercentage,
    estimatedTime: fromChain === 'ethereum' ? '~15-20 min' : '~5-10 min',
    route: fromChain === 'ethereum'
      ? 'USDC (Ethereum) → xReserve → USDCx (Canton)'
      : 'USDCx (Canton) → xReserve → USDC (Ethereum)',
  };
}

/**
 * Encode Canton party ID as bytes32 for xReserve
 * Canton uses keccak256 hash of the party ID
 */
export function encodeCantonRecipient(partyId: string): `0x${string}` {
  // Remove any prefix and ensure proper format
  const cleanPartyId = partyId.startsWith('0x') ? partyId : `0x${partyId}`;
  return keccak256(toBytes(cleanPartyId));
}

/**
 * Encode hook data for Canton
 * Contains the hex-encoded Canton address
 */
export function encodeCantonHookData(partyId: string): `0x${string}` {
  // Hook data contains the hex-encoded party ID
  const cleanPartyId = partyId.startsWith('0x') ? partyId.slice(2) : partyId;
  return `0x${cleanPartyId}` as `0x${string}`;
}

/**
 * Deposit USDC on Ethereum to receive USDCx on Canton
 */
export async function depositToCanon(params: BridgeDepositParams): Promise<{
  txHash: string;
  status: 'pending' | 'failed';
  error?: string;
}> {
  const { amount, cantonPartyId, ethereumPrivateKey, isTestnet = true } = params;

  // Validate mainnet config if not using testnet
  if (!isTestnet) {
    validateMainnetConfig();
  }

  const config = isTestnet ? XRESERVE_CONFIG.testnet : XRESERVE_CONFIG.mainnet;

  try {
    // Create clients
    const account = privateKeyToAccount(ethereumPrivateKey as `0x${string}`);

    const publicClient = createPublicClient({
      chain: config.chain,
      transport: http(config.rpcUrl),
    });

    const walletClient = createWalletClient({
      account,
      chain: config.chain,
      transport: http(config.rpcUrl),
    });

    // Parse amount to USDC units (6 decimals)
    const amountInUnits = parseUnits(amount, USDC_DECIMALS);

    // Check USDC balance
    const balance = await publicClient.readContract({
      address: config.usdcContract,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [account.address],
    });

    if (balance < amountInUnits) {
      return {
        txHash: '',
        status: 'failed',
        error: `Insufficient USDC balance. Have: ${formatUnits(balance, USDC_DECIMALS)}, Need: ${amount}`,
      };
    }

    // Check allowance
    const allowance = await publicClient.readContract({
      address: config.usdcContract,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account.address, config.xReserveContract],
    });

    // Approve if needed
    if (allowance < amountInUnits) {
      const approveHash = await walletClient.writeContract({
        address: config.usdcContract,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [config.xReserveContract, amountInUnits],
      });

      // Wait for approval confirmation
      await publicClient.waitForTransactionReceipt({ hash: approveHash });
    }

    // Encode Canton recipient and hook data
    const remoteRecipient = encodeCantonRecipient(cantonPartyId);
    const hookData = encodeCantonHookData(cantonPartyId);

    // Max fee (0 for standard transfer)
    const maxFee = parseUnits('0', USDC_DECIMALS);

    // Execute deposit
    const depositHash = await walletClient.writeContract({
      address: config.xReserveContract,
      abi: XRESERVE_ABI,
      functionName: 'depositToRemote',
      args: [
        amountInUnits,
        DOMAIN_IDS.canton,
        remoteRecipient,
        config.usdcContract,
        maxFee,
        hookData,
      ],
    });

    return {
      txHash: depositHash,
      status: 'pending',
    };

  } catch (error) {
    logger.error('Bridge deposit error', error instanceof Error ? error : undefined, { cantonPartyId, amount });
    return {
      txHash: '',
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Check deposit status and attestation
 */
export async function checkDepositStatus(txHash: string, isTestnet = true): Promise<{
  status: 'pending' | 'confirming' | 'completed' | 'failed';
  attestation?: string;
  error?: string;
}> {
  // Validate mainnet config if not using testnet
  if (!isTestnet) {
    validateMainnetConfig();
  }

  const config = isTestnet ? XRESERVE_CONFIG.testnet : XRESERVE_CONFIG.mainnet;

  try {
    const publicClient = createPublicClient({
      chain: config.chain,
      transport: http(config.rpcUrl),
    });

    // Check transaction receipt
    const receipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });

    if (!receipt) {
      return { status: 'pending' };
    }

    if (receipt.status === 'reverted') {
      return { status: 'failed', error: 'Transaction reverted' };
    }

    // Transaction confirmed, now waiting for Circle attestation
    // In production, poll Circle's attestation API
    // For now, return confirming status
    return { status: 'confirming' };

  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Initiate withdrawal from Canton to Ethereum
 * This uses the SDK's burnUSDCx method to create a BurnIntent on Canton.
 *
 * The actual withdrawal is a two-step process:
 * 1. User calls burnUSDCx() to create BurnIntent on Canton
 * 2. Circle xReserve processes the BurnIntent and sends USDC on Ethereum
 *
 * This function handles step 1. Step 2 is automatic and processed by Circle.
 *
 * @param params - Withdrawal parameters
 * @param sdk - The OfficialSDKClient instance
 * @param privateKeyHex - User's Canton private key for signing
 */
export async function initiateWithdrawal(
  params: BridgeWithdrawParams,
  sdk?: {
    burnUSDCx: (
      amount: string,
      ethereumAddress: string,
      partyId: string,
      privateKeyHex: string
    ) => Promise<{ success: boolean; burnRequestId?: string; txHash?: string; error?: string }>;
    hasBridgeUserAgreement: (partyId: string) => Promise<boolean>;
  },
  privateKeyHex?: string
): Promise<{
  requestId: string;
  txHash?: string;
  status: 'pending' | 'failed';
  error?: string;
}> {
  const { amount, ethereumAddress, cantonPartyId } = params;

  // Validate Ethereum address
  if (!ethereumAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
    return {
      requestId: '',
      status: 'failed',
      error: 'Invalid Ethereum address format',
    };
  }

  // If SDK is not provided, return placeholder (for backwards compatibility)
  if (!sdk || !privateKeyHex) {
    logger.warn('SDK not provided, returning placeholder', { cantonPartyId, amount });
    return {
      requestId: `withdraw_${Date.now()}`,
      status: 'pending',
    };
  }

  try {
    // Check if user has bridge agreement
    const hasAgreement = await sdk.hasBridgeUserAgreement(cantonPartyId);
    if (!hasAgreement) {
      return {
        requestId: '',
        status: 'failed',
        error: 'No BridgeUserAgreement found. Please complete bridge onboarding first.',
      };
    }

    // Execute burn through SDK
    const result = await sdk.burnUSDCx(amount, ethereumAddress, cantonPartyId, privateKeyHex);

    if (!result.success) {
      return {
        requestId: '',
        status: 'failed',
        error: result.error || 'Failed to burn USDCx',
      };
    }

    const response: {
      requestId: string;
      txHash?: string;
      status: 'pending' | 'failed';
      error?: string;
    } = {
      requestId: result.burnRequestId || '',
      status: 'pending',
    };

    if (result.txHash) {
      response.txHash = result.txHash;
    }

    return response;
  } catch (error) {
    logger.error('Withdrawal error', error instanceof Error ? error : undefined, { cantonPartyId, amount, ethereumAddress });
    return {
      requestId: '',
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Mint USDCx from a DepositAttestation
 * Called after USDC deposit on Ethereum is confirmed and attestation is available.
 *
 * @param attestationCid - The DepositAttestation contract ID
 * @param partyId - User's Canton party ID
 * @param sdk - The OfficialSDKClient instance
 * @param privateKeyHex - User's Canton private key for signing
 */
export async function mintFromAttestation(
  attestationCid: string,
  partyId: string,
  sdk: {
    mintUSDCx: (
      depositAttestationCid: string,
      partyId: string,
      privateKeyHex: string
    ) => Promise<{ success: boolean; amount?: string; txHash?: string; error?: string }>;
    hasBridgeUserAgreement: (partyId: string) => Promise<boolean>;
  },
  privateKeyHex: string
): Promise<{
  success: boolean;
  txHash?: string;
  amount?: string;
  error?: string;
}> {
  try {
    // Check if user has bridge agreement
    const hasAgreement = await sdk.hasBridgeUserAgreement(partyId);
    if (!hasAgreement) {
      return {
        success: false,
        error: 'No BridgeUserAgreement found. Please complete bridge onboarding first.',
      };
    }

    // Execute mint through SDK
    const result = await sdk.mintUSDCx(attestationCid, partyId, privateKeyHex);

    return result;
  } catch (error) {
    logger.error('Mint error', error instanceof Error ? error : undefined, { attestationCid, partyId });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get supported tokens for bridging
 */
export function getSupportedBridgeTokens() {
  return [
    {
      symbol: 'USDC',
      name: 'USD Coin',
      ethereum: true,
      canton: false, // USDC doesn't exist natively on Canton
    },
    {
      symbol: 'USDCx',
      name: 'USD Coin X',
      ethereum: false, // USDCx doesn't exist on Ethereum
      canton: true,
    },
  ];
}

export default {
  getBridgeQuote,
  depositToCanon,
  checkDepositStatus,
  initiateWithdrawal,
  mintFromAttestation,
  getSupportedBridgeTokens,
  XRESERVE_CONFIG,
  DOMAIN_IDS,
};
