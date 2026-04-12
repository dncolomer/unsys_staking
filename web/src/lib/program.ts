import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  PROGRAM_ID,
  GLOBAL_CONFIG_PDA,
  UNSYS_MINT,
  USDC_MINT,
} from "./constants";

// Helper to read u64 as little-endian BigInt (browser Buffer polyfill lacks readBigUInt64LE)
function readU64LE(buffer: Buffer, offset: number): bigint {
  let result = 0n;
  for (let i = 0; i < 8; i++) {
    result |= BigInt(buffer[offset + i]) << BigInt(i * 8);
  }
  return result;
}

// Helper to read i64 as little-endian BigInt
function readI64LE(buffer: Buffer, offset: number): bigint {
  const unsigned = readU64LE(buffer, offset);
  // Check sign bit and convert if negative
  if (unsigned >= 0x8000000000000000n) {
    return unsigned - 0x10000000000000000n;
  }
  return unsigned;
}

// Instruction discriminators (from IDL)
const DISCRIMINATORS = {
  stakeDividends: Buffer.from([233, 176, 28, 203, 245, 144, 234, 38]),
  unstakeDividends: Buffer.from([211, 193, 244, 125, 100, 133, 32, 55]),
  claimDividends: Buffer.from([105, 60, 172, 2, 136, 93, 128, 151]),
  stakePartnership: Buffer.from([171, 47, 121, 219, 178, 69, 65, 227]),
  unstakePartnership: Buffer.from([227, 171, 97, 195, 235, 134, 214, 29]),
  claimReferralShare: Buffer.from([164, 164, 85, 221, 178, 135, 229, 175]),
  stakeDataProvider: Buffer.from([243, 153, 142, 230, 23, 165, 210, 34]),
  unstakeDataProvider: Buffer.from([176, 84, 131, 72, 206, 12, 197, 247]),
  enableLegacyBenefits: Buffer.from([150, 202, 53, 108, 92, 100, 249, 169]),
};

// PDA derivation helpers
export function getDividendStakePda(user: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("dividend_stake"), user.toBuffer()],
    PROGRAM_ID,
  );
  return pda;
}

export function getPartnershipStakePda(user: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("partnership_stake"), user.toBuffer()],
    PROGRAM_ID,
  );
  return pda;
}

export function getDataProviderStakePda(user: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("data_provider_stake"), user.toBuffer()],
    PROGRAM_ID,
  );
  return pda;
}

export function getLegacyOmegaStakePda(user: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("legacy_omega"), user.toBuffer()],
    PROGRAM_ID,
  );
  return pda;
}

// Account data parsing
export interface GlobalConfig {
  unsysMint: PublicKey;
  omegaMint: PublicKey;
  usdcMint: PublicKey;
  tokenVault: PublicKey;
  revenueVault: PublicKey;
  totalDividendShares: bigint;
  admin: PublicKey;
  pendingAdmin: PublicKey;
  buybackWallet: PublicKey;
  dividendEpoch: bigint;
  epochDividendPool: bigint;
  epochDividendSnapshot: bigint;
  paused: boolean;
  totalLegacyHolders: bigint;
  bump: number;
}

export interface DividendStake {
  isInitialized: boolean;
  owner: PublicKey;
  amount: bigint;
  shares: bigint;
  lockEnd: bigint;
  multiplierBps: number;
  lastClaimTs: bigint;
  lastClaimEpoch: bigint;
  bump: number;
}

export interface PartnershipStake {
  isInitialized: boolean;
  owner: PublicKey;
  stakedAmount: bigint;
  referrer: PublicKey | null;
  tier: number;
  referralBalance: bigint;
  bump: number;
}

export interface DataProviderStake {
  isInitialized: boolean;
  owner: PublicKey;
  stakedAmount: bigint;
  active: boolean;
  bump: number;
}

