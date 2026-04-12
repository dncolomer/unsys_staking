"use client";

import { FC, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { DividendStake, GlobalConfig } from "@/lib/program";
import { formatUnsys, formatUsdc, LOCK_MULTIPLIERS } from "@/lib/constants";

interface Props {
  stake: DividendStake | null;
  config: GlobalConfig | null;
  onStake: (amount: number, lockMonths: number) => Promise<void>;
  onUnstake: () => Promise<void>;
  onClaim: () => Promise<void>;
}

export const DividendStaking: FC<Props> = ({
  stake,
  config,
  onStake,
  onUnstake,
  onClaim,
}) => {
  const { connected } = useWallet();
  const [amount, setAmount] = useState("");
  const [lockMonths, setLockMonths] = useState(3);
  const [loading, setLoading] = useState(false);

  const hasStake = stake?.isInitialized && stake.amount > 0n;
  const lockExpired = stake
    ? Date.now() / 1000 >= Number(stake.lockEnd)
    : false;

  const canClaim =
    hasStake &&
    config &&
    stake.lastClaimEpoch < config.dividendEpoch &&
    config.epochDividendSnapshot > 0n;

  const estimatedReward =
    hasStake && config && config.totalDividendShares > 0n
      ? (Number(stake.shares) * Number(config.epochDividendSnapshot)) /
        Number(config.totalDividendShares)
      : 0;

  const handleStake = async () => {
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) return;

    setLoading(true);
    try {
      await onStake(parsedAmount, lockMonths);
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

  const handleClaim = async () => {
    setLoading(true);
    try {
      await onClaim();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      id="dividend"
      className="bg-gray-800 rounded-xl p-6 border border-gray-700"
    >
      <h2 className="text-xl font-bold text-white mb-4">Dividend Staking</h2>
      <p className="text-gray-400 text-sm mb-6">
        Stake UNSYS tokens to earn a share of platform revenue. Longer lock
        periods earn higher multipliers.
      </p>

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
                {formatUnsys(stake.amount)} UNSYS
              </p>
            </div>
            <div className="bg-gray-900 rounded-lg p-4">
              <p className="text-sm text-gray-400">Shares</p>
              <p className="text-lg font-bold text-white">
                {formatUnsys(stake.shares)}
              </p>
            </div>
            <div className="bg-gray-900 rounded-lg p-4">
              <p className="text-sm text-gray-400">Multiplier</p>
              <p className="text-lg font-bold text-white">
                {(stake.multiplierBps / 10000).toFixed(2)}x
              </p>
            </div>
            <div className="bg-gray-900 rounded-lg p-4">
              <p className="text-sm text-gray-400">Lock Status</p>
              <p
                className={`text-lg font-bold ${lockExpired ? "text-green-400" : "text-yellow-400"}`}
              >
                {lockExpired
                  ? "Unlocked"
                  : `Locked until ${new Date(Number(stake.lockEnd) * 1000).toLocaleDateString()}`}
              </p>
            </div>
          </div>

          {canClaim && (
            <div className="bg-purple-900/30 border border-purple-500/50 rounded-lg p-4">
              <p className="text-sm text-purple-300">Available to Claim</p>
              <p className="text-xl font-bold text-white">
                ~{formatUsdc(estimatedReward)} USDC
              </p>
              <button
                onClick={handleClaim}
                disabled={loading}
                className="mt-3 w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
              >
                {loading ? "Processing..." : "Claim Dividends"}
              </button>
            </div>
          )}

          {lockExpired && (
            <button
              onClick={handleUnstake}
              disabled={loading}
              className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
            >
              {loading ? "Processing..." : "Unstake All"}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Amount (UNSYS)
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Lock Period
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[3, 6, 12].map((months) => (
                <button
                  key={months}
                  onClick={() => setLockMonths(months)}
                  className={`py-3 px-4 rounded-lg border transition-colors ${
                    lockMonths === months
                      ? "bg-purple-600 border-purple-500 text-white"
                      : "bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-600"
                  }`}
                >
                  <div className="text-sm font-semibold">{months} Months</div>
                  <div className="text-xs opacity-75">
                    {(LOCK_MULTIPLIERS[months] / 10000).toFixed(2)}x
                  </div>
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleStake}
            disabled={loading || !amount}
            className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
          >
            {loading ? "Processing..." : "Stake UNSYS"}
          </button>
        </div>
      )}
    </div>
  );
};
