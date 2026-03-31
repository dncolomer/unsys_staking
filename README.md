# UNSYS Staking Program

A Solana on-chain program built with Anchor for the Uncertain Systems (UNSYS) ecosystem. It provides staking, revenue sharing, partnership management, and data provider registration.

**Program ID:** `8fQT7WjAw2BLYJcbTPYxLciPmUgh5GS4Jj2Vo1uhoK2q`

## Architecture

### On-Chain Accounts

| Account | PDA Seed | Description |
|---|---|---|
| `GlobalConfig` | `"global_config_v3"` | Stores mints, vaults, admin, buyback wallet, total dividend shares |
| `DividendStake` | `"dividend_stake" + user_pubkey` | Per-user dividend stake with lock period and share multiplier |
| `PartnershipStake` | `"partnership_stake" + user_pubkey` | Per-user partnership stake with tier and optional referrer |
| `DataProviderStake` | `"data_provider_stake" + user_pubkey` | Per-user data provider registration (requires admin activation) |
| `LegacyOmegaStake` | (external) | Read-only account for legacy OMEGA holder verification |

### Token Types

- **UNSYS** -- Utility/governance token used for staking
- **OMEGA** -- Legacy token for migration benefits
- **USDC** -- Revenue distribution token

## Instructions (12 total)

### Admin / Setup

| Instruction | Description |
|---|---|
| `initialize` | Creates `GlobalConfig` PDA. Protected against re-initialization. |
| `deposit_revenue` | Admin deposits USDC into the revenue vault for distribution. |
| `validate_data_provider` | Admin activates a pending data provider. |

### Dividend Staking

| Instruction | Description |
|---|---|
| `stake_dividends` | Lock UNSYS for 3/6/12 months. Shares weighted by multiplier (1.1x / 1.25x / 1.5x). Rejects double-staking. |
| `unstake_dividends` | Returns staked UNSYS after lock period expires. Decrements global shares. |
| `claim_dividends` | Claims proportional USDC from revenue vault (`user_shares / total_shares * vault_balance`). Requires stake owner signature. |

### Partnership / Referral

| Instruction | Description |
|---|---|
| `stake_partnership` | Stake UNSYS to become a partner (tier 1) with optional referrer. |
| `unstake_partnership` | Partial or full unstake. Tokens are returned from vault. Full unstake revokes tier. Owner-only. |
| `claim_referral_share` | Active partner claims 1/3 of revenue vault. Requires partner signature. |

### Data Provider

| Instruction | Description |
|---|---|
| `stake_data_provider` | Stake 5M+ UNSYS to register as data provider (starts inactive). |

### Legacy Migration

| Instruction | Description |
|---|---|
| `enable_legacy_dividends` | Grants 10B dividend shares to verified legacy OMEGA holders. |
| `enable_legacy_partnership` | Grants tier-2 partnership (30% referral) to legacy OMEGA holders. |

## Security Features

- **Signer requirements on claims**: `claim_dividends` and `claim_referral_share` require the stake owner to sign. PDA seed constraints ensure only the owner's key can derive the correct PDA.
- **Vault validation**: All instructions that interact with vaults enforce `constraint = vault.key() == global_config.vault` to prevent substitution attacks.
- **Re-initialization guard**: `initialize` checks that `admin == Pubkey::default()` before writing, preventing admin takeover.
- **Double-stake prevention**: `stake_dividends` rejects if the user already has an active stake.
- **Lock period enforcement**: `unstake_dividends` checks `clock.unix_timestamp >= stake.lock_end` before returning tokens.
- **Owner-only unstake**: `unstake_partnership` validates `partnership_stake.owner == user.key()` via PDA seed + constraint.
- **Token return on unstake**: Both `unstake_partnership` and `unstake_dividends` perform CPI transfers to return tokens from the vault to the user.

## Test Coverage

**30 tests, all passing.**

| Category | Tests | What's Covered |
|---|---|---|
| `initialize` | 2 | Successful init, re-initialization rejection |
| `stake_dividends` | 6 | 3/6/12-month multipliers, invalid period, double-stake rejection, wrong vault rejection |
| `unstake_dividends` | 1 | Lock period enforcement |
| `stake_partnership` | 3 | Without referrer, with referrer, wrong vault rejection |
| `unstake_partnership` | 3 | Partial unstake with token return, full unstake with tier revocation + token return, non-owner rejection |
| `stake_data_provider` | 4 | Insufficient stake, successful 5M+ stake, admin validation, non-admin rejection |
| `deposit_revenue` | 3 | Successful deposit, non-admin rejection, wrong vault rejection |
| `claim_dividends` | 4 | Successful claim with signer, wrong vault rejection, non-owner PDA mismatch, empty vault |
| `claim_referral_share` | 4 | Successful claim with signer, non-owner PDA mismatch, no active stake, wrong vault |

## Build & Test

### Prerequisites

- [Rust](https://rustup.rs/) (toolchain 1.82.0 is pinned via `rust-toolchain.toml`)
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

To regenerate types from the IDL after changes:

```bash
anchor idl convert idl/unsys_staking.json -o target/idl/unsys_staking.json
anchor idl type target/idl/unsys_staking.json -o target/types/unsys_staking.ts
```

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
| Rust toolchain | 1.82.0 |
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
│           └── lib.rs        # Program source (single file, ~500 lines)
├── tests/
│   └── unsys_staking.ts     # Integration tests (30 tests)
└── migrations/
    └── deploy.ts            # Anchor deploy migration
```

## License

ISC
