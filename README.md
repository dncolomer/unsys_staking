# UNSYS Staking Program

A Solana on-chain program built with Anchor for the Uncertain Systems (UNSYS) ecosystem. It provides staking, revenue sharing, partnership management, and data provider registration.

**Program ID:** `8fQT7WjAw2BLYJcbTPYxLciPmUgh5GS4Jj2Vo1uhoK2q`

## Architecture

### On-Chain Accounts

| Account | PDA Seed | Description |
|---|---|---|
| `GlobalConfig` | `"global_config_v3"` | Stores mints, vaults, admin, buyback wallet, total dividend shares, dividend epoch |
| `DividendStake` | `"dividend_stake" + user_pubkey` | Per-user dividend stake with lock period, share multiplier, and epoch tracking |
| `PartnershipStake` | `"partnership_stake" + user_pubkey` | Per-user partnership stake with tier, optional referrer, and epoch tracking |
| `DataProviderStake` | `"data_provider_stake" + user_pubkey` | Per-user data provider registration (requires admin activation) |
| `LegacyOmegaStake` | (external) | Read-only account for legacy OMEGA holder verification |

### Token Types

- **UNSYS** -- Utility/governance token used for staking
- **OMEGA** -- Legacy token for migration benefits
- **USDC** -- Revenue distribution token

## Instructions (14 total)

### Admin / Setup

| Instruction | Description |
|---|---|
| `initialize` | Creates `GlobalConfig` PDA. Protected against re-initialization. |
| `deposit_revenue` | Admin deposits USDC into the revenue vault. Increments the dividend epoch. |
| `validate_data_provider` | Admin activates a pending data provider. |

### Dividend Staking

| Instruction | Description |
|---|---|
| `stake_dividends` | Lock UNSYS for 3/6/12 months. Shares weighted by multiplier (1.1x / 1.25x / 1.5x). Rejects double-staking and zero amounts. |
| `unstake_dividends` | Returns staked UNSYS after lock period expires. Decrements global shares. Owner-only via PDA + signer. |
| `claim_dividends` | Claims proportional USDC from revenue vault. Epoch-based: one claim per deposit. Requires stake owner signature. |

### Partnership / Referral

| Instruction | Description |
|---|---|
| `stake_partnership` | Stake UNSYS to become a partner (tier 1) with optional referrer. Rejects double-staking and zero amounts. |
| `unstake_partnership` | Partial or full unstake. Tokens returned from vault. Full unstake revokes tier. Owner-only. |
| `claim_referral_share` | Active partner claims 1/3 of revenue vault. Epoch-based: one claim per deposit. Requires partner signature. |

### Data Provider

| Instruction | Description |
|---|---|
| `stake_data_provider` | Stake 5M+ UNSYS to register as data provider (starts inactive). Rejects double-staking. |
| `unstake_data_provider` | Returns staked UNSYS to the data provider. Owner-only via PDA + signer. |

### Legacy Migration

| Instruction | Description |
|---|---|
| `enable_legacy_dividends` | Grants 10B dividend shares to verified legacy OMEGA holders. |
| `enable_legacy_partnership` | Grants tier-2 partnership (30% referral) to legacy OMEGA holders. |

## Security Features

- **Epoch-based claim tracking**: `claim_dividends` and `claim_referral_share` use a `dividend_epoch` counter that increments on each `deposit_revenue`. Users can only claim once per epoch, preventing vault drain attacks.
- **PDA-verified GlobalConfig**: Every instruction that references `global_config` verifies it via `seeds = [b"global_config_v3"], bump = global_config.bump`, preventing fake config account substitution.
- **Signer requirements on all mutations**: Claims, unstakes, and stakes all require the owner to sign. PDA seed constraints ensure only the correct owner's key derives the PDA.
- **Vault validation**: All instructions that interact with vaults enforce `constraint = vault.key() == global_config.vault` to prevent substitution attacks.
- **Token account ownership validation**: `user_unsys_ata` and `user_usdc_ata` are validated with `constraint = ata.owner == user.key()` to prevent token redirection.
- **Re-initialization guard**: `initialize` checks that `admin == Pubkey::default()` before writing.
- **Double-stake prevention**: `stake_dividends`, `stake_partnership`, and `stake_data_provider` all reject if a stake already exists.
- **Lock period enforcement**: `unstake_dividends` checks `clock.unix_timestamp >= stake.lock_end`.
- **Zero-amount rejection**: All staking and deposit instructions require `amount > 0`.
- **Token return on all unstakes**: `unstake_partnership`, `unstake_dividends`, and `unstake_data_provider` all perform CPI transfers to return tokens from the vault.

