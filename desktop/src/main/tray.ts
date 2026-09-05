import { Menu, nativeImage } from 'electron'
import type { MenuItemConstructorOptions, NativeImage } from 'electron'

export function shouldHideWindowToTray(isQuitting: boolean) {
  return !isQuitting
}

export function buildTrayMenuTemplate(options: {
  isPerceptionRunning?: boolean
  onTogglePerception?: () => void
  onCaptureNow?: () => void
  onOpenMain: () => void
  onQuit: () => void
}): MenuItemConstructorOptions[] {
  return [
    {
      label: options.isPerceptionRunning ? '暂停感知' : '开启感知',
      click: options.onTogglePerception
    },
    {
      label: '立即截屏一次',
      click: options.onCaptureNow
    },
    {
      type: 'separator'
    },
    {
      label: '打开主窗口',
      click: options.onOpenMain
    },
    {
      type: 'separator'
    },
    {
      label: '退出',
      click: options.onQuit
    }
  ]
}

export function buildTrayMenu(options: {
  isPerceptionRunning?: boolean
  onTogglePerception?: () => void
  onCaptureNow?: () => void
  onOpenMain: () => void
  onQuit: () => void
}) {
  return Menu.buildFromTemplate(buildTrayMenuTemplate(options))
}

export function buildTrayIconDataUrl() {
  // 16x16 compass needle placeholder; swap for a real icon asset later.
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAACISURBVDhPYxgFNAZd8aYS/XHGy3vijTWgQsSD/nhTg7444/O98SYR/XEmx/vjjR2gUoQBTBPIBSB+f7y+QF+cyX6goQlgBYRAX7zJsfp4ew4oFw764k0PQ5n4QX+8yX8QDfICiA3CMDZYASEAU4isAWYQlIsfAP17H0q/h2kEsWHiowAZMDAAALN4O547+cCFAAAAAElFTkSuQmCC'
}

export function createTrayIcon(): NativeImage {
  return nativeImage.createFromDataURL(buildTrayIconDataUrl()).resize({ width: 16, height: 16 })
}
