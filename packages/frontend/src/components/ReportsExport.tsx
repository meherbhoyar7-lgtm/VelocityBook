'use client';

import { useState } from 'react';
import { Download, FileSpreadsheet, ShieldAlert, BookOpen, CheckCircle2 } from 'lucide-react';
import { useUserStore } from '@/stores/useUserStore';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function ReportsExport() {
  const selectedSymbol = useUserStore((s) => s.selectedSymbol);
  const userId = useUserStore((s) => s.userId);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [lastDownloaded, setLastDownloaded] = useState<string | null>(null);

  const triggerDownload = async (url: string, filename: string, reportKey: string) => {
    setDownloading(reportKey);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to generate report');
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
      setLastDownloaded(reportKey);
    } catch (err: unknown) {
      console.error('Download error:', err instanceof Error ? err.message : err);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#131722] p-4 text-xs font-sans select-none overflow-y-auto">
      <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#1E222D]">
        <div>
          <h2 className="text-sm font-semibold text-[#D1D4DC]">Institutional Audit & Data Reports</h2>
          <p className="text-[#787B86] text-[11px] mt-0.5">
            Export regulatory-grade CSV and JSON datasets for backtesting, auditing, and reconciliation.
          </p>
        </div>
        {lastDownloaded && (
          <div className="flex items-center gap-1.5 text-emerald-400 text-[11px] bg-emerald-500/10 px-2.5 py-1 rounded">
            <CheckCircle2 size={13} />
            <span>Downloaded {lastDownloaded} successfully</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* 1. Trade Execution Log */}
        <div className="bg-[#1E222D]/60 border border-[#1E222D] rounded-lg p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 rounded bg-[#2962FF]/10 text-[#2962FF]">
                <FileSpreadsheet size={18} />
              </div>
              <div>
                <h3 className="text-xs font-bold text-[#D1D4DC]">Trade Execution Log</h3>
                <span className="text-[10px] text-[#787B86]">{selectedSymbol} Market Fills</span>
              </div>
            </div>
            <p className="text-[#787B86] text-[11px] leading-relaxed mb-4">
              Comprehensive tick records containing Trade IDs, fill prices, quantities, buyer/seller IDs, and microsecond timestamps.
            </p>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-[#1E222D]">
            <button
              onClick={() =>
                triggerDownload(
                  `${API_URL}/api/reports/trades?symbol=${selectedSymbol}&format=csv`,
                  `trades-${selectedSymbol}-${Date.now()}.csv`,
                  'Trades (CSV)'
                )
              }
              disabled={downloading !== null}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded bg-[#2962FF] hover:bg-[#1E4BD8] text-white font-medium transition-colors"
            >
              <Download size={12} />
              <span>{downloading === 'Trades (CSV)' ? 'Generating...' : 'CSV'}</span>
            </button>
            <button
              onClick={() =>
                triggerDownload(
                  `${API_URL}/api/reports/trades?symbol=${selectedSymbol}&format=json`,
                  `trades-${selectedSymbol}-${Date.now()}.json`,
                  'Trades (JSON)'
                )
              }
              disabled={downloading !== null}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded bg-[#2A2E39] hover:bg-[#363A45] text-[#D1D4DC] font-medium transition-colors"
            >
              <Download size={12} />
              <span>{downloading === 'Trades (JSON)' ? 'Generating...' : 'JSON'}</span>
            </button>
          </div>
        </div>

        {/* 2. ACID Ledger Audit Journal */}
        <div className="bg-[#1E222D]/60 border border-[#1E222D] rounded-lg p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 rounded bg-emerald-500/10 text-emerald-400">
                <BookOpen size={18} />
              </div>
              <div>
                <h3 className="text-xs font-bold text-[#D1D4DC]">Ledger Audit Journal</h3>
                <span className="text-[10px] text-[#787B86]">Immutable Double-Entry Trail</span>
              </div>
            </div>
            <p className="text-[#787B86] text-[11px] leading-relaxed mb-4">
              Complete transaction journal guaranteeing Σ Debits === Σ Credits across all user wallets and fee accounts.
            </p>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-[#1E222D]">
            <button
              onClick={() =>
                triggerDownload(
                  `${API_URL}/api/reports/ledger?currency=ALL&format=csv${userId ? `&userId=${userId}` : ''}`,
                  `ledger-audit-${Date.now()}.csv`,
                  'Ledger (CSV)'
                )
              }
              disabled={downloading !== null}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors"
            >
              <Download size={12} />
              <span>{downloading === 'Ledger (CSV)' ? 'Generating...' : 'CSV'}</span>
            </button>
            <button
              onClick={() =>
                triggerDownload(
                  `${API_URL}/api/reports/ledger?currency=ALL&format=json${userId ? `&userId=${userId}` : ''}`,
                  `ledger-audit-${Date.now()}.json`,
                  'Ledger (JSON)'
                )
              }
              disabled={downloading !== null}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded bg-[#2A2E39] hover:bg-[#363A45] text-[#D1D4DC] font-medium transition-colors"
            >
              <Download size={12} />
              <span>{downloading === 'Ledger (JSON)' ? 'Generating...' : 'JSON'}</span>
            </button>
          </div>
        </div>

        {/* 3. Risk & Exposure Metrics */}
        <div className="bg-[#1E222D]/60 border border-[#1E222D] rounded-lg p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 rounded bg-amber-500/10 text-amber-400">
                <ShieldAlert size={18} />
              </div>
              <div>
                <h3 className="text-xs font-bold text-[#D1D4DC]">Risk & Exposure Report</h3>
                <span className="text-[10px] text-[#787B86]">Margin & Capital Commitments</span>
              </div>
            </div>
            <p className="text-[#787B86] text-[11px] leading-relaxed mb-4">
              Aggregate market risk analytics, locked funds per currency, cancellation ratios, and trader solvency distributions.
            </p>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-[#1E222D]">
            <button
              onClick={() =>
                triggerDownload(
                  `${API_URL}/api/reports/risk?format=csv`,
                  `risk-report-${Date.now()}.csv`,
                  'Risk (CSV)'
                )
              }
              disabled={downloading !== null}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white font-medium transition-colors"
            >
              <Download size={12} />
              <span>{downloading === 'Risk (CSV)' ? 'Generating...' : 'CSV'}</span>
            </button>
            <button
              onClick={() =>
                triggerDownload(
                  `${API_URL}/api/reports/risk?format=json`,
                  `risk-report-${Date.now()}.json`,
                  'Risk (JSON)'
                )
              }
              disabled={downloading !== null}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded bg-[#2A2E39] hover:bg-[#363A45] text-[#D1D4DC] font-medium transition-colors"
            >
              <Download size={12} />
              <span>{downloading === 'Risk (JSON)' ? 'Generating...' : 'JSON'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
