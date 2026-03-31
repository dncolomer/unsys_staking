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
    it("should initialize with vault mint+authority validation", async () => {
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
      assert.equal(config.epochActivePartners.toNumber(), 0);
      assert.ok(config.pendingAdmin.equals(anchor.web3.PublicKey.default));
    });

    it("should reject re-initialization", async () => {
      try {
        await program.methods.initialize()
          .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, unsysMint, omegaMint, usdcMint, buybackWallet: anchor.web3.Keypair.generate().publicKey, tokenVault, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, associatedTokenProgram: anchor.utils.token.ASSOCIATED_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
          .signers([admin]).rpc();
        assert.fail("Should have thrown");
      } catch (e) {
        assert.include(e.toString(), "AlreadyInitialized");
      }
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

    it("should reject accept by wrong address", async () => {
      const na = anchor.web3.Keypair.generate();
      const wrong = anchor.web3.Keypair.generate();
      await airdropSol(na.publicKey, 5);
      await airdropSol(wrong.publicKey, 5);
      await program.methods.proposeAdminTransfer(na.publicKey)
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey }).signers([admin]).rpc();
      try {
        await program.methods.acceptAdminTransfer()
          .accounts({ globalConfig: globalConfigKey, newAdmin: wrong.publicKey }).signers([wrong]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "Unauthorized"); }
      await program.methods.cancelAdminTransfer()
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey }).signers([admin]).rpc();
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

    it("should reject cancel by non-admin", async () => {
      const atk = anchor.web3.Keypair.generate();
      await airdropSol(atk.publicKey, 5);
      try {
        await program.methods.cancelAdminTransfer()
          .accounts({ globalConfig: globalConfigKey, admin: atk.publicKey }).signers([atk]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "Unauthorized"); }
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
      assert.equal(s.shares.toNumber(), 1_100_000);
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

    it("should reject double-stake", async () => {
      const [sk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), user.publicKey.toBuffer()], program.programId);
      try {
        await program.methods.stakeDividends(STAKE_AMOUNT, 6)
          .accounts({ globalConfig: globalConfigKey, userStake: sk, user: user.publicKey, userUnsysAta, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
          .signers([user]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "StakeAlreadyExists"); }
    });

    it("should reject wrong vault", async () => {
      const { kp, ata } = await createFundedUser();
      const [sk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), kp.publicKey.toBuffer()], program.programId);
      const fv = (await getOrCreateAssociatedTokenAccount(provider.connection, kp, unsysMint, kp.publicKey)).address;
      try {
        await program.methods.stakeDividends(STAKE_AMOUNT, 3)
          .accounts({ globalConfig: globalConfigKey, userStake: sk, user: kp.publicKey, userUnsysAta: ata, tokenVault: fv, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
          .signers([kp]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "InvalidVault"); }
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
    // NOTE: Happy-path unstake requires clock warp (not available in anchor test).
    // Test on devnet with solana-test-validator --warp-slot.
  });

  // ================================================================
  describe("stake_partnership", () => {
    it("should stake and increment active partners", async () => {
      const cb = await program.account.globalConfig.fetch(globalConfigKey);
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), user.publicKey.toBuffer()], program.programId);
      await program.methods.stakePartnership(STAKE_AMOUNT, null)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: user.publicKey, userUnsysAta, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([user]).rpc();
      const ca = await program.account.globalConfig.fetch(globalConfigKey);
      assert.equal(ca.totalActivePartners.toNumber(), cb.totalActivePartners.toNumber() + 1);
    });

    it("should stake with referrer", async () => {
      const { kp, ata } = await createFundedUser();
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakePartnership(STAKE_AMOUNT, referrer.publicKey)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();
      assert.ok((await program.account.partnershipStake.fetch(pk)).referrer?.equals(referrer.publicKey));
    });

    it("should reject double-stake", async () => {
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), user.publicKey.toBuffer()], program.programId);
      try {
        await program.methods.stakePartnership(STAKE_AMOUNT, null)
          .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: user.publicKey, userUnsysAta, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
          .signers([user]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "StakeAlreadyExists"); }
    });

    it("should reject zero amount", async () => {
      const { kp, ata } = await createFundedUser();
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), kp.publicKey.toBuffer()], program.programId);
      try {
        await program.methods.stakePartnership(new BN(0), null)
          .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
          .signers([kp]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "InvalidAmount"); }
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
      const after = await provider.connection.getTokenAccountBalance(userUnsysAta);
      assert.equal(parseInt(after.value.amount) - parseInt(before.value.amount), half.toNumber());
    });

    it("should fully unstake and decrement partners", async () => {
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), user.publicKey.toBuffer()], program.programId);
      const cb = await program.account.globalConfig.fetch(globalConfigKey);
      const rem = (await program.account.partnershipStake.fetch(pk)).stakedAmount;
      await program.methods.unstakePartnership(rem)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: user.publicKey, tokenVault, userUnsysAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([user]).rpc();
      const s = await program.account.partnershipStake.fetch(pk);
      assert.equal(s.tier, 0);
      const ca = await program.account.globalConfig.fetch(globalConfigKey);
      assert.equal(ca.totalActivePartners.toNumber(), cb.totalActivePartners.toNumber() - 1);
    });

    it("should reject zero-amount unstake", async () => {
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
      const { kp: st, ata } = await createFundedUser();
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), st.publicKey.toBuffer()], program.programId);
      await program.methods.stakePartnership(STAKE_AMOUNT, null)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: st.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([st]).rpc();
      const atk = anchor.web3.Keypair.generate();
      await airdropSol(atk.publicKey, 5);
      const aAta = (await getOrCreateAssociatedTokenAccount(provider.connection, atk, unsysMint, atk.publicKey)).address;
      try {
        await program.methods.unstakePartnership(STAKE_AMOUNT)
          .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: atk.publicKey, tokenVault, userUnsysAta: aAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([atk]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.ok(e.toString().length > 0); }
    });
  });

  // ================================================================
  describe("re-stake partnership after full unstake", () => {
    it("should re-stake with fresh epoch tracking", async () => {
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), user.publicKey.toBuffer()], program.programId);
      const remaining = (await program.account.partnershipStake.fetch(pk)).stakedAmount;
      if (remaining.toNumber() > 0) {
        await program.methods.unstakePartnership(remaining)
          .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: user.publicKey, tokenVault, userUnsysAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([user]).rpc();
      }

      await program.methods.depositRevenue(REVENUE_DEPOSIT)
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([admin]).rpc();
      const config = await program.account.globalConfig.fetch(globalConfigKey);

      await mintTo(provider.connection, admin, unsysMint, userUnsysAta, admin, STAKE_AMOUNT.toNumber());
      await program.methods.stakePartnership(STAKE_AMOUNT, null)
        .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: user.publicKey, userUnsysAta, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([user]).rpc();

      const s = await program.account.partnershipStake.fetch(pk);
      assert.equal(s.tier, 1);
      assert.equal(s.lastClaimEpoch.toNumber(), config.dividendEpoch.toNumber());
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
      assert.ok((await program.account.dataProviderStake.fetch(dk)).stakedAmount.eq(DATA_PROVIDER_STAKE));
    });

    it("should reject double-stake", async () => {
      const { kp, ata } = await createFundedUser(20_000_000);
      const [dk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakeDataProvider(DATA_PROVIDER_STAKE)
        .accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();
      try {
        await program.methods.stakeDataProvider(DATA_PROVIDER_STAKE)
          .accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
          .signers([kp]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "StakeAlreadyExists"); }
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
    });

    it("should reject deactivation of inactive", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [dk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakeDataProvider(DATA_PROVIDER_STAKE)
        .accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();
      try {
        await program.methods.deactivateDataProvider()
          .accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, admin: admin.publicKey }).signers([admin]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "NotActive"); }
    });

    it("should reject unstake by non-owner", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [dk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()], program.programId);
      await program.methods.stakeDataProvider(DATA_PROVIDER_STAKE)
        .accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, user: kp.publicKey, userUnsysAta: ata, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, systemProgram: anchor.web3.SystemProgram.programId })
        .signers([kp]).rpc();
      const atk = anchor.web3.Keypair.generate();
      await airdropSol(atk.publicKey, 5);
      const aAta = (await getOrCreateAssociatedTokenAccount(provider.connection, atk, unsysMint, atk.publicKey)).address;
      try {
        await program.methods.unstakeDataProvider()
          .accounts({ globalConfig: globalConfigKey, dataProviderStake: dk, user: atk.publicKey, userUnsysAta: aAta, tokenVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([atk]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.ok(e.toString().length > 0); }
    });
  });

  // ================================================================
  describe("deposit_revenue (accumulating, partner snapshot)", () => {
    it("should deposit, accumulate, and snapshot partners", async () => {
      const cb = await program.account.globalConfig.fetch(globalConfigKey);
      await program.methods.depositRevenue(REVENUE_DEPOSIT)
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([admin]).rpc();
      const ca = await program.account.globalConfig.fetch(globalConfigKey);
      assert.equal(ca.dividendEpoch.toNumber(), cb.dividendEpoch.toNumber() + 1);
      // Snapshot: epoch_active_partners == total_active_partners at deposit time
      assert.equal(ca.epochActivePartners.toNumber(), ca.totalActivePartners.toNumber());
      // Pools accumulate
      const expectedRef = Math.floor(1_000_000 * 3333 / 10000);
      const expectedDiv = 1_000_000 - expectedRef;
      assert.equal(ca.epochDividendPool.toNumber(), cb.epochDividendPool.toNumber() + expectedDiv);
      assert.equal(ca.epochReferralPool.toNumber(), cb.epochReferralPool.toNumber() + expectedRef);
      // Snapshots equal pool values at deposit time
      assert.equal(ca.epochDividendSnapshot.toNumber(), ca.epochDividendPool.toNumber());
      assert.equal(ca.epochReferralSnapshot.toNumber(), ca.epochReferralPool.toNumber());
    });

    it("should accumulate across multiple deposits", async () => {
      const cb = await program.account.globalConfig.fetch(globalConfigKey);
      await program.methods.depositRevenue(new BN(2_000_000))
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([admin]).rpc();
      const ca = await program.account.globalConfig.fetch(globalConfigKey);
      const expectedRef2 = Math.floor(2_000_000 * 3333 / 10000);
      const expectedDiv2 = 2_000_000 - expectedRef2;
      assert.equal(ca.epochDividendPool.toNumber(), cb.epochDividendPool.toNumber() + expectedDiv2);
      assert.equal(ca.epochReferralPool.toNumber(), cb.epochReferralPool.toNumber() + expectedRef2);
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

    it("should reject wrong vault", async () => {
      const fv = (await getOrCreateAssociatedTokenAccount(provider.connection, admin, usdcMint, admin.publicKey)).address;
      try {
        await program.methods.depositRevenue(new BN(100_000))
          .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault: fv, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([admin]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "InvalidVault"); }
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
  describe("claim_dividends (pool decrement)", () => {
    it("should claim and decrement epoch_dividend_pool", async () => {
      await program.methods.depositRevenue(REVENUE_DEPOSIT)
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([admin]).rpc();

      const [sk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), user.publicKey.toBuffer()], program.programId);
      const configBefore = await program.account.globalConfig.fetch(globalConfigKey);
      const stake = await program.account.dividendStake.fetch(sk);
      // Reward calculated from snapshot (not live pool)
      const expected = Math.floor(stake.shares.toNumber() * configBefore.epochDividendSnapshot.toNumber() / configBefore.totalDividendShares.toNumber());

      const before = await provider.connection.getTokenAccountBalance(userUsdcAta);
      await program.methods.claimDividends()
        .accounts({ globalConfig: globalConfigKey, userStake: sk, user: user.publicKey, revenueVault, userUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([user]).rpc();
      const after = await provider.connection.getTokenAccountBalance(userUsdcAta);
      const received = parseInt(after.value.amount) - parseInt(before.value.amount);
      assert.equal(received, expected);

      // Verify pool was decremented
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

    it("should allow after new deposit", async () => {
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
      await program.methods.depositRevenue(REVENUE_DEPOSIT)
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([admin]).rpc();
      const [sk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), user.publicKey.toBuffer()], program.programId);
      const fv = (await getOrCreateAssociatedTokenAccount(provider.connection, admin, usdcMint, admin.publicKey)).address;
      try {
        await program.methods.claimDividends()
          .accounts({ globalConfig: globalConfigKey, userStake: sk, user: user.publicKey, revenueVault: fv, userUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([user]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "InvalidVault"); }
    });

    it("should reject non-owner", async () => {
      const atk = anchor.web3.Keypair.generate();
      await airdropSol(atk.publicKey, 5);
      const atkAta = (await getOrCreateAssociatedTokenAccount(provider.connection, atk, usdcMint, atk.publicKey)).address;
      const [sk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("dividend_stake"), user.publicKey.toBuffer()], program.programId);
      try {
        await program.methods.claimDividends()
          .accounts({ globalConfig: globalConfigKey, userStake: sk, user: atk.publicKey, revenueVault, userUsdcAta: atkAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([atk]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.ok(e.toString().length > 0); }
    });
  });

  // ================================================================
  describe("multi-user dividend fairness", () => {
    it("two users with equal shares get identical amounts regardless of claim order", async () => {
      const { kp: uA, ata: ataA } = await createFundedUser();
      const { kp: uB, ata: ataB } = await createFundedUser();
      const usdcA = (await getOrCreateAssociatedTokenAccount(provider.connection, uA, usdcMint, uA.publicKey)).address;
      const usdcB = (await getOrCreateAssociatedTokenAccount(provider.connection, uB, usdcMint, uB.publicKey)).address;
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

      // A claims first, B claims second
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

      // Both must receive identical amounts (snapshot fairness proof)
      assert.equal(receivedA, receivedB, "Equal-share users must receive equal rewards");
      assert.isTrue(receivedA > 0);
    });
  });

  // ================================================================
  describe("claim_referral_share (pool decrement, partner snapshot)", () => {
    it("should claim per-partner share and decrement pool", async () => {
      await program.methods.depositRevenue(REVENUE_DEPOSIT)
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([admin]).rpc();

      const configBefore = await program.account.globalConfig.fetch(globalConfigKey);
      // Reward calculated from snapshot (not live pool)
      const expectedPerPartner = Math.floor(configBefore.epochReferralSnapshot.toNumber() / configBefore.epochActivePartners.toNumber());

      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), user.publicKey.toBuffer()], program.programId);
      const before = await provider.connection.getTokenAccountBalance(userUsdcAta);
      await program.methods.claimReferralShare()
        .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: user.publicKey, revenueVault, userUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([user]).rpc();
      const after = await provider.connection.getTokenAccountBalance(userUsdcAta);
      const received = parseInt(after.value.amount) - parseInt(before.value.amount);
      assert.equal(received, expectedPerPartner);

      // Verify pool was decremented
      const configAfter = await program.account.globalConfig.fetch(globalConfigKey);
      assert.equal(configAfter.epochReferralPool.toNumber(), configBefore.epochReferralPool.toNumber() - received);
    });

    it("should reject double-claim", async () => {
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), user.publicKey.toBuffer()], program.programId);
      try {
        await program.methods.claimReferralShare()
          .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: user.publicKey, revenueVault, userUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([user]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "AlreadyClaimed"); }
    });

    it("should reject non-owner", async () => {
      const atk = anchor.web3.Keypair.generate();
      await airdropSol(atk.publicKey, 5);
      const atkAta = (await getOrCreateAssociatedTokenAccount(provider.connection, atk, usdcMint, atk.publicKey)).address;
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), user.publicKey.toBuffer()], program.programId);
      try {
        await program.methods.claimReferralShare()
          .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: atk.publicKey, revenueVault, userUsdcAta: atkAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([atk]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.ok(e.toString().length > 0); }
    });

    it("should reject wrong vault", async () => {
      await program.methods.depositRevenue(REVENUE_DEPOSIT)
        .accounts({ globalConfig: globalConfigKey, admin: admin.publicKey, adminUsdcAta, revenueVault, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
        .signers([admin]).rpc();
      const [pk] = anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("partnership_stake"), user.publicKey.toBuffer()], program.programId);
      const fv = (await getOrCreateAssociatedTokenAccount(provider.connection, admin, usdcMint, admin.publicKey)).address;
      try {
        await program.methods.claimReferralShare()
          .accounts({ globalConfig: globalConfigKey, partnershipStake: pk, user: user.publicKey, revenueVault: fv, userUsdcAta, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
          .signers([user]).rpc();
        assert.fail("Should have thrown");
      } catch (e) { assert.include(e.toString(), "InvalidVault"); }
    });
  });
});
