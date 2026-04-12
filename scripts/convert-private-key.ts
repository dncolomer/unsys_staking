/**
 * Convert a base58 private key (from pump.fun, Phantom, etc.) to Solana CLI format
 *
 * Usage:
 *   npx ts-node scripts/convert-private-key.ts <BASE58_PRIVATE_KEY>
 *
 * Output:
 *   Creates keys/admin-wallet.json in Solana CLI format
 */

import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import * as fs from "fs";
import * as path from "path";

function main() {
  const args = process.argv.slice(2);

  if (args.length !== 1) {
    console.error(
      "Usage: npx ts-node scripts/convert-private-key.ts <BASE58_PRIVATE_KEY>",
    );
    console.error("\nExample:");
    console.error("  npx ts-node scripts/convert-private-key.ts 5KvP3abc...");
    process.exit(1);
  }

  const base58PrivateKey = args[0];

  try {
    // Decode base58 private key
    const privateKeyBytes = bs58.decode(base58PrivateKey);

    // Create keypair from secret key
    const keypair = Keypair.fromSecretKey(privateKeyBytes);

    // Verify public key
    const publicKey = keypair.publicKey.toBase58();
    console.log(`Public Key: ${publicKey}`);

    // Expected public key
    const expectedPubkey = "6HGeNL5852ykqQNiwT6sC5YFu1xBBwvgtVnUWuf5EfEP";

    if (publicKey !== expectedPubkey) {
      console.error(`\nWARNING: Public key does not match expected!`);
      console.error(`  Expected: ${expectedPubkey}`);
      console.error(`  Got:      ${publicKey}`);
      console.error(`\nMake sure you exported the correct private key.`);
      process.exit(1);
    }

    console.log(`\nPublic key matches expected: ${expectedPubkey}`);

    // Save to Solana CLI format (JSON array of bytes)
    const outputPath = path.join(__dirname, "..", "keys", "admin-wallet.json");
    const jsonContent = JSON.stringify(Array.from(privateKeyBytes));

    fs.writeFileSync(outputPath, jsonContent);
    console.log(`\nSaved to: ${outputPath}`);
    console.log("\nDONE! You can now use this keypair with Solana CLI:");
    console.log(`  solana config set --keypair ${outputPath}`);
  } catch (error: any) {
    console.error("Error converting private key:", error.message);
    process.exit(1);
  }
}

main();
