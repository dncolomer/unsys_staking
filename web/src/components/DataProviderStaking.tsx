"use client";

import { FC, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { DataProviderStake } from "@/lib/program";
import {
  formatUnsys,
  DATA_PROVIDER_MIN,
  UNSYS_DECIMALS,
} from "@/lib/constants";

interface Props {
  stake: DataProviderStake | null;
  onStake: (amount: number) => Promise<void>;
  onUnstake: () => Promise<void>;
}

const MIN_STAKE_DISPLAY = DATA_PROVIDER_MIN / 10 ** UNSYS_DECIMALS;

export const DataProviderStaking: FC<Props> = ({
  stake,
  onStake,
  onUnstake,
}) => {
  const { connected } = useWallet();
  const [amount, setAmount] = useState(MIN_STAKE_DISPLAY.toString());
  const [loading, setLoading] = useState(false);

  const hasStake = stake?.isInitialized && stake.stakedAmount > 0n;

  const handleStake = async () => {
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) return;

    setLoading(true);
    try {
      await onStake(parsedAmount);
      setAmount(MIN_STAKE_DISPLAY.toString());
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

  return (
    <div
      id="data-provider"
      className="bg-gray-800 rounded-xl p-6 border border-gray-700"
    >
      <h2 className="text-xl font-bold text-white mb-4">
        Data Provider Registration
      </h2>
      <p className="text-gray-400 text-sm mb-6">
        Register as a data provider by staking{" "}
        {formatUnsys(BigInt(DATA_PROVIDER_MIN))} UNSYS. Data providers supply
        external data to the network and must be validated by an admin before
        becoming active.
      </p>

      {/* Status indicator */}
      <div className="mb-6 p-4 bg-gray-900 rounded-lg border border-gray-700">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-400">Status</span>
          {!hasStake ? (
            <span className="text-yellow-400 text-sm font-medium">
              Not Registered
            </span>
          ) : stake.active ? (
            <span className="text-green-400 text-sm font-medium flex items-center gap-2">
              <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
              Active
            </span>
          ) : (
            <span className="text-orange-400 text-sm font-medium">
              Pending Validation
            </span>
          )}
        </div>
      </div>

      {!connected ? (
        <div className="text-center py-8 text-gray-500">
          Connect your wallet to register
        </div>
      ) : hasStake ? (
        <div className="space-y-4">
          <div className="bg-gray-900 rounded-lg p-4">
            <p className="text-sm text-gray-400">Staked Amount</p>
            <p className="text-lg font-bold text-white">
              {formatUnsys(stake.stakedAmount)} UNSYS
            </p>
          </div>

          {!stake.active && (
            <div className="bg-orange-900/20 border border-orange-500/30 rounded-lg p-4">
              <p className="text-sm text-orange-300">
                Your registration is pending admin validation. Once validated,
                you will be able to provide data to the network.
              </p>
            </div>
          )}

          {stake.active && (
            <div className="bg-green-900/20 border border-green-500/30 rounded-lg p-4">
              <p className="text-sm text-green-300">
                You are an active data provider. You can now submit data to the
                network.
              </p>
            </div>
          )}

          <button
            onClick={handleUnstake}
            disabled={loading || stake.active}
            className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
          >
            {loading ? "Processing..." : "Unstake & Unregister"}
          </button>

          {stake.active && (
            <p className="text-sm text-yellow-500 text-center">
              Contact admin to deactivate before unstaking
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              Amount (UNSYS) - Min {formatUnsys(BigInt(DATA_PROVIDER_MIN))}
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={MIN_STAKE_DISPLAY.toString()}
              min={MIN_STAKE_DISPLAY}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <button
            onClick={handleStake}
            disabled={
              loading || !amount || parseFloat(amount) < MIN_STAKE_DISPLAY
            }
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-semibold py-3 px-4 rounded-lg transition-colors"
          >
            {loading ? "Processing..." : "Register as Data Provider"}
          </button>

          <p className="text-xs text-gray-500 text-center">
            After staking, an admin must validate your registration before you
            can provide data.
          </p>
        </div>
      )}
    </div>
  );
};
