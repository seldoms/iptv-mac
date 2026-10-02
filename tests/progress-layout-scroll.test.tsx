import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ProgressLayout from '../src/renderer/src/components/ProgressLayout/ProgressLayout'

describe('ProgressLayout scrolling contract', () => {
  it('constrains content to the remaining flex height so children can scroll', () => {
    const html = renderToString(
      <div className="flex h-full flex-col">
        <ProgressLayout state="content">
          <div className="flex-1 overflow-y-auto">content</div>
        </ProgressLayout>
      </div>
    )

    expect(html).toContain('flex-1 min-h-0 flex flex-col')
  })
})
