import {
  BaseMessageSignerWalletAdapter,
  WalletName,
  WalletReadyState,
  WalletConnectionError,
  WalletDisconnectionError,
  WalletNotConnectedError,
  WalletNotReadyError,
  WalletPublicKeyError,
  WalletSignMessageError,
  WalletSignTransactionError,
  type WalletError,
} from "@solana/wallet-adapter-base";
import type {
  SendOptions,
  Transaction,
  TransactionSignature,
  VersionedTransaction,
} from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

interface OkxWalletSolana {
  isOkxWallet?: boolean;
  publicKey?: { toBytes(): Uint8Array };
  isConnected?: boolean;
  connect(): Promise<{ publicKey: { toBytes(): Uint8Array } }>;
  disconnect(): Promise<void>;
  signTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T
  ): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[]
  ): Promise<T[]>;
  signMessage(message: Uint8Array): Promise<{ signature: Uint8Array }>;
  signAndSendTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T,
    options?: SendOptions
  ): Promise<{ signature: TransactionSignature }>;
  on(event: string, callback: (...args: unknown[]) => void): void;
  off(event: string, callback: (...args: unknown[]) => void): void;
}

interface OkxWalletWindow extends Window {
  okxwallet?: {
    solana?: OkxWalletSolana;
  };
}

declare const window: OkxWalletWindow;

export const OkxWalletName = "OKX Wallet" as WalletName<"OKX Wallet">;

export class OkxWalletAdapter extends BaseMessageSignerWalletAdapter {
  name = OkxWalletName;
  url = "https://www.okx.com/web3";
  icon =
    "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iOCIgZmlsbD0iYmxhY2siLz4KPHBhdGggZD0iTTEyLjY2NjcgOUg5LjMzMzMzQzkuMTQ5MjQgOSA5IDkuMTQ5MjQgOSA5LjMzMzMzVjEyLjY2NjdDOSAxMi44NTA4IDkuMTQ5MjQgMTMgOS4zMzMzMyAxM0gxMi42NjY3QzEyLjg1MDggMTMgMTMgMTIuODUwOCAxMyAxMi42NjY3VjkuMzMzMzNDMTMgOS4xNDkyNCAxMi44NTA4IDkgMTIuNjY2NyA5WiIgZmlsbD0id2hpdGUiLz4KPHBhdGggZD0iTTE4LjY2NjcgMTNIMTUuMzMzM0MxNS4xNDkyIDEzIDE1IDEzLjE0OTIgMTUgMTMuMzMzM1YxOC42NjY3QzE1IDE4Ljg1MDggMTUuMTQ5MiAxOSAxNS4zMzMzIDE5SDE4LjY2NjdDMTguODUwOCAxOSAxOSAxOC44NTA4IDE5IDE4LjY2NjdWMTMuMzMzM0MxOSAxMy4xNDkyIDE4Ljg1MDggMTMgMTguNjY2NyAxM1oiIGZpbGw9IndoaXRlIi8+CjxwYXRoIGQ9Ik0xMi42NjY3IDE5SDkuMzMzMzNDOS4xNDkyNCAxOSA5IDE5LjE0OTIgOSAxOS4zMzMzVjIyLjY2NjdDOSAyMi44NTA4IDkuMTQ5MjQgMjMgOS4zMzMzMyAyM0gxMi42NjY3QzEyLjg1MDggMjMgMTMgMjIuODUwOCAxMyAyMi42NjY3VjE5LjMzMzNDMTMgMTkuMTQ5MiAxMi44NTA4IDE5IDEyLjY2NjcgMTlaIiBmaWxsPSJ3aGl0ZSIvPgo8cGF0aCBkPSJNMjIuNjY2NyA5SDE5LjMzMzNDMTkuMTQ5MiA5IDE5IDkuMTQ5MjQgMTkgOS4zMzMzM1YxMi42NjY3QzE5IDEyLjg1MDggMTkuMTQ5MiAxMyAxOS4zMzMzIDEzSDIyLjY2NjdDMjIuODUwOCAxMyAyMyAxMi44NTA4IDIzIDEyLjY2NjdWOS4zMzMzM0MyMyA5LjE0OTI0IDIyLjg1MDggOSAyMi42NjY3IDlaIiBmaWxsPSJ3aGl0ZSIvPgo8cGF0aCBkPSJNMjIuNjY2NyAxOUgxOS4zMzMzQzE5LjE0OTIgMTkgMTkgMTkuMTQ5MiAxOSAxOS4zMzMzVjIyLjY2NjdDMTkgMjIuODUwOCAxOS4xNDkyIDIzIDE5LjMzMzMgMjNIMjIuNjY2N0MyMi44NTA4IDIzIDIzIDIyLjg1MDggMjMgMjIuNjY2N1YxOS4zMzMzQzIzIDE5LjE0OTIgMjIuODUwOCAxOSAyMi42NjY3IDE5WiIgZmlsbD0id2hpdGUiLz4KPC9zdmc+" as const;

  readonly supportedTransactionVersions = new Set(["legacy", 0] as const);

