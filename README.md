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

Each deposit increments a `dividend_epoch` counter. Pools **accumulate** across deposits -- unclaimed funds from prior epochs roll forward into the next snapshot. Users can only claim once per epoch, and the snapshot-based calculation ensures all users with equal shares receive identical rewards regardless of claim ordering.

## Instructions (19 total)

### Admin / Setup

| Instruction | Description |
|---|---|
| `initialize` | Creates `GlobalConfig` PDA. Protected against re-initialization. |
| `propose_admin_transfer` | Current admin proposes a new admin. Two-step pattern. |
| `accept_admin_transfer` | Pending admin accepts the transfer by signing. |
| `cancel_admin_transfer` | Current admin cancels a pending transfer. |
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
| `revoke_legacy_partnership` | Admin revokes a tier-2 legacy partnership. Decrements active partner count. |

## Security Features

- **Snapshot-based claims**: Revenue is snapshotted into `epoch_dividend_pool` and `epoch_referral_pool` at deposit time. Claims calculate from the snapshot, not the live vault balance, eliminating early-claimer advantage. Verified by multi-user fairness test.
- **Snapshot + pool decrement**: Each deposit snapshots the pools (`epoch_dividend_snapshot`, `epoch_referral_snapshot`) for fair per-user calculation. Claims decrement the live pool (`epoch_dividend_pool`, `epoch_referral_pool`) to keep on-chain accounting in sync with the vault. Equal-share users always receive identical rewards.
- **Accumulating pools**: Unclaimed funds from prior epochs roll forward (`+=`) into the next snapshot, preventing loss from rapid deposits.
- **Snapshotted partner count**: `epoch_active_partners` is captured at deposit time, preventing mid-epoch partner dilution.
- **Epoch-based claim tracking**: One claim per epoch per user/partner. Prevents vault drain attacks.
- **Per-partner referral split**: Referral pool divided by `total_active_partners` count, not a flat 1/3 of vault. Integer division dust remains in vault (standard on-chain behavior).
- **Two-step admin transfer**: `propose_admin_transfer` + `accept_admin_transfer` + `cancel_admin_transfer` for safe admin rotation.
- **Vault mint and authority validation**: `initialize` verifies `token_vault.mint == unsys_mint`, `revenue_vault.mint == usdc_mint`, and both vaults are owned by the GlobalConfig PDA.
- **Full ATA mint validation**: All claim ATAs verify `mint == usdc_mint`, all staking ATAs verify `mint == unsys_mint`, admin deposit ATA verifies `mint == usdc_mint`. Defense-in-depth alongside CPI checks.
- **Early exit on zero shares**: `claim_dividends` rejects with `NoActiveStake` if `shares == 0` (e.g. after unstake), avoiding wasted compute.
- **Checked arithmetic**: All `total_dividend_shares`, `epoch_dividend_pool`, `epoch_referral_pool`, and `dividend_epoch` operations use `checked_add`/`checked_div`/`checked_sub`/`checked_mul`.
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

**47 tests, all passing.**

| Category | Tests | What's Covered |
|---|---|---|
| `initialize` | 2 | Successful init with vault mint/authority validation, re-initialization rejection |
| `admin_transfer` | 5 | Propose+accept, non-admin rejection, wrong-address rejection, cancel transfer, cancel by non-admin |
| `stake_dividends` | 7 | 3/6/12-month multipliers, invalid period, double-stake, wrong vault, zero amount |
| `unstake_dividends` | 1 | Lock period enforcement (happy path requires clock warp -- devnet only) |
| `stake_partnership` | 4 | Stake + partner count increment, referrer, double-stake, zero amount |
| `unstake_partnership` | 4 | Partial + token return, full + tier revocation + partner decrement, zero-amount, non-owner |
| `re-stake partnership` | 1 | Full unstake -> re-stake with correct epoch tracking |
| `stake_data_provider` | 4 | Insufficient, 5M+, double-stake, admin/non-admin validation |
| `data_provider_deactivation` | 4 | Active unstake rejection, deactivate+unstake, inactive deactivation, non-owner |
| `deposit_revenue` | 6 | Pool accumulation + snapshot verification, multi-deposit accumulation, non-admin, wrong vault, zero |
| `claim_dividends` | 5 | Exact snapshot math + pool decrement verification, double-claim, new-epoch, wrong vault, non-owner |
| `multi-user fairness` | 1 | Two equal-share users receive **identical** rewards regardless of claim order (snapshot proof) |
| `claim_referral_share` | 4 | Exact per-partner split from snapshot + pool decrement, double-claim, non-owner, wrong vault |

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
│           └── lib.rs        # Program source (~1200 lines)
├── tests/
│   └── unsys_staking.ts     # Integration tests (47 tests)
└── migrations/
    └── deploy.ts
```

## License

ISC
