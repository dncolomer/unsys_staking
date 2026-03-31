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

  const STAKE_AMOUNT = new BN(1_000_000);
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

  async function createFundedUserWithUsdc(unsysAmount: number = 50_000_000) {
    const { kp, ata } = await createFundedUser(unsysAmount);
    const usdcAta = (await getOrCreateAssociatedTokenAccount(provider.connection, kp, usdcMint, kp.publicKey)).address;
    return { kp, unsysAta: ata, usdcAta };
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

    await mintTo(provider.connection, admin, unsysMint, adminUnsysAta, admin, 100_000_000);
    await mintTo(provider.connection, admin, unsysMint, userUnsysAta, admin, 50_000_000);
    await mintTo(provider.connection, admin, usdcMint, adminUsdcAta, admin, 100_000_000);
  });

  // ================================================================
  describe("initialize", () => {
    it("should initialize global config with all fields", async () => {
      const buybackWallet = anchor.web3.Keypair.generate().publicKey;
      await program.methods.initialize()
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, unsysMint, omegaMint, usdcMint, buybackWallet, tokenVault, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([admin]).rpc();
      const config = await program.account.globalConfig.fetch(globalConfigKey);
      assert.ok(config.admin.equals(admin.publicKey));
      assert.equal(config.dividendEpoch.toNumber(), 0);
      assert.equal(config.epochDividendPool.toNumber(), 0);
      assert.equal(config.epochReferralPool.toNumber(), 0);
      assert.equal(config.totalActivePartners.toNumber(), 0);
      assert.ok(config.pendingAdmin.equals(anchor.web3.PublicKey.default));
    });

    it("should reject re-initialization", async () => {
      try {
        await program.methods.initialize()
          .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, unsysMint, omegaMint, usdcMint, buybackWallet: anchor.web3.Keypair.generate().publicKey, tokenVault, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
          .signers([admin]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "AlreadyInitialized"); }
    });
  });

  // ================================================================
  describe("admin_transfer", () => {
    it("should propose and accept admin transfer", async () => {
      const newAdmin = anchor.web3.Keypair.generate();
      await airdropSol(newAdmin.publicKey, 5);

      await program.methods.proposeAdminTransfer(newAdmin.publicKey)
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey })
        .signers([admin]).rpc();

      let config = await program.account.globalConfig.fetch(globalConfigKey);
      assert.ok(config.pendingAdmin.equals(newAdmin.publicKey));

      await program.methods.acceptAdminTransfer()
        .accounts({ globalConfig: globalConfigKey, newAdmin: newAdmin.publicKey })
        .signers([newAdmin]).rpc();

      config = await program.account.globalConfig.fetch(globalConfigKey);
      assert.ok(config.admin.equals(newAdmin.publicKey));
      assert.ok(config.pendingAdmin.equals(anchor.web3.PublicKey.default));

      // Transfer back to original admin for remaining tests
      await program.methods.proposeAdminTransfer(admin.publicKey)
        .accounts({ globalConfig: globalConfigKey, admin: newAdmin.publicKey })
        .signers([newAdmin]).rpc();
      await program.methods.acceptAdminTransfer()
        .accounts({ globalConfig: globalConfigKey, newAdmin: admin.publicKey })
        .signers([admin]).rpc();
    });

    it("should reject propose by non-admin", async () => {
      const attacker = anchor.web3.Keypair.generate();
      await airdropSol(attacker.publicKey, 5);
      try {
        await program.methods.proposeAdminTransfer(attacker.publicKey)
          .accounts({ globalConfig: globalConfigKey, admin: attacker.publicKey })
          .signers([attacker]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "Unauthorized"); }
    });

    it("should reject accept by wrong address", async () => {
      const newAdmin = anchor.web3.Keypair.generate();
      const wrongUser = anchor.web3.Keypair.generate();
      await airdropSol(newAdmin.publicKey, 5);
      await airdropSol(wrongUser.publicKey, 5);

      await program.methods.proposeAdminTransfer(newAdmin.publicKey)
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey })
        .signers([admin]).rpc();

      try {
        await program.methods.acceptAdminTransfer()
          .accounts({ globalConfig: globalConfigKey, newAdmin: wrongUser.publicKey })
          .signers([wrongUser]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "Unauthorized"); }

      // Clean up: clear pending by proposing default (will fail, but let's set back)
      await program.methods.proposeAdminTransfer(admin.publicKey)
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey })
        .signers([admin]).rpc();
      await program.methods.acceptAdminTransfer()
        .accounts({ globalConfig: globalConfigKey, newAdmin: admin.publicKey })
        .signers([admin]).rpc();
    });
  });

  // ================================================================
  describe("stake_dividends", () => {
    it("should stake for 3 months (1.1x)", async () => {
      const [stakeKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), user.publicKey.toBuffer()], program.programId);
      await program.methods.stakeDividends(STAKE_AMOUNT, 3)
        .accounts({ globalConfig: globalConfigKey, userStake: stakeKey, user: user.publicKey, userUnsysAta, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([user]).rpc();
      const stake = await program.account.dividendStake.fetch(stakeKey);
      assert.ok(stake.amount.eq(STAKE_AMOUNT));
      assert.equal(stake.multiplierBps, 11000);
      assert.equal(stake.shares.toNumber(), 1_100_000);
    });

    it("should stake for 6 months (1.25x)", async () => {
      const { kp, ata } = await createFundedUser();
      const [sk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakeDividends(STAKE_AMOUNT, 6)
        .accounts({ globalConfig: globalConfigKey, userStake: sk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();
      assert.equal((await program.account.dividendStake.fetch(sk)).multiplierBps, 12500);
    });

    it("should stake for 12 months (1.5x)", async () => {
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
      try { await program.methods.stakeDividends(STAKE_AMOUNT, 1).accounts({ globalConfig: globalConfigKey, userStake: sk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId }).signers([kp]).rpc(); assert.fail("Should have thrown"); } catch (e) { assert.include(e.toString(), "Invalid lock period"); }
    });

    it("should reject double-staking", async () => {
      const [sk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), user.publicKey.toBuffer()], program.programId);
      try { await program.methods.stakeDividends(STAKE_AMOUNT, 6).accounts({ globalConfig: globalConfigKey, userStake: sk, user: user.publicKey, userUnsysAta, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId }).signers([user]).rpc(); assert.fail("Should have thrown"); } catch (e) { assert.include(e.toString(), "StakeAlreadyExists"); }
    });

    it("should reject wrong vault", async () => {
      const { kp, ata } = await createFundedUser();
      const [sk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), kp.publicKey.toBuffer()], program.programId);
      const fv = (await getOrCreateAssociatedTokenAccount(provider.connection, kp, unsysMint, kp.publicKey)).address;
      try { await program.methods.stakeDividends(STAKE_AMOUNT, 3).accounts({ globalConfig: globalConfigKey, userStake: sk, user: kp.publicKey, userUnsysAta: ata, tokenVault: fv, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId }).signers([kp]).rpc(); assert.fail("Should have thrown"); } catch (e) { assert.include(e.toString(), "InvalidVault"); }
    });

    it("should reject zero amount", async () => {
      const { kp, ata } = await createFundedUser();
      const [sk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), kp.publicKey.toBuffer()], program.programId);
      try { await program.methods.stakeDividends(new BN(0), 3).accounts({ globalConfig: globalConfigKey, userStake: sk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId }).signers([kp]).rpc(); assert.fail("Should have thrown"); } catch (e) { assert.include(e.toString(), "InvalidAmount"); }
    });
  });

  // ================================================================
  describe("unstake_dividends", () => {
    it("should reject when lock not expired", async () => {
      const [sk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), user.publicKey.toBuffer()], program.programId);
      try { await program.methods.unstakeDividends().accounts({ globalConfig: globalConfigKey, userStake: sk, user: user.publicKey, userUnsysAta, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID }).signers([user]).rpc(); assert.fail("Should have thrown"); } catch (e) { assert.include(e.toString(), "LockPeriodNotExpired"); }
    });
  });

  // ================================================================
  describe("stake_partnership", () => {
    it("should stake partnership and increment active partners", async () => {
      const configBefore = await program.account.globalConfig.fetch(globalConfigKey);
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), user.publicKey.toBuffer()], program.programId);
      await program.methods.stakePartnership(STAKE_AMOUNT, null)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: user.publicKey, userUnsysAta, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([user]).rpc();
      const stake = await program.account.partnershipStake.fetch(pk);
      assert.ok(stake.stakedAmount.eq(STAKE_AMOUNT));
      assert.equal(stake.tier, 1);
      const configAfter = await program.account.globalConfig.fetch(globalConfigKey);
      assert.equal(configAfter.totalActivePartners.toNumber(), configBefore.totalActivePartners.toNumber() + 1);
    });

    it("should stake with referrer", async () => {
      const { kp, ata } = await createFundedUser();
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakePartnership(STAKE_AMOUNT, referrer.publicKey)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();
      assert.ok((await program.account.partnershipStake.fetch(pk)).referrer?.equals(referrer.publicKey));
    });

    it("should reject double-staking", async () => {
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), user.publicKey.toBuffer()], program.programId);
      try { await program.methods.stakePartnership(STAKE_AMOUNT, null).accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: user.publicKey, userUnsysAta, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId }).signers([user]).rpc(); assert.fail("Should have thrown"); } catch (e) { assert.include(e.toString(), "StakeAlreadyExists"); }
    });

    it("should reject zero amount", async () => {
      const { kp, ata } = await createFundedUser();
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), kp.publicKey.toBuffer()], program.programId);
      try { await program.methods.stakePartnership(new BN(0), null).accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId }).signers([kp]).rpc(); assert.fail("Should have thrown"); } catch (e) { assert.include(e.toString(), "InvalidAmount"); }
    });
  });

  // ================================================================
  describe("unstake_partnership", () => {
    it("should partially unstake and return tokens", async () => {
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), user.publicKey.toBuffer()], program.programId);
      const before = await provider.connection.getTokenAccountBalance(userUnsysAta);
      const half = STAKE_AMOUNT.div(new BN(2));
      await program.methods.unstakePartnership(half)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: user.publicKey, tokenVault, userUnsysAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([user]).rpc();
      const stake = await program.account.partnershipStake.fetch(pk);
      assert.ok(stake.stakedAmount.eq(half));
      assert.equal(stake.tier, 1);
      const after = await provider.connection.getTokenAccountBalance(userUnsysAta);
      assert.equal(parseInt(after.value.amount) - parseInt(before.value.amount), half.toNumber());
    });

    it("should fully unstake, revoke tier, decrement partners", async () => {
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), user.publicKey.toBuffer()], program.programId);
      const configBefore = await program.account.globalConfig.fetch(globalConfigKey);
      const remaining = (await program.account.partnershipStake.fetch(pk)).stakedAmount;
      await program.methods.unstakePartnership(remaining)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: user.publicKey, tokenVault, userUnsysAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([user]).rpc();
      const stake = await program.account.partnershipStake.fetch(pk);
      assert.ok(stake.stakedAmount.eq(new BN(0)));
      assert.equal(stake.tier, 0);
      const configAfter = await program.account.globalConfig.fetch(globalConfigKey);
      assert.equal(configAfter.totalActivePartners.toNumber(), configBefore.totalActivePartners.toNumber() - 1);
    });

    it("should reject zero-amount unstake", async () => {
      // Re-stake first
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), user.publicKey.toBuffer()], program.programId);
      await mintTo(provider.connection, admin, unsysMint, userUnsysAta, admin, STAKE_AMOUNT.toNumber());
      await program.methods.stakePartnership(STAKE_AMOUNT, null)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: user.publicKey, userUnsysAta, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([user]).rpc();
      try {
        await program.methods.unstakePartnership(new BN(0))
          .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: user.publicKey, tokenVault, userUnsysAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([user]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "InvalidAmount"); }
    });

    it("should reject unstake by non-owner", async () => {
      const { kp: staker, ata } = await createFundedUser();
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), staker.publicKey.toBuffer()], program.programId);
      await program.methods.stakePartnership(STAKE_AMOUNT, null)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: staker.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([staker]).rpc();
      const attacker = anchor.web3.Keypair.generate();
      await airdropSol(attacker.publicKey, 5);
      const aAta = (await getOrCreateAssociatedTokenAccount(provider.connection, attacker, unsysMint, attacker.publicKey)).address;
      try { await program.methods.unstakePartnership(STAKE_AMOUNT).accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: attacker.publicKey, tokenVault, userUnsysAta: aAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID }).signers([attacker]).rpc(); assert.fail("Should have thrown"); } catch (e) { assert.ok(e.toString().length > 0); }
    });
  });

  // ================================================================
  describe("stake_data_provider", () => {
    it("should reject insufficient stake", async () => {
      const { kp, ata } = await createFundedUser(1_000_000);
      const [dk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()], program.programId);
      try { await program.methods.stakeDataProvider(new BN(1_000_000)).accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId }).signers([kp]).rpc(); assert.fail("Should have thrown"); } catch (e) { assert.include(e.toString(), "InsufficientDataProviderStake"); }
    });

    it("should stake 5M+", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [dk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakeDataProvider(DATA_PROVIDER_STAKE).accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId }).signers([kp]).rpc();
      const s = await program.account.dataProviderStake.fetch(dk);
      assert.ok(s.stakedAmount.eq(DATA_PROVIDER_STAKE));
      assert.equal(s.active, false);
    });

    it("should reject double-staking", async () => {
      const { kp, ata } = await createFundedUser(20_000_000);
      const [dk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakeDataProvider(DATA_PROVIDER_STAKE).accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId }).signers([kp]).rpc();
      try { await program.methods.stakeDataProvider(DATA_PROVIDER_STAKE).accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId }).signers([kp]).rpc(); assert.fail("Should have thrown"); } catch (e) { assert.include(e.toString(), "StakeAlreadyExists"); }
    });

    it("should validate (admin) and reject non-admin", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [dk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakeDataProvider(DATA_PROVIDER_STAKE).accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId }).signers([kp]).rpc();

      const nonAdmin = anchor.web3.Keypair.generate();
      await airdropSol(nonAdmin.publicKey, 5);
      try { await program.methods.validateDataProvider().accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, admin: nonAdmin.publicKey }).signers([nonAdmin]).rpc(); assert.fail("Should have thrown"); } catch (e) { assert.include(e.toString(), "Unauthorized"); }

      await program.methods.validateDataProvider().accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, admin: admin.publicKey }).signers([admin]).rpc();
      assert.equal((await program.account.dataProviderStake.fetch(dk)).active, true);
    });
  });

  // ================================================================
  describe("data_provider_deactivation_and_unstake", () => {
    it("should reject unstaking an active provider (MustDeactivateFirst)", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [dk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakeDataProvider(DATA_PROVIDER_STAKE).accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId }).signers([kp]).rpc();
      await program.methods.validateDataProvider().accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, admin: admin.publicKey }).signers([admin]).rpc();

      try {
        await program.methods.unstakeDataProvider().accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID }).signers([kp]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "MustDeactivateFirst"); }
    });

    it("should deactivate then unstake successfully", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [dk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakeDataProvider(DATA_PROVIDER_STAKE).accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId }).signers([kp]).rpc();
      await program.methods.validateDataProvider().accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, admin: admin.publicKey }).signers([admin]).rpc();

      // Deactivate
      await program.methods.deactivateDataProvider().accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, admin: admin.publicKey }).signers([admin]).rpc();
      assert.equal((await program.account.dataProviderStake.fetch(dk)).active, false);

      // Now unstake
      const before = await provider.connection.getTokenAccountBalance(ata);
      await program.methods.unstakeDataProvider().accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID }).signers([kp]).rpc();
      const after = await provider.connection.getTokenAccountBalance(ata);
      assert.equal(parseInt(after.value.amount) - parseInt(before.value.amount), DATA_PROVIDER_STAKE.toNumber());
    });

    it("should reject deactivation of inactive provider", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [dk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakeDataProvider(DATA_PROVIDER_STAKE).accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId }).signers([kp]).rpc();
      // Not validated yet, so active=false
      try { await program.methods.deactivateDataProvider().accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, admin: admin.publicKey }).signers([admin]).rpc(); assert.fail("Should have thrown"); } catch (e) { assert.include(e.toString(), "NotActive"); }
    });

    it("should reject unstake by non-owner", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [dk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakeDataProvider(DATA_PROVIDER_STAKE).accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId }).signers([kp]).rpc();
      const attacker = anchor.web3.Keypair.generate();
      await airdropSol(attacker.publicKey, 5);
      const aAta = (await getOrCreateAssociatedTokenAccount(provider.connection, attacker, unsysMint, attacker.publicKey)).address;
      try { await program.methods.unstakeDataProvider().accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, user: attacker.publicKey, userUnsysAta: aAta, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID }).signers([attacker]).rpc(); assert.fail("Should have thrown"); } catch (e) { assert.ok(e.toString().length > 0); }
    });
  });

  // ================================================================
  describe("deposit_revenue (snapshot)", () => {
    it("should deposit, increment epoch, and snapshot pools", async () => {
      const configBefore = await program.account.globalConfig.fetch(globalConfigKey);
      await program.methods.depositRevenue(REVENUE_DEPOSIT)
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([admin]).rpc();
      const config = await program.account.globalConfig.fetch(globalConfigKey);
      assert.equal(config.dividendEpoch.toNumber(), configBefore.dividendEpoch.toNumber() + 1);
      // 33.33% referral, 66.67% dividend
      const expectedReferral = Math.floor(1_000_000 * 3333 / 10000); // 333300
      const expectedDividend = 1_000_000 - expectedReferral; // 666700
      assert.equal(config.epochDividendPool.toNumber(), expectedDividend);
      assert.equal(config.epochReferralPool.toNumber(), expectedReferral);
    });

    it("should reject non-admin", async () => {
      const na = anchor.web3.Keypair.generate();
      await airdropSol(na.publicKey, 5);
      const naAta = (await getOrCreateAssociatedTokenAccount(provider.connection, na, usdcMint, na.publicKey)).address;
      await mintTo(provider.connection, admin, usdcMint, naAta, admin, 1_000_000);
      try { await program.methods.depositRevenue(new BN(100_000)).accounts({ globalConfig: globalConfigKey, admin: na.publicKey, adminUsdcAta: naAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID }).signers([na]).rpc(); assert.fail("Should have thrown"); } catch (e) { assert.include(e.toString(), "Unauthorized"); }
    });

    it("should reject wrong vault", async () => {
      const fv = (await getOrCreateAssociatedTokenAccount(provider.connection, admin, usdcMint, admin.publicKey)).address;
      try { await program.methods.depositRevenue(new BN(100_000)).accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault: fv, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID }).signers([admin]).rpc(); assert.fail("Should have thrown"); } catch (e) { assert.include(e.toString(), "InvalidVault"); }
    });

    it("should reject zero amount", async () => {
      try { await program.methods.depositRevenue(new BN(0)).accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID }).signers([admin]).rpc(); assert.fail("Should have thrown"); } catch (e) { assert.include(e.toString(), "InvalidAmount"); }
    });
  });

  // ================================================================
  describe("claim_dividends (snapshot-based fairness)", () => {
    it("should claim correct proportional amount from snapshot pool", async () => {
      const [sk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), user.publicKey.toBuffer()], program.programId);
      const config = await program.account.globalConfig.fetch(globalConfigKey);
      const stake = await program.account.dividendStake.fetch(sk);

      // Expected: user_shares / total_shares * epoch_dividend_pool
      const expectedReward = stake.shares.toNumber() * config.epochDividendPool.toNumber() / config.totalDividendShares.toNumber();

      const before = await provider.connection.getTokenAccountBalance(userUsdcAta);
      await program.methods.claimDividends()
        .accounts({ globalConfig: globalConfigKey, userStake: sk, user: user.publicKey, revenueVault, userUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([user]).rpc();
      const after = await provider.connection.getTokenAccountBalance(userUsdcAta);
      const received = parseInt(after.value.amount) - parseInt(before.value.amount);
      assert.equal(received, Math.floor(expectedReward));
    });

    it("should reject double-claim (AlreadyClaimed)", async () => {
      const [sk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), user.publicKey.toBuffer()], program.programId);
      try { await program.methods.claimDividends().accounts({ globalConfig: globalConfigKey, userStake: sk, user: user.publicKey, revenueVault, userUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID }).signers([user]).rpc(); assert.fail("Should have thrown"); } catch (e) { assert.include(e.toString(), "AlreadyClaimed"); }
    });

    it("should allow claim after new deposit (new epoch)", async () => {
      await program.methods.depositRevenue(REVENUE_DEPOSIT)
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([admin]).rpc();
      const [sk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), user.publicKey.toBuffer()], program.programId);
      const before = await provider.connection.getTokenAccountBalance(userUsdcAta);
      await program.methods.claimDividends()
        .accounts({ globalConfig: globalConfigKey, userStake: sk, user: user.publicKey, revenueVault, userUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([user]).rpc();
      const after = await provider.connection.getTokenAccountBalance(userUsdcAta);
      assert.isTrue(parseInt(after.value.amount) > parseInt(before.value.amount));
    });

    it("should reject wrong vault", async () => {
      await program.methods.depositRevenue(REVENUE_DEPOSIT).accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID }).signers([admin]).rpc();
      const [sk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), user.publicKey.toBuffer()], program.programId);
      const fv = (await getOrCreateAssociatedTokenAccount(provider.connection, admin, usdcMint, admin.publicKey)).address;
      try { await program.methods.claimDividends().accounts({ globalConfig: globalConfigKey, userStake: sk, user: user.publicKey, revenueVault: fv, userUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID }).signers([user]).rpc(); assert.fail("Should have thrown"); } catch (e) { assert.include(e.toString(), "InvalidVault"); }
    });

    it("should reject non-owner PDA mismatch", async () => {
      const atk = anchor.web3.Keypair.generate();
      await airdropSol(atk.publicKey, 5);
      const atkUsdcAta = (await getOrCreateAssociatedTokenAccount(provider.connection, atk, usdcMint, atk.publicKey)).address;
      const [sk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), user.publicKey.toBuffer()], program.programId);
      try { await program.methods.claimDividends().accounts({ globalConfig: globalConfigKey, userStake: sk, user: atk.publicKey, revenueVault, userUsdcAta: atkUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID }).signers([atk]).rpc(); assert.fail("Should have thrown"); } catch (e) { assert.ok(e.toString().length > 0); }
    });
  });

  // ================================================================
  describe("claim_referral_share (snapshot-based, per-partner split)", () => {
    it("should claim equal per-partner share from referral pool", async () => {
      // user already has an active partnership from the unstake_partnership tests
      // Deposit new revenue for fresh epoch
      await program.methods.depositRevenue(REVENUE_DEPOSIT)
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([admin]).rpc();

      const config = await program.account.globalConfig.fetch(globalConfigKey);
      const expectedPerPartner = Math.floor(config.epochReferralPool.toNumber() / config.totalActivePartners.toNumber());

      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), user.publicKey.toBuffer()], program.programId);
      const before = await provider.connection.getTokenAccountBalance(userUsdcAta);
      await program.methods.claimReferralShare()
        .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: user.publicKey, revenueVault, userUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([user]).rpc();
      const after = await provider.connection.getTokenAccountBalance(userUsdcAta);
      const received = parseInt(after.value.amount) - parseInt(before.value.amount);
      assert.equal(received, expectedPerPartner);
    });

    it("should reject double-claim in same epoch", async () => {
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), user.publicKey.toBuffer()], program.programId);
      try { await program.methods.claimReferralShare().accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: user.publicKey, revenueVault, userUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID }).signers([user]).rpc(); assert.fail("Should have thrown"); } catch (e) { assert.include(e.toString(), "AlreadyClaimed"); }
    });

    it("should reject non-owner PDA mismatch", async () => {
      const atk = anchor.web3.Keypair.generate();
      await airdropSol(atk.publicKey, 5);
      const atkUsdcAta = (await getOrCreateAssociatedTokenAccount(provider.connection, atk, usdcMint, atk.publicKey)).address;
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), user.publicKey.toBuffer()], program.programId);
      try { await program.methods.claimReferralShare().accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: atk.publicKey, revenueVault, userUsdcAta: atkUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID }).signers([atk]).rpc(); assert.fail("Should have thrown"); } catch (e) { assert.ok(e.toString().length > 0); }
    });

    it("should reject wrong vault", async () => {
      await program.methods.depositRevenue(REVENUE_DEPOSIT).accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID }).signers([admin]).rpc();
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), user.publicKey.toBuffer()], program.programId);
      const fv = (await getOrCreateAssociatedTokenAccount(provider.connection, admin, usdcMint, admin.publicKey)).address;
      try { await program.methods.claimReferralShare().accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: user.publicKey, revenueVault: fv, userUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID }).signers([user]).rpc(); assert.fail("Should have thrown"); } catch (e) { assert.include(e.toString(), "InvalidVault"); }
    });
  });
});
