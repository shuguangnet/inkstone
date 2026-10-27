import { describe, expect, it } from 'vitest'
import { extractTags, retargetWikiLinkTarget } from './markdown-utils'

describe('extractTags', () => {
  it('handles an unterminated inline-code marker with a mismatched trailing marker', () => {
    expect(extractTags('` #visible ``')).toEqual(['visible'])
  })

  it('does not treat tags in complete inline code or fenced blocks as tags', () => {
    expect(extractTags('`#inline`\n```\n#fenced\n```\n#visible')).toEqual(['visible'])
  })
})

describe('retargetWikiLinkTarget', () => {
  it('follows a rename for a plain title', () => {
    expect(retargetWikiLinkTarget('Old Name', 'Old Name', 'New Name')).toBe('New Name')
  })

  it('keeps the folder prefix of a path-style target', () => {
    expect(retargetWikiLinkTarget('01-net/frp/tunnel', 'tunnel', 'frp tunnel'))
      .toBe('01-net/frp/frp tunnel')
  })

  it('matches regardless of case and spacing', () => {
    expect(retargetWikiLinkTarget('Notes/Old   NAME', 'old name', 'New')).toBe('Notes/New')
  })

  it('ignores targets that address a different note', () => {
    expect(retargetWikiLinkTarget('Notes/Other', 'Old Name', 'New')).toBeNull()
    expect(retargetWikiLinkTarget('Old Name Two', 'Old Name', 'New')).toBeNull()
  })

  it('returns null when nothing would change', () => {
    expect(retargetWikiLinkTarget('Same', 'Same', 'Same')).toBeNull()
  })
})
