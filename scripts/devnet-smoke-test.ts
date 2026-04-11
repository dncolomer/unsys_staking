/**
 * Devnet Smoke Test
 *
 * Usage:
 *   1. Run migrations/deploy.ts first to initialize the program
 *   2. Run: npx ts-node scripts/devnet-smoke-test.ts
 *
 * This script will test the core flows:
 *   - Dividend staking/claiming/unstaking
 *   - Partnership staking/unstaking
 *   - Emergency pause/unpause
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { Keypair, PublicKey, Connection, clusterApiUrl } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

async function main() {
  // Load deployment addresses
  if (!fs.existsSync("devnet-addresses.json")) {
    console.error("ERROR: devnet-addresses.json not found.");
    console.error("Run 'npx ts-node migrations/deploy.ts' first.");
    process.exit(1);
  }
  const addresses = JSON.parse(
    fs.readFileSync("devnet-addresses.json", "utf-8"),
  );

  // Load wallet
  const walletPath = path.join(os.homedir(), ".config/solana/id.json");
  const secretKey = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
  const adminKeypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));

  console.log("=".repeat(60));
  console.log("UNSYS Staking Devnet Smoke Test");
  console.log("=".repeat(60));
  console.log(`Admin wallet: ${adminKeypair.publicKey.toBase58()}`);

  // Connect to devnet
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const wallet = new anchor.Wallet(adminKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  // Load program
  const idl = JSON.parse(
    fs.readFileSync("./target/idl/unsys_staking.json", "utf-8"),
  );
  const programId = new PublicKey(addresses.programId);
  const program = new Program(idl, provider) as any;

  const globalConfigKey = new PublicKey(addresses.globalConfig);
  const unsysMint = new PublicKey(addresses.unsysMint);
  const usdcMint = new PublicKey(addresses.usdcMint);
  const tokenVault = new PublicKey(addresses.tokenVault);
  const revenueVault = new PublicKey(addresses.revenueVault);

  // Get admin ATAs
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

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    process.stdout.write(`\n[TEST] ${name}... `);
    try {
      await fn();
      console.log("PASSED");
      passed++;
    } catch (e: any) {
      console.log("FAILED");
      console.log(`  Error: ${e.message || e}`);
      failed++;
    }
  }

  // ============================================================
  // Test 1: Verify initialization
  // ============================================================
  await test("Verify program is initialized", async () => {
    const config = await program.account.globalConfig.fetch(globalConfigKey);
    if (!config.admin.equals(adminKeypair.publicKey)) {
      throw new Error("Admin mismatch");
    }
    if (config.paused) {
      throw new Error("Program is paused");
    }
  });

  // ============================================================
  // Test 2: Dividend staking
  // ============================================================
  const [dividendStakeKey] = PublicKey.findProgramAddressSync(
    [Buffer.from("dividend_stake"), adminKeypair.publicKey.toBuffer()],
    programId,
  );

  await test("Stake dividends (1 UNSYS, 3-month lock)", async () => {
    const tx = await program.methods
      .stakeDividends(new BN(1_000_000), 3) // 1 UNSYS, 3 months
      .accounts({
        globalConfig: globalConfigKey,
        userStake: dividendStakeKey,
        user: adminKeypair.publicKey,
        userUnsysAta: adminUnsysAta,
        tokenVault,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([adminKeypair])
      .rpc();
    console.log(`tx: ${tx.slice(0, 20)}...`);
  });

  // ============================================================
  // Test 3: Deposit revenue and claim dividends
  // ============================================================
  await test("Deposit revenue (1 USDC)", async () => {
    const tx = await program.methods
      .depositRevenue(new BN(1_000_000)) // 1 USDC
      .accounts({
        globalConfig: globalConfigKey,
        admin: adminKeypair.publicKey,
        adminUsdcAta: adminUsdcAta,
        revenueVault,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([adminKeypair])
      .rpc();
    console.log(`tx: ${tx.slice(0, 20)}...`);
  });

  await test("Claim dividends", async () => {
    const tx = await program.methods
      .claimDividends()
      .accounts({
        globalConfig: globalConfigKey,
        userStake: dividendStakeKey,
        user: adminKeypair.publicKey,
        userUsdcAta: adminUsdcAta,
        revenueVault,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([adminKeypair])
      .rpc();
    console.log(`tx: ${tx.slice(0, 20)}...`);
  });

  // ============================================================
  // Test 4: Partnership staking
  // ============================================================
  const [partnershipStakeKey] = PublicKey.findProgramAddressSync(
    [Buffer.from("partnership_stake"), adminKeypair.publicKey.toBuffer()],
    programId,
  );

  await test("Stake partnership (1M UNSYS = Tier 1)", async () => {
    // Need to mint more UNSYS for partnership
    await mintTo(
      connection,
      adminKeypair,
      unsysMint,
      adminUnsysAta,
      adminKeypair,
      1_000_000,
    );

    const tx = await program.methods
      .stakePartnership(new BN(1_000_000), null) // 1M UNSYS, no referrer
      .accounts({
        globalConfig: globalConfigKey,
        partnershipStake: partnershipStakeKey,
        user: adminKeypair.publicKey,
        userUnsysAta: adminUnsysAta,
        tokenVault,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([adminKeypair])
      .rpc();
    console.log(`tx: ${tx.slice(0, 20)}...`);
  });

  await test("Verify partnership tier", async () => {
    const stake =
      await program.account.partnershipStake.fetch(partnershipStakeKey);
    if (stake.tier !== 1) {
      throw new Error(`Expected tier 1, got ${stake.tier}`);
    }
  });

  await test("Unstake partnership", async () => {
    const tx = await program.methods
      .unstakePartnership()
      .accounts({
        globalConfig: globalConfigKey,
        partnershipStake: partnershipStakeKey,
        user: adminKeypair.publicKey,
        tokenVault,
        userUnsysAta: adminUnsysAta,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .signers([adminKeypair])
      .rpc();
    console.log(`tx: ${tx.slice(0, 20)}...`);
  });

  // ============================================================
  // Test 5: Emergency pause/unpause
  // ============================================================
  await test("Emergency pause", async () => {
    const tx = await program.methods
      .pause()
      .accounts({
        globalConfig: globalConfigKey,
        admin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();
    console.log(`tx: ${tx.slice(0, 20)}...`);

    const config = await program.account.globalConfig.fetch(globalConfigKey);
    if (!config.paused) {
      throw new Error("Program should be paused");
    }
  });

  await test("Emergency unpause", async () => {
    const tx = await program.methods
      .unpause()
      .accounts({
        globalConfig: globalConfigKey,
        admin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();
    console.log(`tx: ${tx.slice(0, 20)}...`);

    const config = await program.account.globalConfig.fetch(globalConfigKey);
    if (config.paused) {
      throw new Error("Program should be unpaused");
    }
  });

  // ============================================================
  // Test 6: Unstake dividends (skip - lock period not expired)
  // ============================================================
  console.log(
    "\n[TEST] Unstake dividends... SKIPPED (3-month lock not expired)",
  );

  // ============================================================
  // Summary
  // ============================================================
  console.log("\n" + "=".repeat(60));
  console.log("SMOKE TEST RESULTS");
  console.log("=".repeat(60));
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log("=".repeat(60));

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
