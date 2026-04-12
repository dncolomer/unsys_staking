"use client";

import { useCallback, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Header } from "@/components/Header";
import { StatsCard } from "@/components/StatsCard";
import { DividendStaking } from "@/components/DividendStaking";
import { PartnershipStaking } from "@/components/PartnershipStaking";
import { DataProviderStaking } from "@/components/DataProviderStaking";
import { useGlobalConfig } from "@/hooks/useGlobalConfig";
import { useUserStakes } from "@/hooks/useUserStakes";
import { formatUnsys, formatUsdc } from "@/lib/constants";
import {
  createStakeDividendsTransaction,
  createUnstakeDividendsTransaction,
  createClaimDividendsTransaction,
  createStakePartnershipTransaction,
  createUnstakePartnershipTransaction,
  createClaimReferralTransaction,
  createClosePartnershipStakeTransaction,
  createStakeDataProviderTransaction,
  createUnstakeDataProviderTransaction,
} from "@/lib/transactions";

export default function Home() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const {
    config,
    loading: configLoading,
    refetch: refetchConfig,
  } = useGlobalConfig();
  const {
    dividendStake,
    partnershipStake,
    dataProviderStake,
    refetch: refetchStakes,
  } = useUserStakes();

  const [txStatus, setTxStatus] = useState<string | null>(null);

  const handleStakeDividends = useCallback(
    async (amount: number, lockMonths: number) => {
      if (!publicKey) return;

      try {
        setTxStatus("Building transaction...");
        const tx = await createStakeDividendsTransaction(
          connection,
          publicKey,
          amount,
          lockMonths,
        );

        setTxStatus("Please approve the transaction in your wallet...");
        const signature = await sendTransaction(tx, connection);

        setTxStatus("Confirming transaction...");
        await connection.confirmTransaction(signature, "confirmed");

        setTxStatus("Success!");
        await Promise.all([refetchConfig(), refetchStakes()]);
        setTimeout(() => setTxStatus(null), 3000);
      } catch (err: any) {
        console.error("Stake error:", err);
        setTxStatus(`Error: ${err.message}`);
        setTimeout(() => setTxStatus(null), 5000);
      }
    },
    [connection, publicKey, sendTransaction, refetchConfig, refetchStakes],
  );

  const handleUnstakeDividends = useCallback(async () => {
    if (!publicKey) return;

    try {
      setTxStatus("Building transaction...");
      const tx = await createUnstakeDividendsTransaction(connection, publicKey);

      setTxStatus("Please approve the transaction in your wallet...");
      const signature = await sendTransaction(tx, connection);

      setTxStatus("Confirming transaction...");
      await connection.confirmTransaction(signature, "confirmed");

      setTxStatus("Success!");
      await Promise.all([refetchConfig(), refetchStakes()]);
      setTimeout(() => setTxStatus(null), 3000);
    } catch (err: any) {
      console.error("Unstake error:", err);
      setTxStatus(`Error: ${err.message}`);
      setTimeout(() => setTxStatus(null), 5000);
    }
  }, [connection, publicKey, sendTransaction, refetchConfig, refetchStakes]);

  const handleClaimDividends = useCallback(async () => {
    if (!publicKey) return;

    try {
      setTxStatus("Building transaction...");
      const tx = await createClaimDividendsTransaction(connection, publicKey);

      setTxStatus("Please approve the transaction in your wallet...");
      const signature = await sendTransaction(tx, connection);

      setTxStatus("Confirming transaction...");
      await connection.confirmTransaction(signature, "confirmed");

      setTxStatus("Success!");
      await Promise.all([refetchConfig(), refetchStakes()]);
      setTimeout(() => setTxStatus(null), 3000);
    } catch (err: any) {
      console.error("Claim error:", err);
      setTxStatus(`Error: ${err.message}`);
      setTimeout(() => setTxStatus(null), 5000);
    }
  }, [connection, publicKey, sendTransaction, refetchConfig, refetchStakes]);

  const handleStakePartnership = useCallback(
    async (amount: number) => {
      if (!publicKey) return;

      try {
        setTxStatus("Building transaction...");
        const tx = await createStakePartnershipTransaction(
          connection,
          publicKey,
          amount,
        );

        setTxStatus("Please approve the transaction in your wallet...");
        const signature = await sendTransaction(tx, connection);

        setTxStatus("Confirming transaction...");
        await connection.confirmTransaction(signature, "confirmed");

        setTxStatus("Success!");
        await refetchStakes();
        setTimeout(() => setTxStatus(null), 3000);
      } catch (err: any) {
        console.error("Partnership stake error:", err);
        setTxStatus(`Error: ${err.message}`);
        setTimeout(() => setTxStatus(null), 5000);
      }
    },
    [connection, publicKey, sendTransaction, refetchStakes],
  );

  const handleUnstakePartnership = useCallback(async () => {
    if (!publicKey) return;

    try {
      setTxStatus("Building transaction...");
      const tx = await createUnstakePartnershipTransaction(
        connection,
        publicKey,
      );

      setTxStatus("Please approve the transaction in your wallet...");
      const signature = await sendTransaction(tx, connection);

      setTxStatus("Confirming transaction...");
      await connection.confirmTransaction(signature, "confirmed");

      setTxStatus("Success!");
      await refetchStakes();
      setTimeout(() => setTxStatus(null), 3000);
    } catch (err: any) {
      console.error("Unstake partnership error:", err);
      setTxStatus(`Error: ${err.message}`);
      setTimeout(() => setTxStatus(null), 5000);
    }
  }, [connection, publicKey, sendTransaction, refetchStakes]);

  const handleClaimReferral = useCallback(async () => {
    if (!publicKey) return;

    try {
      setTxStatus("Building transaction...");
      const tx = await createClaimReferralTransaction(connection, publicKey);

      setTxStatus("Please approve the transaction in your wallet...");
      const signature = await sendTransaction(tx, connection);

      setTxStatus("Confirming transaction...");
      await connection.confirmTransaction(signature, "confirmed");

      setTxStatus("Success!");
      await refetchStakes();
      setTimeout(() => setTxStatus(null), 3000);
    } catch (err: any) {
      console.error("Claim referral error:", err);
      setTxStatus(`Error: ${err.message}`);
      setTimeout(() => setTxStatus(null), 5000);
    }
  }, [connection, publicKey, sendTransaction, refetchStakes]);

  const handleClosePartnership = useCallback(async () => {
    if (!publicKey) return;

    try {
      setTxStatus("Building transaction...");
      const tx = await createClosePartnershipStakeTransaction(
        connection,
        publicKey,
      );

      setTxStatus("Please approve the transaction in your wallet...");
      const signature = await sendTransaction(tx, connection);

      setTxStatus("Confirming transaction...");
      await connection.confirmTransaction(signature, "confirmed");

      setTxStatus("Account closed! You can now stake again.");
      await refetchStakes();
      setTimeout(() => setTxStatus(null), 3000);
    } catch (err: any) {
      console.error("Close partnership error:", err);
      setTxStatus(`Error: ${err.message}`);
      setTimeout(() => setTxStatus(null), 5000);
    }
  }, [connection, publicKey, sendTransaction, refetchStakes]);

  const handleStakeDataProvider = useCallback(
    async (amount: number) => {
      if (!publicKey) return;

      try {
        setTxStatus("Building transaction...");
        const tx = await createStakeDataProviderTransaction(
          connection,
          publicKey,
          amount,
        );

        setTxStatus("Please approve the transaction in your wallet...");
        const signature = await sendTransaction(tx, connection);

        setTxStatus("Confirming transaction...");
        await connection.confirmTransaction(signature, "confirmed");

        setTxStatus("Success! Awaiting admin validation.");
        await refetchStakes();
        setTimeout(() => setTxStatus(null), 3000);
      } catch (err: any) {
        console.error("Data provider stake error:", err);
        setTxStatus(`Error: ${err.message}`);
        setTimeout(() => setTxStatus(null), 5000);
      }
    },
    [connection, publicKey, sendTransaction, refetchStakes],
  );

  const handleUnstakeDataProvider = useCallback(async () => {
    if (!publicKey) return;

    try {
      setTxStatus("Building transaction...");
      const tx = await createUnstakeDataProviderTransaction(
        connection,
        publicKey,
      );

      setTxStatus("Please approve the transaction in your wallet...");
      const signature = await sendTransaction(tx, connection);

      setTxStatus("Confirming transaction...");
      await connection.confirmTransaction(signature, "confirmed");

      setTxStatus("Success!");
      await refetchStakes();
      setTimeout(() => setTxStatus(null), 3000);
    } catch (err: any) {
      console.error("Unstake data provider error:", err);
      setTxStatus(`Error: ${err.message}`);
      setTimeout(() => setTxStatus(null), 5000);
    }
  }, [connection, publicKey, sendTransaction, refetchStakes]);

  return (
    <div className="min-h-screen">
      <Header />

      {/* Transaction status toast */}
      {txStatus && (
        <div className="fixed top-20 right-4 z-50 bg-gray-800 border border-gray-700 rounded-lg p-4 shadow-xl max-w-sm">
          <p
            className={`text-sm ${txStatus.startsWith("Error") ? "text-red-400" : txStatus === "Success!" ? "text-green-400" : "text-gray-300"}`}
          >
            {txStatus}
          </p>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <StatsCard
            title="Total Staked Shares"
            value={
              configLoading
                ? "Loading..."
                : formatUnsys(config?.totalDividendShares || 0n)
            }
            subtitle="Dividend pool shares"
          />
          <StatsCard
            title="Current Dividend Pool"
            value={
              configLoading
                ? "Loading..."
                : `${formatUsdc(config?.epochDividendPool || 0n)} USDC`
            }
            subtitle={`Epoch ${config?.dividendEpoch?.toString() || "0"}`}
            note="Refilled monthly with the overall platform distributable revenue."
          />
        </div>

        {/* Program status */}
        {config?.paused && (
          <div className="bg-red-900/30 border border-red-500/50 rounded-lg p-4 mb-8">
            <p className="text-red-300 font-semibold">
              Program is currently paused. Staking and claiming are disabled.
            </p>
          </div>
        )}

        {/* Staking sections */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <DividendStaking
            stake={dividendStake}
            config={config}
            onStake={handleStakeDividends}
            onUnstake={handleUnstakeDividends}
            onClaim={handleClaimDividends}
          />
          <PartnershipStaking
            stake={partnershipStake}
            onStake={handleStakePartnership}
            onUnstake={handleUnstakePartnership}
            onClaimReferral={handleClaimReferral}
            onClose={handleClosePartnership}
          />
        </div>

        {/* Data Provider section */}
        <div className="mt-8">
          <DataProviderStaking
            stake={dataProviderStake}
            onStake={handleStakeDataProvider}
            onUnstake={handleUnstakeDataProvider}
          />
        </div>

        {/* Footer */}
        <footer className="mt-16 py-8 border-t border-gray-800 text-center text-gray-500 text-sm">
          <p>
            Program ID:{" "}
            <code className="text-gray-400">
              GSxEFVkssh6trQ97WZBsMGs1iahdJ6Z2fSPjQ617nKLN
            </code>
          </p>
          <p className="mt-2">
            Built on Solana |{" "}
            <a
              href="https://github.com/dncolomer/unsys_staking"
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-400 hover:text-purple-300"
            >
              GitHub
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}