// Fetch and parse accounts
export async function fetchGlobalConfig(
  connection: Connection,
): Promise<GlobalConfig | null> {
  const accountInfo = await connection.getAccountInfo(GLOBAL_CONFIG_PDA);
  if (!accountInfo) return null;

  const data = accountInfo.data;
  // Skip 8-byte discriminator
  let offset = 8;

  const unsysMint = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const omegaMint = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const usdcMint = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const tokenVault = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const revenueVault = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const totalDividendShares =
    readU64LE(data, offset) + (data.readBigUInt64LE(offset + 8) << 64n);
  offset += 16;
  const admin = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const pendingAdmin = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const buybackWallet = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const dividendEpoch = readU64LE(data, offset);
  offset += 8;
  const epochDividendPool = readU64LE(data, offset);
  offset += 8;
  const epochDividendSnapshot = readU64LE(data, offset);
  offset += 8;
  const paused = data[offset] === 1;
  offset += 1;
  const totalLegacyHolders = readU64LE(data, offset);
  offset += 8;
  const bump = data[offset];

  return {
    unsysMint,
    omegaMint,
    usdcMint,
    tokenVault,
    revenueVault,
    totalDividendShares,
    admin,
    pendingAdmin,
    buybackWallet,
    dividendEpoch,
    epochDividendPool,
    epochDividendSnapshot,
    paused,
    totalLegacyHolders,
    bump,
  };
}

export async function fetchDividendStake(
  connection: Connection,
  user: PublicKey,
): Promise<DividendStake | null> {
  const pda = getDividendStakePda(user);
  const accountInfo = await connection.getAccountInfo(pda);
  if (!accountInfo) return null;

  const data = accountInfo.data;
  let offset = 8; // Skip discriminator

  const isInitialized = data[offset] === 1;
  offset += 1;
  const owner = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const amount = readU64LE(data, offset);
  offset += 8;
  const shares =
    readU64LE(data, offset) + (data.readBigUInt64LE(offset + 8) << 64n);
  offset += 16;
  const lockEnd = readI64LE(data, offset);
  offset += 8;
  const multiplierBps = data.readUInt16LE(offset);
  offset += 2;
  const lastClaimTs = readI64LE(data, offset);
  offset += 8;
  const lastClaimEpoch = readU64LE(data, offset);
  offset += 8;
  const bump = data[offset];

  return {
    isInitialized,
    owner,
    amount,
    shares,
    lockEnd,
    multiplierBps,
    lastClaimTs,
    lastClaimEpoch,
    bump,
  };
}

export async function fetchPartnershipStake(
  connection: Connection,
  user: PublicKey,
): Promise<PartnershipStake | null> {
  const pda = getPartnershipStakePda(user);
  const accountInfo = await connection.getAccountInfo(pda);
  if (!accountInfo) return null;

  const data = accountInfo.data;
  let offset = 8; // Skip discriminator

  const isInitialized = data[offset] === 1;
  offset += 1;
  const owner = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const stakedAmount = readU64LE(data, offset);
  offset += 8;
  // Option<Pubkey> - Borsh serialization: 1 byte discriminator + 32 bytes ONLY if Some
  const hasReferrer = data[offset] === 1;
  offset += 1;
  const referrer = hasReferrer
    ? new PublicKey(data.subarray(offset, offset + 32))
    : null;
  if (hasReferrer) {
    offset += 32; // Only skip 32 bytes if referrer is present
  }
  const tier = data[offset];
  offset += 1;
  const referralBalance = readU64LE(data, offset);
  offset += 8;
  const bump = data[offset];

  return {
    isInitialized,
    owner,
    stakedAmount,
    referrer,
    tier,
    referralBalance,
    bump,
  };
}

export async function fetchDataProviderStake(
  connection: Connection,
  user: PublicKey,
): Promise<DataProviderStake | null> {
  const pda = getDataProviderStakePda(user);
  const accountInfo = await connection.getAccountInfo(pda);
  if (!accountInfo) return null;

  const data = accountInfo.data;
  let offset = 8; // Skip discriminator

  const isInitialized = data[offset] === 1;
  offset += 1;
  const owner = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const stakedAmount = readU64LE(data, offset);
  offset += 8;
  const active = data[offset] === 1;
  offset += 1;
  const bump = data[offset];

  return {
    isInitialized,
    owner,
    stakedAmount,
    active,
    bump,
  };
}
