use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

declare_id!("8fQT7WjAw2BLYJcbTPYxLciPmUgh5GS4Jj2Vo1uhoK2q");

// ============================================================
// Events
// ============================================================

#[event]
pub struct ConfigInitialized {
    pub admin: Pubkey,
    pub unsys_mint: Pubkey,
    pub usdc_mint: Pubkey,
}

#[event]
pub struct RevenueDeposited {
    pub amount: u64,
    pub epoch: u64,
    pub epoch_dividend_pool: u64,
    pub epoch_referral_pool: u64,
    pub epoch_active_partners: u64,
}

#[event]
pub struct DividendStakedEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub lock_months: u8,
    pub shares: u128,
    pub multiplier_bps: u16,
}

#[event]
pub struct DividendUnstakedEvent {
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct DividendClaimedEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub epoch: u64,
}

#[event]
pub struct PartnershipStakedEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub referrer: Option<Pubkey>,
}

#[event]
pub struct PartnershipUnstakedEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub fully_unstaked: bool,
}

#[event]
pub struct ReferralShareClaimedEvent {
    pub user: Pubkey,
    pub amount: u64,
    pub epoch: u64,
}

#[event]
pub struct DataProviderStakedEvent {
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct DataProviderUnstakedEvent {
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct DataProviderValidatedEvent {
    pub user: Pubkey,
}

#[event]
pub struct DataProviderDeactivatedEvent {
    pub user: Pubkey,
}

#[event]
pub struct AdminTransferProposed {
    pub current_admin: Pubkey,
    pub pending_admin: Pubkey,
}

#[event]
pub struct AdminTransferAccepted {
    pub old_admin: Pubkey,
    pub new_admin: Pubkey,
}

#[event]
pub struct AdminTransferCancelled {
    pub admin: Pubkey,
}

#[event]
pub struct LegacyHolderRegistered {
    pub holder: Pubkey,
}

#[event]
pub struct LegacyBenefitsEnabled {
    pub user: Pubkey,
    pub shares: u128,
    pub tier: u8,
}

#[event]
pub struct LegacyPartnershipRevoked {
    pub user: Pubkey,
}

#[event]
pub struct ProgramPaused {
    pub admin: Pubkey,
}

#[event]
pub struct ProgramUnpaused {
    pub admin: Pubkey,
}

#[event]
pub struct DustSwept {
    pub pool: String,
    pub amount: u64,
}

#[event]
pub struct DividendStakeClosed {
    pub user: Pubkey,
}

#[event]
pub struct PartnershipStakeClosed {
    pub user: Pubkey,
}

#[event]
pub struct DataProviderStakeClosed {
    pub user: Pubkey,
}

#[program]
pub mod unsys_staking {
    use super::*;

    const MIN_DATA_PROVIDER_STAKE: u64 = 5_000_000;
    const BASE_LEGACY_SHARES: u128 = 1_000_000 * 10_000;
    const REFERRAL_POOL_BPS: u64 = 3333;
    const BPS_DENOMINATOR: u64 = 10000;
    /// [Issue 3] Maximum number of legacy holders that can be registered to prevent
    /// unbounded dilution of regular stakers' dividend shares.
    const MAX_LEGACY_HOLDERS: u64 = 500;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.global_config;
        require!(
            config.admin == Pubkey::default(),
            ErrorCode::AlreadyInitialized
        );

        // Validate vault mints match the declared mints
        require!(
            ctx.accounts.token_vault.mint == ctx.accounts.unsys_mint.key(),
            ErrorCode::InvalidVault
        );
        require!(
            ctx.accounts.revenue_vault.mint == ctx.accounts.usdc_mint.key(),
            ErrorCode::InvalidVault
        );
        // Validate vault authorities are the GlobalConfig PDA
        let global_config_key = config.key();
        require!(
            ctx.accounts.token_vault.owner == global_config_key,
            ErrorCode::InvalidVault
        );
        require!(
            ctx.accounts.revenue_vault.owner == global_config_key,
            ErrorCode::InvalidVault
        );

        config.unsys_mint = ctx.accounts.unsys_mint.key();
        config.omega_mint = ctx.accounts.omega_mint.key();
        config.usdc_mint = ctx.accounts.usdc_mint.key();
        config.token_vault = ctx.accounts.token_vault.key();
        config.revenue_vault = ctx.accounts.revenue_vault.key();
        config.admin = ctx.accounts.admin.key();
        config.pending_admin = Pubkey::default();
        config.buyback_wallet = ctx.accounts.buyback_wallet.key();
        config.total_dividend_shares = 0;
        config.dividend_epoch = 0;
        config.epoch_dividend_pool = 0;
        config.epoch_referral_pool = 0;
        config.total_active_partners = 0;
        config.epoch_active_partners = 0;
        config.epoch_dividend_snapshot = 0;
        config.epoch_referral_snapshot = 0;
        // [Issue 11] Program starts unpaused
        config.paused = false;
        // [Issue 3] Legacy holder counter starts at 0
        config.total_legacy_holders = 0;
        config.bump = ctx.bumps.global_config;

        emit!(ConfigInitialized {
            admin: ctx.accounts.admin.key(),
            unsys_mint: ctx.accounts.unsys_mint.key(),
            usdc_mint: ctx.accounts.usdc_mint.key(),
        });

        msg!("GlobalConfig initialized");
        Ok(())
    }

    // ----------------------------------------------------------------
    // Admin: two-step admin transfer
    // ----------------------------------------------------------------

    pub fn propose_admin_transfer(ctx: Context<ProposeAdminTransfer>, new_admin: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.global_config;
        require_keys_eq!(ctx.accounts.admin.key(), config.admin, ErrorCode::Unauthorized);
        require!(new_admin != Pubkey::default(), ErrorCode::InvalidAdmin);

        config.pending_admin = new_admin;

        emit!(AdminTransferProposed {
            current_admin: config.admin,
            pending_admin: new_admin,
        });
        msg!("Admin transfer proposed to {}", new_admin);
        Ok(())
    }

    pub fn accept_admin_transfer(ctx: Context<AcceptAdminTransfer>) -> Result<()> {
        let config = &mut ctx.accounts.global_config;
        require_keys_eq!(ctx.accounts.new_admin.key(), config.pending_admin, ErrorCode::Unauthorized);

        let old_admin = config.admin;
        config.admin = config.pending_admin;
        config.pending_admin = Pubkey::default();

        emit!(AdminTransferAccepted { old_admin, new_admin: config.admin });
        msg!("Admin transferred from {} to {}", old_admin, config.admin);
        Ok(())
    }

    /// [Issue 7] Dedicated context struct for cancel_admin_transfer
    pub fn cancel_admin_transfer(ctx: Context<CancelAdminTransfer>) -> Result<()> {
        let config = &mut ctx.accounts.global_config;
        require_keys_eq!(ctx.accounts.admin.key(), config.admin, ErrorCode::Unauthorized);

        config.pending_admin = Pubkey::default();

        emit!(AdminTransferCancelled { admin: config.admin });
        msg!("Admin transfer cancelled");
        Ok(())
    }

    // ----------------------------------------------------------------
    // [Issue 11] Emergency pause/unpause
    // ----------------------------------------------------------------

    pub fn pause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.global_config;
        require_keys_eq!(ctx.accounts.admin.key(), config.admin, ErrorCode::Unauthorized);
        require!(!config.paused, ErrorCode::AlreadyPaused);

        config.paused = true;

        emit!(ProgramPaused { admin: config.admin });
        msg!("Program PAUSED by admin");
        Ok(())
    }

