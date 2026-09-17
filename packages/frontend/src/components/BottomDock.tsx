'use client';

import { useState } from 'react';
import ActiveOrders from './ActiveOrders';
import TradeHistory from './TradeHistory';
import Portfolio from './Portfolio';
import LedgerAuditTrail from './LedgerAuditTrail';
import ReportsExport from './ReportsExport';
import { ListFilter, History, Wallet, FileSpreadsheet, Download, LucideIcon } from 'lucide-react';

type TabKey = 'orders' | 'trades' | 'portfolio' | 'ledger' | 'reports';

export default function BottomDock() {
  const [activeTab, setActiveTab] = useState<TabKey>('orders');

  const tabs: { key: TabKey; label: string; icon: LucideIcon }[] = [
    { key: 'orders', label: 'Open Orders', icon: ListFilter },
    { key: 'trades', label: 'Trade History', icon: History },
    { key: 'portfolio', label: 'Balances & Portfolio', icon: Wallet },
    { key: 'ledger', label: 'Ledger Audit Trail', icon: FileSpreadsheet },
    { key: 'reports', label: 'Data & Reports', icon: Download },
  ];

  return (
    <div className="flex flex-col h-full bg-[#131722] border-t border-[#1E222D]">
      {/* Tab Navigation Header */}
      <div className="flex items-center gap-1 px-2 border-b border-[#1E222D] bg-[#0B0E14] h-9">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t text-xs font-medium transition-all ${
                isActive
                  ? 'bg-[#131722] text-[#2962FF] border-t-2 border-[#2962FF]'
                  : 'text-[#787B86] hover:text-[#D1D4DC] hover:bg-[#131722]/50'
              }`}
            >
              <Icon size={13} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content Panel */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'orders' && <ActiveOrders />}
        {activeTab === 'trades' && <TradeHistory />}
        {activeTab === 'portfolio' && <Portfolio />}
        {activeTab === 'ledger' && <LedgerAuditTrail />}
        {activeTab === 'reports' && <ReportsExport />}
      </div>
    </div>
  );
}
