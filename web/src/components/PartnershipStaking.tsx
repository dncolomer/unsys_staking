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
  onStake: (amount: number) => Promise<void>;
  onUnstake: () => Promise<void>;
  onClaimReferral: () => Promise<void>;
  onClose: () => Promise<void>;
}

// Tier thresholds: 1M/2M/5M UNSYS tokens
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
  onClose,
}) => {
  const { connected } = useWallet();
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);

  const hasStake = stake?.isInitialized && stake.stakedAmount > 0n;
  // PDA exists but is empty (was unstaked) - needs to be closed before re-staking
  const hasEmptyPda =
    stake !== null && !stake.isInitialized && stake.stakedAmount === 0n;
  const tierInfo = TIER_INFO.find((t) => t.tier === stake?.tier);
  const hasReferralBalance = stake && stake.referralBalance > 0n;

  const handleStake = async () => {
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) return;

    setLoading(true);
    try {
      await onStake(parsedAmount);
      setAmount("");
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

  const handleClose = async () => {
    setLoading(true);
    try {
      await onClose();
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

      {/* Tier info - clickable to auto-fill amount */}
      <div className="grid grid-cols-3 gap-2 mb-6">
        {TIER_INFO.map((info) => {
          const tierAmount = info.min / 10 ** UNSYS_DECIMALS;
          const isSelected = amount === tierAmount.toString();
          const isCurrentTier = stake?.tier === info.tier;

          return (
            <button
              key={info.tier}
              type="button"
              onClick={() => !hasStake && setAmount(tierAmount.toString())}
              disabled={hasStake}
              className={`rounded-lg p-3 border text-left transition-all ${
                isCurrentTier
                  ? "bg-purple-900/30 border-purple-500"
                  : isSelected
                    ? "bg-purple-900/20 border-purple-400"
                    : "bg-gray-900 border-gray-700 hover:border-purple-500/50 hover:bg-gray-800"
              } ${!hasStake ? "cursor-pointer" : "cursor-default"}`}
            >
              <div className="text-sm font-semibold text-white">
                {info.label}
              </div>
              <div className="text-xs text-gray-400">
                {formatUnsys(info.min)}+ UNSYS
              </div>
              <div className="text-xs text-purple-400">{info.share} share</div>
            </button>
          );
        })}
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
      ) : hasEmptyPda ? (
        <div className="space-y-4">
          <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-4">
            <p className="text-sm text-yellow-300">
              You have an empty partnership account from a previous stake. Close
              it first to reclaim rent, then you can stake again.
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={loading}
            className="w-full bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
          >
            {loading ? "Processing..." : "Close Empty Account"}
          </button>
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