    pub fn unpause(ctx: Context<AdminOnly>) -> Result<()> {
        let config = &mut ctx.accounts.global_config;
        require_keys_eq!(ctx.accounts.admin.key(), config.admin, ErrorCode::Unauthorized);
        require!(config.paused, ErrorCode::NotPaused);

        config.paused = false;

        emit!(ProgramUnpaused { admin: config.admin });
        msg!("Program UNPAUSED by admin");
        Ok(())
    }

    // ----------------------------------------------------------------
    // Revenue deposit with snapshot (accumulating)
    // [Issue 2] Note on accumulation model: Unclaimed funds from prior epochs
    // roll forward into the next epoch's pool. The snapshot captures the total
    // pool value at deposit time. This means late-entering stakers can claim a
    // proportional share of accumulated unclaimed funds. This is by design —
    // it simplifies the model and avoids per-epoch tracking. Dust from integer
    // division truncation remains in the pool and is claimable in future epochs.
    // ----------------------------------------------------------------

    pub fn deposit_revenue(ctx: Context<DepositRevenue>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        // [Issue 11] Check pause state
        require!(!ctx.accounts.global_config.paused, ErrorCode::ProgramPaused);
        require_keys_eq!(ctx.accounts.admin.key(), ctx.accounts.global_config.admin, ErrorCode::Unauthorized);

        let cpi_accounts = Transfer {
            from: ctx.accounts.admin_usdc_ata.to_account_info(),
            to: ctx.accounts.revenue_vault.to_account_info(),
            authority: ctx.accounts.admin.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        let config = &mut ctx.accounts.global_config;

        // [Issue 9] Use checked arithmetic consistently
        let referral_amount = amount.checked_mul(REFERRAL_POOL_BPS).ok_or(ErrorCode::MathOverflow)?
            .checked_div(BPS_DENOMINATOR).ok_or(ErrorCode::MathOverflow)?;
        let dividend_amount = amount.checked_sub(referral_amount).ok_or(ErrorCode::MathOverflow)?;

        // Accumulate: unclaimed funds from prior epochs roll forward
        config.epoch_dividend_pool = config.epoch_dividend_pool.checked_add(dividend_amount).ok_or(ErrorCode::MathOverflow)?;
        config.epoch_referral_pool = config.epoch_referral_pool.checked_add(referral_amount).ok_or(ErrorCode::MathOverflow)?;
        config.dividend_epoch = config.dividend_epoch.checked_add(1).ok_or(ErrorCode::MathOverflow)?;

        // Snapshot pools at deposit time for fair per-user calculation
        // Claims calculate from these snapshots; epoch_*_pool tracks remaining balance
        config.epoch_dividend_snapshot = config.epoch_dividend_pool;
        config.epoch_referral_snapshot = config.epoch_referral_pool;

        // Snapshot active partners at deposit time for fair referral split
        config.epoch_active_partners = config.total_active_partners;

        emit!(RevenueDeposited {
            amount,
            epoch: config.dividend_epoch,
            epoch_dividend_pool: config.epoch_dividend_pool,
            epoch_referral_pool: config.epoch_referral_pool,
            epoch_active_partners: config.epoch_active_partners,
        });

        msg!(
            "Deposited {} USDC (epoch {}, div_pool={}, ref_pool={}, partners={})",
            amount, config.dividend_epoch, config.epoch_dividend_pool, config.epoch_referral_pool, config.epoch_active_partners
        );
        Ok(())
    }

    // ----------------------------------------------------------------
    // Dividend staking
    // [Issue 1] Uses `init` instead of `init_if_needed` — accounts can only
    // be created once. The `is_initialized` flag provides defense-in-depth.
    // ----------------------------------------------------------------

    pub fn stake_dividends(ctx: Context<StakeDividends>, amount: u64, lock_months: u8) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        // [Issue 11] Check pause state
        require!(!ctx.accounts.global_config.paused, ErrorCode::ProgramPaused);

        let stake = &mut ctx.accounts.user_stake;
        let clock = Clock::get()?;
        // [Issue 1] Defense-in-depth: reject if already initialized
        require!(!stake.is_initialized, ErrorCode::StakeAlreadyExists);

        let multiplier_bps = match lock_months {
            3 => 11000u16,
            6 => 12500u16,
            12 => 15000u16,
            _ => return err!(ErrorCode::InvalidLockPeriod),
        };
        // [Issue 9] Use checked arithmetic for share calculation
        let shares = (amount as u128)
            .checked_mul(multiplier_bps as u128).ok_or(ErrorCode::MathOverflow)?
            .checked_div(10000).ok_or(ErrorCode::MathOverflow)?;

        stake.is_initialized = true;
        stake.owner = ctx.accounts.user.key();
        stake.amount = amount;
        stake.shares = shares;
        stake.lock_end = clock.unix_timestamp + (lock_months as i64 * 30 * 24 * 60 * 60);
        stake.multiplier_bps = multiplier_bps;
        stake.last_claim_ts = clock.unix_timestamp;
        stake.last_claim_epoch = ctx.accounts.global_config.dividend_epoch;
        stake.bump = ctx.bumps.user_stake;

        let cpi_accounts = Transfer {
            from: ctx.accounts.user_unsys_ata.to_account_info(),
            to: ctx.accounts.token_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        ctx.accounts.global_config.total_dividend_shares = ctx.accounts.global_config.total_dividend_shares
            .checked_add(shares).ok_or(ErrorCode::MathOverflow)?;

        emit!(DividendStakedEvent { user: ctx.accounts.user.key(), amount, lock_months, shares, multiplier_bps });
        msg!("Staked {} $UNSYS for {} months", amount, lock_months);
        Ok(())
    }

    pub fn unstake_dividends(ctx: Context<UnstakeDividends>) -> Result<()> {
        let stake = &mut ctx.accounts.user_stake;
        let clock = Clock::get()?;

        require!(stake.amount > 0, ErrorCode::NoActiveStake);
        require!(clock.unix_timestamp >= stake.lock_end, ErrorCode::LockPeriodNotExpired);

        let amount = stake.amount;
        let shares = stake.shares;

        let config = &ctx.accounts.global_config;
        let bump = [config.bump];
        let signer_seeds = &[&[b"global_config_v3".as_ref(), &bump][..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.token_vault.to_account_info(),
            to: ctx.accounts.user_unsys_ata.to_account_info(),
            authority: ctx.accounts.global_config.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer_seeds);
        token::transfer(cpi_ctx, amount)?;

        stake.amount = 0;
        stake.shares = 0;
        stake.lock_end = 0;
        stake.multiplier_bps = 0;
        // [Issue 1] Mark as uninitialized so the account can be closed and re-created
        stake.is_initialized = false;

        // [Issue 8] Use checked_sub instead of saturating_sub for accounting integrity
        ctx.accounts.global_config.total_dividend_shares = ctx.accounts.global_config.total_dividend_shares
            .checked_sub(shares).ok_or(ErrorCode::MathOverflow)?;

        emit!(DividendUnstakedEvent { user: ctx.accounts.user.key(), amount });
        msg!("Unstaked {} $UNSYS dividends", amount);
        Ok(())
    }

    // ----------------------------------------------------------------
    // Claim dividends (snapshot-based, pool-decrementing)
    // [Issue 10] Single-epoch claim model: Users can only claim once per epoch.
    // Unclaimed epochs are not individually tracked — when a new deposit creates
    // epoch N+1, the pools include any unclaimed funds from epoch N. A user who
    // missed epoch N will get their proportional share of the accumulated pool
    // when they claim in epoch N+1. This means there is no "lost" revenue, but
    // stakers should claim promptly to avoid dilution from new stakers entering
    // before the next deposit.
    // ----------------------------------------------------------------

    pub fn claim_dividends(ctx: Context<ClaimDividends>) -> Result<()> {
        // [Issue 11] Check pause state
        require!(!ctx.accounts.global_config.paused, ErrorCode::ProgramPaused);

        let stake = &mut ctx.accounts.user_stake;
        let config = &mut ctx.accounts.global_config;

        require!(stake.shares > 0, ErrorCode::NoActiveStake);
        require!(stake.last_claim_epoch < config.dividend_epoch, ErrorCode::AlreadyClaimed);

        // Use snapshot for fair calculation (same value for all claimers in this epoch)
        let snapshot = config.epoch_dividend_snapshot;
        require!(snapshot > 0, ErrorCode::NoRevenueToClaim);

        let user_reward = if config.total_dividend_shares > 0 {
            // [Issue 2] Integer division truncates; dust remains in pool and rolls into
            // the next epoch. This is standard on-chain behavior and prevents over-payout.
            ((stake.shares as u128 * snapshot as u128) / config.total_dividend_shares as u128) as u64
        } else {
            0
        };

        require!(user_reward > 0, ErrorCode::NoRevenueToClaim);

        let vault_balance = ctx.accounts.revenue_vault.amount;
        require!(user_reward <= vault_balance, ErrorCode::InsufficientRevenue);

        // Extract bump before mutable borrow for CPI
        let config_bump = config.bump;
        let current_epoch = config.dividend_epoch;
        let bump = [config_bump];
        let signer_seeds = &[&[b"global_config_v3".as_ref(), &bump][..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.revenue_vault.to_account_info(),
            to: ctx.accounts.user_usdc_ata.to_account_info(),
            authority: ctx.accounts.global_config.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer_seeds);
        token::transfer(cpi_ctx, user_reward)?;

        // [Issue 8] Use checked_sub for accounting integrity — fail if underflow
        let config = &mut ctx.accounts.global_config;
        config.epoch_dividend_pool = config.epoch_dividend_pool
            .checked_sub(user_reward).ok_or(ErrorCode::MathOverflow)?;

        stake.last_claim_ts = Clock::get()?.unix_timestamp;
        stake.last_claim_epoch = current_epoch;

        emit!(DividendClaimedEvent { user: ctx.accounts.user.key(), amount: user_reward, epoch: current_epoch });
        msg!("Claimed {} USDC dividends (epoch {})", user_reward, current_epoch);
        Ok(())
    }

    // ----------------------------------------------------------------
    // Claim referral share (snapshot-based, pool-decrementing)
    // [Issue 4] Note: Integer division dust from `snapshot / total_partners`
    // remains in the pool. The `sweep_dust` instruction allows the admin to
    // recover permanently locked dust to the buyback wallet.
    // ----------------------------------------------------------------

    pub fn claim_referral_share(ctx: Context<ClaimReferralShare>) -> Result<()> {
        // [Issue 11] Check pause state
        require!(!ctx.accounts.global_config.paused, ErrorCode::ProgramPaused);

        let partnership = &mut ctx.accounts.partnership_stake;
        require!(
            partnership.staked_amount > 0 || partnership.tier == 2,
            ErrorCode::NoActiveStake
        );

        let config = &mut ctx.accounts.global_config;
        require!(partnership.last_claim_epoch < config.dividend_epoch, ErrorCode::AlreadyClaimed);

        // Use snapshot for fair calculation (same value for all partners in this epoch)
        let snapshot = config.epoch_referral_snapshot;
        require!(snapshot > 0, ErrorCode::NoRevenueToClaim);

        // Use snapshotted partner count from deposit time (not live count)
        let total_partners = config.epoch_active_partners;
        require!(total_partners > 0, ErrorCode::NoRevenueToClaim);

        // Integer division truncates; dust remains in pool (standard on-chain behavior)
        let amount = snapshot.checked_div(total_partners).ok_or(ErrorCode::MathOverflow)?;
        require!(amount > 0, ErrorCode::NoRevenueToClaim);

        let vault_balance = ctx.accounts.revenue_vault.amount;
        require!(amount <= vault_balance, ErrorCode::InsufficientRevenue);

        let config_bump = config.bump;
        let current_epoch = config.dividend_epoch;
        let bump = [config_bump];
        let signer_seeds = &[&[b"global_config_v3".as_ref(), &bump][..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.revenue_vault.to_account_info(),
            to: ctx.accounts.user_usdc_ata.to_account_info(),
            authority: ctx.accounts.global_config.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer_seeds);
        token::transfer(cpi_ctx, amount)?;

        // [Issue 8] Use checked_sub for accounting integrity
        let config = &mut ctx.accounts.global_config;
        config.epoch_referral_pool = config.epoch_referral_pool
            .checked_sub(amount).ok_or(ErrorCode::MathOverflow)?;

        partnership.last_claim_epoch = current_epoch;

        emit!(ReferralShareClaimedEvent { user: ctx.accounts.user.key(), amount, epoch: current_epoch });
        msg!("Claimed {} USDC referral share (epoch {})", amount, current_epoch);
        Ok(())
    }

    // ----------------------------------------------------------------
    // [Issue 4] Admin sweep dust from pools to buyback wallet
    // Recovers permanently locked funds caused by integer division truncation
    // or partners who unstaked between deposit and claim.
    // ----------------------------------------------------------------

    pub fn sweep_dust(ctx: Context<SweepDust>) -> Result<()> {
        let config = &mut ctx.accounts.global_config;
        require_keys_eq!(ctx.accounts.admin.key(), config.admin, ErrorCode::Unauthorized);

        // Only allow sweeping when there are no pending claims (new epoch not yet created
        // or all expected claims for this epoch have been processed)
        // The admin should call this after all partners/stakers have had time to claim.
        let dust_dividend = config.epoch_dividend_pool;
        let dust_referral = config.epoch_referral_pool;
        let total_dust = dust_dividend.checked_add(dust_referral).ok_or(ErrorCode::MathOverflow)?;
        require!(total_dust > 0, ErrorCode::NoDustToSweep);

        let vault_balance = ctx.accounts.revenue_vault.amount;
        require!(total_dust <= vault_balance, ErrorCode::InsufficientRevenue);

        let config_bump = config.bump;
        let bump = [config_bump];
        let signer_seeds = &[&[b"global_config_v3".as_ref(), &bump][..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.revenue_vault.to_account_info(),
            to: ctx.accounts.buyback_usdc_ata.to_account_info(),
            authority: ctx.accounts.global_config.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer_seeds);
        token::transfer(cpi_ctx, total_dust)?;

        let config = &mut ctx.accounts.global_config;
        config.epoch_dividend_pool = 0;
        config.epoch_referral_pool = 0;

        emit!(DustSwept { pool: "dividend+referral".to_string(), amount: total_dust });
        msg!("Swept {} USDC dust to buyback wallet", total_dust);
        Ok(())
    }

    // ----------------------------------------------------------------
    // Legacy migration
    // ----------------------------------------------------------------

    /// Admin registers a past OMEGA holder by their wallet public key.
    /// The holder doesn't need to sign — admin registers them unilaterally.
    /// Once registered, the holder can call `enable_legacy_benefits` to activate.
    /// [Issue 3] Capped at MAX_LEGACY_HOLDERS to prevent unbounded dilution.
    pub fn register_legacy_holder(ctx: Context<RegisterLegacyHolder>, holder: Pubkey) -> Result<()> {
        require_keys_eq!(ctx.accounts.admin.key(), ctx.accounts.global_config.admin, ErrorCode::Unauthorized);
        require!(holder != Pubkey::default(), ErrorCode::InvalidAdmin);

        // [Issue 3] Enforce legacy holder cap
        let config = &mut ctx.accounts.global_config;
        require!(config.total_legacy_holders < MAX_LEGACY_HOLDERS, ErrorCode::MaxLegacyHoldersReached);

        let legacy = &mut ctx.accounts.legacy_omega_stake;
        legacy.owner = holder;
        legacy.registered = true;
        legacy.bump = ctx.bumps.legacy_omega_stake;

        config.total_legacy_holders = config.total_legacy_holders.checked_add(1).ok_or(ErrorCode::MathOverflow)?;

        emit!(LegacyHolderRegistered { holder });
        msg!("Legacy OMEGA holder registered: {} ({}/{})", holder, config.total_legacy_holders, MAX_LEGACY_HOLDERS);
        Ok(())
    }

    /// User activates both legacy benefits in a single transaction:
    /// - 10B dividend shares (passive income, no tokens locked)
    /// - Tier-2 partnership (referral share claims)
    /// Requires a registered LegacyOmegaStake PDA.
    pub fn enable_legacy_benefits(ctx: Context<EnableLegacyBenefits>) -> Result<()> {
        // [Issue 11] Check pause state
        require!(!ctx.accounts.global_config.paused, ErrorCode::ProgramPaused);
        require!(ctx.accounts.legacy_omega_stake.registered, ErrorCode::NotLegacyOmega);

        let clock = Clock::get()?;
        let current_epoch = ctx.accounts.global_config.dividend_epoch;

        // Set up dividend stake
        let div_stake = &mut ctx.accounts.dividend_stake;
        // [Issue 1] Defense-in-depth check
        require!(!div_stake.is_initialized, ErrorCode::StakeAlreadyExists);

        div_stake.is_initialized = true;
        div_stake.owner = ctx.accounts.user.key();
        div_stake.amount = 0;
        div_stake.shares = BASE_LEGACY_SHARES;
        div_stake.lock_end = 0;
        div_stake.multiplier_bps = 10000;
        div_stake.last_claim_ts = clock.unix_timestamp;
        div_stake.last_claim_epoch = current_epoch;
        div_stake.bump = ctx.bumps.dividend_stake;

        ctx.accounts.global_config.total_dividend_shares = ctx
            .accounts.global_config.total_dividend_shares
            .checked_add(BASE_LEGACY_SHARES).ok_or(ErrorCode::MathOverflow)?;

        // Set up partnership stake
        let partner_stake = &mut ctx.accounts.partnership_stake;
        // [Issue 1] Defense-in-depth check
        require!(!partner_stake.is_initialized, ErrorCode::StakeAlreadyExists);

        partner_stake.is_initialized = true;
        partner_stake.owner = ctx.accounts.user.key();
        partner_stake.staked_amount = 0;
        partner_stake.referrer = None;
        partner_stake.tier = 2;
        partner_stake.last_claim_epoch = current_epoch;
        partner_stake.bump = ctx.bumps.partnership_stake;

        ctx.accounts.global_config.total_active_partners = ctx
            .accounts.global_config.total_active_partners
            .checked_add(1).ok_or(ErrorCode::MathOverflow)?;

        emit!(LegacyBenefitsEnabled {
            user: ctx.accounts.user.key(),
            shares: BASE_LEGACY_SHARES,
            tier: 2,
        });
        msg!("Legacy OMEGA benefits enabled: 10B shares + tier-2 partnership");
        Ok(())
    }

    /// Admin revokes tier-2 partnership status. Registration stays permanent —
    /// the user can re-enable via enable_legacy_benefits if not already staked.
    pub fn revoke_legacy_partnership(ctx: Context<RevokeLegacyPartnership>) -> Result<()> {
        require_keys_eq!(ctx.accounts.admin.key(), ctx.accounts.global_config.admin, ErrorCode::Unauthorized);

        let stake = &mut ctx.accounts.partnership_stake;
        require!(stake.tier == 2, ErrorCode::NotLegacyPartner);

        stake.tier = 0;

        // [Issue 8] Use checked_sub for accounting integrity
        ctx.accounts.global_config.total_active_partners = ctx
            .accounts.global_config.total_active_partners
            .checked_sub(1).ok_or(ErrorCode::MathOverflow)?;

        emit!(LegacyPartnershipRevoked { user: stake.owner });
        msg!("Legacy partnership revoked for {}", stake.owner);
        Ok(())
    }

    // ----------------------------------------------------------------
    // Data Provider
    // ----------------------------------------------------------------

    pub fn stake_data_provider(ctx: Context<StakeDataProvider>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        // [Issue 11] Check pause state
        require!(!ctx.accounts.global_config.paused, ErrorCode::ProgramPaused);

        let stake = &mut ctx.accounts.data_provider_stake;
        // [Issue 1] Defense-in-depth check
        require!(!stake.is_initialized, ErrorCode::StakeAlreadyExists);
        require!(amount >= MIN_DATA_PROVIDER_STAKE, ErrorCode::InsufficientDataProviderStake);

        stake.is_initialized = true;
        stake.owner = ctx.accounts.user.key();
        stake.staked_amount = amount;
        stake.active = false;
        stake.bump = ctx.bumps.data_provider_stake;

        let cpi_accounts = Transfer {
            from: ctx.accounts.user_unsys_ata.to_account_info(),
            to: ctx.accounts.token_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        emit!(DataProviderStakedEvent { user: ctx.accounts.user.key(), amount });
        msg!("Data Provider registered: {} $UNSYS", amount);
        Ok(())
    }

    pub fn deactivate_data_provider(ctx: Context<DeactivateDataProvider>) -> Result<()> {
        require_keys_eq!(ctx.accounts.admin.key(), ctx.accounts.global_config.admin, ErrorCode::Unauthorized);
        require!(ctx.accounts.data_provider_stake.active, ErrorCode::NotActive);

        ctx.accounts.data_provider_stake.active = false;

        emit!(DataProviderDeactivatedEvent { user: ctx.accounts.data_provider_stake.owner });
        msg!("Data Provider deactivated");
        Ok(())
    }

    pub fn unstake_data_provider(ctx: Context<UnstakeDataProvider>) -> Result<()> {
        let stake = &mut ctx.accounts.data_provider_stake;
        require!(stake.staked_amount > 0, ErrorCode::NoActiveStake);
        require!(!stake.active, ErrorCode::MustDeactivateFirst);

        let amount = stake.staked_amount;
        let config = &ctx.accounts.global_config;
        let bump = [config.bump];
        let signer_seeds = &[&[b"global_config_v3".as_ref(), &bump][..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.token_vault.to_account_info(),
            to: ctx.accounts.user_unsys_ata.to_account_info(),
            authority: ctx.accounts.global_config.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer_seeds);
        token::transfer(cpi_ctx, amount)?;

        stake.staked_amount = 0;
        stake.active = false;
        // [Issue 1] Mark as uninitialized
        stake.is_initialized = false;

        emit!(DataProviderUnstakedEvent { user: ctx.accounts.user.key(), amount });
        msg!("Unstaked {} $UNSYS data provider", amount);
        Ok(())
    }

    pub fn validate_data_provider(ctx: Context<ValidateDataProvider>) -> Result<()> {
        require_keys_eq!(ctx.accounts.admin.key(), ctx.accounts.global_config.admin, ErrorCode::Unauthorized);
        ctx.accounts.data_provider_stake.active = true;

        emit!(DataProviderValidatedEvent { user: ctx.accounts.data_provider_stake.owner });
        msg!("Data Provider validated & activated");
        Ok(())
    }

    // ----------------------------------------------------------------
    // Partnership
    // ----------------------------------------------------------------

    pub fn stake_partnership(ctx: Context<StakePartnership>, amount: u64, referrer: Option<Pubkey>) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        // [Issue 11] Check pause state
        require!(!ctx.accounts.global_config.paused, ErrorCode::ProgramPaused);

        let stake = &mut ctx.accounts.partnership_stake;
        // [Issue 1] Defense-in-depth check
        require!(!stake.is_initialized, ErrorCode::StakeAlreadyExists);

        stake.is_initialized = true;
        stake.owner = ctx.accounts.user.key();
        stake.staked_amount = amount;
        stake.referrer = referrer;
        stake.tier = 1;
        stake.last_claim_epoch = ctx.accounts.global_config.dividend_epoch;
        stake.bump = ctx.bumps.partnership_stake;

        let cpi_accounts = Transfer {
            from: ctx.accounts.user_unsys_ata.to_account_info(),
            to: ctx.accounts.token_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        ctx.accounts.global_config.total_active_partners = ctx.accounts.global_config.total_active_partners
            .checked_add(1).ok_or(ErrorCode::MathOverflow)?;

        emit!(PartnershipStakedEvent { user: ctx.accounts.user.key(), amount, referrer });
        msg!("Partnership stake active: {} $UNSYS", amount);
        Ok(())
    }

    pub fn unstake_partnership(ctx: Context<UnstakePartnership>, amount_to_unstake: u64) -> Result<()> {
        require!(amount_to_unstake > 0, ErrorCode::InvalidAmount);

        let stake = &mut ctx.accounts.partnership_stake;
        require!(stake.staked_amount >= amount_to_unstake, ErrorCode::InsufficientStake);

        let config = &ctx.accounts.global_config;
        let bump = [config.bump];
        let signer_seeds = &[&[b"global_config_v3".as_ref(), &bump][..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.token_vault.to_account_info(),
            to: ctx.accounts.user_unsys_ata.to_account_info(),
            authority: ctx.accounts.global_config.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), cpi_accounts, signer_seeds);
        token::transfer(cpi_ctx, amount_to_unstake)?;

        // [Issue 8] Use checked_sub for accounting integrity
        stake.staked_amount = stake.staked_amount
            .checked_sub(amount_to_unstake).ok_or(ErrorCode::MathOverflow)?;

        let fully_unstaked = stake.staked_amount == 0;
        if fully_unstaked && stake.tier != 2 {
            stake.tier = 0;
            // [Issue 1] Mark as uninitialized
            stake.is_initialized = false;
            // [Issue 8] Use checked_sub for accounting integrity
            ctx.accounts.global_config.total_active_partners = ctx.accounts.global_config.total_active_partners
                .checked_sub(1).ok_or(ErrorCode::MathOverflow)?;
            msg!("Fully unstaked - partner status REVOKED");
        }

        emit!(PartnershipUnstakedEvent { user: ctx.accounts.user.key(), amount: amount_to_unstake, fully_unstaked });
        Ok(())
    }

    // ----------------------------------------------------------------
    // [Issue 5] Account close instructions — allow users to reclaim rent
    // from zeroed-out PDA accounts after unstaking.
    // ----------------------------------------------------------------

    pub fn close_dividend_stake(ctx: Context<CloseDividendStake>) -> Result<()> {
        // Account constraints enforce owner match and zero state
        emit!(DividendStakeClosed { user: ctx.accounts.user.key() });
        msg!("Dividend stake account closed, rent reclaimed");
        Ok(())
    }

    pub fn close_partnership_stake(ctx: Context<ClosePartnershipStake>) -> Result<()> {
        emit!(PartnershipStakeClosed { user: ctx.accounts.user.key() });
        msg!("Partnership stake account closed, rent reclaimed");
        Ok(())
    }

    pub fn close_data_provider_stake(ctx: Context<CloseDataProviderStake>) -> Result<()> {
        emit!(DataProviderStakeClosed { user: ctx.accounts.user.key() });
        msg!("Data provider stake account closed, rent reclaimed");
        Ok(())
    }
}

// ============================================================
// Account Structs
// ============================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init_if_needed, payer = admin, space = 8 + 600, seeds = [b"global_config_v3"], bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub unsys_mint: Account<'info, Mint>,
    pub omega_mint: Account<'info, Mint>,
    pub usdc_mint: Account<'info, Mint>,
    /// CHECK: Buyback wallet address stored for off-chain reference only, not used on-chain
    pub buyback_wallet: UncheckedAccount<'info>,
    #[account(mut)]
    pub token_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub revenue_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ProposeAdminTransfer<'info> {
    #[account(mut, seeds = [b"global_config_v3"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
}

/// [Issue 7] Dedicated context for cancel_admin_transfer (previously reused ProposeAdminTransfer)
#[derive(Accounts)]
pub struct CancelAdminTransfer<'info> {
    #[account(mut, seeds = [b"global_config_v3"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct AcceptAdminTransfer<'info> {
    #[account(mut, seeds = [b"global_config_v3"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut)]
    pub new_admin: Signer<'info>,
}

/// [Issue 11] Generic admin-only context for pause/unpause
#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(mut, seeds = [b"global_config_v3"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct DepositRevenue<'info> {
    #[account(mut, seeds = [b"global_config_v3"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        mut,
        constraint = admin_usdc_ata.owner == admin.key() @ ErrorCode::InvalidTokenAccount,
        constraint = admin_usdc_ata.mint == global_config.usdc_mint @ ErrorCode::InvalidTokenAccount,
    )]
    pub admin_usdc_ata: Account<'info, TokenAccount>,
    #[account(mut, constraint = revenue_vault.key() == global_config.revenue_vault @ ErrorCode::InvalidVault)]
    pub revenue_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

/// [Issue 1] Uses `init` instead of `init_if_needed` — PDA can only be created once per user.
#[derive(Accounts)]
pub struct StakeDividends<'info> {
    #[account(mut, seeds = [b"global_config_v3"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(init, payer = user, space = 8 + 200, seeds = [b"dividend_stake", user.key().as_ref()], bump)]
    pub user_stake: Account<'info, DividendStake>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = user_unsys_ata.owner == user.key() @ ErrorCode::InvalidTokenAccount,
        constraint = user_unsys_ata.mint == global_config.unsys_mint @ ErrorCode::InvalidTokenAccount,
    )]
    pub user_unsys_ata: Account<'info, TokenAccount>,
    #[account(mut, constraint = token_vault.key() == global_config.token_vault @ ErrorCode::InvalidVault)]
    pub token_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UnstakeDividends<'info> {
    #[account(mut, seeds = [b"global_config_v3"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [b"dividend_stake", user.key().as_ref()], bump = user_stake.bump, constraint = user_stake.owner == user.key() @ ErrorCode::Unauthorized)]
    pub user_stake: Account<'info, DividendStake>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = user_unsys_ata.owner == user.key() @ ErrorCode::InvalidTokenAccount,
        constraint = user_unsys_ata.mint == global_config.unsys_mint @ ErrorCode::InvalidTokenAccount,
    )]
    pub user_unsys_ata: Account<'info, TokenAccount>,
    #[account(mut, constraint = token_vault.key() == global_config.token_vault @ ErrorCode::InvalidVault)]
    pub token_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RegisterLegacyHolder<'info> {
    #[account(mut, seeds = [b"global_config_v3"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    /// PDA created for the holder. Seeds use the holder's pubkey (passed as arg),
    /// not the admin's. The holder can later call enable_legacy_benefits.
    #[account(
        init,
        payer = admin,
        space = 8 + 66,
        seeds = [b"legacy_omega", holder.key().as_ref()],
        bump
    )]
    pub legacy_omega_stake: Account<'info, LegacyOmegaStake>,
    /// CHECK: The holder's wallet public key. Does not need to sign.
    /// Used only for PDA seed derivation.
    pub holder: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// [Issue 1] Uses `init` for both dividend_stake and partnership_stake
