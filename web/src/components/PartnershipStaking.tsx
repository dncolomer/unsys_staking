"use client";

import { FC, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PartnershipStake } from "@/lib/program";
import {
  formatUnsys,
  formatUsdc,
  PARTNERSHIP_TIER_1,
  PARTNERSHIP_TIER_2,
  PARTNERSHIP_TIER_3,
  UNSYS_DECIMALS,
} from "@/lib/constants";

interface Props {
  stake: PartnershipStake | null;
  onStake: (amount: number, referrer?: string) => Promise<void>;
  onUnstake: () => Promise<void>;
  onClaimReferral: () => Promise<void>;
}

const TIER_INFO = [
  { tier: 1, min: PARTNERSHIP_TIER_1, share: "10%", label: "Bronze" },
  { tier: 2, min: PARTNERSHIP_TIER_2, share: "30%", label: "Silver" },
  { tier: 3, min: PARTNERSHIP_TIER_3, share: "50%", label: "Gold" },
];

export const PartnershipStaking: FC<Props> = ({
  stake,
  onStake,
  onUnstake,
  onClaimReferral,
}) => {
  const { connected } = useWallet();
  const [amount, setAmount] = useState("");
  const [referrer, setReferrer] = useState("");
  const [loading, setLoading] = useState(false);

  const hasStake = stake?.isInitialized && stake.stakedAmount > 0n;
  const tierInfo = TIER_INFO.find((t) => t.tier === stake?.tier);
  const hasReferralBalance = stake && stake.referralBalance > 0n;

  const handleStake = async () => {
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) return;

    setLoading(true);
    try {
      await onStake(parsedAmount, referrer || undefined);
      setAmount("");
      setReferrer("");
    } finally {
      setLoading(false);
    }
  };

  const handleUnstake = async () => {
    setLoading(true);
    try {
      await onUnstake();
    } finally {
      setLoading(false);
    }
  };

  const handleClaimReferral = async () => {
    setLoading(true);
    try {
      await onClaimReferral();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      id="partnership"
      className="bg-gray-800 rounded-xl p-6 border border-gray-700"
    >
      <h2 className="text-xl font-bold text-white mb-4">Partnership Staking</h2>
      <p className="text-gray-400 text-sm mb-6">
        Become a partner and earn referral revenue. Higher tiers unlock greater
        revenue share.
      </p>

      {/* Tier info */}
      <div className="grid grid-cols-3 gap-2 mb-6">
        {TIER_INFO.map((info) => (
          <div
            key={info.tier}
            className={`rounded-lg p-3 border ${
              stake?.tier === info.tier
                ? "bg-purple-900/30 border-purple-500"
                : "bg-gray-900 border-gray-700"
            }`}
          >
            <div className="text-sm font-semibold text-white">{info.label}</div>
            <div className="text-xs text-gray-400">
              {formatUnsys(info.min)}+ UNSYS
            </div>
            <div className="text-xs text-purple-400">{info.share} share</div>
          </div>
        ))}
      </div>

      {!connected ? (
        <div className="text-center py-8 text-gray-500">
          Connect your wallet to stake
        </div>
      ) : hasStake ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-900 rounded-lg p-4">
              <p className="text-sm text-gray-400">Staked Amount</p>
              <p className="text-lg font-bold text-white">
                {formatUnsys(stake.stakedAmount)} UNSYS
              </p>
            </div>
            <div className="bg-gray-900 rounded-lg p-4">
              <p className="text-sm text-gray-400">Current Tier</p>
              <p className="text-lg font-bold text-purple-400">
                {tierInfo?.label || "None"} ({tierInfo?.share || "0%"})
              </p>
            </div>
          </div>

          {stake.referrer && (
            <div className="bg-gray-900 rounded-lg p-4">
              <p className="text-sm text-gray-400">Referred By</p>
              <p className="text-sm font-mono text-gray-300 truncate">
                {stake.referrer.toBase58()}
              </p>
            </div>
          )}

          {hasReferralBalance && (
            <div className="bg-purple-900/30 border border-purple-500/50 rounded-lg p-4">
              <p className="text-sm text-purple-300">Referral Balance</p>
              <p className="text-xl font-bold text-white">
                {formatUsdc(stake.referralBalance)} USDC
              </p>
              <button
                onClick={handleClaimReferral}
                disabled={loading}
                className="mt-3 w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
              >
                {loading ? "Processing..." : "Claim Referral"}
              </button>
            </div>
          )}

          {!hasReferralBalance && (
            <button
              onClick={handleUnstake}
              disabled={loading}
              className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              {loading ? "Processing..." : "Unstake & Leave Partnership"}
            </button>
          )}

          {hasReferralBalance && (
            <p className="text-sm text-yellow-500 text-center">
              Claim referral balance before unstaking
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Amount (UNSYS) - Min 1,000,000
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1000000"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Referrer Address (Optional)
            </label>
            <input
              type="text"
              value={referrer}
              onChange={(e) => setReferrer(e.target.value)}
              placeholder="Solana wallet address"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 font-mono text-sm"
            />
          </div>

          <button
            onClick={handleStake}
            disabled={loading || !amount}
            className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
          >
            {loading ? "Processing..." : "Become Partner"}
          </button>
        </div>
      )}
    </div>
  );
};
