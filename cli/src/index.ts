#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import {
  getOrCreateAssociatedTokenAccount,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

import {
  Network,
  getNetworkConfig,
  getConnection,
  loadKeypair,
  getGlobalConfigPda,
} from "./lib/config";
import { UnsysClient } from "./lib/client";

const program = new Command();

program
  .name("unsys-admin")
  .description("Admin CLI for UNSYS Staking Program")
  .version("1.0.0")
  .option(
    "-n, --network <network>",
    "Network to use (devnet or mainnet-beta)",
    "devnet",
  )
  .option("-k, --keypair <path>", "Path to keypair file");

// Helper to get client
async function getClient(options: any): Promise<UnsysClient> {
  const network = options.network as Network;
  const config = getNetworkConfig(network);
  const connection = getConnection(network);
  const keypair = loadKeypair(options.keypair);

  console.log(chalk.gray(`Network: ${network}`));
  console.log(chalk.gray(`Admin: ${keypair.publicKey.toBase58()}`));
  console.log(chalk.gray(`Program: ${config.programId.toBase58()}`));
  console.log();

  return new UnsysClient(connection, keypair, config);
}

// ============================================================
// Info Commands
// ============================================================

program
  .command("info")
  .description("Show program configuration and state")
  .action(async () => {
    const options = program.opts();
    const client = await getClient(options);

    try {
      const config = await client.getGlobalConfig();

      console.log(chalk.bold("Global Configuration:"));
      console.log(`  Admin:            ${config.admin.toBase58()}`);
      console.log(
        `  Paused:           ${config.paused ? chalk.red("YES") : chalk.green("NO")}`,
      );
      console.log(`  Dividend Epoch:   ${config.dividendEpoch.toString()}`);
      console.log(
        `  Dividend Pool:    ${config.epochDividendPool.toString()} (raw)`,
      );
      console.log(
        `  Dividend Snapshot:${config.epochDividendSnapshot.toString()} (raw)`,
      );
      console.log(
        `  Total Shares:     ${config.totalDividendShares.toString()}`,
      );
      console.log(
        `  Legacy Holders:   ${config.totalLegacyHolders.toString()}`,
      );
      console.log();
      console.log(chalk.bold("Token Vaults:"));
      console.log(`  UNSYS Vault:      ${config.tokenVault.toBase58()}`);
      console.log(`  USDC Vault:       ${config.revenueVault.toBase58()}`);
      console.log();
      console.log(chalk.bold("Mints:"));
      console.log(`  UNSYS:            ${config.unsysMint.toBase58()}`);
      console.log(`  OMEGA:            ${config.omegaMint.toBase58()}`);
      console.log(`  USDC:             ${config.usdcMint.toBase58()}`);
    } catch (e: any) {
      if (e.message?.includes("Account does not exist")) {
        console.log(chalk.yellow("Program not initialized on this network."));
        console.log(`Run: unsys-admin init --network ${options.network}`);
      } else {
        throw e;
      }
    }
  });

program
  .command("partner <address>")
  .description("Show partnership stake info for an address")
  .action(async (address: string) => {
    const options = program.opts();
    const client = await getClient(options);
    const pubkey = new PublicKey(address);

    try {
      const stake = await client.getPartnershipStake(pubkey);

      console.log(chalk.bold("Partnership Stake:"));
      console.log(`  Owner:            ${stake.owner.toBase58()}`);
      console.log(`  Staked Amount:    ${stake.stakedAmount.toString()} (raw)`);
      console.log(`  Tier:             ${stake.tier}`);
      console.log(
        `  Referral Balance: ${stake.referralBalance.toString()} (raw)`,
      );
      console.log(`  Initialized:      ${stake.isInitialized}`);
      if (stake.referrer) {
        console.log(`  Referrer:         ${stake.referrer.toBase58()}`);
      }
    } catch (e: any) {
      console.log(chalk.yellow(`No partnership stake found for ${address}`));
    }
  });

// ============================================================
// Revenue Commands
// ============================================================

