use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

declare_id!("8fQT7WjAw2BLYJcbTPYxLciPmUgh5GS4Jj2Vo1uhoK2q");

// ============================================================
// Events (for off-chain indexing)
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
}

#[event]
pub struct DividendStaked {
    pub user: Pubkey,
    pub amount: u64,
    pub lock_months: u8,
    pub shares: u128,
    pub multiplier_bps: u16,
}

#[event]
pub struct DividendUnstaked {
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct DividendClaimed {
    pub user: Pubkey,
    pub amount: u64,
    pub epoch: u64,
}

#[event]
pub struct PartnershipStaked {
    pub user: Pubkey,
    pub amount: u64,
    pub referrer: Option<Pubkey>,
}

#[event]
pub struct PartnershipUnstaked {
    pub user: Pubkey,
    pub amount: u64,
    pub fully_unstaked: bool,
}

#[event]
pub struct ReferralShareClaimed {
    pub user: Pubkey,
    pub amount: u64,
    pub epoch: u64,
}

#[event]
pub struct DataProviderStaked {
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct DataProviderUnstaked {
    pub user: Pubkey,
    pub amount: u64,
}

#[event]
pub struct DataProviderValidated {
    pub user: Pubkey,
}

#[event]
pub struct DataProviderDeactivated {
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

#[program]
pub mod unsys_staking {
    use super::*;

    const MIN_DATA_PROVIDER_STAKE: u64 = 5_000_000;
    const BASE_LEGACY_SHARES: u128 = 1_000_000 * 10_000;
    /// Referral pool is 33% of each deposit (3333 bps)
    const REFERRAL_POOL_BPS: u64 = 3333;
    const BPS_DENOMINATOR: u64 = 10000;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.global_config;
        require!(
            config.admin == Pubkey::default(),
            ErrorCode::AlreadyInitialized
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
        require_keys_eq!(
            ctx.accounts.admin.key(),
            config.admin,
            ErrorCode::Unauthorized
        );
        require!(
            new_admin != Pubkey::default(),
            ErrorCode::InvalidAmount // reuse: new admin can't be default
        );

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
        require_keys_eq!(
            ctx.accounts.new_admin.key(),
            config.pending_admin,
            ErrorCode::Unauthorized
        );

        let old_admin = config.admin;
        config.admin = config.pending_admin;
        config.pending_admin = Pubkey::default();

        emit!(AdminTransferAccepted {
            old_admin,
            new_admin: config.admin,
        });

        msg!("Admin transferred from {} to {}", old_admin, config.admin);
        Ok(())
    }

    // ----------------------------------------------------------------
    // Revenue deposit with snapshot
    // ----------------------------------------------------------------

    pub fn deposit_revenue(ctx: Context<DepositRevenue>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.global_config.admin,
            ErrorCode::Unauthorized
        );

        let cpi_accounts = Transfer {
            from: ctx.accounts.admin_usdc_ata.to_account_info(),
            to: ctx.accounts.revenue_vault.to_account_info(),
            authority: ctx.accounts.admin.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        let config = &mut ctx.accounts.global_config;

        // Snapshot: split deposit into dividend pool and referral pool
        let referral_amount = amount
            .checked_mul(REFERRAL_POOL_BPS)
            .unwrap()
            .checked_div(BPS_DENOMINATOR)
            .unwrap();
        let dividend_amount = amount.checked_sub(referral_amount).unwrap();

        config.epoch_dividend_pool = dividend_amount;
        config.epoch_referral_pool = referral_amount;
        config.dividend_epoch += 1;

        emit!(RevenueDeposited {
            amount,
            epoch: config.dividend_epoch,
            epoch_dividend_pool: dividend_amount,
            epoch_referral_pool: referral_amount,
        });

        msg!(
            "Deposited {} USDC (epoch {}, div_pool={}, ref_pool={})",
            amount, config.dividend_epoch, dividend_amount, referral_amount
        );
        Ok(())
    }

    // ----------------------------------------------------------------
    // Dividend staking
    // ----------------------------------------------------------------

    pub fn stake_dividends(
        ctx: Context<StakeDividends>,
        amount: u64,
        lock_months: u8,
    ) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);

        let stake = &mut ctx.accounts.user_stake;
        let clock = Clock::get()?;

        require!(stake.amount == 0, ErrorCode::StakeAlreadyExists);

        let multiplier_bps = match lock_months {
            3 => 11000u16,
            6 => 12500u16,
            12 => 15000u16,
            _ => return err!(ErrorCode::InvalidLockPeriod),
        };
        let shares = (amount as u128) * (multiplier_bps as u128) / 10000;

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

