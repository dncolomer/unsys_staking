"use client";

import { Header } from "@/components/Header";
import { StatsCard } from "@/components/StatsCard";
import { DividendStaking } from "@/components/DividendStaking";
import { PartnershipStaking } from "@/components/PartnershipStaking";
import { useGlobalConfig } from "@/hooks/useGlobalConfig";
import { useUserStakes } from "@/hooks/useUserStakes";
import { formatUnsys, formatUsdc } from "@/lib/constants";

export default function Home() {
  const { config, loading: configLoading } = useGlobalConfig();
  const {
    dividendStake,
    partnershipStake,
    loading: stakesLoading,
  } = useUserStakes();

  // Placeholder handlers - will implement transaction logic
  const handleStakeDividends = async (amount: number, lockMonths: number) => {
    console.log("Stake dividends:", amount, lockMonths);
    alert("Transaction signing coming soon!");
  };

  const handleUnstakeDividends = async () => {
    console.log("Unstake dividends");
    alert("Transaction signing coming soon!");
  };

  const handleClaimDividends = async () => {
    console.log("Claim dividends");
    alert("Transaction signing coming soon!");
  };

  const handleStakePartnership = async (amount: number, referrer?: string) => {
    console.log("Stake partnership:", amount, referrer);
    alert("Transaction signing coming soon!");
  };

  const handleUnstakePartnership = async () => {
    console.log("Unstake partnership");
    alert("Transaction signing coming soon!");
  };

  const handleClaimReferral = async () => {
    console.log("Claim referral");
    alert("Transaction signing coming soon!");
  };

  return (
    <div className="min-h-screen">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
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
          />
          <StatsCard
            title="Legacy Holders"
            value={
              configLoading
                ? "Loading..."
                : config?.totalLegacyHolders?.toString() || "0"
            }
            subtitle="OMEGA migration"
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
