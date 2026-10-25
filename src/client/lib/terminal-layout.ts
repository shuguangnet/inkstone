export type TerminalDock = 'top' | 'bottom' | 'left' | 'right' | 'floating';
export type TerminalBounds = { x: number; y: number; width: number; height: number };
export const TERMINAL_DOCKS: TerminalDock[] = ['top', 'bottom', 'left', 'right', 'floating'];

export function clampTerminalBounds(bounds: TerminalBounds, viewport: { width: number; height: number }): TerminalBounds {
  const width = Math.min(Math.max(320, bounds.width), Math.max(1, viewport.width - 16));
  const height = Math.min(Math.max(240, bounds.height), Math.max(1, viewport.height - 16));
  return {
    width,
    height,
    x: Math.max(8, Math.min(bounds.x, viewport.width - width - 8)),
    y: Math.max(8, Math.min(bounds.y, viewport.height - height - 8)),
  };
}

export function terminalGrid(dock: TerminalDock, size: number, open: boolean) {
  const extent = `${Math.max(20, Math.min(65, size))}%`;
  if (!open || dock === 'floating') return { gridTemplateAreas: '"workspace"', gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)' };
  if (dock === 'left' || dock === 'right') return {
    gridTemplateAreas: dock === 'left' ? '"terminal workspace"' : '"workspace terminal"',
    gridTemplateColumns: dock === 'left' ? `${extent} minmax(0, 1fr)` : `minmax(0, 1fr) ${extent}`,
    gridTemplateRows: 'minmax(0, 1fr)',
  };
  return {
    gridTemplateAreas: dock === 'top' ? '"terminal" "workspace"' : '"workspace" "terminal"',
    gridTemplateColumns: 'minmax(0, 1fr)',
    gridTemplateRows: dock === 'top' ? `${extent} minmax(0, 1fr)` : `minmax(0, 1fr) ${extent}`,
  };
}