  private _connecting: boolean;
  private _wallet: OkxWalletSolana | null;
  private _publicKey: PublicKey | null;
  private _readyState: WalletReadyState =
    typeof window === "undefined" || typeof document === "undefined"
      ? WalletReadyState.Unsupported
      : WalletReadyState.NotDetected;

  constructor() {
    super();
    this._connecting = false;
    this._wallet = null;
    this._publicKey = null;

    if (this._readyState !== WalletReadyState.Unsupported) {
      this._checkReadyState();

      if (typeof document !== "undefined") {
        const onReadyStateChange = () => {
          this._checkReadyState();
        };
        // OKX wallet may inject after page load
        if (document.readyState === "complete") {
          setTimeout(onReadyStateChange, 100);
        } else {
          window.addEventListener("load", onReadyStateChange, { once: true });
        }
      }
    }
  }

  private _checkReadyState() {
    if (typeof window !== "undefined" && window.okxwallet?.solana?.isOkxWallet) {
      this._readyState = WalletReadyState.Installed;
      this.emit("readyStateChange", this._readyState);
    }
  }

  get publicKey(): PublicKey | null {
    return this._publicKey;
  }

  get connecting(): boolean {
    return this._connecting;
  }

  get readyState(): WalletReadyState {
    return this._readyState;
  }

  async connect(): Promise<void> {
    try {
      if (this.connected || this.connecting) return;
      if (this._readyState !== WalletReadyState.Installed)
        throw new WalletNotReadyError();

      this._connecting = true;

      const wallet = window.okxwallet?.solana;
      if (!wallet) throw new WalletNotReadyError();

      let publicKey: PublicKey;
      try {
        const response = await wallet.connect();
        publicKey = new PublicKey(response.publicKey.toBytes());
      } catch (error: unknown) {
        throw new WalletConnectionError(
          error instanceof Error ? error.message : "Unknown error"
        );
      }

      if (!publicKey) throw new WalletPublicKeyError();

      wallet.on("disconnect", this._disconnected);
      wallet.on("accountChanged", this._accountChanged);

      this._wallet = wallet;
      this._publicKey = publicKey;

      this.emit("connect", publicKey);
    } catch (error: unknown) {
      this.emit("error", error as WalletError);
      throw error;
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    const wallet = this._wallet;
    if (wallet) {
      wallet.off("disconnect", this._disconnected);
      wallet.off("accountChanged", this._accountChanged);

      this._wallet = null;
      this._publicKey = null;

      try {
        await wallet.disconnect();
      } catch (error: unknown) {
        this.emit(
          "error",
          new WalletDisconnectionError(
            error instanceof Error ? error.message : "Unknown error"
          )
        );
      }
    }

    this.emit("disconnect");
  }

  async sendTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T,
    _connection: unknown,
    options?: SendOptions
  ): Promise<TransactionSignature> {
    try {
      const wallet = this._wallet;
      if (!wallet) throw new WalletNotConnectedError();

      try {
        const { signature } = await wallet.signAndSendTransaction(
          transaction,
          options
        );
        return signature;
      } catch (error: unknown) {
        throw new WalletSignTransactionError(
          error instanceof Error ? error.message : "Unknown error"
        );
      }
    } catch (error: unknown) {
      this.emit("error", error as WalletError);
      throw error;
    }
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T
  ): Promise<T> {
    try {
      const wallet = this._wallet;
      if (!wallet) throw new WalletNotConnectedError();

      try {
        return await wallet.signTransaction(transaction);
      } catch (error: unknown) {
        throw new WalletSignTransactionError(
          error instanceof Error ? error.message : "Unknown error"
        );
      }
    } catch (error: unknown) {
      this.emit("error", error as WalletError);
      throw error;
    }
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[]
  ): Promise<T[]> {
    try {
      const wallet = this._wallet;
      if (!wallet) throw new WalletNotConnectedError();

      try {
        return await wallet.signAllTransactions(transactions);
      } catch (error: unknown) {
        throw new WalletSignTransactionError(
          error instanceof Error ? error.message : "Unknown error"
        );
      }
    } catch (error: unknown) {
      this.emit("error", error as WalletError);
      throw error;
    }
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    try {
      const wallet = this._wallet;
      if (!wallet) throw new WalletNotConnectedError();

      try {
        const response = await wallet.signMessage(message);
        return response.signature;
      } catch (error: unknown) {
        throw new WalletSignMessageError(
          error instanceof Error ? error.message : "Unknown error"
        );
      }
    } catch (error: unknown) {
      this.emit("error", error as WalletError);
      throw error;
    }
  }

  private _disconnected = () => {
    const wallet = this._wallet;
    if (wallet) {
      wallet.off("disconnect", this._disconnected);
      wallet.off("accountChanged", this._accountChanged);

      this._wallet = null;
      this._publicKey = null;

      this.emit("disconnect");
    }
  };

  private _accountChanged = (...args: unknown[]) => {
    const newPublicKey = args[0] as { toBytes(): Uint8Array } | undefined;
    if (!newPublicKey) {
      // Disconnected
      this._disconnected();
      return;
    }

    const publicKey = new PublicKey(newPublicKey.toBytes());

    if (this._publicKey && !this._publicKey.equals(publicKey)) {
      this._publicKey = publicKey;
      this.emit("connect", publicKey);
    }
  };
}
