# UNSYS Staking Program

A Solana on-chain program built with Anchor for the Uncertain Systems (UNSYS) ecosystem. It provides staking, revenue sharing, partnership management, and data provider registration.

**Program ID:** `8fQT7WjAw2BLYJcbTPYxLciPmUgh5GS4Jj2Vo1uhoK2q`

## Architecture

### On-Chain Accounts

| Account | PDA Seed | Description |
|---|---|---|
| `GlobalConfig` | `"global_config_v3"` | Stores mints, vaults, admin, pending admin, dividend epoch, snapshot pools, active partner count |
| `DividendStake` | `"dividend_stake" + user_pubkey` | Per-user dividend stake with lock period, share multiplier, and epoch tracking |
| `PartnershipStake` | `"partnership_stake" + user_pubkey` | Per-user partnership stake with tier, optional referrer, and epoch tracking |
| `DataProviderStake` | `"data_provider_stake" + user_pubkey` | Per-user data provider registration (requires admin activation) |
| `LegacyOmegaStake` | (external) | Read-only account for legacy OMEGA holder verification |

### Token Types

- **UNSYS** -- Utility/governance token used for staking
- **OMEGA** -- Legacy token for migration benefits
- **USDC** -- Revenue distribution token

### Revenue Distribution Model

Revenue deposits are split into two pools via a snapshot mechanism:
- **Dividend Pool (66.67%)**: Distributed proportionally to stakers based on `user_shares / total_shares`
- **Referral Pool (33.33%)**: Split equally among all active partners (`pool / total_active_partners`)

Each deposit increments a `dividend_epoch` counter. Users can only claim once per epoch, ensuring fair distribution regardless of claim ordering.

## Instructions (17 total)

### Admin / Setup

| Instruction | Description |
|---|---|
| `initialize` | Creates `GlobalConfig` PDA. Protected against re-initialization. |
| `propose_admin_transfer` | Current admin proposes a new admin. Two-step pattern. |
| `accept_admin_transfer` | Pending admin accepts the transfer by signing. |
| `deposit_revenue` | Admin deposits USDC into revenue vault. Snapshots the deposit into dividend and referral pools. Increments epoch. |
| `validate_data_provider` | Admin activates a pending data provider. PDA-verified. |
| `deactivate_data_provider` | Admin deactivates an active data provider. Required before unstaking. |

### Dividend Staking

| Instruction | Description |
|---|---|
| `stake_dividends` | Lock UNSYS for 3/6/12 months. Shares weighted by multiplier (1.1x / 1.25x / 1.5x). Rejects double-staking and zero amounts. |
| `unstake_dividends` | Returns staked UNSYS after lock period expires. Decrements global shares. Owner-only. |
| `claim_dividends` | Claims proportional USDC from the epoch's dividend pool snapshot. One claim per epoch. |

### Partnership / Referral

| Instruction | Description |
|---|---|
| `stake_partnership` | Stake UNSYS to become a partner (tier 1). Increments active partner count. Rejects double-staking. |
| `unstake_partnership` | Partial or full unstake. Tokens returned. Full unstake revokes tier and decrements partner count. Rejects zero-amount. |
| `claim_referral_share` | Claims equal share of the epoch's referral pool (`pool / total_partners`). One claim per epoch. |

### Data Provider

| Instruction | Description |
|---|---|
| `stake_data_provider` | Stake 5M+ UNSYS to register (starts inactive). Rejects double-staking. |
| `deactivate_data_provider` | Admin deactivates provider. Required before unstaking. |
| `unstake_data_provider` | Returns staked UNSYS. Must be deactivated first. Owner-only. |

### Legacy Migration

| Instruction | Description |
|---|---|
| `enable_legacy_dividends` | Grants 10B dividend shares to verified legacy OMEGA holders. Sets epoch tracking. |
| `enable_legacy_partnership` | Grants tier-2 partnership to legacy OMEGA holders. Guards against double-registration. Sets epoch tracking. |

## Security Features