program
  .command("deposit-revenue <amount>")
  .description("Deposit USDC to dividend pool (amount in smallest units)")
  .action(async (amount: string) => {
    const options = program.opts();
    const client = await getClient(options);

    console.log(chalk.bold(`Depositing ${amount} USDC to dividend pool...`));

    const tx = await client.depositRevenue(new BN(amount));
    console.log(chalk.green(`Success! TX: ${tx}`));
  });

program
  .command("deposit-referral <partner> <amount>")
  .description("Deposit referral revenue for a partner")
  .action(async (partner: string, amount: string) => {
    const options = program.opts();
    const client = await getClient(options);
    const partnerPubkey = new PublicKey(partner);

    console.log(
      chalk.bold(`Depositing ${amount} USDC to partner ${partner}...`),
    );

    const tx = await client.depositReferralRevenue(
      partnerPubkey,
      new BN(amount),
    );
    console.log(chalk.green(`Success! TX: ${tx}`));
  });

// ============================================================
// Legacy Commands
// ============================================================

program
  .command("register-legacy <holder> <tier>")
  .description("Register a legacy OMEGA holder with tier (1, 2, or 3)")
  .action(async (holder: string, tier: string) => {
    const options = program.opts();
    const client = await getClient(options);
    const holderPubkey = new PublicKey(holder);
    const tierNum = parseInt(tier);

    if (tierNum < 1 || tierNum > 3) {
      console.log(chalk.red("Tier must be 1, 2, or 3"));
      process.exit(1);
    }

    console.log(
      chalk.bold(`Registering legacy holder ${holder} with tier ${tierNum}...`),
    );

    const tx = await client.registerLegacyHolder(holderPubkey, tierNum);
    console.log(chalk.green(`Success! TX: ${tx}`));
  });

program
  .command("revoke-legacy <holder>")
  .description("Revoke legacy partnership for a holder")
  .action(async (holder: string) => {
    const options = program.opts();
    const client = await getClient(options);
    const holderPubkey = new PublicKey(holder);

    console.log(chalk.bold(`Revoking legacy partnership for ${holder}...`));

    const tx = await client.revokeLegacyPartnership(holderPubkey);
    console.log(chalk.green(`Success! TX: ${tx}`));
  });

// ============================================================
// Data Provider Commands
// ============================================================

program
  .command("validate-provider <address>")
  .description("Validate (activate) a data provider")
  .action(async (address: string) => {
    const options = program.opts();
    const client = await getClient(options);
    const providerPubkey = new PublicKey(address);

    console.log(chalk.bold(`Validating data provider ${address}...`));

    const tx = await client.validateDataProvider(providerPubkey);
    console.log(chalk.green(`Success! TX: ${tx}`));
  });

program
  .command("deactivate-provider <address>")
  .description("Deactivate a data provider")
  .action(async (address: string) => {
    const options = program.opts();
    const client = await getClient(options);
    const providerPubkey = new PublicKey(address);

    console.log(chalk.bold(`Deactivating data provider ${address}...`));

    const tx = await client.deactivateDataProvider(providerPubkey);
    console.log(chalk.green(`Success! TX: ${tx}`));
  });

// ============================================================
// Admin Transfer Commands
// ============================================================

program
  .command("propose-admin <newAdmin>")
  .description("Propose a new admin address")
  .action(async (newAdmin: string) => {
    const options = program.opts();
    const client = await getClient(options);
    const newAdminPubkey = new PublicKey(newAdmin);

    console.log(chalk.bold(`Proposing admin transfer to ${newAdmin}...`));
    console.log(
      chalk.yellow(
        "The new admin must call 'accept-admin' to complete the transfer.",
      ),
    );

    const tx = await client.proposeAdminTransfer(newAdminPubkey);
    console.log(chalk.green(`Success! TX: ${tx}`));
  });

program
  .command("accept-admin")
  .description("Accept pending admin transfer (run as the new admin)")
  .action(async () => {
    const options = program.opts();
    const client = await getClient(options);

    console.log(chalk.bold("Accepting admin transfer..."));

    const tx = await client.acceptAdminTransfer();
    console.log(chalk.green(`Success! TX: ${tx}`));
  });

