import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  PROGRAM_ID,
  GLOBAL_CONFIG_PDA,
  UNSYS_MINT,
  USDC_MINT,
  UNSYS_VAULT,
  USDC_VAULT,
  UNSYS_DECIMALS,
} from "./constants";
import {
  getDividendStakePda,
  getPartnershipStakePda,
  getDataProviderStakePda,
} from "./program";

// Instruction discriminators - computed from Anchor's sighash("global:<instruction_name>")
// These are the first 8 bytes of sha256("global:<instruction_name>")
const DISCRIMINATORS = {
  stakeDividends: Buffer.from([161, 224, 5, 30, 92, 103, 47, 69]),
  unstakeDividends: Buffer.from([211, 193, 244, 125, 100, 133, 32, 55]),
  claimDividends: Buffer.from([105, 60, 172, 2, 136, 93, 128, 151]),
  stakePartnership: Buffer.from([128, 9, 210, 114, 118, 244, 25, 115]),
  unstakePartnership: Buffer.from([139, 64, 29, 175, 154, 5, 133, 158]),
  closePartnershipStake: Buffer.from([29, 8, 62, 192, 87, 148, 123, 156]),
  claimReferralShare: Buffer.from([228, 210, 199, 63, 193, 255, 205, 166]),
  stakeDataProvider: Buffer.from([239, 111, 156, 41, 135, 169, 76, 82]),
  unstakeDataProvider: Buffer.from([209, 104, 77, 28, 168, 96, 48, 22]),
};

// Helper to write u64 as little-endian bytes (browser Buffer polyfill lacks writeBigUInt64LE)
function writeU64LE(buffer: Buffer, value: bigint, offset: number): void {
  for (let i = 0; i < 8; i++) {
    buffer[offset + i] = Number((value >> BigInt(i * 8)) & 0xffn);
  }
}

/**
 * Create stake dividends transaction
 *
 * Rust struct order:
 * - global_config (mut)
 * - user_stake (mut, init)
 * - user (signer, mut)
 * - unsys_mint
 * - user_unsys_ata (mut)
 * - token_vault (mut)
 * - token_program
 * - system_program
 */
export async function createStakeDividendsTransaction(
  connection: Connection,
  user: PublicKey,
  amount: number,
  lockMonths: number,
): Promise<Transaction> {
  const userStakePda = getDividendStakePda(user);
  const userUnsysAta = getAssociatedTokenAddressSync(
    UNSYS_MINT,
    user,
    false,
    TOKEN_2022_PROGRAM_ID,
  );

  // Encode instruction data: discriminator + amount (u64) + lock_months (u8)
  const amountRaw = BigInt(Math.floor(amount * 10 ** UNSYS_DECIMALS));
  const data = Buffer.alloc(8 + 8 + 1);
  DISCRIMINATORS.stakeDividends.copy(data, 0);
  writeU64LE(data, amountRaw, 8);
  data.writeUInt8(lockMonths, 16);

  const keys = [
    { pubkey: GLOBAL_CONFIG_PDA, isSigner: false, isWritable: true },
    { pubkey: userStakePda, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: UNSYS_MINT, isSigner: false, isWritable: false },
    { pubkey: userUnsysAta, isSigner: false, isWritable: true },
    { pubkey: UNSYS_VAULT, isSigner: false, isWritable: true },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });

  const tx = new Transaction().add(ix);
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = user;

  return tx;
}

/**
 * Create unstake dividends transaction
 *
 * Rust struct order:
 * - global_config (mut)
 * - user_stake (mut)
 * - user (signer, mut)
 * - unsys_mint
 * - user_unsys_ata (mut)
 * - token_vault (mut)
 * - token_program
 */
export async function createUnstakeDividendsTransaction(
  connection: Connection,
  user: PublicKey,
): Promise<Transaction> {
  const userStakePda = getDividendStakePda(user);
  const userUnsysAta = getAssociatedTokenAddressSync(
    UNSYS_MINT,
    user,
    false,
    TOKEN_2022_PROGRAM_ID,
  );

  const keys = [
    { pubkey: GLOBAL_CONFIG_PDA, isSigner: false, isWritable: true },
    { pubkey: userStakePda, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: UNSYS_MINT, isSigner: false, isWritable: false },
    { pubkey: userUnsysAta, isSigner: false, isWritable: true },
    { pubkey: UNSYS_VAULT, isSigner: false, isWritable: true },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data: DISCRIMINATORS.unstakeDividends,
  });

  const tx = new Transaction().add(ix);
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = user;

  return tx;
}