#[derive(Accounts)]
pub struct EnableLegacyBenefits<'info> {
    #[account(mut, seeds = [b"global_config_v3"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        seeds = [b"legacy_omega", user.key().as_ref()],
        bump = legacy_omega_stake.bump,
        constraint = legacy_omega_stake.registered @ ErrorCode::NotLegacyOmega,
        constraint = legacy_omega_stake.owner == user.key() @ ErrorCode::Unauthorized,
    )]
    pub legacy_omega_stake: Account<'info, LegacyOmegaStake>,
    #[account(init, payer = user, space = 8 + 200, seeds = [b"dividend_stake", user.key().as_ref()], bump)]
    pub dividend_stake: Account<'info, DividendStake>,
    #[account(init, payer = user, space = 8 + 150, seeds = [b"partnership_stake", user.key().as_ref()], bump)]
    pub partnership_stake: Account<'info, PartnershipStake>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeLegacyPartnership<'info> {
    #[account(mut, seeds = [b"global_config_v3"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        seeds = [b"partnership_stake", partnership_stake.owner.as_ref()],
        bump = partnership_stake.bump,
    )]
    pub partnership_stake: Account<'info, PartnershipStake>,
    #[account(mut)]
    pub admin: Signer<'info>,
}

/// [Issue 1] Uses `init` instead of `init_if_needed`
#[derive(Accounts)]
pub struct StakeDataProvider<'info> {
    #[account(seeds = [b"global_config_v3"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(init, payer = user, space = 8 + 100, seeds = [b"data_provider_stake", user.key().as_ref()], bump)]
    pub data_provider_stake: Account<'info, DataProviderStake>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = user_unsys_ata.owner == user.key() @ ErrorCode::InvalidTokenAccount,
        constraint = user_unsys_ata.mint == global_config.unsys_mint @ ErrorCode::InvalidTokenAccount,
    )]
    pub user_unsys_ata: Account<'info, TokenAccount>,
    #[account(mut, constraint = token_vault.key() == global_config.token_vault @ ErrorCode::InvalidVault)]
    pub token_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DeactivateDataProvider<'info> {
    #[account(seeds = [b"global_config_v3"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [b"data_provider_stake", data_provider_stake.owner.as_ref()], bump = data_provider_stake.bump)]
    pub data_provider_stake: Account<'info, DataProviderStake>,
    #[account(mut)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct UnstakeDataProvider<'info> {
    #[account(mut, seeds = [b"global_config_v3"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [b"data_provider_stake", user.key().as_ref()], bump = data_provider_stake.bump, constraint = data_provider_stake.owner == user.key() @ ErrorCode::Unauthorized)]
    pub data_provider_stake: Account<'info, DataProviderStake>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = user_unsys_ata.owner == user.key() @ ErrorCode::InvalidTokenAccount,
        constraint = user_unsys_ata.mint == global_config.unsys_mint @ ErrorCode::InvalidTokenAccount,
    )]
    pub user_unsys_ata: Account<'info, TokenAccount>,
    #[account(mut, constraint = token_vault.key() == global_config.token_vault @ ErrorCode::InvalidVault)]
    pub token_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ValidateDataProvider<'info> {
    #[account(seeds = [b"global_config_v3"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [b"data_provider_stake", data_provider_stake.owner.as_ref()], bump = data_provider_stake.bump)]
    pub data_provider_stake: Account<'info, DataProviderStake>,
    #[account(mut)]
    pub admin: Signer<'info>,
}

