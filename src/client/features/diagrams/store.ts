import { create } from 'zustand'
import { listDrawioBlocks, type DrawioBlock } from '@shared/drawio'
import { useNotes } from '../../store/notes'

export interface DiagramSession {
  noteId: string
  block: DrawioBlock | null
  anchor: number
  base: string
}
export const useDiagrams = create<{ session: DiagramSession | null; open: (session: DiagramSession) => void; close: () => void }>((set) => ({
  session: null,
  open: (session) => set({ session }),
  close: () => set({ session: null }),
}))

export function editDiagram(noteId: string, id: string, xml: string) {
  const content = useNotes.getState().contents[noteId]
  if (content === undefined) return
  const matches = listDrawioBlocks(content).filter((block) => id ? block.id === id : block.xml === xml.trim())
  if (matches.length !== 1) return
  useDiagrams.getState().open({ noteId, block: matches[0]!, anchor: matches[0]!.from, base: content })
}