/**
 * Create claim dividends transaction
 *
 * Rust struct order:
 * - global_config (mut)
 * - user_stake (mut)
 * - user (signer, mut)
 * - revenue_vault (mut) - USDC vault
 * - user_usdc_ata (mut)
 * - token_program - SPL Token (not Token-2022, USDC is regular SPL)
 */
export async function createClaimDividendsTransaction(
  connection: Connection,
  user: PublicKey,
): Promise<Transaction> {
  const userStakePda = getDividendStakePda(user);
  const userUsdcAta = getAssociatedTokenAddressSync(
    USDC_MINT,
    user,
    false,
    TOKEN_PROGRAM_ID,
  );

  const keys = [
    { pubkey: GLOBAL_CONFIG_PDA, isSigner: false, isWritable: true },
    { pubkey: userStakePda, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: USDC_VAULT, isSigner: false, isWritable: true },
    { pubkey: userUsdcAta, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data: DISCRIMINATORS.claimDividends,
  });

  const tx = new Transaction().add(ix);
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = user;

  return tx;
}

/**
 * Create stake partnership transaction
 *
 * Rust struct order:
 * - global_config (mut)
 * - partnership_stake (mut, init)
 * - user (signer, mut)
 * - unsys_mint
 * - user_unsys_ata (mut)
 * - token_vault (mut)
 * - token_program
 * - system_program
 */
export async function createStakePartnershipTransaction(
  connection: Connection,
  user: PublicKey,
  amount: number,
  referrer?: PublicKey,
): Promise<Transaction> {
  const partnershipStakePda = getPartnershipStakePda(user);
  const userUnsysAta = getAssociatedTokenAddressSync(
    UNSYS_MINT,
    user,
    false,
    TOKEN_2022_PROGRAM_ID,
  );

  // Encode instruction data: discriminator + amount (u64) + Option<Pubkey>
  const amountRaw = BigInt(Math.floor(amount * 10 ** UNSYS_DECIMALS));
  const data = Buffer.alloc(8 + 8 + 1 + (referrer ? 32 : 0));
  DISCRIMINATORS.stakePartnership.copy(data, 0);
  writeU64LE(data, amountRaw, 8);

  if (referrer) {
    data.writeUInt8(1, 16); // Some
    referrer.toBuffer().copy(data, 17);
  } else {
    data.writeUInt8(0, 16); // None
  }

  const keys = [
    { pubkey: GLOBAL_CONFIG_PDA, isSigner: false, isWritable: true },
    { pubkey: partnershipStakePda, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: UNSYS_MINT, isSigner: false, isWritable: false },
    { pubkey: userUnsysAta, isSigner: false, isWritable: true },
    { pubkey: UNSYS_VAULT, isSigner: false, isWritable: true },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });

  const tx = new Transaction().add(ix);
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = user;

  return tx;
}

/**
 * Create unstake partnership transaction
 *
 * Rust struct order:
 * - global_config (mut)
 * - partnership_stake (mut)
 * - user (signer, mut)
 * - unsys_mint
 * - token_vault (mut)
 * - user_unsys_ata (mut)
 * - token_program
 */
export async function createUnstakePartnershipTransaction(
  connection: Connection,
  user: PublicKey,
): Promise<Transaction> {
  const partnershipStakePda = getPartnershipStakePda(user);
  const userUnsysAta = getAssociatedTokenAddressSync(
    UNSYS_MINT,
    user,
    false,
    TOKEN_2022_PROGRAM_ID,
  );

  const keys = [
    { pubkey: GLOBAL_CONFIG_PDA, isSigner: false, isWritable: true },
    { pubkey: partnershipStakePda, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: UNSYS_MINT, isSigner: false, isWritable: false },
    { pubkey: UNSYS_VAULT, isSigner: false, isWritable: true },
    { pubkey: userUnsysAta, isSigner: false, isWritable: true },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data: DISCRIMINATORS.unstakePartnership,
  });

  const tx = new Transaction().add(ix);
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = user;

  return tx;
}

