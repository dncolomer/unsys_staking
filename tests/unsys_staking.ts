import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { UnsysStaking } from "../target/types/unsys_staking";
import { assert } from "chai";
import BN from "bn.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

describe("unsys_staking", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.unsysStaking as Program<UnsysStaking>;
  const provider = anchor.getProvider();

  let admin: anchor.web3.Keypair;
  let user: anchor.web3.Keypair;
  let referrer: anchor.web3.Keypair;
  let unsysMint: anchor.web3.PublicKey;
  let omegaMint: anchor.web3.PublicKey;
  let usdcMint: anchor.web3.PublicKey;
  let adminUnsysAta: anchor.web3.PublicKey;
  let userUnsysAta: anchor.web3.PublicKey;
  let userUsdcAta: anchor.web3.PublicKey;
  let adminUsdcAta: anchor.web3.PublicKey;
  let tokenVault: anchor.web3.PublicKey;
  let revenueVault: anchor.web3.PublicKey;
  let globalConfigKey: anchor.web3.PublicKey;
  let buybackWallet: anchor.web3.PublicKey;

  const STAKE_AMOUNT = new BN(1_000_000);
  const PARTNERSHIP_1M = new BN(1_000_000);
  const PARTNERSHIP_2M = new BN(2_000_000);
  const PARTNERSHIP_5M = new BN(5_000_000);
  const DATA_PROVIDER_STAKE = new BN(5_000_000);
  const REVENUE_DEPOSIT = new BN(1_000_000);

  async function airdropSol(pubkey: anchor.web3.PublicKey, amount: number) {
    const sig = await provider.connection.requestAirdrop(pubkey, amount * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);
  }

  async function createFundedUser(unsysAmount: number = 50_000_000) {
    const kp = anchor.web3.Keypair.generate();
    await airdropSol(kp.publicKey, 10);
    const ata = (await getOrCreateAssociatedTokenAccount(provider.connection, kp, unsysMint, kp.publicKey)).address;
    if (unsysAmount > 0) await mintTo(provider.connection, admin, unsysMint, ata, admin, unsysAmount);
    return { kp, ata };
  }

  async function getUserUsdcAta(kp: anchor.web3.Keypair) {
    return (await getOrCreateAssociatedTokenAccount(provider.connection, kp, usdcMint, kp.publicKey)).address;
  }

  before(async () => {
    admin = anchor.web3.Keypair.generate();
    user = anchor.web3.Keypair.generate();
    referrer = anchor.web3.Keypair.generate();
    await airdropSol(admin.publicKey, 100);
    await airdropSol(user.publicKey, 100);
    await airdropSol(referrer.publicKey, 10);

    unsysMint = await createMint(provider.connection, admin, admin.publicKey, null, 6);
    omegaMint = await createMint(provider.connection, admin, admin.publicKey, null, 6);
    usdcMint = await createMint(provider.connection, admin, admin.publicKey, null, 6);

    adminUnsysAta = (await getOrCreateAssociatedTokenAccount(provider.connection, admin, unsysMint, admin.publicKey)).address;
    userUnsysAta = (await getOrCreateAssociatedTokenAccount(provider.connection, user, unsysMint, user.publicKey)).address;
    userUsdcAta = (await getOrCreateAssociatedTokenAccount(provider.connection, user, usdcMint, user.publicKey)).address;
    adminUsdcAta = (await getOrCreateAssociatedTokenAccount(provider.connection, admin, usdcMint, admin.publicKey)).address;

    [globalConfigKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("global_config_v3")], program.programId);
    tokenVault = (await getOrCreateAssociatedTokenAccount(provider.connection, admin, unsysMint, globalConfigKey, true)).address;
    revenueVault = (await getOrCreateAssociatedTokenAccount(provider.connection, admin, usdcMint, globalConfigKey, true)).address;

    buybackWallet = anchor.web3.Keypair.generate().publicKey;

    await mintTo(provider.connection, admin, unsysMint, adminUnsysAta, admin, 500_000_000);
    await mintTo(provider.connection, admin, unsysMint, userUnsysAta, admin, 50_000_000);
    await mintTo(provider.connection, admin, usdcMint, adminUsdcAta, admin, 500_000_000);
  });

  // ================================================================
  describe("initialize", () => {
    it("should initialize", async () => {
      await program.methods.initialize()
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, unsysMint, omegaMint, usdcMint, buybackWallet, tokenVault, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([admin]).rpc();

      const config = await program.account.globalConfig.fetch(globalConfigKey);
      assert.ok(config.admin.equals(admin.publicKey));
      assert.equal(config.dividendEpoch.toNumber(), 0);
      assert.equal(config.epochDividendPool.toNumber(), 0);
      assert.equal(config.paused, false);
      assert.equal(config.totalLegacyHolders.toNumber(), 0);
    });

    it("should reject re-initialization", async () => {
      try {
        await program.methods.initialize()
          .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, unsysMint, omegaMint, usdcMint, buybackWallet, tokenVault, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
          .signers([admin]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "AlreadyInitialized"); }
    });
  });

  // ================================================================
  describe("admin_transfer", () => {
    it("should propose and accept", async () => {
      const newAdmin = anchor.web3.Keypair.generate();
      await airdropSol(newAdmin.publicKey, 5);
      await program.methods.proposeAdminTransfer(newAdmin.publicKey)
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey }).signers([admin]).rpc();
      await program.methods.acceptAdminTransfer()
        .accounts({ globalConfig: globalConfigKey, newAdmin: newAdmin.publicKey }).signers([newAdmin]).rpc();
      const c = await program.account.globalConfig.fetch(globalConfigKey);
      assert.ok(c.admin.equals(newAdmin.publicKey));
      // Transfer back
      await program.methods.proposeAdminTransfer(admin.publicKey)
        .accounts({ globalConfig: globalConfigKey, admin: newAdmin.publicKey }).signers([newAdmin]).rpc();
      await program.methods.acceptAdminTransfer()
        .accounts({ globalConfig: globalConfigKey, newAdmin: admin.publicKey }).signers([admin]).rpc();
    });

    it("should reject propose by non-admin", async () => {
      const atk = anchor.web3.Keypair.generate();
      await airdropSol(atk.publicKey, 5);
      try {
        await program.methods.proposeAdminTransfer(atk.publicKey)
          .accounts({ globalConfig: globalConfigKey, admin: atk.publicKey }).signers([atk]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "Unauthorized"); }
    });

    it("should cancel admin transfer", async () => {
      const na = anchor.web3.Keypair.generate();
      await program.methods.proposeAdminTransfer(na.publicKey)
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey }).signers([admin]).rpc();
      await program.methods.cancelAdminTransfer()
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey }).signers([admin]).rpc();
      const c = await program.account.globalConfig.fetch(globalConfigKey);
      assert.ok(c.pendingAdmin.equals(anchor.web3.PublicKey.default));
    });
  });

  // ================================================================
  describe("pause and unpause", () => {
    it("should pause the program", async () => {
      await program.methods.pause()
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey }).signers([admin]).rpc();
      assert.equal((await program.account.globalConfig.fetch(globalConfigKey)).paused, true);
    });

    it("should reject operations when paused", async () => {
      try {
        await program.methods.depositRevenue(REVENUE_DEPOSIT)
          .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([admin]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "ProgramPaused"); }
    });

    it("should unpause the program", async () => {
      await program.methods.unpause()
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey }).signers([admin]).rpc();
      assert.equal((await program.account.globalConfig.fetch(globalConfigKey)).paused, false);
    });
  });

  // ================================================================
  describe("stake_dividends", () => {
    it("should stake 3m (1.1x)", async () => {
      const [sk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), user.publicKey.toBuffer()], program.programId);
      await program.methods.stakeDividends(STAKE_AMOUNT, 3)
        .accounts({ globalConfig: globalConfigKey, userStake: sk, user: user.publicKey, userUnsysAta, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([user]).rpc();
      const s = await program.account.dividendStake.fetch(sk);
      assert.ok(s.amount.eq(STAKE_AMOUNT));
      assert.equal(s.multiplierBps, 11000);
      assert.equal(s.isInitialized, true);
    });

    it("should stake 6m (1.25x)", async () => {
      const { kp, ata } = await createFundedUser();
      const [sk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakeDividends(STAKE_AMOUNT, 6)
        .accounts({ globalConfig: globalConfigKey, userStake: sk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();
      assert.equal((await program.account.dividendStake.fetch(sk)).multiplierBps, 12500);
    });

    it("should stake 12m (1.5x)", async () => {
      const { kp, ata } = await createFundedUser();
      const [sk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakeDividends(STAKE_AMOUNT, 12)
        .accounts({ globalConfig: globalConfigKey, userStake: sk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();
      assert.equal((await program.account.dividendStake.fetch(sk)).multiplierBps, 15000);
    });

    it("should reject invalid lock period", async () => {
      const { kp, ata } = await createFundedUser();
      const [sk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), kp.publicKey.toBuffer()], program.programId);
      try {
        await program.methods.stakeDividends(STAKE_AMOUNT, 1)
          .accounts({ globalConfig: globalConfigKey, userStake: sk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
          .signers([kp]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "Invalid lock period"); }
    });

    it("should reject zero amount", async () => {
      const { kp, ata } = await createFundedUser();
      const [sk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), kp.publicKey.toBuffer()], program.programId);
      try {
        await program.methods.stakeDividends(new BN(0), 3)
          .accounts({ globalConfig: globalConfigKey, userStake: sk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
          .signers([kp]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "InvalidAmount"); }
    });
  });

  // ================================================================
  describe("unstake_dividends", () => {
    it("should reject when lock not expired", async () => {
      const [sk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), user.publicKey.toBuffer()], program.programId);
      try {
        await program.methods.unstakeDividends()
          .accounts({ globalConfig: globalConfigKey, userStake: sk, user: user.publicKey, userUnsysAta, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([user]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "LockPeriodNotExpired"); }
    });
  });

  // ================================================================
  describe("stake_partnership (tiered: 1M/2M/5M)", () => {
    it("should reject below 1M minimum", async () => {
      const { kp, ata } = await createFundedUser();
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), kp.publicKey.toBuffer()], program.programId);
      try {
        await program.methods.stakePartnership(new BN(500_000), null)
          .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
          .signers([kp]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "InsufficientPartnershipStake"); }
    });

    it("should stake 1M → tier 1", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakePartnership(PARTNERSHIP_1M, null)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();
      const s = await program.account.partnershipStake.fetch(pk);
      assert.equal(s.tier, 1);
      assert.equal(s.referralBalance.toNumber(), 0);
      assert.equal(s.isInitialized, true);
    });

    it("should stake 2M → tier 2", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakePartnership(PARTNERSHIP_2M, null)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();
      assert.equal((await program.account.partnershipStake.fetch(pk)).tier, 2);
    });

    it("should stake 5M → tier 3", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakePartnership(PARTNERSHIP_5M, null)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();
      assert.equal((await program.account.partnershipStake.fetch(pk)).tier, 3);
    });

    it("should stake with referrer", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakePartnership(PARTNERSHIP_1M, referrer.publicKey)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();
      assert.ok((await program.account.partnershipStake.fetch(pk)).referrer?.equals(referrer.publicKey));
    });
  });

  // ================================================================
  describe("unstake_partnership (full only)", () => {
    it("should fully unstake and revoke tier", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakePartnership(PARTNERSHIP_1M, null)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();

      const before = await provider.connection.getTokenAccountBalance(ata);
      await program.methods.unstakePartnership()
        .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: kp.publicKey, tokenVault, userUnsysAta: ata, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([kp]).rpc();
      const after = await provider.connection.getTokenAccountBalance(ata);
      assert.equal(parseInt(after.value.amount) - parseInt(before.value.amount), PARTNERSHIP_1M.toNumber());

      const s = await program.account.partnershipStake.fetch(pk);
      assert.equal(s.tier, 0);
      assert.equal(s.isInitialized, false);
    });

    it("should reject unstake when referral balance > 0", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakePartnership(PARTNERSHIP_1M, null)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();

      // Admin deposits referral revenue
      await program.methods.depositReferralRevenue(new BN(50_000))
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, partnershipStake: pk, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([admin]).rpc();

      try {
        await program.methods.unstakePartnership()
          .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: kp.publicKey, tokenVault, userUnsysAta: ata, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([kp]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "MustClaimReferralFirst"); }

      // Claim referral first, then unstake
      const usdcAta = await getUserUsdcAta(kp);
      await program.methods.claimReferralShare()
        .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: kp.publicKey, revenueVault, userUsdcAta: usdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([kp]).rpc();

      await program.methods.unstakePartnership()
        .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: kp.publicKey, tokenVault, userUnsysAta: ata, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([kp]).rpc();
      assert.equal((await program.account.partnershipStake.fetch(pk)).tier, 0);
    });

    it("should reject unstake by non-owner", async () => {
      const { kp: st, ata } = await createFundedUser(10_000_000);
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), st.publicKey.toBuffer()], program.programId);
      await program.methods.stakePartnership(PARTNERSHIP_1M, null)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: st.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([st]).rpc();
      const atk = anchor.web3.Keypair.generate();
      await airdropSol(atk.publicKey, 5);
      const aAta = (await getOrCreateAssociatedTokenAccount(provider.connection, atk, unsysMint, atk.publicKey)).address;
      try {
        await program.methods.unstakePartnership()
          .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: atk.publicKey, tokenVault, userUnsysAta: aAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([atk]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.ok(e.toString().length > 0); }
    });
  });

  // ================================================================
  describe("close and re-stake partnership", () => {
    it("should close then re-stake", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), kp.publicKey.toBuffer()], program.programId);

      // Stake
      await program.methods.stakePartnership(PARTNERSHIP_1M, null)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();

      // Unstake
      await program.methods.unstakePartnership()
        .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: kp.publicKey, tokenVault, userUnsysAta: ata, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([kp]).rpc();

      // Close
      await program.methods.closePartnershipStake()
        .accounts({ partnershipStake: pk, user: kp.publicKey })
        .signers([kp]).rpc();
      try {
        await program.account.partnershipStake.fetch(pk);
        assert.fail("Should be closed");
      } catch (e) { assert.ok(e.toString().includes("Account does not exist")); }

      // Re-stake at higher tier
      await program.methods.stakePartnership(PARTNERSHIP_2M, null)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();
      assert.equal((await program.account.partnershipStake.fetch(pk)).tier, 2);
    });
  });

  // ================================================================
  describe("deposit_referral_revenue", () => {
    let partner: anchor.web3.Keypair;
    let partnerAta: anchor.web3.PublicKey;
    let partnerPk: anchor.web3.PublicKey;

    before(async () => {
      const funded = await createFundedUser(10_000_000);
      partner = funded.kp;
      partnerAta = funded.ata;
      [partnerPk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), partner.publicKey.toBuffer()], program.programId);
      await program.methods.stakePartnership(PARTNERSHIP_5M, null)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: partnerPk, user: partner.publicKey, userUnsysAta: partnerAta, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([partner]).rpc();
    });

    it("should deposit referral revenue for a partner", async () => {
      const amount = new BN(100_000);
      await program.methods.depositReferralRevenue(amount)
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, partnershipStake: partnerPk, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([admin]).rpc();

      const s = await program.account.partnershipStake.fetch(partnerPk);
      assert.equal(s.referralBalance.toNumber(), 100_000);
    });

    it("should accumulate multiple deposits", async () => {
      await program.methods.depositReferralRevenue(new BN(50_000))
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, partnershipStake: partnerPk, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([admin]).rpc();

      assert.equal((await program.account.partnershipStake.fetch(partnerPk)).referralBalance.toNumber(), 150_000);
    });

    it("should reject by non-admin", async () => {
      const atk = anchor.web3.Keypair.generate();
      await airdropSol(atk.publicKey, 5);
      const atkAta = (await getOrCreateAssociatedTokenAccount(provider.connection, atk, usdcMint, atk.publicKey)).address;
      await mintTo(provider.connection, admin, usdcMint, atkAta, admin, 100_000);
      try {
        await program.methods.depositReferralRevenue(new BN(10_000))
          .accounts({ globalConfig: globalConfigKey, admin: atk.publicKey, adminUsdcAta: atkAta, revenueVault, partnershipStake: partnerPk, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([atk]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "Unauthorized"); }
    });

    it("should reject zero amount", async () => {
      try {
        await program.methods.depositReferralRevenue(new BN(0))
          .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, partnershipStake: partnerPk, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([admin]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "InvalidAmount"); }
    });
  });

  // ================================================================
  describe("claim_referral_share", () => {
    let partner: anchor.web3.Keypair;
    let partnerAta: anchor.web3.PublicKey;
    let partnerUsdcAta: anchor.web3.PublicKey;
    let partnerPk: anchor.web3.PublicKey;

    before(async () => {
      const funded = await createFundedUser(10_000_000);
      partner = funded.kp;
      partnerAta = funded.ata;
      partnerUsdcAta = await getUserUsdcAta(partner);
      [partnerPk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), partner.publicKey.toBuffer()], program.programId);
      await program.methods.stakePartnership(PARTNERSHIP_1M, null)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: partnerPk, user: partner.publicKey, userUnsysAta: partnerAta, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([partner]).rpc();

      // Admin deposits 200k referral revenue
      await program.methods.depositReferralRevenue(new BN(200_000))
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, partnershipStake: partnerPk, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([admin]).rpc();
    });

    it("should claim full referral balance", async () => {
      const before = await provider.connection.getTokenAccountBalance(partnerUsdcAta);
      await program.methods.claimReferralShare()
        .accounts({ globalConfig: globalConfigKey, partnershipStake: partnerPk, user: partner.publicKey, revenueVault, userUsdcAta: partnerUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([partner]).rpc();
      const after = await provider.connection.getTokenAccountBalance(partnerUsdcAta);
      assert.equal(parseInt(after.value.amount) - parseInt(before.value.amount), 200_000);

      // Balance should be zero
      assert.equal((await program.account.partnershipStake.fetch(partnerPk)).referralBalance.toNumber(), 0);
    });

    it("should reject claim when balance is zero", async () => {
      try {
        await program.methods.claimReferralShare()
          .accounts({ globalConfig: globalConfigKey, partnershipStake: partnerPk, user: partner.publicKey, revenueVault, userUsdcAta: partnerUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([partner]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "NoReferralBalance"); }
    });

    it("should allow claiming again after new deposit", async () => {
      await program.methods.depositReferralRevenue(new BN(75_000))
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, partnershipStake: partnerPk, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([admin]).rpc();

      const before = await provider.connection.getTokenAccountBalance(partnerUsdcAta);
      await program.methods.claimReferralShare()
        .accounts({ globalConfig: globalConfigKey, partnershipStake: partnerPk, user: partner.publicKey, revenueVault, userUsdcAta: partnerUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([partner]).rpc();
      const after = await provider.connection.getTokenAccountBalance(partnerUsdcAta);
      assert.equal(parseInt(after.value.amount) - parseInt(before.value.amount), 75_000);
    });

    it("should reject claim by non-owner", async () => {
      await program.methods.depositReferralRevenue(new BN(10_000))
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, partnershipStake: partnerPk, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([admin]).rpc();

      const atk = anchor.web3.Keypair.generate();
      await airdropSol(atk.publicKey, 5);
      const atkAta = (await getOrCreateAssociatedTokenAccount(provider.connection, atk, usdcMint, atk.publicKey)).address;
      try {
        await program.methods.claimReferralShare()
          .accounts({ globalConfig: globalConfigKey, partnershipStake: partnerPk, user: atk.publicKey, revenueVault, userUsdcAta: atkAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([atk]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.ok(e.toString().length > 0); }
    });
  });

  // ================================================================
  describe("stake_data_provider", () => {
    it("should reject insufficient", async () => {
      const { kp, ata } = await createFundedUser(1_000_000);
      const [dk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()], program.programId);
      try {
        await program.methods.stakeDataProvider(new BN(1_000_000))
          .accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
          .signers([kp]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "InsufficientDataProviderStake"); }
    });

    it("should stake 5M+", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [dk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakeDataProvider(DATA_PROVIDER_STAKE)
        .accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();
      const s = await program.account.dataProviderStake.fetch(dk);
      assert.ok(s.stakedAmount.eq(DATA_PROVIDER_STAKE));
      assert.equal(s.isInitialized, true);
    });

    it("should validate (admin) and reject non-admin", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [dk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakeDataProvider(DATA_PROVIDER_STAKE)
        .accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();

      const na = anchor.web3.Keypair.generate();
      await airdropSol(na.publicKey, 5);
      try {
        await program.methods.validateDataProvider()
          .accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, admin: na.publicKey }).signers([na]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "Unauthorized"); }

      await program.methods.validateDataProvider()
        .accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, admin: admin.publicKey }).signers([admin]).rpc();
      assert.equal((await program.account.dataProviderStake.fetch(dk)).active, true);
    });
  });

  // ================================================================
  describe("data_provider_deactivation_and_unstake", () => {
    it("should deactivate then unstake", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [dk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakeDataProvider(DATA_PROVIDER_STAKE)
        .accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();
      await program.methods.validateDataProvider()
        .accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, admin: admin.publicKey }).signers([admin]).rpc();
      await program.methods.deactivateDataProvider()
        .accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, admin: admin.publicKey }).signers([admin]).rpc();
      const before = await provider.connection.getTokenAccountBalance(ata);
      await program.methods.unstakeDataProvider()
        .accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([kp]).rpc();
      const after = await provider.connection.getTokenAccountBalance(ata);
      assert.equal(parseInt(after.value.amount) - parseInt(before.value.amount), DATA_PROVIDER_STAKE.toNumber());
      assert.equal((await program.account.dataProviderStake.fetch(dk)).isInitialized, false);
    });

    it("should reject unstaking active provider", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [dk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakeDataProvider(DATA_PROVIDER_STAKE)
        .accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();
      await program.methods.validateDataProvider()
        .accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, admin: admin.publicKey }).signers([admin]).rpc();
      try {
        await program.methods.unstakeDataProvider()
          .accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([kp]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "MustDeactivateFirst"); }
    });
  });

  // ================================================================
  describe("deposit_revenue (100% to dividend pool)", () => {
    it("should deposit full amount to dividend pool", async () => {
      const cb = await program.account.globalConfig.fetch(globalConfigKey);
      await program.methods.depositRevenue(REVENUE_DEPOSIT)
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([admin]).rpc();
      const ca = await program.account.globalConfig.fetch(globalConfigKey);
      assert.equal(ca.dividendEpoch.toNumber(), cb.dividendEpoch.toNumber() + 1);
      // 100% to dividend pool — no referral split
      assert.equal(ca.epochDividendPool.toNumber(), cb.epochDividendPool.toNumber() + REVENUE_DEPOSIT.toNumber());
      assert.equal(ca.epochDividendSnapshot.toNumber(), ca.epochDividendPool.toNumber());
    });

    it("should reject non-admin", async () => {
      const na = anchor.web3.Keypair.generate();
      await airdropSol(na.publicKey, 5);
      const naAta = (await getOrCreateAssociatedTokenAccount(provider.connection, na, usdcMint, na.publicKey)).address;
      await mintTo(provider.connection, admin, usdcMint, naAta, admin, 1_000_000);
      try {
        await program.methods.depositRevenue(new BN(100_000))
          .accounts({ globalConfig: globalConfigKey, admin: na.publicKey, adminUsdcAta: naAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([na]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "Unauthorized"); }
    });

    it("should reject zero", async () => {
      try {
        await program.methods.depositRevenue(new BN(0))
          .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([admin]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "InvalidAmount"); }
    });
  });

  // ================================================================
  describe("claim_dividends", () => {
    it("should claim and decrement pool", async () => {
      await program.methods.depositRevenue(REVENUE_DEPOSIT)
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([admin]).rpc();

      const [sk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), user.publicKey.toBuffer()], program.programId);
      const configBefore = await program.account.globalConfig.fetch(globalConfigKey);
      const stake = await program.account.dividendStake.fetch(sk);
      const expected = Math.floor(stake.shares.toNumber() * configBefore.epochDividendSnapshot.toNumber() / configBefore.totalDividendShares.toNumber());

      const before = await provider.connection.getTokenAccountBalance(userUsdcAta);
      await program.methods.claimDividends()
        .accounts({ globalConfig: globalConfigKey, userStake: sk, user: user.publicKey, revenueVault, userUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([user]).rpc();
      const after = await provider.connection.getTokenAccountBalance(userUsdcAta);
      const received = parseInt(after.value.amount) - parseInt(before.value.amount);
      assert.equal(received, expected);

      const configAfter = await program.account.globalConfig.fetch(globalConfigKey);
      assert.equal(configAfter.epochDividendPool.toNumber(), configBefore.epochDividendPool.toNumber() - received);
    });

    it("should reject double-claim", async () => {
      const [sk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), user.publicKey.toBuffer()], program.programId);
      try {
        await program.methods.claimDividends()
          .accounts({ globalConfig: globalConfigKey, userStake: sk, user: user.publicKey, revenueVault, userUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([user]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "AlreadyClaimed"); }
    });
  });

  // ================================================================
  describe("multi-user dividend fairness", () => {
    it("two users with equal shares get identical amounts", async () => {
      const { kp: uA, ata: ataA } = await createFundedUser();
      const { kp: uB, ata: ataB } = await createFundedUser();
      const usdcA = await getUserUsdcAta(uA);
      const usdcB = await getUserUsdcAta(uB);
      const [skA] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), uA.publicKey.toBuffer()], program.programId);
      const [skB] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), uB.publicKey.toBuffer()], program.programId);

      await program.methods.stakeDividends(STAKE_AMOUNT, 3)
        .accounts({ globalConfig: globalConfigKey, userStake: skA, user: uA.publicKey, userUnsysAta: ataA, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([uA]).rpc();
      await program.methods.stakeDividends(STAKE_AMOUNT, 3)
        .accounts({ globalConfig: globalConfigKey, userStake: skB, user: uB.publicKey, userUnsysAta: ataB, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([uB]).rpc();

      await program.methods.depositRevenue(new BN(3_000_000))
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([admin]).rpc();

      const beforeA = await provider.connection.getTokenAccountBalance(usdcA);
      await program.methods.claimDividends()
        .accounts({ globalConfig: globalConfigKey, userStake: skA, user: uA.publicKey, revenueVault, userUsdcAta: usdcA, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([uA]).rpc();
      const receivedA = parseInt((await provider.connection.getTokenAccountBalance(usdcA)).value.amount) - parseInt(beforeA.value.amount);

      const beforeB = await provider.connection.getTokenAccountBalance(usdcB);
      await program.methods.claimDividends()
        .accounts({ globalConfig: globalConfigKey, userStake: skB, user: uB.publicKey, revenueVault, userUsdcAta: usdcB, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([uB]).rpc();
      const receivedB = parseInt((await provider.connection.getTokenAccountBalance(usdcB)).value.amount) - parseInt(beforeB.value.amount);

      assert.equal(receivedA, receivedB);
      assert.isTrue(receivedA > 0);
    });
  });

  // ================================================================
  describe("legacy OMEGA holder registration and benefits", () => {
    let legacyUser: anchor.web3.Keypair;
    let legacyUsdcAta: anchor.web3.PublicKey;
    let legacyOmegaPda: anchor.web3.PublicKey;

    before(async () => {
      legacyUser = anchor.web3.Keypair.generate();
      await airdropSol(legacyUser.publicKey, 10);
      legacyUsdcAta = await getUserUsdcAta(legacyUser);
      [legacyOmegaPda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("legacy_omega"), legacyUser.publicKey.toBuffer()], program.programId
      );
    });

    it("should register with admin-assigned tier", async () => {
      const configBefore = await program.account.globalConfig.fetch(globalConfigKey);
      await program.methods.registerLegacyHolder(legacyUser.publicKey, 2)
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, legacyOmegaStake: legacyOmegaPda, holder: legacyUser.publicKey, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([admin]).rpc();

      const legacy = await program.account.legacyOmegaStake.fetch(legacyOmegaPda);
      assert.ok(legacy.owner.equals(legacyUser.publicKey));
      assert.equal(legacy.registered, true);
      assert.equal(legacy.tier, 2);

      const configAfter = await program.account.globalConfig.fetch(globalConfigKey);
      assert.equal(configAfter.totalLegacyHolders.toNumber(), configBefore.totalLegacyHolders.toNumber() + 1);
    });

    it("should reject invalid tier (0 or 4)", async () => {
      const otherUser = anchor.web3.Keypair.generate();
      await airdropSol(otherUser.publicKey, 5);
      const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("legacy_omega"), otherUser.publicKey.toBuffer()], program.programId
      );
      try {
        await program.methods.registerLegacyHolder(otherUser.publicKey, 0)
          .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, legacyOmegaStake: pda, holder: otherUser.publicKey, systemProgram: anchor.web3.SystemProgram.programId })
          .signers([admin]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "InvalidTier"); }

      try {
        await program.methods.registerLegacyHolder(otherUser.publicKey, 4)
          .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, legacyOmegaStake: pda, holder: otherUser.publicKey, systemProgram: anchor.web3.SystemProgram.programId })
          .signers([admin]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "InvalidTier"); }
    });

    it("should reject registration by non-admin", async () => {
      const otherUser = anchor.web3.Keypair.generate();
      await airdropSol(otherUser.publicKey, 5);
      const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("legacy_omega"), otherUser.publicKey.toBuffer()], program.programId
      );
      const nonAdmin = anchor.web3.Keypair.generate();
      await airdropSol(nonAdmin.publicKey, 5);
      try {
        await program.methods.registerLegacyHolder(otherUser.publicKey, 1)
          .accounts({ globalConfig: globalConfigKey, admin: nonAdmin.publicKey, legacyOmegaStake: pda, holder: otherUser.publicKey, systemProgram: anchor.web3.SystemProgram.programId })
          .signers([nonAdmin]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "Unauthorized"); }
    });

    it("should enable legacy benefits with stored tier", async () => {
      const configBefore = await program.account.globalConfig.fetch(globalConfigKey);

      const [divStakeKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("dividend_stake"), legacyUser.publicKey.toBuffer()], program.programId
      );
      const [partnerKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("partnership_stake"), legacyUser.publicKey.toBuffer()], program.programId
      );

      await program.methods.enableLegacyBenefits()
        .accounts({ globalConfig: globalConfigKey, legacyOmegaStake: legacyOmegaPda, dividendStake: divStakeKey, partnershipStake: partnerKey, user: legacyUser.publicKey, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([legacyUser]).rpc();

      const divStake = await program.account.dividendStake.fetch(divStakeKey);
      assert.ok(divStake.owner.equals(legacyUser.publicKey));
      assert.equal(divStake.amount.toNumber(), 0);
      assert.isTrue(divStake.shares.toNumber() > 0);
      assert.equal(divStake.isInitialized, true);

      // Verify partner gets the stored tier (2)
      const partnerStake = await program.account.partnershipStake.fetch(partnerKey);
      assert.equal(partnerStake.tier, 2);
      assert.equal(partnerStake.referralBalance.toNumber(), 0);
      assert.equal(partnerStake.isInitialized, true);

      const configAfter = await program.account.globalConfig.fetch(globalConfigKey);
      assert.isTrue(configAfter.totalDividendShares.toNumber() > configBefore.totalDividendShares.toNumber());
    });

    it("legacy partner should receive and claim referral revenue", async () => {
      const [partnerKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("partnership_stake"), legacyUser.publicKey.toBuffer()], program.programId
      );

      // Admin deposits referral revenue for legacy partner
      await program.methods.depositReferralRevenue(new BN(300_000))
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, partnershipStake: partnerKey, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([admin]).rpc();

      const before = await provider.connection.getTokenAccountBalance(legacyUsdcAta);
      await program.methods.claimReferralShare()
        .accounts({ globalConfig: globalConfigKey, partnershipStake: partnerKey, user: legacyUser.publicKey, revenueVault, userUsdcAta: legacyUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([legacyUser]).rpc();
      const after = await provider.connection.getTokenAccountBalance(legacyUsdcAta);
      assert.equal(parseInt(after.value.amount) - parseInt(before.value.amount), 300_000);
    });

    it("legacy user should claim dividends", async () => {
      await program.methods.depositRevenue(REVENUE_DEPOSIT)
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([admin]).rpc();

      const [divStakeKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("dividend_stake"), legacyUser.publicKey.toBuffer()], program.programId
      );

      const before = await provider.connection.getTokenAccountBalance(legacyUsdcAta);
      await program.methods.claimDividends()
        .accounts({ globalConfig: globalConfigKey, userStake: divStakeKey, user: legacyUser.publicKey, revenueVault, userUsdcAta: legacyUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([legacyUser]).rpc();
      const after = await provider.connection.getTokenAccountBalance(legacyUsdcAta);
      assert.isTrue(parseInt(after.value.amount) > parseInt(before.value.amount));
    });

    it("admin should revoke legacy partnership", async () => {
      const [partnerKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("partnership_stake"), legacyUser.publicKey.toBuffer()], program.programId
      );

      await program.methods.revokeLegacyPartnership()
        .accounts({ globalConfig: globalConfigKey, partnershipStake: partnerKey, admin: admin.publicKey })
        .signers([admin]).rpc();

      assert.equal((await program.account.partnershipStake.fetch(partnerKey)).tier, 0);
      // Registration stays permanent
      assert.equal((await program.account.legacyOmegaStake.fetch(legacyOmegaPda)).registered, true);
    });
  });
});
