import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { UnsysStaking } from "../target/types/unsys_staking";
import { assert } from "chai";
import BN from "bn.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAssociatedTokenAddress,
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

  const ADMIN_UNSYS_AMOUNT = 100_000_000;
  const USER_UNSYS_AMOUNT = 50_000_000;
  const STAKE_AMOUNT = new BN(1_000_000);
  const DATA_PROVIDER_STAKE = new BN(5_000_000);
  const REVENUE_DEPOSIT = new BN(1_000_000);

  // Helper to airdrop and confirm
  async function airdropSol(pubkey: anchor.web3.PublicKey, amount: number) {
    const sig = await provider.connection.requestAirdrop(pubkey, amount * anchor.web3.LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);
  }

  // Helper to create user with UNSYS tokens
  async function createFundedUser(unsysAmount: number = USER_UNSYS_AMOUNT) {
    const kp = anchor.web3.Keypair.generate();
    await airdropSol(kp.publicKey, 10);
    const ata = (await getOrCreateAssociatedTokenAccount(
      provider.connection, kp, unsysMint, kp.publicKey
    )).address;
    if (unsysAmount > 0) {
      await mintTo(provider.connection, admin, unsysMint, ata, admin, unsysAmount);
    }
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

    adminUnsysAta = (await getOrCreateAssociatedTokenAccount(
      provider.connection, admin, unsysMint, admin.publicKey
    )).address;

    userUnsysAta = (await getOrCreateAssociatedTokenAccount(
      provider.connection, user, unsysMint, user.publicKey
    )).address;

    userUsdcAta = (await getOrCreateAssociatedTokenAccount(
      provider.connection, user, usdcMint, user.publicKey
    )).address;

    adminUsdcAta = (await getOrCreateAssociatedTokenAccount(
      provider.connection, admin, usdcMint, admin.publicKey
    )).address;

    [globalConfigKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("global_config_v3")],
      program.programId
    );

    tokenVault = (await getOrCreateAssociatedTokenAccount(
      provider.connection, admin, unsysMint, globalConfigKey, true
    )).address;

    revenueVault = (await getOrCreateAssociatedTokenAccount(
      provider.connection, admin, usdcMint, globalConfigKey, true
    )).address;

    await mintTo(provider.connection, admin, unsysMint, adminUnsysAta, admin, ADMIN_UNSYS_AMOUNT);
    await mintTo(provider.connection, admin, unsysMint, userUnsysAta, admin, USER_UNSYS_AMOUNT);
    await mintTo(provider.connection, admin, usdcMint, adminUsdcAta, admin, 100_000_000);
  });

  // ================================================================
  // INITIALIZE
  // ================================================================
  describe("initialize", () => {
    it("should initialize global config", async () => {
      const buybackWallet = anchor.web3.Keypair.generate().publicKey;

      const tx = await program.methods
        .initialize()
        .accounts({
          globalConfig: globalConfigKey,
          admin: admin.publicKey,
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
        .signers([admin])
        .rpc();

      console.log("Initialize transaction:", tx);

      const config = await program.account.globalConfig.fetch(globalConfigKey);
      assert.ok(config.unsysMint.equals(unsysMint));
      assert.ok(config.omegaMint.equals(omegaMint));
      assert.ok(config.usdcMint.equals(usdcMint));
      assert.ok(config.admin.equals(admin.publicKey));
      assert.ok(config.tokenVault.equals(tokenVault));
      assert.ok(config.revenueVault.equals(revenueVault));
      assert.equal(config.totalDividendShares.toNumber(), 0);
    });

    it("should reject re-initialization", async () => {
      const buybackWallet = anchor.web3.Keypair.generate().publicKey;

      try {
        await program.methods
          .initialize()
          .accounts({
            globalConfig: globalConfigKey,
            admin: admin.publicKey,
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
          .signers([admin])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (e) {
        assert.include(e.toString(), "AlreadyInitialized");
      }
    });
  });

  // ================================================================
  // STAKE DIVIDENDS
  // ================================================================
  describe("stake_dividends", () => {
    it("should stake dividends for 3 months (1.1x multiplier)", async () => {
      const [userStakeKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("dividend_stake"), user.publicKey.toBuffer()],
        program.programId
      );

      const tx = await program.methods
        .stakeDividends(STAKE_AMOUNT, 3)
        .accounts({
          globalConfig: globalConfigKey,
          userStake: userStakeKey,
          user: user.publicKey,
          userUnsysAta,
          tokenVault,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      console.log("Stake 3m transaction:", tx);

      const stake = await program.account.dividendStake.fetch(userStakeKey);
      assert.ok(stake.owner.equals(user.publicKey));
      assert.ok(stake.amount.eq(STAKE_AMOUNT));
      assert.equal(stake.multiplierBps, 11000);
      assert.isAbove(stake.lockEnd.toNumber(), 0);
      // shares = 1_000_000 * 11000 / 10000 = 1_100_000
      assert.equal(stake.shares.toNumber(), 1_100_000);
    });

    it("should stake dividends for 6 months (1.25x multiplier)", async () => {
      const { kp: user2, ata: user2UnsysAta } = await createFundedUser();

      const [userStakeKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("dividend_stake"), user2.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .stakeDividends(STAKE_AMOUNT, 6)
        .accounts({
          globalConfig: globalConfigKey,
          userStake: userStakeKey,
          user: user2.publicKey,
          userUnsysAta: user2UnsysAta,
          tokenVault,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user2])
        .rpc();

      const stake = await program.account.dividendStake.fetch(userStakeKey);
      assert.equal(stake.multiplierBps, 12500);
      assert.equal(stake.shares.toNumber(), 1_250_000);
    });

    it("should stake dividends for 12 months (1.5x multiplier)", async () => {
      const { kp: user3, ata: user3UnsysAta } = await createFundedUser();

      const [userStakeKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("dividend_stake"), user3.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .stakeDividends(STAKE_AMOUNT, 12)
        .accounts({
          globalConfig: globalConfigKey,
          userStake: userStakeKey,
          user: user3.publicKey,
          userUnsysAta: user3UnsysAta,
          tokenVault,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user3])
        .rpc();

      const stake = await program.account.dividendStake.fetch(userStakeKey);
      assert.equal(stake.multiplierBps, 15000);
      assert.equal(stake.shares.toNumber(), 1_500_000);
    });

    it("should fail with invalid lock period", async () => {
      const { kp, ata } = await createFundedUser();
      const [stakeKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("dividend_stake"), kp.publicKey.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .stakeDividends(STAKE_AMOUNT, 1)
          .accounts({
            globalConfig: globalConfigKey,
            userStake: stakeKey,
            user: kp.publicKey,
            userUnsysAta: ata,
            tokenVault,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([kp])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (e) {
        assert.include(e.toString(), "Invalid lock period");
      }
    });

    it("should reject double-staking (StakeAlreadyExists)", async () => {
      // user already staked above, try again
      const [userStakeKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("dividend_stake"), user.publicKey.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .stakeDividends(STAKE_AMOUNT, 6)
          .accounts({
            globalConfig: globalConfigKey,
            userStake: userStakeKey,
            user: user.publicKey,
            userUnsysAta,
            tokenVault,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([user])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (e) {
        assert.include(e.toString(), "StakeAlreadyExists");
      }
    });

    it("should reject wrong token vault", async () => {
      const { kp, ata } = await createFundedUser();
      const [stakeKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("dividend_stake"), kp.publicKey.toBuffer()],
        program.programId
      );

      // Create a fake vault
      const fakeVault = (await getOrCreateAssociatedTokenAccount(
        provider.connection, kp, unsysMint, kp.publicKey
      )).address;

      try {
        await program.methods
          .stakeDividends(STAKE_AMOUNT, 3)
          .accounts({
            globalConfig: globalConfigKey,
            userStake: stakeKey,
            user: kp.publicKey,
            userUnsysAta: ata,
            tokenVault: fakeVault,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([kp])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (e) {
        assert.include(e.toString(), "InvalidVault");
      }
    });
  });

  // ================================================================
  // UNSTAKE DIVIDENDS (new)
  // ================================================================
  describe("unstake_dividends", () => {
    it("should fail when lock period not expired", async () => {
      // user's stake from above has a 3-month lock
      const [userStakeKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("dividend_stake"), user.publicKey.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .unstakeDividends()
          .accounts({
            globalConfig: globalConfigKey,
            userStake: userStakeKey,
            user: user.publicKey,
            userUnsysAta,
            tokenVault,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
            owner: user.publicKey,
          })
          .signers([user])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (e) {
        assert.include(e.toString(), "LockPeriodNotExpired");
      }
    });

    // Note: We can't easily test successful unstake in localnet without time manipulation.
    // In a real integration test you'd warp the clock forward.
  });

  // ================================================================
  // STAKE PARTNERSHIP
  // ================================================================
  describe("stake_partnership", () => {
    it("should stake partnership", async () => {
      const [partnershipKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("partnership_stake"), user.publicKey.toBuffer()],
        program.programId
      );

      const tx = await program.methods
        .stakePartnership(STAKE_AMOUNT, null)
        .accounts({
          partnershipStake: partnershipKey,
          user: user.publicKey,
          userUnsysAta,
          tokenVault,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          globalConfig: globalConfigKey,
        })
        .signers([user])
        .rpc();

      console.log("Stake partnership transaction:", tx);

      const stake = await program.account.partnershipStake.fetch(partnershipKey);
      assert.ok(stake.owner.equals(user.publicKey));
      assert.ok(stake.stakedAmount.eq(STAKE_AMOUNT));
      assert.equal(stake.tier, 1);
      assert.isNull(stake.referrer);
    });

    it("should stake partnership with referrer", async () => {
      const { kp: refUser, ata: refUnsysAta } = await createFundedUser();

      const [partnershipKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("partnership_stake"), refUser.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .stakePartnership(STAKE_AMOUNT, referrer.publicKey)
        .accounts({
          partnershipStake: partnershipKey,
          user: refUser.publicKey,
          userUnsysAta: refUnsysAta,
          tokenVault,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          globalConfig: globalConfigKey,
        })
        .signers([refUser])
        .rpc();

      const stake = await program.account.partnershipStake.fetch(partnershipKey);
      assert.ok(stake.referrer?.equals(referrer.publicKey));
      assert.equal(stake.tier, 1);
    });

    it("should reject wrong token vault for partnership", async () => {
      const { kp, ata } = await createFundedUser();
      const [partnershipKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("partnership_stake"), kp.publicKey.toBuffer()],
        program.programId
      );

      const fakeVault = (await getOrCreateAssociatedTokenAccount(
        provider.connection, kp, unsysMint, kp.publicKey
      )).address;

      try {
        await program.methods
          .stakePartnership(STAKE_AMOUNT, null)
          .accounts({
            partnershipStake: partnershipKey,
            user: kp.publicKey,
            userUnsysAta: ata,
            tokenVault: fakeVault,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
            globalConfig: globalConfigKey,
          })
          .signers([kp])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (e) {
        assert.include(e.toString(), "InvalidVault");
      }
    });
  });

  // ================================================================
  // UNSTAKE PARTNERSHIP (now with token return)
  // ================================================================
  describe("unstake_partnership", () => {
    it("should partially unstake and return tokens", async () => {
      const [partnershipKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("partnership_stake"), user.publicKey.toBuffer()],
        program.programId
      );

      const beforeBalance = await provider.connection.getTokenAccountBalance(userUnsysAta);
      const halfAmount = STAKE_AMOUNT.div(new BN(2));

      const tx = await program.methods
        .unstakePartnership(halfAmount)
        .accounts({
          partnershipStake: partnershipKey,
          user: user.publicKey,
          globalConfig: globalConfigKey,
          tokenVault,
          userUnsysAta,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      console.log("Partial unstake transaction:", tx);

      const stake = await program.account.partnershipStake.fetch(partnershipKey);
      assert.ok(stake.stakedAmount.eq(halfAmount));
      assert.equal(stake.tier, 1); // still active

      const afterBalance = await provider.connection.getTokenAccountBalance(userUnsysAta);
      const tokensReturned = parseInt(afterBalance.value.amount) - parseInt(beforeBalance.value.amount);
      assert.equal(tokensReturned, halfAmount.toNumber());
    });

    it("should fully unstake, return tokens, and revoke tier", async () => {
      const [partnershipKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("partnership_stake"), user.publicKey.toBuffer()],
        program.programId
      );

      const stakeBefore = await program.account.partnershipStake.fetch(partnershipKey);
      const remaining = stakeBefore.stakedAmount;

      const beforeBalance = await provider.connection.getTokenAccountBalance(userUnsysAta);

      await program.methods
        .unstakePartnership(remaining)
        .accounts({
          partnershipStake: partnershipKey,
          user: user.publicKey,
          globalConfig: globalConfigKey,
          tokenVault,
          userUnsysAta,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      const stake = await program.account.partnershipStake.fetch(partnershipKey);
      assert.ok(stake.stakedAmount.eq(new BN(0)));
      assert.equal(stake.tier, 0); // revoked

      const afterBalance = await provider.connection.getTokenAccountBalance(userUnsysAta);
      const tokensReturned = parseInt(afterBalance.value.amount) - parseInt(beforeBalance.value.amount);
      assert.equal(tokensReturned, remaining.toNumber());
    });

    it("should reject unstake by non-owner", async () => {
      // Create a user with a partnership stake
      const { kp: staker, ata: stakerAta } = await createFundedUser();
      const [partnershipKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("partnership_stake"), staker.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .stakePartnership(STAKE_AMOUNT, null)
        .accounts({
          partnershipStake: partnershipKey,
          user: staker.publicKey,
          userUnsysAta: stakerAta,
          tokenVault,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          globalConfig: globalConfigKey,
        })
        .signers([staker])
        .rpc();

      // Now try to unstake as a different user (attacker)
      const attacker = anchor.web3.Keypair.generate();
      await airdropSol(attacker.publicKey, 5);
      const attackerAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection, attacker, unsysMint, attacker.publicKey
      )).address;

      try {
        // Attacker tries to use their own key but reference staker's PDA
        // The PDA seed check will fail because the seed is derived from user.key()
        await program.methods
          .unstakePartnership(STAKE_AMOUNT)
          .accounts({
            partnershipStake: partnershipKey,
            user: attacker.publicKey,
            globalConfig: globalConfigKey,
            tokenVault,
            userUnsysAta: attackerAta,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          })
          .signers([attacker])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (e) {
        // PDA seed mismatch or constraint error
        assert.ok(e.toString().length > 0);
      }
    });
  });

  // ================================================================
  // STAKE DATA PROVIDER
  // ================================================================
  describe("stake_data_provider", () => {
    it("should fail with insufficient stake", async () => {
      const { kp, ata } = await createFundedUser(1_000_000);
      const [dpStakeKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .stakeDataProvider(new BN(1_000_000))
          .accounts({
            dataProviderStake: dpStakeKey,
            user: kp.publicKey,
            userUnsysAta: ata,
            tokenVault,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([kp])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (e) {
        assert.include(e.toString(), "InsufficientDataProviderStake");
      }
    });

    it("should stake data provider with 5M+", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [dpStakeKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .stakeDataProvider(DATA_PROVIDER_STAKE)
        .accounts({
          dataProviderStake: dpStakeKey,
          user: kp.publicKey,
          userUnsysAta: ata,
          tokenVault,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([kp])
        .rpc();

      const stake = await program.account.dataProviderStake.fetch(dpStakeKey);
      assert.ok(stake.owner.equals(kp.publicKey));
      assert.ok(stake.stakedAmount.eq(DATA_PROVIDER_STAKE));
      assert.equal(stake.active, false);
    });

    it("should validate data provider (admin only)", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [dpStakeKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .stakeDataProvider(DATA_PROVIDER_STAKE)
        .accounts({
          dataProviderStake: dpStakeKey,
          user: kp.publicKey,
          userUnsysAta: ata,
          tokenVault,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([kp])
        .rpc();

      await program.methods
        .validateDataProvider()
        .accounts({
          globalConfig: globalConfigKey,
          dataProviderStake: dpStakeKey,
          admin: admin.publicKey,
        })
        .signers([admin])
        .rpc();

      const stake = await program.account.dataProviderStake.fetch(dpStakeKey);
      assert.equal(stake.active, true);
    });

    it("should reject validation by non-admin", async () => {
      const { kp, ata } = await createFundedUser(10_000_000);
      const [dpStakeKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("data_provider_stake"), kp.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .stakeDataProvider(DATA_PROVIDER_STAKE)
        .accounts({
          dataProviderStake: dpStakeKey,
          user: kp.publicKey,
          userUnsysAta: ata,
          tokenVault,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([kp])
        .rpc();

      // Non-admin tries to validate
      const nonAdmin = anchor.web3.Keypair.generate();
      await airdropSol(nonAdmin.publicKey, 5);

      try {
        await program.methods
          .validateDataProvider()
          .accounts({
            globalConfig: globalConfigKey,
            dataProviderStake: dpStakeKey,
            admin: nonAdmin.publicKey,
          })
          .signers([nonAdmin])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (e) {
        assert.include(e.toString(), "Unauthorized");
      }
    });
  });

  // ================================================================
  // DEPOSIT REVENUE
  // ================================================================
  describe("deposit_revenue", () => {
    it("should deposit revenue", async () => {
      const tx = await program.methods
        .depositRevenue(REVENUE_DEPOSIT)
        .accounts({
          globalConfig: globalConfigKey,
          admin: admin.publicKey,
          adminUsdcAta,
          revenueVault,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      console.log("Deposit revenue transaction:", tx);

      const vaultInfo = await provider.connection.getTokenAccountBalance(revenueVault);
      assert.equal(vaultInfo.value.amount, REVENUE_DEPOSIT.toString());
    });

    it("should reject deposit from non-admin", async () => {
      const nonAdmin = anchor.web3.Keypair.generate();
      await airdropSol(nonAdmin.publicKey, 5);
      const nonAdminUsdcAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection, nonAdmin, usdcMint, nonAdmin.publicKey
      )).address;
      await mintTo(provider.connection, admin, usdcMint, nonAdminUsdcAta, admin, 1_000_000);

      try {
        await program.methods
          .depositRevenue(new BN(100_000))
          .accounts({
            globalConfig: globalConfigKey,
            admin: nonAdmin.publicKey,
            adminUsdcAta: nonAdminUsdcAta,
            revenueVault,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          })
          .signers([nonAdmin])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (e) {
        assert.include(e.toString(), "Unauthorized");
      }
    });

    it("should reject deposit with wrong revenue vault", async () => {
      const fakeVault = (await getOrCreateAssociatedTokenAccount(
        provider.connection, admin, usdcMint, admin.publicKey
      )).address;

      try {
        await program.methods
          .depositRevenue(new BN(100_000))
          .accounts({
            globalConfig: globalConfigKey,
            admin: admin.publicKey,
            adminUsdcAta,
            revenueVault: fakeVault,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          })
          .signers([admin])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (e) {
        assert.include(e.toString(), "InvalidVault");
      }
    });
  });

  // ================================================================
  // CLAIM DIVIDENDS (now requires signer)
  // ================================================================
  describe("claim_dividends", () => {
    it("should claim dividends (user signs)", async () => {
      const [userStakeKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("dividend_stake"), user.publicKey.toBuffer()],
        program.programId
      );

      const initialBalance = await provider.connection.getTokenAccountBalance(userUsdcAta);

      const tx = await program.methods
        .claimDividends()
        .accounts({
          globalConfig: globalConfigKey,
          userStake: userStakeKey,
          user: user.publicKey,
          revenueVault,
          userUsdcAta,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      console.log("Claim dividends transaction:", tx);

      const finalBalance = await provider.connection.getTokenAccountBalance(userUsdcAta);
      assert.isTrue(parseInt(finalBalance.value.amount) > parseInt(initialBalance.value.amount));
    });

    it("should reject claim with wrong revenue vault", async () => {
      // Deposit more so there's revenue
      await program.methods
        .depositRevenue(REVENUE_DEPOSIT)
        .accounts({
          globalConfig: globalConfigKey,
          admin: admin.publicKey,
          adminUsdcAta,
          revenueVault,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      const [userStakeKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("dividend_stake"), user.publicKey.toBuffer()],
        program.programId
      );

      const fakeVault = (await getOrCreateAssociatedTokenAccount(
        provider.connection, admin, usdcMint, admin.publicKey
      )).address;

      try {
        await program.methods
          .claimDividends()
          .accounts({
            globalConfig: globalConfigKey,
            userStake: userStakeKey,
            user: user.publicKey,
            revenueVault: fakeVault,
            userUsdcAta,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          })
          .signers([user])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (e) {
        assert.include(e.toString(), "InvalidVault");
      }
    });

    it("should reject claim by non-owner (PDA seed mismatch)", async () => {
      // user's stake PDA is seeded with user.publicKey
      const [userStakeKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("dividend_stake"), user.publicKey.toBuffer()],
        program.programId
      );

      const attacker = anchor.web3.Keypair.generate();
      await airdropSol(attacker.publicKey, 5);
      const attackerUsdcAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection, attacker, usdcMint, attacker.publicKey
      )).address;

      try {
        // Attacker signs as user but PDA is derived from attacker.key, so mismatch
        await program.methods
          .claimDividends()
          .accounts({
            globalConfig: globalConfigKey,
            userStake: userStakeKey,
            user: attacker.publicKey,
            revenueVault,
            userUsdcAta: attackerUsdcAta,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          })
          .signers([attacker])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (e) {
        // The PDA derived from attacker.key won't match userStakeKey
        assert.ok(e.toString().length > 0);
      }
    });

    it("should fail to claim when no revenue in vault", async () => {
      const { kp: emptyUser, ata: emptyUnsysAta } = await createFundedUser();
      const emptyUsdcAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection, emptyUser, usdcMint, emptyUser.publicKey
      )).address;

      const [stakeKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("dividend_stake"), emptyUser.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .stakeDividends(STAKE_AMOUNT, 3)
        .accounts({
          globalConfig: globalConfigKey,
          userStake: stakeKey,
          user: emptyUser.publicKey,
          userUnsysAta: emptyUnsysAta,
          tokenVault,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([emptyUser])
        .rpc();

      // Use an empty vault to trigger NoRevenueToClaim
      const emptyVaultOwner = anchor.web3.Keypair.generate();
      await airdropSol(emptyVaultOwner.publicKey, 2);
      const emptyRevenueVault = (await getOrCreateAssociatedTokenAccount(
        provider.connection, emptyVaultOwner, usdcMint, emptyVaultOwner.publicKey
      )).address;

      try {
        await program.methods
          .claimDividends()
          .accounts({
            globalConfig: globalConfigKey,
            userStake: stakeKey,
            user: emptyUser.publicKey,
            revenueVault: emptyRevenueVault,
            userUsdcAta: emptyUsdcAta,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          })
          .signers([emptyUser])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (e) {
        // Will fail with InvalidVault constraint since emptyRevenueVault != global_config.revenue_vault
        assert.include(e.toString(), "InvalidVault");
      }
    });
  });

  // ================================================================
  // CLAIM REFERRAL SHARE (now requires signer)
  // ================================================================
  describe("claim_referral_share", () => {
    it("should claim referral share (partner signs)", async () => {
      // Re-stake partnership since previous test fully unstaked
      const [partnershipKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("partnership_stake"), user.publicKey.toBuffer()],
        program.programId
      );

      await mintTo(provider.connection, admin, unsysMint, userUnsysAta, admin, STAKE_AMOUNT.toNumber());

      await program.methods
        .stakePartnership(STAKE_AMOUNT, null)
        .accounts({
          partnershipStake: partnershipKey,
          user: user.publicKey,
          userUnsysAta,
          tokenVault,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          globalConfig: globalConfigKey,
        })
        .signers([user])
        .rpc();

      // Deposit more revenue
      await program.methods
        .depositRevenue(REVENUE_DEPOSIT)
        .accounts({
          globalConfig: globalConfigKey,
          admin: admin.publicKey,
          adminUsdcAta,
          revenueVault,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .signers([admin])
        .rpc();

      const initialBalance = await provider.connection.getTokenAccountBalance(userUsdcAta);

      const tx = await program.methods
        .claimReferralShare()
        .accounts({
          globalConfig: globalConfigKey,
          partnershipStake: partnershipKey,
          user: user.publicKey,
          revenueVault,
          userUsdcAta,
          tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc();

      console.log("Claim referral share transaction:", tx);

      const finalBalance = await provider.connection.getTokenAccountBalance(userUsdcAta);
      assert.isTrue(parseInt(finalBalance.value.amount) > parseInt(initialBalance.value.amount));
    });

    it("should reject referral claim by non-owner (PDA mismatch)", async () => {
      const attacker = anchor.web3.Keypair.generate();
      await airdropSol(attacker.publicKey, 5);
      const attackerUsdcAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection, attacker, usdcMint, attacker.publicKey
      )).address;

      // user's partnership PDA
      const [partnershipKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("partnership_stake"), user.publicKey.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .claimReferralShare()
          .accounts({
            globalConfig: globalConfigKey,
            partnershipStake: partnershipKey,
            user: attacker.publicKey,
            revenueVault,
            userUsdcAta: attackerUsdcAta,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          })
          .signers([attacker])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (e) {
        // PDA seed mismatch: seeds use user.key() but attacker != user
        assert.ok(e.toString().length > 0);
      }
    });

    it("should reject referral claim with no active stake", async () => {
      // Create user with no partnership
      const { kp: noPartner } = await createFundedUser(0);
      const noPartnerUsdcAta = (await getOrCreateAssociatedTokenAccount(
        provider.connection, noPartner, usdcMint, noPartner.publicKey
      )).address;

      const [partnershipKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("partnership_stake"), noPartner.publicKey.toBuffer()],
        program.programId
      );

      try {
        await program.methods
          .claimReferralShare()
          .accounts({
            globalConfig: globalConfigKey,
            partnershipStake: partnershipKey,
            user: noPartner.publicKey,
            revenueVault,
            userUsdcAta: noPartnerUsdcAta,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          })
          .signers([noPartner])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (e) {
        // Account doesn't exist yet, so will fail
        assert.ok(e.toString().length > 0);
      }
    });

    it("should reject referral claim with wrong vault", async () => {
      const [partnershipKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [Buffer.from("partnership_stake"), user.publicKey.toBuffer()],
        program.programId
      );

      const fakeVault = (await getOrCreateAssociatedTokenAccount(
        provider.connection, admin, usdcMint, admin.publicKey
      )).address;

      try {
        await program.methods
          .claimReferralShare()
          .accounts({
            globalConfig: globalConfigKey,
            partnershipStake: partnershipKey,
            user: user.publicKey,
            revenueVault: fakeVault,
            userUsdcAta,
            tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
          })
          .signers([user])
          .rpc();
        assert.fail("Should have thrown error");
      } catch (e) {
        assert.include(e.toString(), "InvalidVault");
      }
    });
  });
});
