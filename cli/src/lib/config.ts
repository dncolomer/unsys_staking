import { Connection, Keypair, PublicKey, clusterApiUrl } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export type Network = "devnet" | "mainnet-beta";

export interface NetworkConfig {
  programId: PublicKey;
  unsysMint: PublicKey;
  omegaMint: PublicKey;
  usdcMint: PublicKey;
  buybackWallet: PublicKey;
}

// Mainnet configuration
const MAINNET_CONFIG: NetworkConfig = {
  programId: new PublicKey("GSxEFVkssh6trQ97WZBsMGs1iahdJ6Z2fSPjQ617nKLN"),
  unsysMint: new PublicKey("Dza3Bey5tvyYiPgcGRKoXKU6rNrdoNrWNVmjqePcpump"),
  omegaMint: new PublicKey("BaWyD9P8ctkZ6if2umqj7htV91YuuouzUrMFsJh9BAGS"),
  usdcMint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  buybackWallet: new PublicKey("2v1EY1dF7eN4QnHhrat1nCcqDLMnw3twVKmyyQQe4mPF"),
};

// Devnet configuration (load from devnet-addresses.json if exists)
function loadDevnetConfig(): NetworkConfig {
  const devnetPath = path.join(__dirname, "../../../devnet-addresses.json");
  if (fs.existsSync(devnetPath)) {
    const addresses = JSON.parse(fs.readFileSync(devnetPath, "utf-8"));
    return {
      programId: new PublicKey(addresses.programId),
      unsysMint: new PublicKey(addresses.unsysMint),
      omegaMint: new PublicKey(addresses.omegaMint),
      usdcMint: new PublicKey(addresses.usdcMint),
      buybackWallet: new PublicKey(addresses.buybackWallet),
    };
  }
  // Fallback to mainnet config structure with devnet program ID
  return {
    ...MAINNET_CONFIG,
    programId: new PublicKey("GSxEFVkssh6trQ97WZBsMGs1iahdJ6Z2fSPjQ617nKLN"),
  };
}

export function getNetworkConfig(network: Network): NetworkConfig {
  return network === "mainnet-beta" ? MAINNET_CONFIG : loadDevnetConfig();
}

export function getConnection(network: Network): Connection {
  const url =
    network === "mainnet-beta"
      ? clusterApiUrl("mainnet-beta")
      : clusterApiUrl("devnet");
  return new Connection(url, "confirmed");
}

export function loadKeypair(keypairPath?: string): Keypair {
  // Default paths to check
  const pathsToTry = keypairPath
    ? [keypairPath]
    : [
        path.join(__dirname, "../../../keys/admin-wallet.json"),
        path.join(os.homedir(), ".config/solana/id.json"),
      ];

  for (const p of pathsToTry) {
    if (fs.existsSync(p)) {
      const secretKey = JSON.parse(fs.readFileSync(p, "utf-8"));
      return Keypair.fromSecretKey(Uint8Array.from(secretKey));
    }
  }

  throw new Error(
    `Keypair not found. Tried: ${pathsToTry.join(", ")}\n` +
      `Create one with: solana-keygen new -o keys/admin-wallet.json`,
  );
}

export function getGlobalConfigPda(programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global_config_v3")],
    programId,
  );
  return pda;
}
