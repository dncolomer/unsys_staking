/**
 * Direct mainnet initialization script for UNSYS Staking Program
 * Bypasses Anchor IDL - constructs transaction manually
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// Program ID
const PROGRAM_ID = new PublicKey(
  "GSxEFVkssh6trQ97WZBsMGs1iahdJ6Z2fSPjQ617nKLN",
);

// Mainnet mints
const UNSYS_MINT = new PublicKey(
  "Dza3Bey5tvyYiPgcGRKoXKU6rNrdoNrWNVmjqePcpump",
);
const OMEGA_MINT = new PublicKey(
  "BaWyD9P8ctkZ6if2umqj7htV91YuuouzUrMFsJh9BAGS",
);
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const BUYBACK_WALLET = new PublicKey(
  "2v1EY1dF7eN4QnHhrat1nCcqDLMnw3twVKmyyQQe4mPF",
);

// Initialize instruction discriminator (first 8 bytes of sha256("global:initialize"))
// From the IDL: [175, 175, 109, 31, 13, 152, 155, 237]
const INITIALIZE_DISCRIMINATOR = Buffer.from([
  175, 175, 109, 31, 13, 152, 155, 237,
]);

async function main() {
  console.log("=== UNSYS Staking - Mainnet Initialization ===\n");

  // Load admin keypair
  const adminPath = path.join(__dirname, "../keys/admin-wallet.json");
  const adminKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(adminPath, "utf-8"))),
  );
  console.log(`Admin: ${adminKeypair.publicKey.toBase58()}`);

  // Connect to mainnet
  const connection = new Connection(
    "https://api.mainnet-beta.solana.com",
    "confirmed",
  );
  const balance = await connection.getBalance(adminKeypair.publicKey);
  console.log(`Balance: ${balance / 1e9} SOL`);

  // Derive GlobalConfig PDA
  const [globalConfigPda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_config_v3")],
    PROGRAM_ID,
  );
  console.log(`GlobalConfig PDA: ${globalConfigPda.toBase58()}`);

  // Check if already initialized
  const existingConfig = await connection.getAccountInfo(globalConfigPda);
  if (existingConfig && existingConfig.data.length > 0) {
    console.log("\nProgram appears to already be initialized.");
    console.log(`Account size: ${existingConfig.data.length} bytes`);
    // Check if admin field is set (offset 8 for discriminator + 32*5 for mints/vaults = 168)
    // Actually for anchor accounts, discriminator is 8 bytes, then fields follow
    // Let's just continue and let the program reject if already initialized
  }

  // Create token vaults
  console.log("\nCreating token vaults...");

  // UNSYS vault (Token-2022)
  console.log("  Creating UNSYS vault (Token-2022)...");
  const unsysVault = await getOrCreateAssociatedTokenAccount(
    connection,
    adminKeypair,
    UNSYS_MINT,
    globalConfigPda,
    true, // allowOwnerOffCurve for PDA
    undefined,
    undefined,
    TOKEN_2022_PROGRAM_ID,
  );
  console.log(`  UNSYS Vault: ${unsysVault.address.toBase58()}`);

  // USDC vault (SPL Token)
  console.log("  Creating USDC vault (SPL Token)...");
  const usdcVault = await getOrCreateAssociatedTokenAccount(
    connection,
    adminKeypair,
    USDC_MINT,
    globalConfigPda,
    true,
    undefined,
    undefined,
    TOKEN_PROGRAM_ID,
  );
  console.log(`  USDC Vault: ${usdcVault.address.toBase58()}`);

  // Build initialize instruction
  // Simplified account structure to avoid stack overflow
  console.log("\nBuilding initialize instruction...");

  const keys = [
    { pubkey: globalConfigPda, isSigner: false, isWritable: true },
    { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: true },
    { pubkey: UNSYS_MINT, isSigner: false, isWritable: false },
    { pubkey: OMEGA_MINT, isSigner: false, isWritable: false },
    { pubkey: USDC_MINT, isSigner: false, isWritable: false },
    { pubkey: BUYBACK_WALLET, isSigner: false, isWritable: false },
    { pubkey: unsysVault.address, isSigner: false, isWritable: true },
    { pubkey: usdcVault.address, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const initializeIx = new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data: INITIALIZE_DISCRIMINATOR,
  });

  // Create and send transaction
  console.log("\nSending initialize transaction...");
  const tx = new Transaction().add(initializeIx);
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.feePayer = adminKeypair.publicKey;

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      tx,
      [adminKeypair],
      {
        commitment: "confirmed",
      },
    );
    console.log(`\n✅ SUCCESS!`);
    console.log(`Transaction: ${signature}`);
    console.log(`\nProgram initialized with:`);
    console.log(`  GlobalConfig: ${globalConfigPda.toBase58()}`);
    console.log(`  UNSYS Vault:  ${unsysVault.address.toBase58()}`);
    console.log(`  USDC Vault:   ${usdcVault.address.toBase58()}`);
    console.log(`  Admin:        ${adminKeypair.publicKey.toBase58()}`);
  } catch (err: any) {
    console.error("\n❌ Transaction failed:", err.message);
    if (err.logs) {
      console.error("\nProgram logs:");
      err.logs.forEach((log: string) => console.error("  ", log));
    }
    process.exit(1);
  }
}

main().catch(console.error);
