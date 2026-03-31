use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

declare_id!("8fQT7WjAw2BLYJcbTPYxLciPmUgh5GS4Jj2Vo1uhoK2q");

#[program]
pub mod unsys_staking {
    use super::*;

    const MIN_DATA_PROVIDER_STAKE: u64 = 5_000_000;
    const BASE_LEGACY_SHARES: u128 = 1_000_000 * 10_000;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.global_config;
        // Prevent re-initialization: if admin is already set, reject
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
        config.buyback_wallet = ctx.accounts.buyback_wallet.key();
        config.total_dividend_shares = 0;
        config.bump = ctx.bumps.global_config;
        msg!("GlobalConfig initialized");
        Ok(())
    }

    pub fn deposit_revenue(ctx: Context<DepositRevenue>, amount: u64) -> Result<()> {
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
        msg!("Deposited {} USDC revenue", amount);
        Ok(())
    }

    pub fn stake_dividends(
        ctx: Context<StakeDividends>,
        amount: u64,
        lock_months: u8,
    ) -> Result<()> {
        let stake = &mut ctx.accounts.user_stake;
        let clock = Clock::get()?;

        // Prevent overwriting an existing active stake
        require!(
            stake.amount == 0,
            ErrorCode::StakeAlreadyExists
        );

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
        stake.bump = ctx.bumps.user_stake;

        let cpi_accounts = Transfer {
            from: ctx.accounts.user_unsys_ata.to_account_info(),
            to: ctx.accounts.token_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        ctx.accounts.global_config.total_dividend_shares += shares;
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

        // Transfer tokens back from vault to user
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

        // Clear the stake
        stake.amount = 0;
        stake.shares = 0;
        stake.lock_end = 0;
        stake.multiplier_bps = 0;

        // Decrease global shares
        ctx.accounts.global_config.total_dividend_shares = ctx
            .accounts
            .global_config
            .total_dividend_shares
            .saturating_sub(shares);

        msg!("Unstaked {} $UNSYS dividends", amount);
        Ok(())
    }

    pub fn enable_legacy_dividends(ctx: Context<EnableLegacyDividends>) -> Result<()> {
        require!(
            ctx.accounts.legacy_omega_stake.registered,
            ErrorCode::NotLegacyOmega
        );
        let stake = &mut ctx.accounts.dividend_stake;

        // Prevent overwriting existing stake
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

        stake.owner = ctx.accounts.user.key();
        stake.staked_amount = 0;
        stake.referrer = None;
        stake.tier = 2;
        stake.bump = ctx.bumps.partnership_stake;

        msg!("Legacy Omega now has 30% referral tier");
        Ok(())
    }

    pub fn stake_data_provider(ctx: Context<StakeDataProvider>, amount: u64) -> Result<()> {
        let stake = &mut ctx.accounts.data_provider_stake;
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

        msg!("Data Provider registered: {} $UNSYS", amount);
        Ok(())
    }

    pub fn validate_data_provider(ctx: Context<ValidateDataProvider>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.global_config.admin,
            ErrorCode::Unauthorized
        );
        ctx.accounts.data_provider_stake.active = true;
        msg!("Data Provider validated & activated");
        Ok(())
    }

    pub fn stake_partnership(
        ctx: Context<StakePartnership>,
        amount: u64,
        referrer: Option<Pubkey>,
    ) -> Result<()> {
        let stake = &mut ctx.accounts.partnership_stake;
        stake.owner = ctx.accounts.user.key();
        stake.staked_amount = amount;
        stake.referrer = referrer;
        stake.tier = 1;
        stake.bump = ctx.bumps.partnership_stake;

        let cpi_accounts = Transfer {
            from: ctx.accounts.user_unsys_ata.to_account_info(),
            to: ctx.accounts.token_vault.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        msg!("Partnership stake active: {} $UNSYS", amount);
        Ok(())
    }

    pub fn unstake_partnership(
        ctx: Context<UnstakePartnership>,
        amount_to_unstake: u64,
    ) -> Result<()> {
        let stake = &mut ctx.accounts.partnership_stake;
        require!(
            stake.staked_amount >= amount_to_unstake,
            ErrorCode::InsufficientStake
        );

        // Transfer tokens back from vault to user
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

        if stake.staked_amount == 0 {
            stake.tier = 0;
            msg!("Fully unstaked - partner status REVOKED");
        }
        Ok(())
    }

    pub fn claim_dividends(ctx: Context<ClaimDividends>) -> Result<()> {
        let stake = &mut ctx.accounts.user_stake;
        let config = &ctx.accounts.global_config;
        let vault_balance = ctx.accounts.revenue_vault.amount;

        require!(vault_balance > 0, ErrorCode::NoRevenueToClaim);

        let user_reward = if config.total_dividend_shares > 0 {
            ((stake.shares as u128 * vault_balance as u128) / config.total_dividend_shares as u128)
                as u64
        } else {
            0
        };

        require!(user_reward > 0, ErrorCode::NoRevenueToClaim);
        require!(user_reward <= vault_balance, ErrorCode::InsufficientRevenue);

        let cpi_accounts = Transfer {
            from: ctx.accounts.revenue_vault.to_account_info(),
            to: ctx.accounts.user_usdc_ata.to_account_info(),
            authority: ctx.accounts.global_config.to_account_info(),
        };

        let bump = [config.bump];
        let signer_seeds = &[&[b"global_config_v3".as_ref(), &bump][..]];
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, user_reward)?;

        stake.last_claim_ts = Clock::get()?.unix_timestamp;
        msg!("Claimed {} USDC dividends", user_reward);
        Ok(())
    }

    pub fn claim_referral_share(ctx: Context<ClaimReferralShare>) -> Result<()> {
        let partnership = &ctx.accounts.partnership_stake;
        require!(
            partnership.staked_amount > 0 || partnership.tier == 2,
            ErrorCode::NoActiveStake
        );

        let vault_balance = ctx.accounts.revenue_vault.amount;
        require!(vault_balance > 0, ErrorCode::NoRevenueToClaim);

        let amount = vault_balance / 3;

        require!(amount <= vault_balance, ErrorCode::InsufficientRevenue);

        let cpi_accounts = Transfer {
            from: ctx.accounts.revenue_vault.to_account_info(),
            to: ctx.accounts.user_usdc_ata.to_account_info(),
            authority: ctx.accounts.global_config.to_account_info(),
        };

        let bump = [ctx.accounts.global_config.bump];
        let signer_seeds = &[&[b"global_config_v3".as_ref(), &bump][..]];
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token::transfer(cpi_ctx, amount)?;

        msg!("Claimed {} USDC referral share", amount);
        Ok(())
    }
}

