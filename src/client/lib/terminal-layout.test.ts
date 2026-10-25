import { describe, expect, it } from 'vitest';
import { clampTerminalBounds, terminalGrid } from './terminal-layout';

describe('terminal window layout', () => {
  it('keeps the whole floating window reachable after a viewport shrink', () => {
    expect(clampTerminalBounds({ x: 1200, y: 800, width: 900, height: 600 }, { width: 640, height: 480 })).toEqual({ x: 8, y: 8, width: 624, height: 464 });
    expect(clampTerminalBounds({ x: -500, y: -100, width: 100, height: 50 }, { width: 1280, height: 800 })).toEqual({ x: 8, y: 8, width: 320, height: 240 });
  });
  it('reserves writing space for all dock positions and frees it when floating or closed', () => {
    expect(terminalGrid('left', 90, true).gridTemplateColumns).toBe('65% minmax(0, 1fr)');
    expect(terminalGrid('right', 40, true).gridTemplateAreas).toBe('"workspace terminal"');
    expect(terminalGrid('top', 40, true).gridTemplateAreas).toBe('"terminal" "workspace"');
    expect(terminalGrid('bottom', 5, true).gridTemplateRows).toBe('minmax(0, 1fr) 20%');
    expect(terminalGrid('floating', 40, true)).toEqual(terminalGrid('bottom', 40, false));
  });
});