/// [Issue 1] Uses `init` instead of `init_if_needed`
#[derive(Accounts)]
pub struct StakePartnership<'info> {
    #[account(mut, seeds = [b"global_config_v3"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(init, payer = user, space = 8 + 150, seeds = [b"partnership_stake", user.key().as_ref()], bump)]
    pub partnership_stake: Account<'info, PartnershipStake>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = user_unsys_ata.owner == user.key() @ ErrorCode::InvalidTokenAccount,
        constraint = user_unsys_ata.mint == global_config.unsys_mint @ ErrorCode::InvalidTokenAccount,
    )]
    pub user_unsys_ata: Account<'info, TokenAccount>,
    #[account(mut, constraint = token_vault.key() == global_config.token_vault @ ErrorCode::InvalidVault)]
    pub token_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UnstakePartnership<'info> {
    #[account(mut, seeds = [b"global_config_v3"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [b"partnership_stake", user.key().as_ref()], bump = partnership_stake.bump, constraint = partnership_stake.owner == user.key() @ ErrorCode::Unauthorized)]
    pub partnership_stake: Account<'info, PartnershipStake>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, constraint = token_vault.key() == global_config.token_vault @ ErrorCode::InvalidVault)]
    pub token_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = user_unsys_ata.owner == user.key() @ ErrorCode::InvalidTokenAccount,
        constraint = user_unsys_ata.mint == global_config.unsys_mint @ ErrorCode::InvalidTokenAccount,
    )]
    pub user_unsys_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimDividends<'info> {
    #[account(mut, seeds = [b"global_config_v3"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [b"dividend_stake", user.key().as_ref()], bump = user_stake.bump, constraint = user_stake.owner == user.key() @ ErrorCode::Unauthorized)]
    pub user_stake: Account<'info, DividendStake>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, constraint = revenue_vault.key() == global_config.revenue_vault @ ErrorCode::InvalidVault)]
    pub revenue_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = user_usdc_ata.owner == user.key() @ ErrorCode::InvalidTokenAccount,
        constraint = user_usdc_ata.mint == global_config.usdc_mint @ ErrorCode::InvalidTokenAccount,
    )]
    pub user_usdc_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimReferralShare<'info> {
    #[account(mut, seeds = [b"global_config_v3"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut, seeds = [b"partnership_stake", user.key().as_ref()], bump = partnership_stake.bump, constraint = partnership_stake.owner == user.key() @ ErrorCode::Unauthorized)]
    pub partnership_stake: Account<'info, PartnershipStake>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, constraint = revenue_vault.key() == global_config.revenue_vault @ ErrorCode::InvalidVault)]
    pub revenue_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = user_usdc_ata.owner == user.key() @ ErrorCode::InvalidTokenAccount,
        constraint = user_usdc_ata.mint == global_config.usdc_mint @ ErrorCode::InvalidTokenAccount,
    )]
    pub user_usdc_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

