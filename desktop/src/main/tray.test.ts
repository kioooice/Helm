import { describe, expect, it } from 'vitest'
import { buildTrayMenuTemplate, shouldHideWindowToTray } from './tray'

describe('tray menu template', () => {
  it('shows pause wording while perception is running', () => {
    const template = buildTrayMenuTemplate({
      isPerceptionRunning: true,
      onOpenMain: () => undefined,
      onQuit: () => undefined
    })

    expect(template[0]?.label).toBe('暂停感知')
    expect(template[1]?.label).toBe('立即截屏一次')
    expect(template.some((entry) => entry.label === '打开主窗口')).toBe(true)
    expect(template.some((entry) => entry.label === '退出')).toBe(true)
  })

  it('shows start wording while perception is paused', () => {
    const template = buildTrayMenuTemplate({
      isPerceptionRunning: false,
      onOpenMain: () => undefined,
      onQuit: () => undefined
    })

    expect(template[0]?.label).toBe('开启感知')
  })
})

describe('shouldHideWindowToTray', () => {
  it('hides the window unless the app is quitting', () => {
    expect(shouldHideWindowToTray(false)).toBe(true)
    expect(shouldHideWindowToTray(true)).toBe(false)
  })
})
