import type { Connection, Transaction, TransactionSignature } from "@solana/web3.js";

type SendTransaction = (
  transaction: Transaction,
  connection: Connection,
) => Promise<TransactionSignature>;

/**
 * Phantom's in-app browser usually cannot open the websocket that
 * `connection.confirmTransaction()` subscribes on. Poll status over HTTP so a
 * claim that already landed is not reported as a failure.
 */
export async function sendAndConfirm(
  connection: Connection,
  tx: Transaction,
  sendTransaction: SendTransaction,
  onConfirming?: () => void,
): Promise<string> {
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;

  const signature = await sendTransaction(tx, connection);
  onConfirming?.();
  if (!signature) {
    throw new Error(
      "The wallet did not return a signature. Refresh before trying again in case the transaction already went through.",
    );
  }

  const started = Date.now();
  const timeoutMs = 90_000;
  while (Date.now() - started < timeoutMs) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const status = value[0];
    if (status?.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
    }
    if (
      status?.confirmationStatus === "confirmed" ||
      status?.confirmationStatus === "finalized"
    ) {
      return signature;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error(
    "Timed out waiting for confirmation. Refresh before trying again in case it already succeeded.",
  );
}

export function txErrorMessage(err: unknown): string {
  if (!err || typeof err !== "object") return "Transaction failed";
  const value = err as {
    message?: string;
    logs?: string[];
    error?: { message?: string; logs?: string[] };
  };
  const logs = value.logs ?? value.error?.logs ?? [];
  const anchor = logs.find((line) => line.includes("Error Message:"));
  const detail = anchor
    ? anchor.slice(anchor.indexOf("Error Message:") + "Error Message:".length).trim()
    : logs.find((line) => /insufficient lamports|insufficient funds/i.test(line));
  const message = value.message || value.error?.message || "Transaction failed";
  const combined = `${message} ${detail ?? ""}`;
  if (/insufficient lamports|insufficient funds/i.test(combined)) {
    return "Not enough SOL to pay the fee and open a USDC account. Add a little SOL, then try again.";
  }
  if (detail && !message.includes(detail)) return `${message}: ${detail}`;
  return message;
}
