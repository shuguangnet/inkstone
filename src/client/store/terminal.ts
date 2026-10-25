import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TerminalBounds, TerminalDock } from '../lib/terminal-layout';

type TerminalState = {
  open: boolean;
  dock: TerminalDock;
  size: number;
  bounds: TerminalBounds;
  setOpen: (open: boolean) => void;
  setDock: (dock: TerminalDock) => void;
  setSize: (size: number) => void;
  setBounds: (bounds: TerminalBounds) => void;
};

export const useTerminal = create<TerminalState>()(persist((set) => ({
  open: false,
  dock: 'bottom',
  size: 40,
  bounds: { x: 80, y: 100, width: 800, height: 420 },
  setOpen: (open) => set({ open }),
  setDock: (dock) => set({ dock }),
  setSize: (size) => set({ size: Math.max(20, Math.min(65, size)) }),
  setBounds: (bounds) => set({ bounds }),
}), {
  name: 'inkstone-terminal-layout',
  partialize: ({ dock, size, bounds }) => ({ dock, size, bounds }),
}));