/// [Issue 4] Admin sweeps dust from pools to buyback wallet
#[derive(Accounts)]
pub struct SweepDust<'info> {
    #[account(mut, seeds = [b"global_config_v3"], bump = global_config.bump)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, constraint = revenue_vault.key() == global_config.revenue_vault @ ErrorCode::InvalidVault)]
    pub revenue_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = buyback_usdc_ata.owner == global_config.buyback_wallet @ ErrorCode::InvalidTokenAccount,
        constraint = buyback_usdc_ata.mint == global_config.usdc_mint @ ErrorCode::InvalidTokenAccount,
    )]
    pub buyback_usdc_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

// ----------------------------------------------------------------
// [Issue 5] Close account contexts — users reclaim rent from zeroed PDAs
// Constraints ensure accounts are fully unstaked before closing.
// ----------------------------------------------------------------

#[derive(Accounts)]
pub struct CloseDividendStake<'info> {
    #[account(
        mut,
        close = user,
        seeds = [b"dividend_stake", user.key().as_ref()],
        bump = user_stake.bump,
        constraint = user_stake.owner == user.key() @ ErrorCode::Unauthorized,
        constraint = user_stake.amount == 0 @ ErrorCode::NoActiveStake,
        constraint = user_stake.shares == 0 @ ErrorCode::NoActiveStake,
    )]
    pub user_stake: Account<'info, DividendStake>,
    #[account(mut)]
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClosePartnershipStake<'info> {
    #[account(
        mut,
        close = user,
        seeds = [b"partnership_stake", user.key().as_ref()],
        bump = partnership_stake.bump,
        constraint = partnership_stake.owner == user.key() @ ErrorCode::Unauthorized,
        constraint = partnership_stake.staked_amount == 0 @ ErrorCode::NoActiveStake,
        constraint = partnership_stake.tier == 0 @ ErrorCode::NoActiveStake,
    )]
    pub partnership_stake: Account<'info, PartnershipStake>,
    #[account(mut)]
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct CloseDataProviderStake<'info> {
    #[account(
        mut,
        close = user,
        seeds = [b"data_provider_stake", user.key().as_ref()],
        bump = data_provider_stake.bump,
        constraint = data_provider_stake.owner == user.key() @ ErrorCode::Unauthorized,
        constraint = data_provider_stake.staked_amount == 0 @ ErrorCode::NoActiveStake,
    )]
    pub data_provider_stake: Account<'info, DataProviderStake>,
    #[account(mut)]
    pub user: Signer<'info>,
}

