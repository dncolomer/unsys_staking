"use client";

import { FC } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export const Header: FC = () => {
  return (
    <header className="bg-gray-900 border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-blue-500 rounded-lg" />
            <span className="text-xl font-bold text-white">UNSYS Staking</span>
          </div>
          <nav className="hidden md:flex space-x-8">
            <a
              href="#dividend"
              className="text-gray-300 hover:text-white transition-colors"
            >
              Dividend Staking
            </a>
            <a
              href="#partnership"
              className="text-gray-300 hover:text-white transition-colors"
            >
              Partnership
            </a>
            <a
              href="#data-provider"
              className="text-gray-300 hover:text-white transition-colors"
            >
              Data Provider
            </a>
          </nav>
          <WalletMultiButton className="!bg-purple-600 hover:!bg-purple-700 !transition-colors" />
        </div>
      </div>
    </header>
  );
};