        ctx.accounts.global_config.total_dividend_shares += shares;

        emit!(DividendStaked {
            user: ctx.accounts.user.key(),
            amount,
            lock_months,
            shares,
            multiplier_bps,
        });

        msg!("Staked {} $UNSYS for {} months", amount, lock_months);
        Ok(())
    }

    pub fn unstake_dividends(ctx: Context<UnstakeDividends>) -> Result<()> {
        let stake = &mut ctx.accounts.user_stake;
        let clock = Clock::get()?;

        require!(stake.amount > 0, ErrorCode::NoActiveStake);
        require!(
            clock.unix_timestamp >= stake.lock_end,
            ErrorCode::LockPeriodNotExpired
        );

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
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, amount)?;

        stake.amount = 0;
        stake.shares = 0;
        stake.lock_end = 0;
        stake.multiplier_bps = 0;

        ctx.accounts.global_config.total_dividend_shares = ctx
            .accounts
            .global_config
            .total_dividend_shares
            .saturating_sub(shares);

        emit!(DividendUnstaked {
            user: ctx.accounts.user.key(),
            amount,
        });

        msg!("Unstaked {} $UNSYS dividends", amount);
        Ok(())
    }

    // ----------------------------------------------------------------
    // Claim dividends (snapshot-based)
    // ----------------------------------------------------------------

