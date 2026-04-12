"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState, useCallback } from "react";
import {
  fetchDividendStake,
  fetchPartnershipStake,
  fetchDataProviderStake,
  DividendStake,
  PartnershipStake,
  DataProviderStake,
} from "@/lib/program";

export function useUserStakes() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();

  const [dividendStake, setDividendStake] = useState<DividendStake | null>(
    null,
  );
  const [partnershipStake, setPartnershipStake] =
    useState<PartnershipStake | null>(null);
  const [dataProviderStake, setDataProviderStake] =
    useState<DataProviderStake | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refetch = useCallback(async () => {
    if (!publicKey) {
      setDividendStake(null);
      setPartnershipStake(null);
      setDataProviderStake(null);
      return;
    }

    try {
      setLoading(true);
      const [div, partner, provider] = await Promise.all([
        fetchDividendStake(connection, publicKey),
        fetchPartnershipStake(connection, publicKey),
        fetchDataProviderStake(connection, publicKey),
      ]);
      setDividendStake(div);
      setPartnershipStake(partner);
      setDataProviderStake(provider);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [connection, publicKey]);

  useEffect(() => {
    refetch();

    // Refresh every 30 seconds
    const interval = setInterval(refetch, 30000);

    return () => clearInterval(interval);
  }, [refetch]);

  return {
    dividendStake,
    partnershipStake,
    dataProviderStake,
    loading,
    error,
    refetch,
  };
}
