"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import { fetchGlobalConfig, GlobalConfig } from "@/lib/program";

export function useGlobalConfig() {
  const { connection } = useConnection();
  const [config, setConfig] = useState<GlobalConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const data = await fetchGlobalConfig(connection);
        if (!cancelled) {
          setConfig(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    // Refresh every 30 seconds
    const interval = setInterval(load, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [connection]);

  return {
    config,
    loading,
    error,
    refetch: () => fetchGlobalConfig(connection).then(setConfig),
  };
}
