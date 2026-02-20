import { BrowserWindow, dialog, ipcMain } from 'electron'
import { spawn } from 'child_process'
import { join } from 'path'
import {
  AppSettings,
  AppSettingsPatch,
  databaseFilePath,
  recordingsBaseDir,
  settingsFilePath,
  getSettings,
  updateSettings
} from '../settings'

function getWindow(): BrowserWindow | null {
  const windows = BrowserWindow.getAllWindows()
  return windows.length > 0 ? windows[0] : null
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:get', (): AppSettings => getSettings())

  ipcMain.handle('settings:update', (_event, patch: AppSettingsPatch): AppSettings => {
    return updateSettings(patch)
  })

  ipcMain.handle('settings:pick-directory', async (): Promise<string | null> => {
    const ownerWindow = getWindow() ?? undefined
    const result = await dialog.showOpenDialog(ownerWindow, {
      properties: ['openDirectory', 'createDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(
    'settings:paths',
    (): { databasePath: string; settingsPath: string; recordingsBaseDir: string } => {
      const settings = getSettings()
      return {
        databasePath: databaseFilePath(),
        settingsPath: settingsFilePath(),
        recordingsBaseDir: recordingsBaseDir(settings)
      }
    }
  )

  ipcMain.handle(
    'settings:diarization-download',
    async (): Promise<{ ok: boolean; message: string; path?: string }> => {
      const settings = getSettings()
      const token = settings.transcription.huggingFaceToken.trim()
      if (!token) {
        return { ok: false, message: 'Hugging Face token is missing in Settings.' }
      }

      const dest = join(process.cwd(), 'python', 'models', 'pyannote-embedding')
      const result = await runPythonModelManager([
        'download',
        '--repo-id',
        'pyannote/embedding',
        '--dest',
        dest,
        '--token',
        token
      ])

      if (result.ok && result.path) {
        updateSettings({
          transcription: { localDiarizationModelPath: result.path }
        })
      }
      return result
    }
  )

  ipcMain.handle(
    'settings:diarization-validate',
    async (): Promise<{ ok: boolean; message: string; path?: string }> => {
      const settings = getSettings()
      const modelPath = settings.transcription.localDiarizationModelPath
      if (!modelPath) {
        return { ok: false, message: 'No local diarization model path configured.' }
      }
      return await runPythonModelManager(['validate', '--path', modelPath])
    }
  )
}

function runPythonModelManager(args: string[]): Promise<{ ok: boolean; message: string; path?: string }> {
  return new Promise((resolve) => {
    const scriptPath = join(process.cwd(), 'python', 'model_manager.py')
    const proc = spawn('python', [scriptPath, ...args], { cwd: process.cwd() })

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    proc.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })

    proc.on('close', () => {
      try {
        const parsed = JSON.parse(stdout.trim()) as { ok: boolean; message: string; path?: string }
        resolve(parsed)
      } catch {
        resolve({
          ok: false,
          message: stderr.trim() || stdout.trim() || 'Failed to run model manager.'
        })
      }
    })
  })
}
