# UNSYS Staking Admin CLI

Command-line interface for administering the UNSYS Staking Program.

## Installation

```bash
cd cli
npm install
```

## Usage

```bash
# Run directly with ts-node
npx ts-node src/index.ts <command> [options]

# Or build and run
npm run build
node dist/index.js <command> [options]
```

## Global Options

| Option                    | Description                                 | Default                  |
| ------------------------- | ------------------------------------------- | ------------------------ |
| `-n, --network <network>` | Network to use (`devnet` or `mainnet-beta`) | `devnet`                 |
| `-k, --keypair <path>`    | Path to admin keypair file                  | `keys/admin-wallet.json` |

## Commands

### Info Commands

```bash
# Show program configuration
unsys-admin info

# Show partner stake info
unsys-admin partner <address>
```

### Revenue Commands

```bash
# Deposit USDC to dividend pool (amount in smallest units, e.g., 1000000 = 1 USDC)
unsys-admin deposit-revenue <amount>

# Deposit referral revenue for a specific partner
unsys-admin deposit-referral <partner-address> <amount>
```

### Legacy OMEGA Commands

```bash
# Register a legacy holder with tier (1, 2, or 3)
unsys-admin register-legacy <holder-address> <tier>

# Revoke legacy partnership
unsys-admin revoke-legacy <holder-address>
```

### Data Provider Commands

```bash
# Validate (activate) a data provider
unsys-admin validate-provider <address>

# Deactivate a data provider
unsys-admin deactivate-provider <address>
```

### Admin Transfer Commands

```bash
# Propose a new admin
unsys-admin propose-admin <new-admin-address>

# Accept admin transfer (run as new admin)
unsys-admin accept-admin

# Cancel pending admin transfer
unsys-admin cancel-admin
```

### Emergency Commands

```bash
# Pause the program (blocks all operations)
unsys-admin pause

# Unpause the program
unsys-admin unpause
```

### Initialization

```bash
# Initialize the program (one-time setup)
unsys-admin init --network mainnet-beta
```

## Examples

### Mainnet Operations

```bash
# Check program status on mainnet
npx ts-node src/index.ts info --network mainnet-beta

# Deposit 100 USDC to dividend pool
npx ts-node src/index.ts deposit-revenue 100000000 --network mainnet-beta

# Register a legacy holder at tier 2
npx ts-node src/index.ts register-legacy <wallet> 2 --network mainnet-beta
```

### Using a Custom Keypair

```bash
npx ts-node src/index.ts info --keypair /path/to/keypair.json
```

## Security Notes

1. Always verify the network before executing commands
2. The CLI will show transaction details before sending
3. Keep your admin keypair secure
4. Consider using a hardware wallet for mainnet operations
