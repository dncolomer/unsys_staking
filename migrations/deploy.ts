/**
 * Devnet deployment & initialization script
 *
 * Usage:
 *   1. Ensure Anchor.toml is set to cluster = "Devnet"
 *   2. Ensure your wallet has ~5 SOL on devnet
 *   3. Run: npx ts-node migrations/deploy.ts
 *
 * This script will:
 *   - Create 3 test SPL token mints (UNSYS, OMEGA, USDC)
 *   - Create the token vaults (ATAs owned by GlobalConfig PDA)
 *   - Call the initialize instruction
 *   - Print out all relevant addresses
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { UnsysStaking } from "../target/types/unsys_staking";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { Keypair, PublicKey, Connection, clusterApiUrl } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

async function main() {
  // Load wallet from default Solana CLI location
  const walletPath = path.join(os.homedir(), ".config/solana/id.json");
  const secretKey = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  const adminKeypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));

  console.log("=".repeat(60));
  console.log("UNSYS Staking Devnet Deployment");
  console.log("=".repeat(60));
  console.log(`Admin wallet: ${adminKeypair.publicKey.toBase58()}`);

  // Connect to devnet
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const balance = await connection.getBalance(adminKeypair.publicKey);
  console.log(`Wallet balance: ${balance / 1e9} SOL`);

  if (balance < 0.5 * 1e9) {
    console.error(
      "ERROR: Insufficient balance. Need at least 0.5 SOL for initialization.",
    );
    console.error("Get devnet SOL from: https://faucet.solana.com");
    process.exit(1);
  }

  // Setup Anchor provider
  const wallet = new anchor.Wallet(adminKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  // Load the program
  const idl = JSON.parse(
    fs.readFileSync("./target/idl/unsys_staking.json", "utf-8"),
  );
  const programId = new PublicKey(
    "GSxEFVkssh6trQ97WZBsMGs1iahdJ6Z2fSPjQ617nKLN",
  );
  const program = new Program(idl, provider) as Program<UnsysStaking>;

  console.log(`\nProgram ID: ${programId.toBase58()}`);

  // Step 1: Create token mints
  console.log("\n[1/4] Creating token mints...");

  const unsysMint = await createMint(
    connection,
    adminKeypair,
    adminKeypair.publicKey, // mint authority
    null, // freeze authority
    6, // decimals
  );
  console.log(`  UNSYS Mint: ${unsysMint.toBase58()}`);

  const omegaMint = await createMint(
    connection,
    adminKeypair,
    adminKeypair.publicKey,
    null,
    6,
  );
  console.log(`  OMEGA Mint: ${omegaMint.toBase58()}`);

  const usdcMint = await createMint(
    connection,
    adminKeypair,
    adminKeypair.publicKey,
    null,
    6,
  );
  console.log(`  USDC Mint:  ${usdcMint.toBase58()}`);

  // Step 2: Derive GlobalConfig PDA
  console.log("\n[2/4] Deriving GlobalConfig PDA...");
  const [globalConfigKey] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_config_v3")],
    programId,
  );
  console.log(`  GlobalConfig PDA: ${globalConfigKey.toBase58()}`);

  // Step 3: Create token vaults (ATAs owned by GlobalConfig PDA)
  console.log("\n[3/4] Creating token vaults...");

  const tokenVault = (
    await getOrCreateAssociatedTokenAccount(
      connection,
      adminKeypair,
      unsysMint,
      globalConfigKey,
      true, // allowOwnerOffCurve (PDA owner)
    )
  ).address;
  console.log(`  Token Vault (UNSYS): ${tokenVault.toBase58()}`);

  const revenueVault = (
    await getOrCreateAssociatedTokenAccount(
      connection,
      adminKeypair,
      usdcMint,
      globalConfigKey,
      true,
    )
  ).address;
  console.log(`  Revenue Vault (USDC): ${revenueVault.toBase58()}`);

  // Buyback wallet (just a random address for now)
  const buybackWallet = Keypair.generate().publicKey;
  console.log(`  Buyback Wallet: ${buybackWallet.toBase58()}`);

  // Step 4: Initialize the program
  console.log("\n[4/4] Initializing program...");

  try {
    const tx = await program.methods
      .initialize()
      .accounts({
        globalConfig: globalConfigKey,
        admin: adminKeypair.publicKey,
        unsysMint,
        omegaMint,
        usdcMint,
        buybackWallet,
        tokenVault,
        revenueVault,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([adminKeypair])
      .rpc();

    console.log(`  Transaction: ${tx}`);
    console.log("  SUCCESS: Program initialized!");
  } catch (e: any) {
    if (e.toString().includes("AlreadyInitialized")) {
      console.log("  Program was already initialized.");
    } else {
      throw e;
    }
  }

  // Fetch and display config
  const config = await program.account.globalConfig.fetch(globalConfigKey);

  console.log("\n" + "=".repeat(60));
  console.log("DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log("\nDevnet Addresses:");
  console.log(`  Program ID:      ${programId.toBase58()}`);
  console.log(`  GlobalConfig:    ${globalConfigKey.toBase58()}`);
  console.log(`  Admin:           ${config.admin.toBase58()}`);
  console.log(`  UNSYS Mint:      ${unsysMint.toBase58()}`);
  console.log(`  OMEGA Mint:      ${omegaMint.toBase58()}`);
  console.log(`  USDC Mint:       ${usdcMint.toBase58()}`);
  console.log(`  Token Vault:     ${tokenVault.toBase58()}`);
  console.log(`  Revenue Vault:   ${revenueVault.toBase58()}`);
  console.log(`  Buyback Wallet:  ${buybackWallet.toBase58()}`);

  // Save addresses to file
  const addresses = {
    network: "devnet",
    programId: programId.toBase58(),
    globalConfig: globalConfigKey.toBase58(),
    admin: adminKeypair.publicKey.toBase58(),
    unsysMint: unsysMint.toBase58(),
    omegaMint: omegaMint.toBase58(),
    usdcMint: usdcMint.toBase58(),
    tokenVault: tokenVault.toBase58(),
    revenueVault: revenueVault.toBase58(),
    buybackWallet: buybackWallet.toBase58(),
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync("devnet-addresses.json", JSON.stringify(addresses, null, 2));
  console.log("\nAddresses saved to: devnet-addresses.json");

  // Mint some test tokens to admin
  console.log("\n[Bonus] Minting test tokens to admin wallet...");
  const adminUnsysAta = (
    await getOrCreateAssociatedTokenAccount(
      connection,
      adminKeypair,
      unsysMint,
      adminKeypair.publicKey,
    )
  ).address;
  const adminUsdcAta = (
    await getOrCreateAssociatedTokenAccount(
      connection,
      adminKeypair,
      usdcMint,
      adminKeypair.publicKey,
    )
  ).address;

  await mintTo(
    connection,
    adminKeypair,
    unsysMint,
    adminUnsysAta,
    adminKeypair,
    100_000_000,
  ); // 100 UNSYS
  await mintTo(
    connection,
    adminKeypair,
    usdcMint,
    adminUsdcAta,
    adminKeypair,
    100_000_000,
  ); // 100 USDC
  console.log("  Minted 100 UNSYS and 100 USDC to admin wallet");

  console.log("\nDone!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