program
  .command("cancel-admin")
  .description("Cancel pending admin transfer")
  .action(async () => {
    const options = program.opts();
    const client = await getClient(options);

    console.log(chalk.bold("Cancelling admin transfer..."));

    const tx = await client.cancelAdminTransfer();
    console.log(chalk.green(`Success! TX: ${tx}`));
  });

// ============================================================
// Emergency Commands
// ============================================================

program
  .command("pause")
  .description("Emergency pause the program")
  .action(async () => {
    const options = program.opts();
    const client = await getClient(options);

    console.log(chalk.bold(chalk.red("PAUSING PROGRAM...")));
    console.log(
      chalk.yellow("This will prevent all staking, claiming, and deposits!"),
    );

    const tx = await client.pause();
    console.log(chalk.green(`Success! TX: ${tx}`));
    console.log(chalk.red("Program is now PAUSED."));
  });

program
  .command("unpause")
  .description("Unpause the program")
  .action(async () => {
    const options = program.opts();
    const client = await getClient(options);

    console.log(chalk.bold("Unpausing program..."));

    const tx = await client.unpause();
    console.log(chalk.green(`Success! TX: ${tx}`));
    console.log(chalk.green("Program is now ACTIVE."));
  });

// ============================================================
// Initialize Command
// ============================================================

program
  .command("init")
  .description("Initialize the program (one-time setup)")
  .action(async () => {
    const options = program.opts();
    const network = options.network as Network;
    const config = getNetworkConfig(network);
    const connection = getConnection(network);
    const keypair = loadKeypair(options.keypair);

    console.log(chalk.bold("Initializing UNSYS Staking Program..."));
    console.log(chalk.gray(`Network: ${network}`));
    console.log(chalk.gray(`Admin: ${keypair.publicKey.toBase58()}`));
    console.log(chalk.gray(`Program: ${config.programId.toBase58()}`));
    console.log();

    const globalConfigPda = getGlobalConfigPda(config.programId);
    console.log(`GlobalConfig PDA: ${globalConfigPda.toBase58()}`);

    // Create token vaults
    console.log("\nCreating token vaults...");

    // UNSYS uses Token-2022
    const tokenVault = await getOrCreateAssociatedTokenAccount(
      connection,
      keypair,
      config.unsysMint,
      globalConfigPda,
      true, // allowOwnerOffCurve
      undefined, // commitment
      undefined, // confirmOptions
      TOKEN_2022_PROGRAM_ID, // programId - Token-2022 for UNSYS
    );
    console.log(`  UNSYS Vault: ${tokenVault.address.toBase58()}`);

    // USDC uses standard SPL Token
    const revenueVault = await getOrCreateAssociatedTokenAccount(
      connection,
      keypair,
      config.usdcMint,
      globalConfigPda,
      true,
      undefined, // commitment
      undefined, // confirmOptions
      TOKEN_PROGRAM_ID, // programId - standard SPL Token for USDC
    );
    console.log(`  USDC Vault: ${revenueVault.address.toBase58()}`);

    // Initialize
    console.log("\nInitializing program...");
    const client = new UnsysClient(connection, keypair, config);

    try {
      const tx = await client.initialize(
        tokenVault.address,
        revenueVault.address,
      );
      console.log(chalk.green(`\nSuccess! TX: ${tx}`));

      console.log("\n" + chalk.bold("Program initialized!"));
      console.log(`  GlobalConfig: ${globalConfigPda.toBase58()}`);
      console.log(`  Token Vault:  ${tokenVault.address.toBase58()}`);
      console.log(`  Revenue Vault:${revenueVault.address.toBase58()}`);
    } catch (e: any) {
      if (e.message?.includes("AlreadyInitialized")) {
        console.log(chalk.yellow("\nProgram already initialized."));
      } else {
        throw e;
      }
    }
  });

program.parse();
