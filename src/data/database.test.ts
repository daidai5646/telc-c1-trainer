// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { deleteSubmission, deleteStudySet, saveAudio, db } from './database'
import type { Attempt, Question, StudySet } from '../domain/model'

const time = '2026-10-09T00:00:00.000Z'
const set: StudySet = { id: 'set-persist', title: 'Persistence', exam: 'telc C1 Hochschule', skill: 'reading', part: 'Teil 1', instruction: '', createdAt: time, updatedAt: time, tags: [] }
const question: Question = { id: 'question-persist', setId: set.id, title: '', prompt: 'Original prompt', questionType: 'single-choice', points: 1, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], matches: [], correctAnswers: { selectedOptionIds: ['a'] }, acceptedAnswers: {}, explanation: 'Original explanation', tags: [], difficulty: 'medium', scoringRules: { partialCredit: false, ignoreCase: true, trim: true }, createdAt: time, updatedAt: time }
const attempt: Attempt = { id: 'attempt-persist', setId: set.id, setTitle: set.title, skill: 'reading', part: set.part, mode: 'practice', startedAt: time, completedAt: time, durationSeconds: 30, answers: [{ questionId: question.id, answer: { selectedOptionIds: ['b'] }, earnedPoints: 0, maxPoints: 1, isCorrect: false, questionSnapshot: { prompt: question.prompt, questionType: question.questionType, options: question.options, matches: [], correctAnswers: question.correctAnswers, acceptedAnswers: {}, explanation: question.explanation, tags: question.tags, difficulty: question.difficulty } }], earnedPoints: 0, maxPoints: 1, percentage: 0 }

beforeEach(async () => { await db.delete(); await db.open() })

describe('local persistence', () => {
  it('survives closing and reopening IndexedDB', async () => {
    await db.sets.add(set); await db.questions.add(question)
    db.close(); await db.open()
    expect((await db.sets.get(set.id))?.title).toBe(set.title)
    expect((await db.questions.get(question.id))?.prompt).toBe(question.prompt)
  })
  it('keeps immutable result snapshots after editing or deleting bank data', async () => {
    await db.sets.add(set); await db.questions.add(question); await db.attempts.add(attempt)
    await db.questions.put({ ...question, prompt: 'Edited prompt' })
    expect((await db.attempts.get(attempt.id))?.answers[0]?.questionSnapshot.prompt).toBe('Original prompt')
    await deleteStudySet(set.id)
    expect(await db.sets.get(set.id)).toBeUndefined()
    expect(await db.questions.get(question.id)).toBeUndefined()
    expect((await db.attempts.get(attempt.id))?.percentage).toBe(0)
    expect((await db.attempts.get(attempt.id))?.answers[0]?.questionSnapshot.explanation).toBe('Original explanation')
  })
  it('accepts only bounded audio uploads', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'lesson.mp3', { type: 'audio/mpeg' })
    expect((await saveAudio(file)).size).toBe(3)
    await expect(saveAudio(new File(['x'], 'fake.txt', { type: 'text/plain' }))).rejects.toThrow(/格式不支持/)
    await expect(saveAudio(file, 2)).rejects.toThrow(/小于 25 MB/)
  })
  it('retains reused recordings and removes recordings no longer referenced', async () => {
    const asset = { id: 'recording', name: 'answer.webm', mimeType: 'audio/webm', size: 2, blob: new Blob([new Uint8Array([1, 2])], { type: 'audio/webm' }), createdAt: time }
    await db.audio.add(asset)
    await db.sets.add({ ...set, audioId: asset.id })
    await db.submissions.add({ id: 'spoken-answer', skill: 'speaking', title: 'Speaking', response: '', rubric: '', feedback: '', audioId: asset.id, createdAt: time, updatedAt: time })
    await deleteSubmission('spoken-answer')
    expect(await db.audio.get(asset.id)).toBeDefined()
    await db.sets.delete(set.id)
    await db.submissions.add({ id: 'cleanup-answer', skill: 'speaking', title: 'Cleanup', response: '', rubric: '', feedback: '', audioId: asset.id, createdAt: time, updatedAt: time })
    await deleteSubmission('cleanup-answer')
    const orphan = { ...asset, id: 'orphan-recording' }
    await db.audio.add(orphan)
    await db.submissions.add({ id: 'orphan-answer', skill: 'speaking', title: 'Temporary', response: '', rubric: '', feedback: '', audioId: orphan.id, createdAt: time, updatedAt: time })
    await deleteSubmission('orphan-answer')
    expect(await db.audio.get(asset.id)).toBeUndefined()
    expect(await db.audio.get(orphan.id)).toBeUndefined()
  })
})
