import { app, shell, BrowserWindow, globalShortcut } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { APP_ID, APP_NAME, DEFAULT_HOTKEY } from '@shared/constants'
import { QUICK_ADD_FOCUS_CHANNEL } from '@shared/ipc-types'
import { getDb, dbHealthCheck } from './db'
import { registerIpcHandlers } from './ipc/handlers'

app.setName(APP_NAME)

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 940,
    minHeight: 640,
    show: false,
    title: APP_NAME,
    backgroundColor: '#253237',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showAndFocusMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (!mainWindow.isVisible()) mainWindow.show()
  mainWindow.focus()
}

// Single instance: a second launch (or the global hotkey while another app is focused) surfaces
// the existing window instead of starting a new process.
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => showAndFocusMainWindow())

  app.whenReady().then(() => {
    electronApp.setAppUserModelId(APP_ID)

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Open + migrate the local database before the UI loads (ADR-004).
    getDb()
    console.log(`[ledger] database ready — ${dbHealthCheck()} campaigns`)

    registerIpcHandlers()
    createWindow()

    // Global quick-add hotkey. ADR-010: Phase 0 ships the focus-main behavior; the
    // popup-vs-focus decision is made in Phase 1. The hotkey is configurable (Settings).
    const registered = globalShortcut.register(DEFAULT_HOTKEY, () => {
      showAndFocusMainWindow()
      mainWindow?.webContents.send(QUICK_ADD_FOCUS_CHANNEL)
    })
    if (!registered) {
      console.warn(`[ledger] could not register global hotkey "${DEFAULT_HOTKEY}" (already in use?)`)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}
