import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { Network, NetworkConfig, getGlobalConfigPda } from "./config";

export class UnsysClient {
  program: any;
  connection: Connection;
  admin: Keypair;
  config: NetworkConfig;
  globalConfigPda: PublicKey;

  constructor(connection: Connection, admin: Keypair, config: NetworkConfig) {
    this.connection = connection;
    this.admin = admin;
    this.config = config;
    this.globalConfigPda = getGlobalConfigPda(config.programId);

    // Load IDL and create program
    const idlPath = path.join(
      __dirname,
      "../../../target/idl/unsys_staking.json",
    );
    const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

    const wallet = {
      publicKey: admin.publicKey,
      signTransaction: async (tx: Transaction) => {
        tx.partialSign(admin);
        return tx;
      },
      signAllTransactions: async (txs: Transaction[]) => {
        txs.forEach((tx) => tx.partialSign(admin));
        return txs;
      },
    };

    const provider = new AnchorProvider(connection, wallet as any, {
      commitment: "confirmed",
    });

    this.program = new Program(idl, provider);
  }

  // ============================================================
  // Read Operations
  // ============================================================

  async getGlobalConfig() {
    return this.program.account.globalConfig.fetch(this.globalConfigPda);
  }

  async getPartnershipStake(user: PublicKey) {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("partnership_stake"), user.toBuffer()],
      this.config.programId,
    );
    return this.program.account.partnershipStake.fetch(pda);
  }

  async getDividendStake(user: PublicKey) {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("dividend_stake"), user.toBuffer()],
      this.config.programId,
    );
    return this.program.account.dividendStake.fetch(pda);
  }

  async getDataProviderStake(user: PublicKey) {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("data_provider_stake"), user.toBuffer()],
      this.config.programId,
    );
    return this.program.account.dataProviderStake.fetch(pda);
  }

  async getLegacyOmegaStake(holder: PublicKey) {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("legacy_omega"), holder.toBuffer()],
      this.config.programId,
    );
    return this.program.account.legacyOmegaStake.fetch(pda);
  }

  // ============================================================
  // Admin Operations
  // ============================================================

  async initialize(tokenVault: PublicKey, revenueVault: PublicKey) {
    return this.program.methods
      .initialize()
      .accounts({
        globalConfig: this.globalConfigPda,
        admin: this.admin.publicKey,
        unsysMint: this.config.unsysMint,
        omegaMint: this.config.omegaMint,
        usdcMint: this.config.usdcMint,
        buybackWallet: this.config.buybackWallet,
        tokenVault,
        revenueVault,
        // UNSYS uses Token-2022, USDC uses standard SPL Token
        unsysTokenProgram: TOKEN_2022_PROGRAM_ID,
        usdcTokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: new PublicKey(
          "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
        ),
        systemProgram: new PublicKey("11111111111111111111111111111111"),
      })
      .signers([this.admin])
      .rpc();
  }

  async depositRevenue(amount: BN) {
    const adminUsdcAta = await getOrCreateAssociatedTokenAccount(
      this.connection,
      this.admin,
      this.config.usdcMint,
      this.admin.publicKey,
    );

    const config = await this.getGlobalConfig();

    return this.program.methods
      .depositRevenue(amount)
      .accounts({
        globalConfig: this.globalConfigPda,
        admin: this.admin.publicKey,
        adminUsdcAta: adminUsdcAta.address,
        revenueVault: config.revenueVault,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([this.admin])
      .rpc();
  }

  async depositReferralRevenue(partnerAddress: PublicKey, amount: BN) {
    const adminUsdcAta = await getOrCreateAssociatedTokenAccount(
      this.connection,
      this.admin,
      this.config.usdcMint,
      this.admin.publicKey,
    );

    const config = await this.getGlobalConfig();

    const [partnershipStake] = PublicKey.findProgramAddressSync(
      [Buffer.from("partnership_stake"), partnerAddress.toBuffer()],
      this.config.programId,
    );

    return this.program.methods
      .depositReferralRevenue(amount)
      .accounts({
        globalConfig: this.globalConfigPda,
        admin: this.admin.publicKey,
        adminUsdcAta: adminUsdcAta.address,
        revenueVault: config.revenueVault,
        partnershipStake,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([this.admin])
      .rpc();
  }

  async registerLegacyHolder(holderAddress: PublicKey, tier: number) {
    const [legacyOmegaStake] = PublicKey.findProgramAddressSync(
      [Buffer.from("legacy_omega"), holderAddress.toBuffer()],
      this.config.programId,
    );

    return this.program.methods
      .registerLegacyHolder(holderAddress, tier)
      .accounts({
        globalConfig: this.globalConfigPda,
        admin: this.admin.publicKey,
        legacyOmegaStake,
        holder: holderAddress,
        systemProgram: new PublicKey("11111111111111111111111111111111"),
      })
      .signers([this.admin])
      .rpc();
  }

  async revokeLegacyPartnership(holderAddress: PublicKey) {
    const [partnershipStake] = PublicKey.findProgramAddressSync(
      [Buffer.from("partnership_stake"), holderAddress.toBuffer()],
      this.config.programId,
    );

    return this.program.methods
      .revokeLegacyPartnership()
      .accounts({
        globalConfig: this.globalConfigPda,
        partnershipStake,
        admin: this.admin.publicKey,
      })
      .signers([this.admin])
      .rpc();
  }

  async validateDataProvider(providerAddress: PublicKey) {
    const [dataProviderStake] = PublicKey.findProgramAddressSync(
      [Buffer.from("data_provider_stake"), providerAddress.toBuffer()],
      this.config.programId,
    );

    return this.program.methods
      .validateDataProvider()
      .accounts({
        globalConfig: this.globalConfigPda,
        dataProviderStake,
        admin: this.admin.publicKey,
      })
      .signers([this.admin])
      .rpc();
  }

  async deactivateDataProvider(providerAddress: PublicKey) {
    const [dataProviderStake] = PublicKey.findProgramAddressSync(
      [Buffer.from("data_provider_stake"), providerAddress.toBuffer()],
      this.config.programId,
    );

    return this.program.methods
      .deactivateDataProvider()
      .accounts({
        globalConfig: this.globalConfigPda,
        dataProviderStake,
        admin: this.admin.publicKey,
      })
      .signers([this.admin])
      .rpc();
  }

  async proposeAdminTransfer(newAdmin: PublicKey) {
    return this.program.methods
      .proposeAdminTransfer(newAdmin)
      .accounts({
        globalConfig: this.globalConfigPda,
        admin: this.admin.publicKey,
      })
      .signers([this.admin])
      .rpc();
  }

  async acceptAdminTransfer() {
    return this.program.methods
      .acceptAdminTransfer()
      .accounts({
        globalConfig: this.globalConfigPda,
        newAdmin: this.admin.publicKey,
      })
      .signers([this.admin])
      .rpc();
  }

  async cancelAdminTransfer() {
    return this.program.methods
      .cancelAdminTransfer()
      .accounts({
        globalConfig: this.globalConfigPda,
        admin: this.admin.publicKey,
      })
      .signers([this.admin])
      .rpc();
  }

  async pause() {
    return this.program.methods
      .pause()
      .accounts({
        globalConfig: this.globalConfigPda,
        admin: this.admin.publicKey,
      })
      .signers([this.admin])
      .rpc();
  }

  async unpause() {
    return this.program.methods
      .unpause()
      .accounts({
        globalConfig: this.globalConfigPda,
        admin: this.admin.publicKey,
      })
      .signers([this.admin])
      .rpc();
  }
}
