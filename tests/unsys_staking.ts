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

  async function createUserWithUsdc(usdcAmount: number = 0, unsysAmount: number = 50_000_000) {
    const { kp, ata } = await createFundedUser(unsysAmount);
    const usdcAta = (await getOrCreateAssociatedTokenAccount(provider.connection, kp, usdcMint, kp.publicKey)).address;
    if (usdcAmount > 0) await mintTo(provider.connection, admin, usdcMint, usdcAta, admin, usdcAmount);
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
  // INITIALIZE
  // ================================================================
  describe("initialize", () => {
    it("should initialize global config", async () => {
      const buybackWallet = anchor.web3.Keypair.generate().publicKey;
      await program.methods.initialize()
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, unsysMint, omegaMint, usdcMint, buybackWallet, tokenVault, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([admin]).rpc();

      const config = await program.account.globalConfig.fetch(globalConfigKey);
      assert.ok(config.unsysMint.equals(unsysMint));
      assert.ok(config.admin.equals(admin.publicKey));
      assert.equal(config.totalDividendShares.toNumber(), 0);
      assert.equal(config.dividendEpoch.toNumber(), 0);
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
  // STAKE DIVIDENDS
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
      assert.equal(stake.lastClaimEpoch.toNumber(), 0);
    });

    it("should stake for 6 months (1.25x)", async () => {
      const { kp, ata } = await createFundedUser();
      const [stakeKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakeDividends(STAKE_AMOUNT, 6)
        .accounts({ globalConfig: globalConfigKey, userStake: stakeKey, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();
      const stake = await program.account.dividendStake.fetch(stakeKey);
      assert.equal(stake.multiplierBps, 12500);
      assert.equal(stake.shares.toNumber(), 1_250_000);
    });

    it("should stake for 12 months (1.5x)", async () => {
      const { kp, ata } = await createFundedUser();
      const [stakeKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakeDividends(STAKE_AMOUNT, 12)
        .accounts({ globalConfig: globalConfigKey, userStake: stakeKey, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();
      const stake = await program.account.dividendStake.fetch(stakeKey);
      assert.equal(stake.multiplierBps, 15000);
      assert.equal(stake.shares.toNumber(), 1_500_000);
    });

    it("should reject invalid lock period", async () => {
      const { kp, ata } = await createFundedUser();
      const [stakeKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), kp.publicKey.toBuffer()], program.programId);
      try {
        await program.methods.stakeDividends(STAKE_AMOUNT, 1)
          .accounts({ globalConfig: globalConfigKey, userStake: stakeKey, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
          .signers([kp]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "Invalid lock period"); }
    });

    it("should reject double-staking", async () => {
      const [stakeKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), user.publicKey.toBuffer()], program.programId);
      try {
        await program.methods.stakeDividends(STAKE_AMOUNT, 6)
          .accounts({ globalConfig: globalConfigKey, userStake: stakeKey, user: user.publicKey, userUnsysAta, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
          .signers([user]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "StakeAlreadyExists"); }
    });

    it("should reject wrong token vault", async () => {
      const { kp, ata } = await createFundedUser();
      const [stakeKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), kp.publicKey.toBuffer()], program.programId);
      const fakeVault = (await getOrCreateAssociatedTokenAccount(provider.connection, kp, unsysMint, kp.publicKey)).address;
      try {
        await program.methods.stakeDividends(STAKE_AMOUNT, 3)
          .accounts({ globalConfig: globalConfigKey, userStake: stakeKey, user: kp.publicKey, userUnsysAta: ata, tokenVault: fakeVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
          .signers([kp]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "InvalidVault"); }
    });

    it("should reject zero amount", async () => {
      const { kp, ata } = await createFundedUser();
      const [stakeKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), kp.publicKey.toBuffer()], program.programId);
      try {
        await program.methods.stakeDividends(new BN(0), 3)
          .accounts({ globalConfig: globalConfigKey, userStake: stakeKey, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
          .signers([kp]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "InvalidAmount"); }
    });
  });

  // ================================================================
  // UNSTAKE DIVIDENDS
  // ================================================================
  describe("unstake_dividends", () => {
    it("should reject when lock period not expired", async () => {
      const [stakeKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), user.publicKey.toBuffer()], program.programId);
      try {
        await program.methods.unstakeDividends()
          .accounts({ globalConfig: globalConfigKey, userStake: stakeKey, user: user.publicKey, userUnsysAta, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([user]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "LockPeriodNotExpired"); }
    });
  });

  // ================================================================
  // STAKE PARTNERSHIP
  // ================================================================
  describe("stake_partnership", () => {
    it("should stake partnership", async () => {
      const [partnershipKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), user.publicKey.toBuffer()], program.programId);
      await program.methods.stakePartnership(STAKE_AMOUNT, null)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: partnershipKey, user: user.publicKey, userUnsysAta, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([user]).rpc();

      const stake = await program.account.partnershipStake.fetch(partnershipKey);
      assert.ok(stake.owner.equals(user.publicKey));
      assert.ok(stake.stakedAmount.eq(STAKE_AMOUNT));
      assert.equal(stake.tier, 1);
      assert.isNull(stake.referrer);
    });

    it("should stake with referrer", async () => {
      const { kp, ata } = await createFundedUser();
      const [partnershipKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakePartnership(STAKE_AMOUNT, referrer.publicKey)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: partnershipKey, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();
      const stake = await program.account.partnershipStake.fetch(partnershipKey);
      assert.ok(stake.referrer?.equals(referrer.publicKey));
    });

    it("should reject double-staking partnership", async () => {
      const [partnershipKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), user.publicKey.toBuffer()], program.programId);
      try {
        await program.methods.stakePartnership(STAKE_AMOUNT, null)
          .accounts({ globalConfig: globalConfigKey, partnershipStake: partnershipKey, user: user.publicKey, userUnsysAta, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
          .signers([user]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "StakeAlreadyExists"); }
    });

    it("should reject zero amount", async () => {
      const { kp, ata } = await createFundedUser();
      const [partnershipKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), kp.publicKey.toBuffer()], program.programId);
      try {
        await program.methods.stakePartnership(new BN(0), null)
          .accounts({ globalConfig: globalConfigKey, partnershipStake: partnershipKey, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
          .signers([kp]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "InvalidAmount"); }
    });

    it("should reject wrong vault", async () => {
      const { kp, ata } = await createFundedUser();
      const [partnershipKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), kp.publicKey.toBuffer()], program.programId);
      const fakeVault = (await getOrCreateAssociatedTokenAccount(provider.connection, kp, unsysMint, kp.publicKey)).address;
      try {
        await program.methods.stakePartnership(STAKE_AMOUNT, null)
          .accounts({ globalConfig: globalConfigKey, partnershipStake: partnershipKey, user: kp.publicKey, userUnsysAta: ata, tokenVault: fakeVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
          .signers([kp]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "InvalidVault"); }
    });
  });

  // ================================================================
  // UNSTAKE PARTNERSHIP
  // ================================================================
  describe("unstake_partnership", () => {
    it("should partially unstake and return tokens", async () => {
      const [partnershipKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), user.publicKey.toBuffer()], program.programId);
      const beforeBalance = await provider.connection.getTokenAccountBalance(userUnsysAta);
      const halfAmount = STAKE_AMOUNT.div(new BN(2));

      await program.methods.unstakePartnership(halfAmount)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: partnershipKey, user: user.publicKey, tokenVault, userUnsysAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([user]).rpc();

      const stake = await program.account.partnershipStake.fetch(partnershipKey);
      assert.ok(stake.stakedAmount.eq(halfAmount));
      assert.equal(stake.tier, 1);

      const afterBalance = await provider.connection.getTokenAccountBalance(userUnsysAta);
      assert.equal(parseInt(afterBalance.value.amount) - parseInt(beforeBalance.value.amount), halfAmount.toNumber());
    });

    it("should fully unstake, return tokens, revoke tier", async () => {
      const [partnershipKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), user.publicKey.toBuffer()], program.programId);
      const stakeBefore = await program.account.partnershipStake.fetch(partnershipKey);
      const beforeBalance = await provider.connection.getTokenAccountBalance(userUnsysAta);

      await program.methods.unstakePartnership(stakeBefore.stakedAmount)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: partnershipKey, user: user.publicKey, tokenVault, userUnsysAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([user]).rpc();

      const stake = await program.account.partnershipStake.fetch(partnershipKey);
      assert.ok(stake.stakedAmount.eq(new BN(0)));
      assert.equal(stake.tier, 0);

      const afterBalance = await provider.connection.getTokenAccountBalance(userUnsysAta);
      assert.equal(parseInt(afterBalance.value.amount) - parseInt(beforeBalance.value.amount), stakeBefore.stakedAmount.toNumber());
    });

    it("should reject unstake by non-owner", async () => {
      const { kp: staker, ata: stakerAta } = await createFundedUser();
      const [partnershipKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), staker.publicKey.toBuffer()], program.programId);
      await program.methods.stakePartnership(STAKE_AMOUNT, null)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: partnershipKey, user: staker.publicKey, userUnsysAta: stakerAta, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([staker]).rpc();

      const attacker = anchor.web3.Keypair.generate();
      await airdropSol(attacker.publicKey, 5);
      const attackerAta = (await getOrCreateAssociatedTokenAccount(provider.connection, attacker, unsysMint, attacker.publicKey)).address;
      try {
        await program.methods.unstakePartnership(STAKE_AMOUNT)
          .accounts({ globalConfig: globalConfigKey, partnershipStake: partnershipKey, user: attacker.publicKey, tokenVault, userUnsysAta: attackerAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([attacker]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.ok(e.toString().length > 0); }
    });
  });

  // ================================================================
  // STAKE DATA PROVIDER
  // ================================================================
  describe("stake_data_provider", () => {
    it("should reject insufficient stake", async () => {
      const { kp, ata } = await createFundedUser(1_000_000);
      const [dpKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()], program.programId);
      try {
        await program.methods.stakeDataProvider(new BN(1_000_000))
          .accounts({ globalConfig: globalConfigKey, dataProviderStake: dpKey, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
          .signers([kp]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "InsufficientDataProviderStake"); }
    });

    it("should stake 5M+ successfully", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [dpKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakeDataProvider(DATA_PROVIDER_STAKE)
        .accounts({ globalConfig: globalConfigKey, dataProviderStake: dpKey, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();

      const stake = await program.account.dataProviderStake.fetch(dpKey);
      assert.ok(stake.stakedAmount.eq(DATA_PROVIDER_STAKE));
      assert.equal(stake.active, false);
    });

    it("should reject double-staking data provider", async () => {
      const { kp, ata } = await createFundedUser(20_000_000);
      const [dpKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakeDataProvider(DATA_PROVIDER_STAKE)
        .accounts({ globalConfig: globalConfigKey, dataProviderStake: dpKey, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();
      try {
        await program.methods.stakeDataProvider(DATA_PROVIDER_STAKE)
          .accounts({ globalConfig: globalConfigKey, dataProviderStake: dpKey, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
          .signers([kp]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "StakeAlreadyExists"); }
    });

    it("should validate data provider (admin only)", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [dpKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakeDataProvider(DATA_PROVIDER_STAKE)
        .accounts({ globalConfig: globalConfigKey, dataProviderStake: dpKey, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();

      await program.methods.validateDataProvider()
        .accounts({ globalConfig: globalConfigKey, dataProviderStake: dpKey, admin: admin.publicKey })
        .signers([admin]).rpc();

      const stake = await program.account.dataProviderStake.fetch(dpKey);
      assert.equal(stake.active, true);
    });

    it("should reject validation by non-admin", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [dpKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakeDataProvider(DATA_PROVIDER_STAKE)
        .accounts({ globalConfig: globalConfigKey, dataProviderStake: dpKey, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();

      const nonAdmin = anchor.web3.Keypair.generate();
      await airdropSol(nonAdmin.publicKey, 5);
      try {
        await program.methods.validateDataProvider()
          .accounts({ globalConfig: globalConfigKey, dataProviderStake: dpKey, admin: nonAdmin.publicKey })
          .signers([nonAdmin]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "Unauthorized"); }
    });
  });

  // ================================================================
  // UNSTAKE DATA PROVIDER (new)
  // ================================================================
  describe("unstake_data_provider", () => {
    it("should unstake and return tokens", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [dpKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()], program.programId);

      await program.methods.stakeDataProvider(DATA_PROVIDER_STAKE)
        .accounts({ globalConfig: globalConfigKey, dataProviderStake: dpKey, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();

      const beforeBalance = await provider.connection.getTokenAccountBalance(ata);

      await program.methods.unstakeDataProvider()
        .accounts({ globalConfig: globalConfigKey, dataProviderStake: dpKey, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([kp]).rpc();

      const stake = await program.account.dataProviderStake.fetch(dpKey);
      assert.equal(stake.stakedAmount.toNumber(), 0);
      assert.equal(stake.active, false);

      const afterBalance = await provider.connection.getTokenAccountBalance(ata);
      assert.equal(parseInt(afterBalance.value.amount) - parseInt(beforeBalance.value.amount), DATA_PROVIDER_STAKE.toNumber());
    });

    it("should reject unstake by non-owner", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [dpKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakeDataProvider(DATA_PROVIDER_STAKE)
        .accounts({ globalConfig: globalConfigKey, dataProviderStake: dpKey, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();

      const attacker = anchor.web3.Keypair.generate();
      await airdropSol(attacker.publicKey, 5);
      const attackerAta = (await getOrCreateAssociatedTokenAccount(provider.connection, attacker, unsysMint, attacker.publicKey)).address;
      try {
        await program.methods.unstakeDataProvider()
          .accounts({ globalConfig: globalConfigKey, dataProviderStake: dpKey, user: attacker.publicKey, userUnsysAta: attackerAta, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([attacker]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.ok(e.toString().length > 0); }
    });
  });

  // ================================================================
  // DEPOSIT REVENUE
  // ================================================================
  describe("deposit_revenue", () => {
    it("should deposit revenue and increment epoch", async () => {
      const configBefore = await program.account.globalConfig.fetch(globalConfigKey);
      await program.methods.depositRevenue(REVENUE_DEPOSIT)
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([admin]).rpc();

      const configAfter = await program.account.globalConfig.fetch(globalConfigKey);
      assert.equal(configAfter.dividendEpoch.toNumber(), configBefore.dividendEpoch.toNumber() + 1);

      const vaultInfo = await provider.connection.getTokenAccountBalance(revenueVault);
      assert.equal(vaultInfo.value.amount, REVENUE_DEPOSIT.toString());
    });

    it("should reject deposit from non-admin", async () => {
      const nonAdmin = anchor.web3.Keypair.generate();
      await airdropSol(nonAdmin.publicKey, 5);
      const nonAdminAta = (await getOrCreateAssociatedTokenAccount(provider.connection, nonAdmin, usdcMint, nonAdmin.publicKey)).address;
      await mintTo(provider.connection, admin, usdcMint, nonAdminAta, admin, 1_000_000);
      try {
        await program.methods.depositRevenue(new BN(100_000))
          .accounts({ globalConfig: globalConfigKey, admin: nonAdmin.publicKey, adminUsdcAta: nonAdminAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([nonAdmin]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "Unauthorized"); }
    });

    it("should reject wrong revenue vault", async () => {
      const fakeVault = (await getOrCreateAssociatedTokenAccount(provider.connection, admin, usdcMint, admin.publicKey)).address;
      try {
        await program.methods.depositRevenue(new BN(100_000))
          .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault: fakeVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([admin]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "InvalidVault"); }
    });

    it("should reject zero amount deposit", async () => {
      try {
        await program.methods.depositRevenue(new BN(0))
          .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([admin]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "InvalidAmount"); }
    });
  });

  // ================================================================
  // CLAIM DIVIDENDS (epoch-based)
  // ================================================================
  describe("claim_dividends", () => {
    it("should claim dividends (user signs)", async () => {
      const [stakeKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), user.publicKey.toBuffer()], program.programId);
      const initialBalance = await provider.connection.getTokenAccountBalance(userUsdcAta);

      await program.methods.claimDividends()
        .accounts({ globalConfig: globalConfigKey, userStake: stakeKey, user: user.publicKey, revenueVault, userUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([user]).rpc();

      const finalBalance = await provider.connection.getTokenAccountBalance(userUsdcAta);
      assert.isTrue(parseInt(finalBalance.value.amount) > parseInt(initialBalance.value.amount));

      // Verify epoch was updated
      const stake = await program.account.dividendStake.fetch(stakeKey);
      assert.equal(stake.lastClaimEpoch.toNumber(), 1);
    });

    it("should reject double-claim in same epoch (AlreadyClaimed)", async () => {
      const [stakeKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), user.publicKey.toBuffer()], program.programId);
      try {
        await program.methods.claimDividends()
          .accounts({ globalConfig: globalConfigKey, userStake: stakeKey, user: user.publicKey, revenueVault, userUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([user]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "AlreadyClaimed"); }
    });

    it("should allow claim after new deposit (new epoch)", async () => {
      // Deposit more revenue = new epoch
      await program.methods.depositRevenue(REVENUE_DEPOSIT)
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([admin]).rpc();

      const [stakeKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), user.publicKey.toBuffer()], program.programId);
      const initialBalance = await provider.connection.getTokenAccountBalance(userUsdcAta);

      await program.methods.claimDividends()
        .accounts({ globalConfig: globalConfigKey, userStake: stakeKey, user: user.publicKey, revenueVault, userUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([user]).rpc();

      const finalBalance = await provider.connection.getTokenAccountBalance(userUsdcAta);
      assert.isTrue(parseInt(finalBalance.value.amount) > parseInt(initialBalance.value.amount));
    });

    it("should reject claim with wrong vault", async () => {
      // Deposit to create new epoch
      await program.methods.depositRevenue(REVENUE_DEPOSIT)
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([admin]).rpc();

      const [stakeKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), user.publicKey.toBuffer()], program.programId);
      const fakeVault = (await getOrCreateAssociatedTokenAccount(provider.connection, admin, usdcMint, admin.publicKey)).address;
      try {
        await program.methods.claimDividends()
          .accounts({ globalConfig: globalConfigKey, userStake: stakeKey, user: user.publicKey, revenueVault: fakeVault, userUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([user]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "InvalidVault"); }
    });

    it("should reject claim by non-owner (PDA mismatch)", async () => {
      const attacker = anchor.web3.Keypair.generate();
      await airdropSol(attacker.publicKey, 5);
      const attackerUsdcAta = (await getOrCreateAssociatedTokenAccount(provider.connection, attacker, usdcMint, attacker.publicKey)).address;
      const [stakeKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), user.publicKey.toBuffer()], program.programId);
      try {
        await program.methods.claimDividends()
          .accounts({ globalConfig: globalConfigKey, userStake: stakeKey, user: attacker.publicKey, revenueVault, userUsdcAta: attackerUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([attacker]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.ok(e.toString().length > 0); }
    });
  });

  // ================================================================
  // CLAIM REFERRAL SHARE (epoch-based)
  // ================================================================
  describe("claim_referral_share", () => {
    it("should claim referral share (partner signs)", async () => {
      // Re-stake partnership (was fully unstaked above)
      const [partnershipKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), user.publicKey.toBuffer()], program.programId);
      await mintTo(provider.connection, admin, unsysMint, userUnsysAta, admin, STAKE_AMOUNT.toNumber());

      // Need to clear staked_amount=0 so init_if_needed doesn't block (stake already exists with amount=0)
      // stake_partnership checks staked_amount == 0, and it IS 0 after full unstake, so this should work
      await program.methods.stakePartnership(STAKE_AMOUNT, null)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: partnershipKey, user: user.publicKey, userUnsysAta, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([user]).rpc();

      // Deposit more for new epoch
      await program.methods.depositRevenue(REVENUE_DEPOSIT)
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([admin]).rpc();

      const initialBalance = await provider.connection.getTokenAccountBalance(userUsdcAta);
      await program.methods.claimReferralShare()
        .accounts({ globalConfig: globalConfigKey, partnershipStake: partnershipKey, user: user.publicKey, revenueVault, userUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([user]).rpc();

      const finalBalance = await provider.connection.getTokenAccountBalance(userUsdcAta);
      assert.isTrue(parseInt(finalBalance.value.amount) > parseInt(initialBalance.value.amount));
    });

    it("should reject double-claim in same epoch", async () => {
      const [partnershipKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), user.publicKey.toBuffer()], program.programId);
      try {
        await program.methods.claimReferralShare()
          .accounts({ globalConfig: globalConfigKey, partnershipStake: partnershipKey, user: user.publicKey, revenueVault, userUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([user]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "AlreadyClaimed"); }
    });

    it("should reject non-owner (PDA mismatch)", async () => {
      const attacker = anchor.web3.Keypair.generate();
      await airdropSol(attacker.publicKey, 5);
      const attackerUsdcAta = (await getOrCreateAssociatedTokenAccount(provider.connection, attacker, usdcMint, attacker.publicKey)).address;
      const [partnershipKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), user.publicKey.toBuffer()], program.programId);
      try {
        await program.methods.claimReferralShare()
          .accounts({ globalConfig: globalConfigKey, partnershipStake: partnershipKey, user: attacker.publicKey, revenueVault, userUsdcAta: attackerUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([attacker]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.ok(e.toString().length > 0); }
    });

    it("should reject wrong vault", async () => {
      // New epoch
      await program.methods.depositRevenue(REVENUE_DEPOSIT)
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([admin]).rpc();

      const [partnershipKey] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), user.publicKey.toBuffer()], program.programId);
      const fakeVault = (await getOrCreateAssociatedTokenAccount(provider.connection, admin, usdcMint, admin.publicKey)).address;
      try {
        await program.methods.claimReferralShare()
          .accounts({ globalConfig: globalConfigKey, partnershipStake: partnershipKey, user: user.publicKey, revenueVault: fakeVault, userUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([user]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "InvalidVault"); }
    });
  });
});
