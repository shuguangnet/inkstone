import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react';
import { GripHorizontal, X } from 'lucide-react';
import { IconButton } from '../../components/primitives';
import { cn } from '../../lib/cn';
import { t } from '../../lib/i18n';
import { clampTerminalBounds, TERMINAL_DOCKS, type TerminalDock } from '../../lib/terminal-layout';
import { useTerminal } from '../../store/terminal';

export function TerminalWindow({ header, children }: { header: ReactNode; children: ReactNode }) {
  const { dock, size, bounds, setDock, setSize, setBounds, setOpen } = useTerminal();
  const panel = useRef<HTMLElement>(null);
  const floating = dock === 'floating';
  const vertical = dock === 'left' || dock === 'right';
  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const resize = () => setBounds(clampTerminalBounds(useTerminal.getState().bounds, viewport()));
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [setBounds]);
  const gesture = (event: PointerEvent<HTMLElement>, mode: 'move' | 'resize' | 'dock') => {
    if (event.button !== 0 || (mode === 'move' && (event.target as HTMLElement).closest('button, select, input'))) return;
    event.preventDefault();
    const element = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    const start = clampTerminalBounds(bounds, viewport());
    const area = panel.current?.parentElement?.getBoundingClientRect();
    element.setPointerCapture(event.pointerId);
    const move = (next: globalThis.PointerEvent) => {
      const dx = next.clientX - startX;
      const dy = next.clientY - startY;
      if (mode === 'dock') {
        const span = vertical ? area?.width : area?.height;
        if (span) setSize(size + (vertical ? dx : dy) * (dock === 'bottom' || dock === 'right' ? -1 : 1) / span * 100);
      } else setBounds(clampTerminalBounds(mode === 'move'
        ? { ...start, x: start.x + dx, y: start.y + dy }
        : { ...start, width: start.width + dx, height: start.height + dy }, viewport()));
    };
    const stop = () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', stop);
      element.removeEventListener('pointercancel', stop);
      element.removeEventListener('lostpointercapture', stop);
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', stop);
    element.addEventListener('pointercancel', stop);
    element.addEventListener('lostpointercapture', stop);
  };
  const safeBounds = clampTerminalBounds(bounds, viewport());
  return <section ref={panel} aria-label={t('terminal.title')} data-terminal-dock={dock}
    style={floating ? { position: 'fixed', left: safeBounds.x, top: safeBounds.y, width: safeBounds.width, height: safeBounds.height, zIndex: 35 } : { gridArea: 'terminal' }}
    className={cn('inkstone-terminal-window relative flex min-h-0 min-w-0 flex-col border border-[var(--border-default)] bg-[var(--bg-editor)]', floating && 'overflow-hidden rounded-lg shadow-2xl')}>
    {!floating && <div role="separator" tabIndex={0} aria-label={t('terminal.resize')} aria-orientation={vertical ? 'vertical' : 'horizontal'} aria-valuenow={Math.round(size)} aria-valuemin={20} aria-valuemax={65}
      onPointerDown={(event) => gesture(event, 'dock')}
      onKeyDown={(event) => {
        const increase = dock === 'bottom' ? 'ArrowUp' : dock === 'top' ? 'ArrowDown' : dock === 'left' ? 'ArrowRight' : 'ArrowLeft';
        const decrease = dock === 'bottom' ? 'ArrowDown' : dock === 'top' ? 'ArrowUp' : dock === 'left' ? 'ArrowLeft' : 'ArrowRight';
        if (event.key === increase || event.key === decrease) { event.preventDefault(); setSize(size + (event.key === increase ? 2 : -2)); }
      }}
      className={cn('absolute z-10 touch-none hover:bg-[var(--accent)] focus:bg-[var(--accent)]', vertical ? 'inset-y-0 w-1 cursor-col-resize' : 'inset-x-0 h-1 cursor-row-resize', dock === 'left' ? 'right-0' : dock === 'right' ? 'left-0' : dock === 'top' ? 'bottom-0' : 'top-0')}/>}
    <div onPointerDown={floating ? (event) => gesture(event, 'move') : undefined} className={cn('flex shrink-0 flex-wrap items-center gap-2 px-3 py-2', floating && 'touch-none cursor-move select-none')} title={floating ? t('terminal.drag') : undefined}>
      {floating && <GripHorizontal size={14} aria-hidden="true"/>}
      {header}
      <span className="flex-1"/>
      <select aria-label={t('terminal.position')} value={dock} onChange={(event) => setDock(event.target.value as TerminalDock)} className="rounded border border-[var(--border-default)] bg-[var(--bg-base)] px-1 py-1 text-xs">
        {TERMINAL_DOCKS.map((position) => <option key={position} value={position}>{t(`terminal.dock_${position}`)}</option>)}
      </select>
      <IconButton label={t('common.close')} size="sm" onClick={() => setOpen(false)}><X size={14}/></IconButton>
    </div>
    {children}
    {floating && <button aria-label={t('terminal.resize')} onPointerDown={(event) => gesture(event, 'resize')} onKeyDown={(event) => {
      const delta = event.shiftKey ? 40 : 10;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        setBounds(clampTerminalBounds({ ...bounds, width: bounds.width + (event.key === 'ArrowRight' ? delta : event.key === 'ArrowLeft' ? -delta : 0), height: bounds.height + (event.key === 'ArrowDown' ? delta : event.key === 'ArrowUp' ? -delta : 0) }, viewport()));
      }
    }} className="absolute bottom-0 right-0 size-4 touch-none cursor-nwse-resize text-[var(--text-tertiary)]">◢</button>}
  </section>;
}