/**
 * Create claim referral share transaction
 *
 * Rust struct order:
 * - global_config (readonly)
 * - partnership_stake (mut)
 * - user (signer, mut)
 * - revenue_vault (mut) - USDC vault
 * - user_usdc_ata (mut)
 * - token_program - SPL Token
 */
export async function createClaimReferralTransaction(
  connection: Connection,
  user: PublicKey,
): Promise<Transaction> {
  const partnershipStakePda = getPartnershipStakePda(user);
  const userUsdcAta = getAssociatedTokenAddressSync(
    USDC_MINT,
    user,
    false,
    TOKEN_PROGRAM_ID,
  );

  const keys = [
    { pubkey: GLOBAL_CONFIG_PDA, isSigner: false, isWritable: false },
    { pubkey: partnershipStakePda, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: USDC_VAULT, isSigner: false, isWritable: true },
    { pubkey: userUsdcAta, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data: DISCRIMINATORS.claimReferralShare,
  });

  const tx = new Transaction().add(ix);
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = user;

  return tx;
}

/**
 * Create stake data provider transaction
 *
 * Rust struct order:
 * - global_config (readonly - note: not writable for this instruction)
 * - data_provider_stake (mut, init)
 * - user (signer, mut)
 * - unsys_mint
 * - user_unsys_ata (mut)
 * - token_vault (mut)
 * - token_program
 * - system_program
 */
export async function createStakeDataProviderTransaction(
  connection: Connection,
  user: PublicKey,
  amount: number,
): Promise<Transaction> {
  const dataProviderStakePda = getDataProviderStakePda(user);
  const userUnsysAta = getAssociatedTokenAddressSync(
    UNSYS_MINT,
    user,
    false,
    TOKEN_2022_PROGRAM_ID,
  );

  // Encode instruction data: discriminator + amount (u64)
  const amountRaw = BigInt(Math.floor(amount * 10 ** UNSYS_DECIMALS));
  const data = Buffer.alloc(8 + 8);
  DISCRIMINATORS.stakeDataProvider.copy(data, 0);
  writeU64LE(data, amountRaw, 8);

  const keys = [
    { pubkey: GLOBAL_CONFIG_PDA, isSigner: false, isWritable: false },
    { pubkey: dataProviderStakePda, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: UNSYS_MINT, isSigner: false, isWritable: false },
    { pubkey: userUnsysAta, isSigner: false, isWritable: true },
    { pubkey: UNSYS_VAULT, isSigner: false, isWritable: true },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });

  const tx = new Transaction().add(ix);
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = user;

  return tx;
}

/**
 * Create unstake data provider transaction
 *
 * Rust struct order:
 * - global_config (mut)
 * - data_provider_stake (mut)
 * - user (signer, mut)
 * - unsys_mint
 * - user_unsys_ata (mut)
 * - token_vault (mut)
 * - token_program
 */
export async function createUnstakeDataProviderTransaction(
  connection: Connection,
  user: PublicKey,
): Promise<Transaction> {
  const dataProviderStakePda = getDataProviderStakePda(user);
  const userUnsysAta = getAssociatedTokenAddressSync(
    UNSYS_MINT,
    user,
    false,
    TOKEN_2022_PROGRAM_ID,
  );

  const keys = [
    { pubkey: GLOBAL_CONFIG_PDA, isSigner: false, isWritable: true },
    { pubkey: dataProviderStakePda, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: true, isWritable: true },
    { pubkey: UNSYS_MINT, isSigner: false, isWritable: false },
    { pubkey: userUnsysAta, isSigner: false, isWritable: true },
    { pubkey: UNSYS_VAULT, isSigner: false, isWritable: true },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data: DISCRIMINATORS.unstakeDataProvider,
  });

  const tx = new Transaction().add(ix);
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = user;

  return tx;
}

/**
 * Create close partnership stake transaction
 * Used to close an empty (unstaked) partnership PDA and reclaim rent.
 *
 * Rust struct order:
 * - partnership_stake (mut, close)
 * - user (signer, mut)
 */
export async function createClosePartnershipStakeTransaction(
  connection: Connection,
  user: PublicKey,
): Promise<Transaction> {
  const partnershipStakePda = getPartnershipStakePda(user);

  const keys = [
    { pubkey: partnershipStakePda, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: true, isWritable: true },
  ];

  const ix = new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data: DISCRIMINATORS.closePartnershipStake,
  });

  const tx = new Transaction().add(ix);
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = user;

  return tx;
}