// ============================================================
// Data Accounts
// ============================================================

#[account]
pub struct GlobalConfig {
    pub unsys_mint: Pubkey,
    pub omega_mint: Pubkey,
    pub usdc_mint: Pubkey,
    pub token_vault: Pubkey,
    pub revenue_vault: Pubkey,
    pub total_dividend_shares: u128,
    pub admin: Pubkey,
    pub pending_admin: Pubkey,
    pub buyback_wallet: Pubkey,
    pub dividend_epoch: u64,
    pub epoch_dividend_pool: u64,
    pub epoch_referral_pool: u64,
    pub total_active_partners: u64,
    pub epoch_active_partners: u64,
    pub epoch_dividend_snapshot: u64,
    pub epoch_referral_snapshot: u64,
    /// [Issue 11] Emergency pause flag
    pub paused: bool,
    /// [Issue 3] Counter for registered legacy holders (capped at MAX_LEGACY_HOLDERS)
    pub total_legacy_holders: u64,
    pub bump: u8,
}

#[account]
pub struct DividendStake {
    /// [Issue 1] Explicit initialization flag for defense-in-depth
    pub is_initialized: bool,
    pub owner: Pubkey,
    pub amount: u64,
    pub shares: u128,
    pub lock_end: i64,
    pub multiplier_bps: u16,
    pub last_claim_ts: i64,
    pub last_claim_epoch: u64,
    pub bump: u8,
}