## Test Coverage

**38 tests, all passing.**

| Category | Tests | What's Covered |
|---|---|---|
| `initialize` | 2 | Successful init, re-initialization rejection |
| `stake_dividends` | 7 | 3/6/12-month multipliers, invalid period, double-stake, wrong vault, zero amount |
| `unstake_dividends` | 1 | Lock period enforcement |
| `stake_partnership` | 5 | Without referrer, with referrer, double-stake, zero amount, wrong vault |
| `unstake_partnership` | 3 | Partial unstake with token return, full unstake with tier revocation, non-owner rejection |
| `stake_data_provider` | 5 | Insufficient stake, successful 5M+, double-stake, admin validation, non-admin rejection |
| `unstake_data_provider` | 2 | Successful unstake with token return, non-owner rejection |
| `deposit_revenue` | 4 | Successful deposit + epoch increment, non-admin, wrong vault, zero amount |
| `claim_dividends` | 5 | Successful claim, double-claim rejection (epoch), claim after new deposit, wrong vault, non-owner PDA |
| `claim_referral_share` | 4 | Successful claim, double-claim rejection (epoch), non-owner PDA, wrong vault |

## Build & Test

### Prerequisites

- [Rust](https://rustup.rs/) (toolchain 1.85.0 is pinned via `rust-toolchain.toml`)
- [Solana CLI](https://docs.solanalabs.com/cli/install) v3.x
- [Anchor CLI](https://www.anchor-lang.com/docs/installation) v0.30.1
- Node.js 18+ and Yarn

### Setup

```bash
yarn install
```

### Build

> **Note:** IDL auto-generation is currently broken with `anchor-syn 0.30.1` due to a `proc_macro2::Span::source_file()` incompatibility. Use `--no-idl` and the pre-built IDL in `idl/`.

```bash
anchor build --no-idl
```

The pre-built IDL and TypeScript types are available in the `idl/` directory.

### Test

```bash
# Kill any running validator, then:
anchor test --skip-build
```

If you get a `._genesis.bin` archive error on macOS:

```bash
rm -rf .anchor/test-ledger test-ledger
COPYFILE_DISABLE=1 anchor test --skip-build
```

## Tech Stack

| Component | Version |
|---|---|
| Anchor (Rust) | 0.29.0 |
| Anchor (CLI) | 0.30.1 |
| `@coral-xyz/anchor` (TS) | 0.30.1 |
| Solana CLI | 3.1.11 (Agave) |
| Rust toolchain | 1.85.0 |
| Test runner | ts-mocha + chai |

## Project Structure

```
unsys_staking/
├── Anchor.toml              # Anchor configuration
├── Cargo.toml               # Rust workspace
├── package.json             # Node dependencies
├── rust-toolchain.toml      # Pinned Rust version
├── tsconfig.json            # TypeScript config
├── idl/
│   ├── unsys_staking.json   # Program IDL (Anchor 0.30 format)
│   └── unsys_staking.ts     # TypeScript type definitions
├── programs/
│   └── unsys_staking/
│       ├── Cargo.toml
│       └── src/
│           └── lib.rs        # Program source (~700 lines)
├── tests/
│   └── unsys_staking.ts     # Integration tests (38 tests)
└── migrations/
    └── deploy.ts            # Anchor deploy migration
```

## License

ISC
