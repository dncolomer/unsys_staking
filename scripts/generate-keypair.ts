/**
 * Generate a new Solana keypair and save it in CLI format
 *
 * Usage:
 *   npx ts-node scripts/generate-keypair.ts <output-file>
 *
 * Example:
 *   npx ts-node scripts/generate-keypair.ts keys/buyback-wallet.json
 */

import { Keypair } from "@solana/web3.js";
import * as fs from "fs";

function main() {
  const args = process.argv.slice(2);

  if (args.length !== 1) {
    console.error(
      "Usage: npx ts-node scripts/generate-keypair.ts <output-file>",
    );
    console.error("\nExample:");
    console.error(
      "  npx ts-node scripts/generate-keypair.ts keys/buyback-wallet.json",
    );
    process.exit(1);
  }

  const outputPath = args[0];

  // Generate new keypair
  const keypair = Keypair.generate();

  console.log("Generated new keypair:");
  console.log(`  Public Key: ${keypair.publicKey.toBase58()}`);

  // Save to Solana CLI format (JSON array of bytes)
  const jsonContent = JSON.stringify(Array.from(keypair.secretKey));
  fs.writeFileSync(outputPath, jsonContent);

  console.log(`\nSaved to: ${outputPath}`);
  console.log("\nIMPORTANT: Back up this file to your USB drive!");
  console.log("There is no seed phrase - the file IS the backup.");
}

main();
