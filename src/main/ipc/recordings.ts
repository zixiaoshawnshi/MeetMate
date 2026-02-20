import { ipcMain, shell } from 'electron'
import { existsSync } from 'fs'
import { getDb } from '../database'

export interface SessionRecording {
  id: number
  session_id: number
  file_path: string
  started_at: string
  stopped_at: string
  duration_ms: number | null
  created_at: string
}

export function registerRecordingHandlers(): void {
  ipcMain.handle('recording:list', (_event, sessionId: number): SessionRecording[] => {
    const db = getDb()
    return db
      .prepare(
        `SELECT id, session_id, file_path, started_at, stopped_at, duration_ms, created_at
         FROM session_recordings
         WHERE session_id = ?
         ORDER BY started_at DESC`
      )
      .all(sessionId) as SessionRecording[]
  })

  ipcMain.handle('recording:open-file', async (_event, filePath: string): Promise<void> => {
    if (!filePath || !existsSync(filePath)) return
    await shell.openPath(filePath)
  })

  ipcMain.handle('recording:show-in-folder', (_event, filePath: string): void => {
    if (!filePath || !existsSync(filePath)) return
    shell.showItemInFolder(filePath)
  })
}
