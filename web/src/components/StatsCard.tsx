"use client";

import { FC } from "react";

interface StatsCardProps {
  title: string;
  value: string;
  subtitle?: string;
  note?: string;
  icon?: React.ReactNode;
}

export const StatsCard: FC<StatsCardProps> = ({
  title,
  value,
  subtitle,
  note,
  icon,
}) => {
  return (
    <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-400">{title}</p>
          <p className="text-2xl font-bold text-white mt-1">{value}</p>
          {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
          {note && <p className="text-xs text-gray-500 mt-2 italic">{note}</p>}
        </div>
        {icon && (
          <div className="w-12 h-12 bg-purple-600/20 rounded-lg flex items-center justify-center text-purple-400">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
};