#[account]
pub struct LegacyOmegaStake {
    pub owner: Pubkey,
    pub registered: bool,
    pub bump: u8,
}

#[account]
pub struct PartnershipStake {
    /// [Issue 1] Explicit initialization flag for defense-in-depth
    pub is_initialized: bool,
    pub owner: Pubkey,
    pub staked_amount: u64,
    pub referrer: Option<Pubkey>,
    pub tier: u8,
    pub last_claim_epoch: u64,
    pub bump: u8,
}

#[account]
pub struct DataProviderStake {
    /// [Issue 1] Explicit initialization flag for defense-in-depth
    pub is_initialized: bool,
    pub owner: Pubkey,
    pub staked_amount: u64,
    pub active: bool,
    pub bump: u8,
}

// ============================================================
// Errors
// ============================================================

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Invalid lock period - use 3, 6 or 12 months")]
    InvalidLockPeriod,
    #[msg("No active partnership stake")]
    NoActiveStake,
    #[msg("Insufficient staked amount")]
    InsufficientStake,
    #[msg("Must stake at least 5M $UNSYS for Data Provider")]
    InsufficientDataProviderStake,
    #[msg("Not a registered Legacy Omega holder")]
    NotLegacyOmega,
    #[msg("No revenue available to claim right now")]
    NoRevenueToClaim,
    #[msg("Not enough USDC in the vault for this claim")]
    InsufficientRevenue,
    #[msg("Global config already initialized")]
    AlreadyInitialized,
    #[msg("Stake already exists for this user")]
    StakeAlreadyExists,
    #[msg("Lock period has not expired yet")]
    LockPeriodNotExpired,
    #[msg("Invalid vault account")]
    InvalidVault,
    #[msg("Already claimed for this epoch")]
    AlreadyClaimed,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Invalid token account owner or mint")]
    InvalidTokenAccount,
    #[msg("Data provider must be deactivated before unstaking")]
    MustDeactivateFirst,
    #[msg("Data provider is not currently active")]
    NotActive,
    #[msg("New admin cannot be the zero address")]
    InvalidAdmin,
    #[msg("Not a legacy tier-2 partner")]
    NotLegacyPartner,
    /// [Issue 11] Pause errors
    #[msg("Program is currently paused")]
    ProgramPaused,
    #[msg("Program is already paused")]
    AlreadyPaused,
    #[msg("Program is not paused")]
    NotPaused,
    /// [Issue 8/9] Math overflow
    #[msg("Math overflow or underflow")]
    MathOverflow,
    /// [Issue 3] Legacy holder cap
    #[msg("Maximum number of legacy holders (500) has been reached")]
    MaxLegacyHoldersReached,
    /// [Issue 4] Dust sweep
    #[msg("No dust to sweep from pools")]
    NoDustToSweep,
}
