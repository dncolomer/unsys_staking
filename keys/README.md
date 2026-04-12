# UNSYS Staking - Key Management

> **WARNING**: Never commit `.json` keypair files to git. They are gitignored for security.

## Key Inventory

| File                   | Public Key                                     | Purpose                             | Backed Up?                 |
| ---------------------- | ---------------------------------------------- | ----------------------------------- | -------------------------- |
| `admin-wallet.json`    | `6HGeNL5852ykqQNiwT6sC5YFu1xBBwvgtVnUWuf5EfEP` | Admin/upgrade authority for mainnet | Yes (pump.fun seed phrase) |
| `program-keypair.json` | `GSxEFVkssh6trQ97WZBsMGs1iahdJ6Z2fSPjQ617nKLN` | Program identity (devnet + mainnet) | Backup to USB              |
| `buyback-wallet.json`  | `2v1EY1dF7eN4QnHhrat1nCcqDLMnw3twVKmyyQQe4mPF` | Buyback fund recipient              | Backup to USB              |

## Network Configuration

### Mainnet (DEPLOYED 2026-04-12)

| Item           | Address                                        | Notes                |
| -------------- | ---------------------------------------------- | -------------------- |
| Program ID     | `GSxEFVkssh6trQ97WZBsMGs1iahdJ6Z2fSPjQ617nKLN` |                      |
| GlobalConfig   | `82tAZJHT86kSZv4EP5XuCaXUeijfJLL6uRwpRLzHmem`  | PDA                  |
| Admin          | `6HGeNL5852ykqQNiwT6sC5YFu1xBBwvgtVnUWuf5EfEP` |                      |
| UNSYS Mint     | `Dza3Bey5tvyYiPgcGRKoXKU6rNrdoNrWNVmjqePcpump` | **Token-2022**       |
| OMEGA Mint     | `BaWyD9P8ctkZ6if2umqj7htV91YuuouzUrMFsJh9BAGS` | SPL Token (legacy)   |
| USDC Mint      | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | SPL Token (official) |
| UNSYS Vault    | `9D8ibo7Zw7Zs6psMkWdM58b4NoLXGAV1KTq93grnuDTo` | Token-2022 ATA       |
| USDC Vault     | `6Ni6ovoovqT3pYpNvnReeFM6e9zzC5SNun1ziCC3z3Zj` | SPL Token ATA        |
| Buyback Wallet | `2v1EY1dF7eN4QnHhrat1nCcqDLMnw3twVKmyyQQe4mPF` |                      |

### Devnet

| Item       | Address                                        |
| ---------- | ---------------------------------------------- |
| Program ID | `GSxEFVkssh6trQ97WZBsMGs1iahdJ6Z2fSPjQ617nKLN` |
| Admin      | `Divu4ucfW3u4TFSHWAxNqzCDmj3EKSV4ugn8VYzeTYLi` |

## Backup Checklist

- [ ] `admin-wallet.json` — seed phrase written on paper / stored securely
- [ ] `program-keypair.json` — copied to encrypted USB
- [ ] `buyback-wallet.json` — copied to encrypted USB

## Recovery Instructions

### Admin Wallet

Restore from pump.fun seed phrase, then convert to Solana CLI format.

### Program Keypair

Copy `program-keypair.json` from USB backup to `keys/` directory.

### Buyback Wallet

Copy `buyback-wallet.json` from USB backup to `keys/` directory.

## Security Notes

1. **Never share private keys** — only share public addresses
2. **Never commit `.json` files** — they are gitignored
3. **Keep backups in separate physical locations**
4. **Test recovery** before mainnet deployment
