/**
 * Comprehensive Devnet Test Suite
 *
 * Adapted from the 49 localnet tests to run against devnet.
 *
 * Usage:
 *   1. Ensure devnet-addresses.json exists (run migrations/deploy.ts first)
 *   2. Ensure admin wallet has sufficient SOL and tokens
 *   3. Run: npx ts-node scripts/devnet-full-test.ts
 *
 * Note: Some tests that require fresh state will skip if accounts already exist.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  Connection,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Test results tracking
let passed = 0;
let failed = 0;
let skipped = 0;

async function test(
  name: string,
  fn: () => Promise<void>,
  skipCondition?: () => Promise<boolean>,
) {
  process.stdout.write(`[TEST] ${name}... `);
  try {
    if (skipCondition && (await skipCondition())) {
      console.log("SKIPPED (precondition not met)");
      skipped++;
      return;
    }
    await fn();
    console.log("PASSED");
    passed++;
  } catch (e: any) {
    console.log("FAILED");
    console.log(`       Error: ${e.message?.slice(0, 200) || e}`);
    failed++;
  }
}

async function expectError(
  fn: () => Promise<any>,
  errorSubstring: string,
): Promise<void> {
  try {
    await fn();
    throw new Error(
      `Expected error containing "${errorSubstring}" but succeeded`,
    );
  } catch (e: any) {
    if (!e.toString().includes(errorSubstring)) {
      throw new Error(
        `Expected "${errorSubstring}" but got: ${e.toString().slice(0, 200)}`,
      );
    }
  }
}

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

  console.log("=".repeat(70));
  console.log("UNSYS Staking - Comprehensive Devnet Test Suite");
  console.log("=".repeat(70));
  console.log(`Admin: ${adminKeypair.publicKey.toBase58()}`);

  // Connect to devnet
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  const wallet = new anchor.Wallet(adminKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  // Check balance
  const balance = await connection.getBalance(adminKeypair.publicKey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  if (balance < 0.5 * LAMPORTS_PER_SOL) {
    console.error("ERROR: Insufficient SOL. Need at least 0.5 SOL.");
    process.exit(1);
  }

  // Load program
  const idl = JSON.parse(
    fs.readFileSync("./target/idl/unsys_staking.json", "utf-8"),
  );
  const programId = new PublicKey(addresses.programId);
  const program = new Program(idl, provider) as any;

  // Load addresses
  const globalConfigKey = new PublicKey(addresses.globalConfig);
  const unsysMint = new PublicKey(addresses.unsysMint);
  const omegaMint = new PublicKey(addresses.omegaMint);
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

  // Helper: create a funded test user
  async function createFundedUser(
    unsysAmount: number = 50_000_000,
  ): Promise<{ kp: Keypair; unsysAta: PublicKey; usdcAta: PublicKey }> {
    const kp = Keypair.generate();

    // Fund with SOL (transfer from admin since devnet airdrop is rate-limited)
    const transferSolTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: adminKeypair.publicKey,
        toPubkey: kp.publicKey,
        lamports: 0.05 * LAMPORTS_PER_SOL, // 0.05 SOL for fees
      }),
    );
    await provider.sendAndConfirm(transferSolTx);

    // Create token accounts
    const unsysAta = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        adminKeypair,
        unsysMint,
        kp.publicKey,
      )
    ).address;
    const usdcAta = (
      await getOrCreateAssociatedTokenAccount(
        connection,
        adminKeypair,
        usdcMint,
        kp.publicKey,
      )
    ).address;

    // Mint tokens
    if (unsysAmount > 0) {
      await mintTo(
        connection,
        adminKeypair,
        unsysMint,
        unsysAta,
        adminKeypair,
        unsysAmount,
      );
    }

    return { kp, unsysAta, usdcAta };
  }

  // Helper: check if account exists
  async function accountExists(pubkey: PublicKey): Promise<boolean> {
    try {
      const info = await connection.getAccountInfo(pubkey);
      return info !== null;
    } catch {
      return false;
    }
  }

  // Constants
  const STAKE_AMOUNT = new BN(1_000_000);
  const PARTNERSHIP_1M = new BN(1_000_000);
  const PARTNERSHIP_2M = new BN(2_000_000);
  const PARTNERSHIP_5M = new BN(5_000_000);
  const DATA_PROVIDER_STAKE = new BN(5_000_000);
  const REVENUE_DEPOSIT = new BN(1_000_000);

  // ================================================================
  console.log("\n--- SECTION 1: Initialization & Config ---");
  // ================================================================

  await test("Verify program is initialized", async () => {
    const config = await program.account.globalConfig.fetch(globalConfigKey);
    if (!config.admin.equals(adminKeypair.publicKey)) {
      throw new Error("Admin mismatch");
    }
  });

  await test("Reject re-initialization", async () => {
    await expectError(async () => {
      await program.methods
        .initialize()
        .accounts({
          globalConfig: globalConfigKey,
          admin: adminKeypair.publicKey,
          unsysMint,
          omegaMint,
          usdcMint,
          buybackWallet: Keypair.generate().publicKey,
          tokenVault,
          revenueVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([adminKeypair])
        .rpc();
    }, "AlreadyInitialized");
  });

  // ================================================================
  console.log("\n--- SECTION 2: Admin Transfer ---");
  // ================================================================

  await test("Admin transfer: propose -> accept -> transfer back", async () => {
    const newAdmin = Keypair.generate();

    // Fund new admin
    const transferTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: adminKeypair.publicKey,
        toPubkey: newAdmin.publicKey,
        lamports: 0.01 * LAMPORTS_PER_SOL,
      }),
    );
    await provider.sendAndConfirm(transferTx);

    // Propose
    await program.methods
      .proposeAdminTransfer(newAdmin.publicKey)
      .accounts({
        globalConfig: globalConfigKey,
        admin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();

    // Accept
    await program.methods
      .acceptAdminTransfer()
      .accounts({ globalConfig: globalConfigKey, newAdmin: newAdmin.publicKey })
      .signers([newAdmin])
      .rpc();

    let config = await program.account.globalConfig.fetch(globalConfigKey);
    if (!config.admin.equals(newAdmin.publicKey)) {
      throw new Error("Admin should be newAdmin");
    }

    // Transfer back
    await program.methods
      .proposeAdminTransfer(adminKeypair.publicKey)
      .accounts({ globalConfig: globalConfigKey, admin: newAdmin.publicKey })
      .signers([newAdmin])
      .rpc();

    await program.methods
      .acceptAdminTransfer()
      .accounts({
        globalConfig: globalConfigKey,
        newAdmin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();

    config = await program.account.globalConfig.fetch(globalConfigKey);
    if (!config.admin.equals(adminKeypair.publicKey)) {
      throw new Error("Admin should be original admin");
    }
  });

  await test("Admin transfer: reject propose by non-admin", async () => {
    const attacker = Keypair.generate();
    const transferTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: adminKeypair.publicKey,
        toPubkey: attacker.publicKey,
        lamports: 0.01 * LAMPORTS_PER_SOL,
      }),
    );
    await provider.sendAndConfirm(transferTx);

    await expectError(async () => {
      await program.methods
        .proposeAdminTransfer(attacker.publicKey)
        .accounts({ globalConfig: globalConfigKey, admin: attacker.publicKey })
        .signers([attacker])
        .rpc();
    }, "Unauthorized");
  });

  await test("Admin transfer: cancel", async () => {
    const newAdmin = Keypair.generate();
    await program.methods
      .proposeAdminTransfer(newAdmin.publicKey)
      .accounts({
        globalConfig: globalConfigKey,
        admin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();

    await program.methods
      .cancelAdminTransfer()
      .accounts({
        globalConfig: globalConfigKey,
        admin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();

    const config = await program.account.globalConfig.fetch(globalConfigKey);
    if (!config.pendingAdmin.equals(PublicKey.default)) {
      throw new Error("Pending admin should be cleared");
    }
  });

  // ================================================================
  console.log("\n--- SECTION 3: Pause/Unpause ---");
  // ================================================================

  // First ensure we're unpaused
  const configState = await program.account.globalConfig.fetch(globalConfigKey);
  if (configState.paused) {
    await program.methods
      .unpause()
      .accounts({
        globalConfig: globalConfigKey,
        admin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();
  }

  await test("Pause program", async () => {
    await program.methods
      .pause()
      .accounts({
        globalConfig: globalConfigKey,
        admin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();

    const config = await program.account.globalConfig.fetch(globalConfigKey);
    if (!config.paused) {
      throw new Error("Program should be paused");
    }
  });

  await test("Reject operations when paused", async () => {
    await expectError(async () => {
      await program.methods
        .depositRevenue(REVENUE_DEPOSIT)
        .accounts({
          globalConfig: globalConfigKey,
          admin: adminKeypair.publicKey,
          adminUsdcAta,
          revenueVault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([adminKeypair])
        .rpc();
    }, "ProgramPaused");
  });

  await test("Unpause program", async () => {
    await program.methods
      .unpause()
      .accounts({
        globalConfig: globalConfigKey,
        admin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();

    const config = await program.account.globalConfig.fetch(globalConfigKey);
    if (config.paused) {
      throw new Error("Program should be unpaused");
    }
  });

  // ================================================================
  console.log("\n--- SECTION 4: Dividend Staking ---");
  // ================================================================

  await test("Stake dividends: 3-month lock (1.1x multiplier)", async () => {
    const { kp, unsysAta } = await createFundedUser(10_000_000);
    const [stakeKey] = PublicKey.findProgramAddressSync(
      [Buffer.from("dividend_stake"), kp.publicKey.toBuffer()],
      programId,
    );

    await program.methods
      .stakeDividends(STAKE_AMOUNT, 3)
      .accounts({
        globalConfig: globalConfigKey,
        userStake: stakeKey,
        user: kp.publicKey,
        userUnsysAta: unsysAta,
        tokenVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([kp])
      .rpc();

    const stake = await program.account.dividendStake.fetch(stakeKey);
    if (stake.multiplierBps !== 11000) {
      throw new Error(`Expected 11000 bps, got ${stake.multiplierBps}`);
    }
  });

  await test("Stake dividends: 6-month lock (1.25x multiplier)", async () => {
    const { kp, unsysAta } = await createFundedUser(10_000_000);
    const [stakeKey] = PublicKey.findProgramAddressSync(
      [Buffer.from("dividend_stake"), kp.publicKey.toBuffer()],
      programId,
    );

    await program.methods
      .stakeDividends(STAKE_AMOUNT, 6)
      .accounts({
        globalConfig: globalConfigKey,
        userStake: stakeKey,
        user: kp.publicKey,
        userUnsysAta: unsysAta,
        tokenVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([kp])
      .rpc();

    const stake = await program.account.dividendStake.fetch(stakeKey);
    if (stake.multiplierBps !== 12500) {
      throw new Error(`Expected 12500 bps, got ${stake.multiplierBps}`);
    }
  });

  await test("Stake dividends: 12-month lock (1.5x multiplier)", async () => {
    const { kp, unsysAta } = await createFundedUser(10_000_000);
    const [stakeKey] = PublicKey.findProgramAddressSync(
      [Buffer.from("dividend_stake"), kp.publicKey.toBuffer()],
      programId,
    );

    await program.methods
      .stakeDividends(STAKE_AMOUNT, 12)
      .accounts({
        globalConfig: globalConfigKey,
        userStake: stakeKey,
        user: kp.publicKey,
        userUnsysAta: unsysAta,
        tokenVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([kp])
      .rpc();

    const stake = await program.account.dividendStake.fetch(stakeKey);
    if (stake.multiplierBps !== 15000) {
      throw new Error(`Expected 15000 bps, got ${stake.multiplierBps}`);
    }
  });

  await test("Stake dividends: reject invalid lock period", async () => {
    const { kp, unsysAta } = await createFundedUser(10_000_000);
    const [stakeKey] = PublicKey.findProgramAddressSync(
      [Buffer.from("dividend_stake"), kp.publicKey.toBuffer()],
      programId,
    );

    await expectError(async () => {
      await program.methods
        .stakeDividends(STAKE_AMOUNT, 1)
        .accounts({
          globalConfig: globalConfigKey,
          userStake: stakeKey,
          user: kp.publicKey,
          userUnsysAta: unsysAta,
          tokenVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([kp])
        .rpc();
    }, "Invalid lock period");
  });

  await test("Stake dividends: reject zero amount", async () => {
    const { kp, unsysAta } = await createFundedUser(10_000_000);
    const [stakeKey] = PublicKey.findProgramAddressSync(
      [Buffer.from("dividend_stake"), kp.publicKey.toBuffer()],
      programId,
    );

    await expectError(async () => {
      await program.methods
        .stakeDividends(new BN(0), 3)
        .accounts({
          globalConfig: globalConfigKey,
          userStake: stakeKey,
          user: kp.publicKey,
          userUnsysAta: unsysAta,
          tokenVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([kp])
        .rpc();
    }, "InvalidAmount");
  });

  // ================================================================
  console.log("\n--- SECTION 5: Partnership Staking (Tiers) ---");
  // ================================================================

  await test("Partnership: reject below 1M minimum", async () => {
    const { kp, unsysAta } = await createFundedUser(10_000_000);
    const [stakeKey] = PublicKey.findProgramAddressSync(
      [Buffer.from("partnership_stake"), kp.publicKey.toBuffer()],
      programId,
    );

    await expectError(async () => {
      await program.methods
        .stakePartnership(new BN(500_000), null)
        .accounts({
          globalConfig: globalConfigKey,
          partnershipStake: stakeKey,
          user: kp.publicKey,
          userUnsysAta: unsysAta,
          tokenVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([kp])
        .rpc();
    }, "InsufficientPartnershipStake");
  });

  await test("Partnership: stake 1M -> tier 1", async () => {
    const { kp, unsysAta } = await createFundedUser(10_000_000);
    const [stakeKey] = PublicKey.findProgramAddressSync(
      [Buffer.from("partnership_stake"), kp.publicKey.toBuffer()],
      programId,
    );

    await program.methods
      .stakePartnership(PARTNERSHIP_1M, null)
      .accounts({
        globalConfig: globalConfigKey,
        partnershipStake: stakeKey,
        user: kp.publicKey,
        userUnsysAta: unsysAta,
        tokenVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([kp])
      .rpc();

    const stake = await program.account.partnershipStake.fetch(stakeKey);
    if (stake.tier !== 1) {
      throw new Error(`Expected tier 1, got ${stake.tier}`);
    }
  });

  await test("Partnership: stake 2M -> tier 2", async () => {
    const { kp, unsysAta } = await createFundedUser(10_000_000);
    const [stakeKey] = PublicKey.findProgramAddressSync(
      [Buffer.from("partnership_stake"), kp.publicKey.toBuffer()],
      programId,
    );

    await program.methods
      .stakePartnership(PARTNERSHIP_2M, null)
      .accounts({
        globalConfig: globalConfigKey,
        partnershipStake: stakeKey,
        user: kp.publicKey,
        userUnsysAta: unsysAta,
        tokenVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([kp])
      .rpc();

    const stake = await program.account.partnershipStake.fetch(stakeKey);
    if (stake.tier !== 2) {
      throw new Error(`Expected tier 2, got ${stake.tier}`);
    }
  });

  await test("Partnership: stake 5M -> tier 3", async () => {
    const { kp, unsysAta } = await createFundedUser(10_000_000);
    const [stakeKey] = PublicKey.findProgramAddressSync(
      [Buffer.from("partnership_stake"), kp.publicKey.toBuffer()],
      programId,
    );

    await program.methods
      .stakePartnership(PARTNERSHIP_5M, null)
      .accounts({
        globalConfig: globalConfigKey,
        partnershipStake: stakeKey,
        user: kp.publicKey,
        userUnsysAta: unsysAta,
        tokenVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([kp])
      .rpc();

    const stake = await program.account.partnershipStake.fetch(stakeKey);
    if (stake.tier !== 3) {
      throw new Error(`Expected tier 3, got ${stake.tier}`);
    }
  });

  await test("Partnership: stake with referrer", async () => {
    const referrer = Keypair.generate();
    const { kp, unsysAta } = await createFundedUser(10_000_000);
    const [stakeKey] = PublicKey.findProgramAddressSync(
      [Buffer.from("partnership_stake"), kp.publicKey.toBuffer()],
      programId,
    );

    await program.methods
      .stakePartnership(PARTNERSHIP_1M, referrer.publicKey)
      .accounts({
        globalConfig: globalConfigKey,
        partnershipStake: stakeKey,
        user: kp.publicKey,
        userUnsysAta: unsysAta,
        tokenVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([kp])
      .rpc();

    const stake = await program.account.partnershipStake.fetch(stakeKey);
    if (!stake.referrer || !stake.referrer.equals(referrer.publicKey)) {
      throw new Error("Referrer not set correctly");
    }
  });

  await test("Partnership: unstake and revoke tier", async () => {
    const { kp, unsysAta } = await createFundedUser(10_000_000);
    const [stakeKey] = PublicKey.findProgramAddressSync(
      [Buffer.from("partnership_stake"), kp.publicKey.toBuffer()],
      programId,
    );

    // Stake
    await program.methods
      .stakePartnership(PARTNERSHIP_1M, null)
      .accounts({
        globalConfig: globalConfigKey,
        partnershipStake: stakeKey,
        user: kp.publicKey,
        userUnsysAta: unsysAta,
        tokenVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([kp])
      .rpc();

    // Unstake
    await program.methods
      .unstakePartnership()
      .accounts({
        globalConfig: globalConfigKey,
        partnershipStake: stakeKey,
        user: kp.publicKey,
        tokenVault,
        userUnsysAta: unsysAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([kp])
      .rpc();

    const stake = await program.account.partnershipStake.fetch(stakeKey);
    if (stake.tier !== 0) {
      throw new Error(`Expected tier 0, got ${stake.tier}`);
    }
  });

  // ================================================================
  console.log("\n--- SECTION 6: Revenue & Dividends ---");
  // ================================================================

  await test("Deposit revenue: full amount to dividend pool", async () => {
    const configBefore =
      await program.account.globalConfig.fetch(globalConfigKey);

    await program.methods
      .depositRevenue(REVENUE_DEPOSIT)
      .accounts({
        globalConfig: globalConfigKey,
        admin: adminKeypair.publicKey,
        adminUsdcAta,
        revenueVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([adminKeypair])
      .rpc();

    const configAfter =
      await program.account.globalConfig.fetch(globalConfigKey);
    const expectedEpoch = configBefore.dividendEpoch.toNumber() + 1;
    if (configAfter.dividendEpoch.toNumber() !== expectedEpoch) {
      throw new Error(`Epoch should be ${expectedEpoch}`);
    }
  });

  await test("Deposit revenue: reject non-admin", async () => {
    const { kp, usdcAta } = await createFundedUser(0);
    await mintTo(
      connection,
      adminKeypair,
      usdcMint,
      usdcAta,
      adminKeypair,
      1_000_000,
    );

    await expectError(async () => {
      await program.methods
        .depositRevenue(new BN(100_000))
        .accounts({
          globalConfig: globalConfigKey,
          admin: kp.publicKey,
          adminUsdcAta: usdcAta,
          revenueVault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([kp])
        .rpc();
    }, "Unauthorized");
  });

  await test("Deposit revenue: reject zero amount", async () => {
    await expectError(async () => {
      await program.methods
        .depositRevenue(new BN(0))
        .accounts({
          globalConfig: globalConfigKey,
          admin: adminKeypair.publicKey,
          adminUsdcAta,
          revenueVault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([adminKeypair])
        .rpc();
    }, "InvalidAmount");
  });

  await test("Claim dividends: user receives proportional share", async () => {
    // Create user with dividend stake
    const { kp, unsysAta, usdcAta } = await createFundedUser(10_000_000);
    const [stakeKey] = PublicKey.findProgramAddressSync(
      [Buffer.from("dividend_stake"), kp.publicKey.toBuffer()],
      programId,
    );

    // Stake
    await program.methods
      .stakeDividends(STAKE_AMOUNT, 3)
      .accounts({
        globalConfig: globalConfigKey,
        userStake: stakeKey,
        user: kp.publicKey,
        userUnsysAta: unsysAta,
        tokenVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([kp])
      .rpc();

    // Deposit revenue
    await program.methods
      .depositRevenue(REVENUE_DEPOSIT)
      .accounts({
        globalConfig: globalConfigKey,
        admin: adminKeypair.publicKey,
        adminUsdcAta,
        revenueVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([adminKeypair])
      .rpc();

    // Claim
    const beforeBalance = (await getAccount(connection, usdcAta)).amount;
    await program.methods
      .claimDividends()
      .accounts({
        globalConfig: globalConfigKey,
        userStake: stakeKey,
        user: kp.publicKey,
        revenueVault,
        userUsdcAta: usdcAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([kp])
      .rpc();
    const afterBalance = (await getAccount(connection, usdcAta)).amount;

    if (afterBalance <= beforeBalance) {
      throw new Error("User should have received dividends");
    }
  });

  await test("Claim dividends: reject double-claim same epoch", async () => {
    // This user already claimed in the previous test's epoch
    const { kp, unsysAta, usdcAta } = await createFundedUser(10_000_000);
    const [stakeKey] = PublicKey.findProgramAddressSync(
      [Buffer.from("dividend_stake"), kp.publicKey.toBuffer()],
      programId,
    );

    // Stake
    await program.methods
      .stakeDividends(STAKE_AMOUNT, 3)
      .accounts({
        globalConfig: globalConfigKey,
        userStake: stakeKey,
        user: kp.publicKey,
        userUnsysAta: unsysAta,
        tokenVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([kp])
      .rpc();

    // Deposit revenue
    await program.methods
      .depositRevenue(REVENUE_DEPOSIT)
      .accounts({
        globalConfig: globalConfigKey,
        admin: adminKeypair.publicKey,
        adminUsdcAta,
        revenueVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([adminKeypair])
      .rpc();

    // Claim first time
    await program.methods
      .claimDividends()
      .accounts({
        globalConfig: globalConfigKey,
        userStake: stakeKey,
        user: kp.publicKey,
        revenueVault,
        userUsdcAta: usdcAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([kp])
      .rpc();

    // Try to claim again
    await expectError(async () => {
      await program.methods
        .claimDividends()
        .accounts({
          globalConfig: globalConfigKey,
          userStake: stakeKey,
          user: kp.publicKey,
          revenueVault,
          userUsdcAta: usdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([kp])
        .rpc();
    }, "AlreadyClaimed");
  });

  // ================================================================
  console.log("\n--- SECTION 7: Referral Revenue ---");
  // ================================================================

  await test("Deposit referral revenue for partner", async () => {
    const { kp, unsysAta, usdcAta } = await createFundedUser(10_000_000);
    const [partnerKey] = PublicKey.findProgramAddressSync(
      [Buffer.from("partnership_stake"), kp.publicKey.toBuffer()],
      programId,
    );

    // Stake partnership
    await program.methods
      .stakePartnership(PARTNERSHIP_5M, null)
      .accounts({
        globalConfig: globalConfigKey,
        partnershipStake: partnerKey,
        user: kp.publicKey,
        userUnsysAta: unsysAta,
        tokenVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([kp])
      .rpc();

    // Admin deposits referral revenue
    await program.methods
      .depositReferralRevenue(new BN(100_000))
      .accounts({
        globalConfig: globalConfigKey,
        admin: adminKeypair.publicKey,
        adminUsdcAta,
        revenueVault,
        partnershipStake: partnerKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([adminKeypair])
      .rpc();

    const stake = await program.account.partnershipStake.fetch(partnerKey);
    if (stake.referralBalance.toNumber() !== 100_000) {
      throw new Error(
        `Expected 100000, got ${stake.referralBalance.toNumber()}`,
      );
    }
  });

  await test("Claim referral share", async () => {
    const { kp, unsysAta, usdcAta } = await createFundedUser(10_000_000);
    const [partnerKey] = PublicKey.findProgramAddressSync(
      [Buffer.from("partnership_stake"), kp.publicKey.toBuffer()],
      programId,
    );

    // Stake partnership
    await program.methods
      .stakePartnership(PARTNERSHIP_1M, null)
      .accounts({
        globalConfig: globalConfigKey,
        partnershipStake: partnerKey,
        user: kp.publicKey,
        userUnsysAta: unsysAta,
        tokenVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([kp])
      .rpc();

    // Admin deposits referral revenue
    await program.methods
      .depositReferralRevenue(new BN(200_000))
      .accounts({
        globalConfig: globalConfigKey,
        admin: adminKeypair.publicKey,
        adminUsdcAta,
        revenueVault,
        partnershipStake: partnerKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([adminKeypair])
      .rpc();

    // Claim
    const beforeBalance = (await getAccount(connection, usdcAta)).amount;
    await program.methods
      .claimReferralShare()
      .accounts({
        globalConfig: globalConfigKey,
        partnershipStake: partnerKey,
        user: kp.publicKey,
        revenueVault,
        userUsdcAta: usdcAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([kp])
      .rpc();
    const afterBalance = (await getAccount(connection, usdcAta)).amount;

    if (Number(afterBalance) - Number(beforeBalance) !== 200_000) {
      throw new Error("Should have received 200000");
    }
  });

  await test("Claim referral: reject when balance is zero", async () => {
    const { kp, unsysAta, usdcAta } = await createFundedUser(10_000_000);
    const [partnerKey] = PublicKey.findProgramAddressSync(
      [Buffer.from("partnership_stake"), kp.publicKey.toBuffer()],
      programId,
    );

    // Stake partnership
    await program.methods
      .stakePartnership(PARTNERSHIP_1M, null)
      .accounts({
        globalConfig: globalConfigKey,
        partnershipStake: partnerKey,
        user: kp.publicKey,
        userUnsysAta: unsysAta,
        tokenVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([kp])
      .rpc();

    // Try to claim with no balance
    await expectError(async () => {
      await program.methods
        .claimReferralShare()
        .accounts({
          globalConfig: globalConfigKey,
          partnershipStake: partnerKey,
          user: kp.publicKey,
          revenueVault,
          userUsdcAta: usdcAta,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([kp])
        .rpc();
    }, "NoReferralBalance");
  });

  // ================================================================
  console.log("\n--- SECTION 8: Data Provider ---");
  // ================================================================

  await test("Data provider: reject insufficient stake", async () => {
    const { kp, unsysAta } = await createFundedUser(1_000_000);
    const [stakeKey] = PublicKey.findProgramAddressSync(
      [Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()],
      programId,
    );

    await expectError(async () => {
      await program.methods
        .stakeDataProvider(new BN(1_000_000))
        .accounts({
          globalConfig: globalConfigKey,
          dataProviderStake: stakeKey,
          user: kp.publicKey,
          userUnsysAta: unsysAta,
          tokenVault,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([kp])
        .rpc();
    }, "InsufficientDataProviderStake");
  });

  await test("Data provider: stake 5M+, validate, deactivate, unstake", async () => {
    const { kp, unsysAta } = await createFundedUser(10_000_000);
    const [stakeKey] = PublicKey.findProgramAddressSync(
      [Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()],
      programId,
    );

    // Stake
    await program.methods
      .stakeDataProvider(DATA_PROVIDER_STAKE)
      .accounts({
        globalConfig: globalConfigKey,
        dataProviderStake: stakeKey,
        user: kp.publicKey,
        userUnsysAta: unsysAta,
        tokenVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([kp])
      .rpc();

    let stake = await program.account.dataProviderStake.fetch(stakeKey);
    if (!stake.isInitialized) throw new Error("Should be initialized");
    if (stake.active) throw new Error("Should not be active yet");

    // Validate (admin)
    await program.methods
      .validateDataProvider()
      .accounts({
        globalConfig: globalConfigKey,
        dataProviderStake: stakeKey,
        admin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();

    stake = await program.account.dataProviderStake.fetch(stakeKey);
    if (!stake.active) throw new Error("Should be active");

    // Deactivate (admin)
    await program.methods
      .deactivateDataProvider()
      .accounts({
        globalConfig: globalConfigKey,
        dataProviderStake: stakeKey,
        admin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();

    stake = await program.account.dataProviderStake.fetch(stakeKey);
    if (stake.active) throw new Error("Should not be active");

    // Unstake
    await program.methods
      .unstakeDataProvider()
      .accounts({
        globalConfig: globalConfigKey,
        dataProviderStake: stakeKey,
        user: kp.publicKey,
        userUnsysAta: unsysAta,
        tokenVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([kp])
      .rpc();

    stake = await program.account.dataProviderStake.fetch(stakeKey);
    if (stake.isInitialized) throw new Error("Should be uninitialized");
  });

  await test("Data provider: reject unstake while active", async () => {
    const { kp, unsysAta } = await createFundedUser(10_000_000);
    const [stakeKey] = PublicKey.findProgramAddressSync(
      [Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()],
      programId,
    );

    // Stake and validate
    await program.methods
      .stakeDataProvider(DATA_PROVIDER_STAKE)
      .accounts({
        globalConfig: globalConfigKey,
        dataProviderStake: stakeKey,
        user: kp.publicKey,
        userUnsysAta: unsysAta,
        tokenVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([kp])
      .rpc();

    await program.methods
      .validateDataProvider()
      .accounts({
        globalConfig: globalConfigKey,
        dataProviderStake: stakeKey,
        admin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();

    // Try to unstake while active
    await expectError(async () => {
      await program.methods
        .unstakeDataProvider()
        .accounts({
          globalConfig: globalConfigKey,
          dataProviderStake: stakeKey,
          user: kp.publicKey,
          userUnsysAta: unsysAta,
          tokenVault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([kp])
        .rpc();
    }, "MustDeactivateFirst");
  });

  // ================================================================
  console.log("\n--- SECTION 9: Legacy OMEGA Holder ---");
  // ================================================================

  await test("Legacy: register holder with admin-assigned tier", async () => {
    const legacyUser = Keypair.generate();
    const [legacyPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("legacy_omega"), legacyUser.publicKey.toBuffer()],
      programId,
    );

    const configBefore =
      await program.account.globalConfig.fetch(globalConfigKey);

    await program.methods
      .registerLegacyHolder(legacyUser.publicKey, 2)
      .accounts({
        globalConfig: globalConfigKey,
        admin: adminKeypair.publicKey,
        legacyOmegaStake: legacyPda,
        holder: legacyUser.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([adminKeypair])
      .rpc();

    const legacy = await program.account.legacyOmegaStake.fetch(legacyPda);
    if (!legacy.registered) throw new Error("Should be registered");
    if (legacy.tier !== 2)
      throw new Error(`Expected tier 2, got ${legacy.tier}`);

    const configAfter =
      await program.account.globalConfig.fetch(globalConfigKey);
    if (
      configAfter.totalLegacyHolders.toNumber() !==
      configBefore.totalLegacyHolders.toNumber() + 1
    ) {
      throw new Error("Legacy holder count should increment");
    }
  });

  await test("Legacy: reject invalid tier (0 or 4)", async () => {
    const user1 = Keypair.generate();
    const user2 = Keypair.generate();
    const [pda1] = PublicKey.findProgramAddressSync(
      [Buffer.from("legacy_omega"), user1.publicKey.toBuffer()],
      programId,
    );
    const [pda2] = PublicKey.findProgramAddressSync(
      [Buffer.from("legacy_omega"), user2.publicKey.toBuffer()],
      programId,
    );

    await expectError(async () => {
      await program.methods
        .registerLegacyHolder(user1.publicKey, 0)
        .accounts({
          globalConfig: globalConfigKey,
          admin: adminKeypair.publicKey,
          legacyOmegaStake: pda1,
          holder: user1.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([adminKeypair])
        .rpc();
    }, "InvalidTier");

    await expectError(async () => {
      await program.methods
        .registerLegacyHolder(user2.publicKey, 4)
        .accounts({
          globalConfig: globalConfigKey,
          admin: adminKeypair.publicKey,
          legacyOmegaStake: pda2,
          holder: user2.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([adminKeypair])
        .rpc();
    }, "InvalidTier");
  });

  await test("Legacy: enable benefits creates dividend and partnership stakes", async () => {
    const legacyUser = Keypair.generate();

    // Fund user for tx fees
    const transferTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: adminKeypair.publicKey,
        toPubkey: legacyUser.publicKey,
        lamports: 0.02 * LAMPORTS_PER_SOL,
      }),
    );
    await provider.sendAndConfirm(transferTx);

    const [legacyPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("legacy_omega"), legacyUser.publicKey.toBuffer()],
      programId,
    );
    const [divStakeKey] = PublicKey.findProgramAddressSync(
      [Buffer.from("dividend_stake"), legacyUser.publicKey.toBuffer()],
      programId,
    );
    const [partnerKey] = PublicKey.findProgramAddressSync(
      [Buffer.from("partnership_stake"), legacyUser.publicKey.toBuffer()],
      programId,
    );

    // Register with tier 3
    await program.methods
      .registerLegacyHolder(legacyUser.publicKey, 3)
      .accounts({
        globalConfig: globalConfigKey,
        admin: adminKeypair.publicKey,
        legacyOmegaStake: legacyPda,
        holder: legacyUser.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([adminKeypair])
      .rpc();

    // Enable benefits
    await program.methods
      .enableLegacyBenefits()
      .accounts({
        globalConfig: globalConfigKey,
        legacyOmegaStake: legacyPda,
        dividendStake: divStakeKey,
        partnershipStake: partnerKey,
        user: legacyUser.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([legacyUser])
      .rpc();

    const divStake = await program.account.dividendStake.fetch(divStakeKey);
    if (!divStake.isInitialized)
      throw new Error("Dividend stake should be initialized");
    if (divStake.shares.toNumber() === 0)
      throw new Error("Should have virtual shares");

    const partnerStake =
      await program.account.partnershipStake.fetch(partnerKey);
    if (partnerStake.tier !== 3)
      throw new Error(`Expected tier 3, got ${partnerStake.tier}`);
  });

  // ================================================================
  console.log("\n--- SECTION 10: Close Account Flows ---");
  // ================================================================

  await test("Close partnership stake: unstake then close", async () => {
    const { kp, unsysAta } = await createFundedUser(10_000_000);
    const [stakeKey] = PublicKey.findProgramAddressSync(
      [Buffer.from("partnership_stake"), kp.publicKey.toBuffer()],
      programId,
    );

    // Stake
    await program.methods
      .stakePartnership(PARTNERSHIP_1M, null)
      .accounts({
        globalConfig: globalConfigKey,
        partnershipStake: stakeKey,
        user: kp.publicKey,
        userUnsysAta: unsysAta,
        tokenVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([kp])
      .rpc();

    // Unstake
    await program.methods
      .unstakePartnership()
      .accounts({
        globalConfig: globalConfigKey,
        partnershipStake: stakeKey,
        user: kp.publicKey,
        tokenVault,
        userUnsysAta: unsysAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([kp])
      .rpc();

    // Close
    await program.methods
      .closePartnershipStake()
      .accounts({
        partnershipStake: stakeKey,
        user: kp.publicKey,
      })
      .signers([kp])
      .rpc();

    // Verify account is closed
    const exists = await accountExists(stakeKey);
    if (exists) {
      throw new Error("Account should be closed");
    }
  });

  await test("Close data provider stake: deactivate, unstake, then close", async () => {
    const { kp, unsysAta } = await createFundedUser(10_000_000);
    const [stakeKey] = PublicKey.findProgramAddressSync(
      [Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()],
      programId,
    );

    // Stake
    await program.methods
      .stakeDataProvider(DATA_PROVIDER_STAKE)
      .accounts({
        globalConfig: globalConfigKey,
        dataProviderStake: stakeKey,
        user: kp.publicKey,
        userUnsysAta: unsysAta,
        tokenVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([kp])
      .rpc();

    // Validate then deactivate
    await program.methods
      .validateDataProvider()
      .accounts({
        globalConfig: globalConfigKey,
        dataProviderStake: stakeKey,
        admin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();

    await program.methods
      .deactivateDataProvider()
      .accounts({
        globalConfig: globalConfigKey,
        dataProviderStake: stakeKey,
        admin: adminKeypair.publicKey,
      })
      .signers([adminKeypair])
      .rpc();

    // Unstake
    await program.methods
      .unstakeDataProvider()
      .accounts({
        globalConfig: globalConfigKey,
        dataProviderStake: stakeKey,
        user: kp.publicKey,
        userUnsysAta: unsysAta,
        tokenVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([kp])
      .rpc();

    // Close
    await program.methods
      .closeDataProviderStake()
      .accounts({
        dataProviderStake: stakeKey,
        user: kp.publicKey,
      })
      .signers([kp])
      .rpc();

    // Verify account is closed
    const exists = await accountExists(stakeKey);
    if (exists) {
      throw new Error("Account should be closed");
    }
  });

  await test("Re-stake partnership after close", async () => {
    const { kp, unsysAta } = await createFundedUser(10_000_000);
    const [stakeKey] = PublicKey.findProgramAddressSync(
      [Buffer.from("partnership_stake"), kp.publicKey.toBuffer()],
      programId,
    );

    // Stake -> Unstake -> Close
    await program.methods
      .stakePartnership(PARTNERSHIP_1M, null)
      .accounts({
        globalConfig: globalConfigKey,
        partnershipStake: stakeKey,
        user: kp.publicKey,
        userUnsysAta: unsysAta,
        tokenVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([kp])
      .rpc();

    await program.methods
      .unstakePartnership()
      .accounts({
        globalConfig: globalConfigKey,
        partnershipStake: stakeKey,
        user: kp.publicKey,
        tokenVault,
        userUnsysAta: unsysAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([kp])
      .rpc();

    await program.methods
      .closePartnershipStake()
      .accounts({
        partnershipStake: stakeKey,
        user: kp.publicKey,
      })
      .signers([kp])
      .rpc();

    // Re-stake at higher tier
    await program.methods
      .stakePartnership(PARTNERSHIP_2M, null)
      .accounts({
        globalConfig: globalConfigKey,
        partnershipStake: stakeKey,
        user: kp.publicKey,
        userUnsysAta: unsysAta,
        tokenVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([kp])
      .rpc();

    const stake = await program.account.partnershipStake.fetch(stakeKey);
    if (stake.tier !== 2) {
      throw new Error(`Expected tier 2, got ${stake.tier}`);
    }
  });

  // ================================================================
  // Summary
  // ================================================================
  console.log("\n" + "=".repeat(70));
  console.log("TEST RESULTS");
  console.log("=".repeat(70));
  console.log(`  Passed:  ${passed}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Total:   ${passed + failed + skipped}`);
  console.log("=".repeat(70));

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
