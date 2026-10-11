// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './database'
import { exportQuestionsCsv, importQuestionBank, makeFullBackup, makeQuestionBankBundle, parseCsvQuestions, previewImport, restoreFullBackup } from './exchange'
import { now, type Question, type StudySet } from '../domain/model'
import exampleBank from '../../examples/example-question-bank.json'

const stamp = now()
const set: StudySet = { id: 'set-1', title: 'Lesen Teil 1', exam: 'telc C1 Hochschule', skill: 'reading', part: 'Teil 1', instruction: '', createdAt: stamp, updatedAt: stamp, tags: [] }
const question: Question = { id: 'q-1', setId: set.id, title: '', prompt: 'Was stimmt?', questionType: 'single-choice', points: 1, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], matches: [], correctAnswers: { selectedOptionIds: ['a'] }, acceptedAnswers: {}, explanation: '', tags: [], difficulty: 'medium', scoringRules: { partialCredit: false, ignoreCase: true, trim: true }, createdAt: stamp, updatedAt: stamp }
const bundle = { format: 'telc-c1-trainer' as const, version: 1 as const, exportedAt: stamp, sets: [set], questions: [question], passages: [], audio: [] }

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('question bank exchange', () => {
  it('validates the shipped example bank and recognizes repeated CSV imports', async () => {
    expect(await previewImport(exampleBank)).toMatchObject({ sets: 2, questions: 4, passages: 1 })
    const csv = 'title,skill,part,questionType,prompt,options,correctAnswers\nSample,reading,Teil1,single-choice,Text?,"[{""id"":""a"",""text"":""A""},{""id"":""b"",""text"":""B""}]","{""selectedOptionIds"":[""a""]}"'
    expect(parseCsvQuestions(csv).set.id).toBe(parseCsvQuestions(csv).set.id)
  })
  it('previews and imports a valid bank', async () => {
    expect(await previewImport(bundle)).toMatchObject({ sets: 1, questions: 1, duplicateSetIds: [] })
    expect(await importQuestionBank(bundle, 'skip')).toMatchObject({ importedSets: 1, importedQuestions: 1 })
    expect(await db.questions.count()).toBe(1)
  })
  it('does not overwrite duplicate ids by default and supports explicit copy', async () => {
    await importQuestionBank(bundle, 'skip')
    expect(await importQuestionBank(bundle, 'skip')).toMatchObject({ skippedSets: 1, skippedQuestions: 1 })
    expect(await db.sets.count()).toBe(1)
    expect(await importQuestionBank(bundle, 'copy')).toMatchObject({ importedSets: 1, importedQuestions: 1 })
    expect(await db.sets.count()).toBe(2)
  })
  it('rejects invalid data before mutating stored data', async () => {
    await db.sets.add(set)
    const invalid = { ...bundle, sets: [{ ...set, id: 'bad' }], questions: [{ ...question, setId: 'missing' }] }
    await expect(importQuestionBank(invalid, 'replace')).rejects.toThrow(/没有对应题组/)
    expect(await db.sets.count()).toBe(1)
  })
  it('parses valid CSV and reports malformed CSV field JSON', () => {
    const csv = 'title,skill,part,questionType,prompt,options,correctAnswers\n"Sample",reading,"Teil 1",single-choice,"Text?","[{""id"":""a"",""text"":""A""},{""id"":""b"",""text"":""B""}]","{""selectedOptionIds"":[""a""]}"'
    expect(parseCsvQuestions(csv).questions).toHaveLength(1)
    const malformed = 'title,skill,part,questionType,prompt,correctAnswers\nSample,reading,Teil1,single-choice,Text?,not-json'
    expect(() => parseCsvQuestions(malformed)).toThrow(/不是有效 JSON/)
    const csvExport = exportQuestionsCsv([{ ...question, prompt: '=2+2' }], set.title, set.skill, set.part)
    expect(csvExport).toContain("'=2+2")
    expect(parseCsvQuestions(csvExport).questions[0]?.prompt).toBe('=2+2')
    const secondRow = csv.split('\n')[1]!.replace('Teil 1', 'Teil 2')
    expect(() => parseCsvQuestions(`${csv}\n${secondRow}`)).toThrow(/与首行不一致/)
  })
  it('exports then reimports题库和音频, and restores practice records from a full backup', async () => {
    await db.sets.add({ ...set, audioId: 'audio-1' }); await db.questions.add(question)
    await db.audio.add({ id: 'audio-1', name: 'audio.mp3', mimeType: 'audio/mpeg', size: 2, blob: new Blob([new Uint8Array([3, 4])], { type: 'audio/mpeg' }), createdAt: stamp })
    const bundle = await makeQuestionBankBundle()
    expect(bundle.audio[0]?.base64).toBeTruthy()
    await db.delete(); await db.open()
    await importQuestionBank(bundle, 'skip')
    expect((await db.audio.get('audio-1'))?.size).toBe(2)
    await db.attempts.add({ id: 'attempt-1', setId: set.id, setTitle: set.title, skill: 'reading', part: set.part, mode: 'practice', startedAt: stamp, completedAt: stamp, durationSeconds: 1, answers: [], earnedPoints: 0, maxPoints: 0, percentage: 0 })
    await db.drafts.add({ id: set.id, setId: set.id, mode: 'practice', startedAt: Date.now(), timeLeft: 120, answers: { [question.id]: { selectedOptionIds: ['a'] } }, updatedAt: stamp })
    await db.submissions.add({ id: 'submission-1', skill: 'speaking', title: 'Saved response', response: 'My answer', rubric: 'Clarity', feedback: '', audioId: 'audio-1', createdAt: stamp, updatedAt: stamp })
    const full = await makeFullBackup()
    expect(full.audio).toHaveLength(1)
    await db.delete(); await db.open()
    await restoreFullBackup(full, 'skip')
    expect(await db.attempts.count()).toBe(1)
    expect(await db.drafts.count()).toBe(1)
    expect((await db.submissions.get('submission-1'))?.audioId).toBe('audio-1')
    expect(await db.sets.count()).toBe(1)
  })
})
