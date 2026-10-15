import Dexie, { type Table } from 'dexie'
import type { Attempt, AudioAsset, Passage, PracticeDraft, Question, Settings, StudySet, Submission } from '../domain/model'

class TrainerDatabase extends Dexie {
  sets!: Table<StudySet, string>
  questions!: Table<Question, string>
  passages!: Table<Passage, string>
  audio!: Table<AudioAsset, string>
  attempts!: Table<Attempt, string>
  settings!: Table<Settings & { id: string }, string>
  submissions!: Table<Submission, string>
  drafts!: Table<PracticeDraft, string>

  constructor() {
    super('telc-c1-trainer')
    this.version(3).stores({
      sets: 'id, skill, categoryId, part, updatedAt',
      questions: 'id, setId, questionType, updatedAt',
      passages: 'id, updatedAt',
      audio: 'id, createdAt',
      attempts: 'id, setId, skill, part, completedAt',
      settings: 'id',
      submissions: 'id, skill, updatedAt',
      drafts: 'id, setId, updatedAt',
    })
  }
}

export const db = new TrainerDatabase()

export async function deleteStudySet(setId: string) {
  await db.transaction('rw', [db.sets, db.questions, db.passages, db.audio], async () => {
    const set = await db.sets.get(setId)
    await db.questions.where('setId').equals(setId).delete()
    await db.sets.delete(setId)
    const remaining = await db.sets.toArray()
    if (set?.passageId && !remaining.some((item) => item.passageId === set.passageId)) await db.passages.delete(set.passageId)
    if (set?.audioId && !remaining.some((item) => item.audioId === set.audioId)) await db.audio.delete(set.audioId)
  })
}

export async function deleteQuestion(questionId: string) {
  // Attempts store an immutable question snapshot, so deleting a bank item does not alter history.
  await db.questions.delete(questionId)
}

export async function deleteSubmission(submissionId: string) {
  await db.transaction('rw', [db.submissions, db.audio, db.sets], async () => {
    const submission = await db.submissions.get(submissionId)
    await db.submissions.delete(submissionId)
    if (!submission?.audioId) return
    const [submissions, sets] = await Promise.all([db.submissions.toArray(), db.sets.toArray()])
    if (!submissions.some((item) => item.audioId === submission.audioId) && !sets.some((set) => set.audioId === submission.audioId)) await db.audio.delete(submission.audioId)
  })
}

export async function saveSubmission(submission: Submission) {
  await db.transaction('rw', [db.submissions, db.audio, db.sets], async () => {
    const previous = await db.submissions.get(submission.id)
    await db.submissions.put(submission)
    const oldAudioId = previous?.audioId
    if (!oldAudioId || oldAudioId === submission.audioId) return
    const [submissions, sets] = await Promise.all([db.submissions.toArray(), db.sets.toArray()])
    if (!submissions.some((item) => item.audioId === oldAudioId) && !sets.some((set) => set.audioId === oldAudioId)) await db.audio.delete(oldAudioId)
  })
}

export async function getStorageEstimate() {
  if (!navigator.storage?.estimate) return undefined
  return navigator.storage.estimate()
}

export async function saveAudio(file: File, maxBytes = 25 * 1024 * 1024): Promise<AudioAsset> {
  const allowed = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/aac']
  if (!allowed.includes(file.type)) throw new Error('音频格式不支持，请使用 MP3、WAV、OGG、WebM、MP4 或 AAC。')
  if (!file.size || file.size > maxBytes) throw new Error('音频必须小于 25 MB。')
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    const estimate = await navigator.storage.estimate().catch(() => undefined)
    if (estimate?.quota && estimate.usage !== undefined && estimate.usage + file.size > estimate.quota * 0.95) throw new Error('浏览器剩余存储空间不足，请先导出备份或删除不需要的音频。')
  }
  const asset: AudioAsset = { id: crypto.randomUUID(), name: file.name, mimeType: file.type, size: file.size, blob: file, createdAt: new Date().toISOString() }
  await db.audio.add(asset)
  return asset
}