    pub fn claim_dividends(ctx: Context<ClaimDividends>) -> Result<()> {
        let stake = &mut ctx.accounts.user_stake;
        let config = &ctx.accounts.global_config;

        require!(
            stake.last_claim_epoch < config.dividend_epoch,
            ErrorCode::AlreadyClaimed
        );

        let pool = config.epoch_dividend_pool;
        require!(pool > 0, ErrorCode::NoRevenueToClaim);

        let user_reward = if config.total_dividend_shares > 0 {
            ((stake.shares as u128 * pool as u128) / config.total_dividend_shares as u128) as u64
        } else {
            0
        };

        require!(user_reward > 0, ErrorCode::NoRevenueToClaim);

        // Safety: check actual vault balance
        let vault_balance = ctx.accounts.revenue_vault.amount;
        require!(user_reward <= vault_balance, ErrorCode::InsufficientRevenue);

        let bump = [config.bump];
        let signer_seeds = &[&[b"global_config_v3".as_ref(), &bump][..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.revenue_vault.to_account_info(),
            to: ctx.accounts.user_usdc_ata.to_account_info(),
            authority: ctx.accounts.global_config.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, user_reward)?;

        stake.last_claim_ts = Clock::get()?.unix_timestamp;
        stake.last_claim_epoch = config.dividend_epoch;

        emit!(DividendClaimed {
            user: ctx.accounts.user.key(),
            amount: user_reward,
            epoch: config.dividend_epoch,
        });

        msg!("Claimed {} USDC dividends (epoch {})", user_reward, config.dividend_epoch);
        Ok(())
    }

    // ----------------------------------------------------------------
    // Claim referral share (snapshot-based, per-partner share)
    // ----------------------------------------------------------------

    pub fn claim_referral_share(ctx: Context<ClaimReferralShare>) -> Result<()> {
        let partnership = &mut ctx.accounts.partnership_stake;
        require!(
            partnership.staked_amount > 0 || partnership.tier == 2,
            ErrorCode::NoActiveStake
        );

        let config = &ctx.accounts.global_config;
        require!(
            partnership.last_claim_epoch < config.dividend_epoch,
            ErrorCode::AlreadyClaimed
        );

        let pool = config.epoch_referral_pool;
        require!(pool > 0, ErrorCode::NoRevenueToClaim);

        // Divide referral pool equally among active partners
        let total_partners = config.total_active_partners;
        require!(total_partners > 0, ErrorCode::NoRevenueToClaim);

        let amount = pool.checked_div(total_partners).unwrap();
        require!(amount > 0, ErrorCode::NoRevenueToClaim);

        let vault_balance = ctx.accounts.revenue_vault.amount;
        require!(amount <= vault_balance, ErrorCode::InsufficientRevenue);

        let bump = [config.bump];
        let signer_seeds = &[&[b"global_config_v3".as_ref(), &bump][..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.revenue_vault.to_account_info(),
            to: ctx.accounts.user_usdc_ata.to_account_info(),
            authority: ctx.accounts.global_config.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, amount)?;

        partnership.last_claim_epoch = config.dividend_epoch;

        emit!(ReferralShareClaimed {
            user: ctx.accounts.user.key(),
            amount,
            epoch: config.dividend_epoch,
        });

        msg!("Claimed {} USDC referral share (epoch {})", amount, config.dividend_epoch);
        Ok(())
    }

    // ----------------------------------------------------------------
    // Legacy migration
    // ----------------------------------------------------------------

    pub fn enable_legacy_dividends(ctx: Context<EnableLegacyDividends>) -> Result<()> {
        require!(
            ctx.accounts.legacy_omega_stake.registered,
            ErrorCode::NotLegacyOmega
        );
        let stake = &mut ctx.accounts.dividend_stake;

        require!(
            stake.amount == 0 && stake.shares == 0,
            ErrorCode::StakeAlreadyExists
        );

        let clock = Clock::get()?;

        stake.owner = ctx.accounts.user.key();
        stake.amount = 0;
        stake.shares = BASE_LEGACY_SHARES;
        stake.lock_end = 0;
        stake.multiplier_bps = 10000;
        stake.last_claim_ts = clock.unix_timestamp;
        stake.last_claim_epoch = ctx.accounts.global_config.dividend_epoch;
        stake.bump = ctx.bumps.dividend_stake;

        ctx.accounts.global_config.total_dividend_shares += BASE_LEGACY_SHARES;
        msg!("Legacy Omega now earns passive dividends");
        Ok(())
    }

    pub fn enable_legacy_partnership(ctx: Context<EnableLegacyPartnership>) -> Result<()> {
        require!(
            ctx.accounts.legacy_omega_stake.registered,
            ErrorCode::NotLegacyOmega
        );
        let stake = &mut ctx.accounts.partnership_stake;

        // Prevent overwriting existing partnership
        require!(
            stake.staked_amount == 0 && stake.tier == 0,
            ErrorCode::StakeAlreadyExists
        );

        stake.owner = ctx.accounts.user.key();
        stake.staked_amount = 0;
        stake.referrer = None;
        stake.tier = 2;
        stake.last_claim_epoch = ctx.accounts.global_config.dividend_epoch;
        stake.bump = ctx.bumps.partnership_stake;

        // Legacy partners count as active partners for referral pool split
        ctx.accounts.global_config.total_active_partners += 1;

        msg!("Legacy Omega now has 30% referral tier");
        Ok(())
    }

    // ----------------------------------------------------------------
    // Data Provider
    // ----------------------------------------------------------------

    pub fn stake_data_provider(ctx: Context<StakeDataProvider>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);

        let stake = &mut ctx.accounts.data_provider_stake;
        require!(stake.staked_amount == 0, ErrorCode::StakeAlreadyExists);
        require!(
            amount >= MIN_DATA_PROVIDER_STAKE,
            ErrorCode::InsufficientDataProviderStake
        );

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

        emit!(DataProviderStaked {
            user: ctx.accounts.user.key(),
            amount,
        });

        msg!("Data Provider registered: {} $UNSYS", amount);
        Ok(())
    }

    pub fn deactivate_data_provider(ctx: Context<DeactivateDataProvider>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.global_config.admin,
            ErrorCode::Unauthorized
        );
        require!(
            ctx.accounts.data_provider_stake.active,
            ErrorCode::NotActive
        );

        ctx.accounts.data_provider_stake.active = false;

        emit!(DataProviderDeactivated {
            user: ctx.accounts.data_provider_stake.owner,
        });

        msg!("Data Provider deactivated");
        Ok(())
    }

    pub fn unstake_data_provider(ctx: Context<UnstakeDataProvider>) -> Result<()> {
        let stake = &mut ctx.accounts.data_provider_stake;
        require!(stake.staked_amount > 0, ErrorCode::NoActiveStake);
        // Must be deactivated before unstaking
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
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, amount)?;

        stake.staked_amount = 0;
        stake.active = false;

        emit!(DataProviderUnstaked {
            user: ctx.accounts.user.key(),
            amount,
        });