- **Snapshot-based claims**: Revenue is snapshotted into `epoch_dividend_pool` and `epoch_referral_pool` at deposit time. Claims calculate from the snapshot, not the live vault balance, eliminating early-claimer advantage.
- **Epoch-based claim tracking**: One claim per epoch per user/partner. Prevents vault drain attacks.
- **Per-partner referral split**: Referral pool divided by `total_active_partners` count, not a flat 1/3 of vault.
- **Two-step admin transfer**: `propose_admin_transfer` + `accept_admin_transfer` prevents accidental admin loss.
- **PDA-verified GlobalConfig**: Every instruction verifies GlobalConfig via seeds + bump.
- **PDA seed verification on all admin-facing accounts**: `ValidateDataProvider` and `DeactivateDataProvider` verify the `data_provider_stake` PDA.
- **Signer requirements on all mutations**: Claims, unstakes, and stakes require owner signature + PDA constraint.
- **Vault validation**: All vault interactions enforce `vault.key() == global_config.vault`.
- **Token account ownership**: All ATAs validated with `ata.owner == user.key()`.
- **Re-initialization guard**: `initialize` checks `admin == Pubkey::default()`.
- **Double-stake prevention**: All staking instructions check for existing stakes.
- **Lock period enforcement**: `unstake_dividends` checks `clock >= lock_end`.
- **Zero-amount rejection**: All staking, deposits, and unstakes require `amount > 0`.
- **Deactivation-before-unstake**: Data providers must be deactivated by admin before unstaking.
- **Legacy double-registration guard**: `enable_legacy_partnership` checks `staked_amount == 0 && tier == 0`.
- **Anchor events**: All state-changing instructions emit events for off-chain indexing.

## Test Coverage

**42 tests, all passing.**

| Category | Tests | What's Covered |
|---|---|---|
| `initialize` | 2 | Successful init with all new fields, re-initialization rejection |
| `admin_transfer` | 3 | Full propose+accept flow, non-admin rejection, wrong-address rejection |
| `stake_dividends` | 7 | 3/6/12-month multipliers, invalid period, double-stake, wrong vault, zero amount |
| `unstake_dividends` | 1 | Lock period enforcement |
| `stake_partnership` | 4 | Stake + active partner count increment, referrer, double-stake, zero amount |
| `unstake_partnership` | 4 | Partial + token return, full + tier revocation + partner decrement, zero-amount rejection, non-owner |
| `stake_data_provider` | 4 | Insufficient stake, successful 5M+, double-stake, admin/non-admin validation |
| `data_provider_deactivation` | 4 | Active provider unstake rejection, deactivate+unstake flow, inactive deactivation rejection, non-owner |
| `deposit_revenue` | 4 | Snapshot pool math verification, non-admin, wrong vault, zero amount |
| `claim_dividends` | 5 | Exact proportional math from snapshot, double-claim rejection, new-epoch claim, wrong vault, non-owner |
| `claim_referral_share` | 4 | Exact per-partner split from snapshot, double-claim rejection, non-owner, wrong vault |

## Build & Test

### Prerequisites

- [Rust](https://rustup.rs/) (toolchain 1.85.0 pinned via `rust-toolchain.toml`)
- [Solana CLI](https://docs.solanalabs.com/cli/install) v3.x
- [Anchor CLI](https://www.anchor-lang.com/docs/installation) v0.30.1
- Node.js 18+ and Yarn

### Setup

```bash
yarn install
```

### Build

```bash
anchor build --no-idl
```

Pre-built IDL and TypeScript types are in the `idl/` directory.

### Test

```bash
anchor test --skip-build
```

macOS fix for `._genesis.bin` error:

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
├── Anchor.toml
├── Cargo.toml
├── package.json
├── rust-toolchain.toml
├── tsconfig.json
├── idl/
│   ├── unsys_staking.json   # Program IDL (Anchor 0.30 format)
│   └── unsys_staking.ts     # TypeScript type definitions
├── programs/
│   └── unsys_staking/
│       ├── Cargo.toml
│       └── src/
│           └── lib.rs        # Program source (~850 lines)
├── tests/
│   └── unsys_staking.ts     # Integration tests (42 tests)
└── migrations/
    └── deploy.ts
```

## License

ISC
