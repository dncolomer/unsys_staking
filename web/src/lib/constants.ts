import { PublicKey } from "@solana/web3.js";

// Program addresses from mainnet deployment
export const PROGRAM_ID = new PublicKey(
  "GSxEFVkssh6trQ97WZBsMGs1iahdJ6Z2fSPjQ617nKLN",
);

export const GLOBAL_CONFIG_PDA = new PublicKey(
  "82tAZJHT86kSZv4EP5XuCaXUeijfJLL6uRwpRLzHmem",
);

// Token mints
export const UNSYS_MINT = new PublicKey(
  "Dza3Bey5tvyYiPgcGRKoXKU6rNrdoNrWNVmjqePcpump",
);

export const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);

// Token programs
export const TOKEN_2022_PROGRAM_ID = new PublicKey(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

// Vaults
export const UNSYS_VAULT = new PublicKey(
  "9D8ibo7Zw7Zs6psMkWdM58b4NoLXGAV1KTq93grnuDTo",
);

export const USDC_VAULT = new PublicKey(
  "6Ni6ovoovqT3pYpNvnReeFM6e9zzC5SNun1ziCC3z3Zj",
);

// UNSYS token decimals
export const UNSYS_DECIMALS = 6;
export const USDC_DECIMALS = 6;

// Staking tiers (in raw token units - UNSYS has 6 decimals)
// 1M UNSYS = 1_000_000 * 10^6 = 1_000_000_000_000 raw
export const PARTNERSHIP_TIER_1 = 1_000_000_000_000; // 1M UNSYS
export const PARTNERSHIP_TIER_2 = 2_000_000_000_000; // 2M UNSYS
export const PARTNERSHIP_TIER_3 = 5_000_000_000_000; // 5M UNSYS
export const DATA_PROVIDER_MIN = 5_000_000_000_000; // 5M UNSYS

// Lock period multipliers (basis points)
export const LOCK_MULTIPLIERS: Record<number, number> = {
  3: 11000, // 1.1x
  6: 12500, // 1.25x
  12: 15000, // 1.5x
};

// Format helpers
export function formatUnsys(amount: number | bigint): string {
  const num = typeof amount === "bigint" ? Number(amount) : amount;
  return (num / 10 ** UNSYS_DECIMALS).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

export function formatUsdc(amount: number | bigint): string {
  const num = typeof amount === "bigint" ? Number(amount) : amount;
  return (num / 10 ** USDC_DECIMALS).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}