        msg!("Unstaked {} $UNSYS data provider", amount);
        Ok(())
    }

    pub fn validate_data_provider(ctx: Context<ValidateDataProvider>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.global_config.admin,
            ErrorCode::Unauthorized
        );
        ctx.accounts.data_provider_stake.active = true;

        emit!(DataProviderValidated {
            user: ctx.accounts.data_provider_stake.owner,
        });

        msg!("Data Provider validated & activated");
        Ok(())
    }

    // ----------------------------------------------------------------
    // Partnership
    // ----------------------------------------------------------------

    pub fn stake_partnership(
        ctx: Context<StakePartnership>,
        amount: u64,
        referrer: Option<Pubkey>,
    ) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);

        let stake = &mut ctx.accounts.partnership_stake;
        require!(stake.staked_amount == 0, ErrorCode::StakeAlreadyExists);

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

        // Track active partners for referral pool split
        ctx.accounts.global_config.total_active_partners += 1;

        emit!(PartnershipStaked {
            user: ctx.accounts.user.key(),
            amount,
            referrer,
        });

        msg!("Partnership stake active: {} $UNSYS", amount);
        Ok(())
    }

    pub fn unstake_partnership(
        ctx: Context<UnstakePartnership>,
        amount_to_unstake: u64,
    ) -> Result<()> {
        require!(amount_to_unstake > 0, ErrorCode::InvalidAmount);

        let stake = &mut ctx.accounts.partnership_stake;
        require!(
            stake.staked_amount >= amount_to_unstake,
            ErrorCode::InsufficientStake
        );

        let config = &ctx.accounts.global_config;
        let bump = [config.bump];
        let signer_seeds = &[&[b"global_config_v3".as_ref(), &bump][..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.token_vault.to_account_info(),
            to: ctx.accounts.user_unsys_ata.to_account_info(),
            authority: ctx.accounts.global_config.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, amount_to_unstake)?;

        stake.staked_amount -= amount_to_unstake;

        let fully_unstaked = stake.staked_amount == 0;
        if fully_unstaked && stake.tier != 2 {
            // tier-2 (legacy) partners keep their status even at 0 staked
            stake.tier = 0;
            ctx.accounts.global_config.total_active_partners = ctx
                .accounts
                .global_config
                .total_active_partners
                .saturating_sub(1);
            msg!("Fully unstaked - partner status REVOKED");
        }

        emit!(PartnershipUnstaked {
            user: ctx.accounts.user.key(),
            amount: amount_to_unstake,
            fully_unstaked,
        });

        Ok(())
    }
}