// ============================================================
// Account Structs (with proper constraints)
// ============================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + 400,
        seeds = [b"global_config_v3"],
        bump
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub unsys_mint: Account<'info, Mint>,
    pub omega_mint: Account<'info, Mint>,
    pub usdc_mint: Account<'info, Mint>,

    /// CHECK: Buyback wallet address stored for off-chain reference only
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
pub struct DepositRevenue<'info> {
    #[account(mut)]
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
    #[account(mut)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(init_if_needed, payer = user, space = 8 + 150, seeds = [b"dividend_stake", user.key().as_ref()], bump)]
    pub user_stake: Account<'info, DividendStake>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
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
    #[account(mut)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        seeds = [b"dividend_stake", user.key().as_ref()],
        bump = user_stake.bump,
        has_one = owner @ ErrorCode::Unauthorized,
    )]
    pub user_stake: Account<'info, DividendStake>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_unsys_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = token_vault.key() == global_config.token_vault @ ErrorCode::InvalidVault
    )]
    pub token_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    /// CHECK: owner field on DividendStake used for has_one check
    pub owner: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct EnableLegacyDividends<'info> {
    #[account(mut)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(init_if_needed, payer = user, space = 8 + 150, seeds = [b"dividend_stake", user.key().as_ref()], bump)]
    pub dividend_stake: Account<'info, DividendStake>,
    pub legacy_omega_stake: Account<'info, LegacyOmegaStake>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EnableLegacyPartnership<'info> {
    #[account(init_if_needed, payer = user, space = 8 + 120, seeds = [b"partnership_stake", user.key().as_ref()], bump)]
    pub partnership_stake: Account<'info, PartnershipStake>,
    pub legacy_omega_stake: Account<'info, LegacyOmegaStake>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StakeDataProvider<'info> {
    #[account(init_if_needed, payer = user, space = 8 + 100, seeds = [b"data_provider_stake", user.key().as_ref()], bump)]
    pub data_provider_stake: Account<'info, DataProviderStake>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_unsys_ata: Account<'info, TokenAccount>,
    #[account(mut)]
    pub token_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ValidateDataProvider<'info> {
    #[account(mut)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(mut)]
    pub data_provider_stake: Account<'info, DataProviderStake>,
    #[account(mut)]
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct StakePartnership<'info> {
    #[account(init_if_needed, payer = user, space = 8 + 120, seeds = [b"partnership_stake", user.key().as_ref()], bump)]
    pub partnership_stake: Account<'info, PartnershipStake>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_unsys_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = token_vault.key() == global_config.token_vault @ ErrorCode::InvalidVault
    )]
    pub token_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub global_config: Account<'info, GlobalConfig>,
}

#[derive(Accounts)]
pub struct UnstakePartnership<'info> {
    #[account(
        mut,
        seeds = [b"partnership_stake", user.key().as_ref()],
        bump = partnership_stake.bump,
        constraint = partnership_stake.owner == user.key() @ ErrorCode::Unauthorized
    )]
    pub partnership_stake: Account<'info, PartnershipStake>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        constraint = token_vault.key() == global_config.token_vault @ ErrorCode::InvalidVault
    )]
    pub token_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_unsys_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimDividends<'info> {
    #[account(mut)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        mut,
        seeds = [b"dividend_stake", user.key().as_ref()],
        bump = user_stake.bump,
        constraint = user_stake.owner == user.key() @ ErrorCode::Unauthorized
    )]
    pub user_stake: Account<'info, DividendStake>,
    /// The stake owner must sign to claim their dividends
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = revenue_vault.key() == global_config.revenue_vault @ ErrorCode::InvalidVault
    )]
    pub revenue_vault: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_usdc_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClaimReferralShare<'info> {
    #[account(mut)]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(
        seeds = [b"partnership_stake", user.key().as_ref()],
        bump = partnership_stake.bump,
        constraint = partnership_stake.owner == user.key() @ ErrorCode::Unauthorized
    )]
    pub partnership_stake: Account<'info, PartnershipStake>,
    /// The partner must sign to claim their referral share
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        constraint = revenue_vault.key() == global_config.revenue_vault @ ErrorCode::InvalidVault
    )]
    pub revenue_vault: Account<'info, TokenAccount>,
    #[account(mut)]
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
    pub buyback_wallet: Pubkey,
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
}
