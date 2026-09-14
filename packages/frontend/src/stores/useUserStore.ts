import { create } from 'zustand';
import { UserAccount, DemoUser } from '@/types';

interface UserState {
  userId: string | null;
  displayName: string | null;
  token: string | null;
  accounts: UserAccount[];
  demoUsers: DemoUser[];
  selectedSymbol: string;
  isConnected: boolean;
  setUser: (userId: string, displayName: string, token: string) => void;
  setAccounts: (accounts: UserAccount[]) => void;
  setDemoUsers: (users: DemoUser[]) => void;
  setSelectedSymbol: (symbol: string) => void;
  setConnected: (connected: boolean) => void;
  logout: () => void;
}

export const useUserStore = create<UserState>((set) => ({
  userId: null,
  displayName: null,
  token: null,
  accounts: [],
  demoUsers: [],
  selectedSymbol: 'BTC-USD',
  isConnected: false,
  setUser: (userId, displayName, token) => set({ userId, displayName, token }),
  setAccounts: (accounts) => set({ accounts }),
  setDemoUsers: (users) => set({ demoUsers: users }),
  setSelectedSymbol: (symbol) => set({ selectedSymbol: symbol }),
  setConnected: (connected) => set({ isConnected: connected }),
  logout: () => set({ userId: null, displayName: null, token: null, accounts: [] }),
}));