// ============================================================
// Account Structs
// ============================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + 500,
        seeds = [b"global_config_v3"],
        bump
    )]
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
    #[account(
        mut,
        seeds = [b"global_config_v3"],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct AcceptAdminTransfer<'info> {
    #[account(
        mut,
        seeds = [b"global_config_v3"],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut)]
    pub new_admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct DepositRevenue<'info> {
    #[account(
        mut,
        seeds = [b"global_config_v3"],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut)]
    pub admin_usdc_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = revenue_vault.key() == global_config.revenue_vault @ ErrorCode::InvalidVault
    )]
    pub revenue_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct StakeDividends<'info> {
    #[account(
        mut,
        seeds = [b"global_config_v3"],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(init_if_needed, payer = user, space = 8 + 200, seeds = [b"dividend_stake", user.key().as_ref()], bump)]
    pub user_stake: Account<'info, DividendStake>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = user_unsys_ata.owner == user.key() @ ErrorCode::InvalidTokenAccount
    )]
    pub user_unsys_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = token_vault.key() == global_config.token_vault @ ErrorCode::InvalidVault
    )]
    pub token_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UnstakeDividends<'info> {
    #[account(
        mut,
        seeds = [b"global_config_v3"],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        seeds = [b"dividend_stake", user.key().as_ref()],
        bump = user_stake.bump,
        constraint = user_stake.owner == user.key() @ ErrorCode::Unauthorized,
    )]
    pub user_stake: Account<'info, DividendStake>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = user_unsys_ata.owner == user.key() @ ErrorCode::InvalidTokenAccount
    )]
    pub user_unsys_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = token_vault.key() == global_config.token_vault @ ErrorCode::InvalidVault
    )]
    pub token_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct EnableLegacyDividends<'info> {
    #[account(
        mut,
        seeds = [b"global_config_v3"],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(init_if_needed, payer = user, space = 8 + 200, seeds = [b"dividend_stake", user.key().as_ref()], bump)]
    pub dividend_stake: Account<'info, DividendStake>,
    pub legacy_omega_stake: Account<'info, LegacyOmegaStake>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EnableLegacyPartnership<'info> {
    #[account(
        mut,
        seeds = [b"global_config_v3"],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(init_if_needed, payer = user, space = 8 + 150, seeds = [b"partnership_stake", user.key().as_ref()], bump)]
    pub partnership_stake: Account<'info, PartnershipStake>,
    pub legacy_omega_stake: Account<'info, LegacyOmegaStake>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StakeDataProvider<'info> {
    #[account(
        seeds = [b"global_config_v3"],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(init_if_needed, payer = user, space = 8 + 100, seeds = [b"data_provider_stake", user.key().as_ref()], bump)]
    pub data_provider_stake: Account<'info, DataProviderStake>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = user_unsys_ata.owner == user.key() @ ErrorCode::InvalidTokenAccount
    )]
    pub user_unsys_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = token_vault.key() == global_config.token_vault @ ErrorCode::InvalidVault
    )]
    pub token_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DeactivateDataProvider<'info> {
    #[account(
        seeds = [b"global_config_v3"],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        seeds = [b"data_provider_stake", data_provider_stake.owner.as_ref()],
        bump = data_provider_stake.bump,
    )]
    pub data_provider_stake: Account<'info, DataProviderStake>,
    #[account(mut)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct UnstakeDataProvider<'info> {
    #[account(
        mut,
        seeds = [b"global_config_v3"],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        seeds = [b"data_provider_stake", user.key().as_ref()],
        bump = data_provider_stake.bump,
        constraint = data_provider_stake.owner == user.key() @ ErrorCode::Unauthorized,
    )]
    pub data_provider_stake: Account<'info, DataProviderStake>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = user_unsys_ata.owner == user.key() @ ErrorCode::InvalidTokenAccount
    )]
    pub user_unsys_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = token_vault.key() == global_config.token_vault @ ErrorCode::InvalidVault
    )]
    pub token_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ValidateDataProvider<'info> {
    #[account(
        seeds = [b"global_config_v3"],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        seeds = [b"data_provider_stake", data_provider_stake.owner.as_ref()],
        bump = data_provider_stake.bump,
    )]
    pub data_provider_stake: Account<'info, DataProviderStake>,
    #[account(mut)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct StakePartnership<'info> {
    #[account(
        mut,
        seeds = [b"global_config_v3"],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(init_if_needed, payer = user, space = 8 + 150, seeds = [b"partnership_stake", user.key().as_ref()], bump)]
    pub partnership_stake: Account<'info, PartnershipStake>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = user_unsys_ata.owner == user.key() @ ErrorCode::InvalidTokenAccount
    )]
    pub user_unsys_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = token_vault.key() == global_config.token_vault @ ErrorCode::InvalidVault
    )]
    pub token_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UnstakePartnership<'info> {
    #[account(
        mut,
        seeds = [b"global_config_v3"],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        seeds = [b"partnership_stake", user.key().as_ref()],
        bump = partnership_stake.bump,
        constraint = partnership_stake.owner == user.key() @ ErrorCode::Unauthorized
    )]
    pub partnership_stake: Account<'info, PartnershipStake>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = token_vault.key() == global_config.token_vault @ ErrorCode::InvalidVault
    )]
    pub token_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = user_unsys_ata.owner == user.key() @ ErrorCode::InvalidTokenAccount
    )]
    pub user_unsys_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimDividends<'info> {
    #[account(
        seeds = [b"global_config_v3"],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        seeds = [b"dividend_stake", user.key().as_ref()],
        bump = user_stake.bump,
        constraint = user_stake.owner == user.key() @ ErrorCode::Unauthorized
    )]
    pub user_stake: Account<'info, DividendStake>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = revenue_vault.key() == global_config.revenue_vault @ ErrorCode::InvalidVault
    )]
    pub revenue_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = user_usdc_ata.owner == user.key() @ ErrorCode::InvalidTokenAccount
    )]
    pub user_usdc_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimReferralShare<'info> {
    #[account(
        seeds = [b"global_config_v3"],
        bump = global_config.bump,
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        seeds = [b"partnership_stake", user.key().as_ref()],
        bump = partnership_stake.bump,
        constraint = partnership_stake.owner == user.key() @ ErrorCode::Unauthorized
    )]
    pub partnership_stake: Account<'info, PartnershipStake>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = revenue_vault.key() == global_config.revenue_vault @ ErrorCode::InvalidVault
    )]
    pub revenue_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = user_usdc_ata.owner == user.key() @ ErrorCode::InvalidTokenAccount
    )]
    pub user_usdc_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
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
    pub bump: u8,
}

#[account]
pub struct DividendStake {
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
    pub owner: Pubkey,
    pub staked_amount: u64,
    pub referrer: Option<Pubkey>,
    pub tier: u8,
    pub last_claim_epoch: u64,
    pub bump: u8,
}

#[account]
pub struct DataProviderStake {
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
    #[msg("Invalid token account owner")]
    InvalidTokenAccount,
    #[msg("Data provider must be deactivated before unstaking")]
    MustDeactivateFirst,
    #[msg("Data provider is not currently active")]
    NotActive,
}
