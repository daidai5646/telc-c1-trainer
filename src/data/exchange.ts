import Papa from 'papaparse'
import { ImportBundleSchema, FullBackupSchema, QuestionSchema, StudySetSchema, SkillSchema, PassageSchema, categoryForSet, now, id, type Attempt, type ImportBundle, type Question, type Settings, type PracticeDraft, type Submission } from '../domain/model'
import { db } from './database'

export type DuplicateStrategy = 'skip' | 'replace' | 'copy'
export interface ImportPreview { sets: number; questions: number; passages: number; audio: number; duplicateSetIds: string[]; duplicateQuestionIds: string[]; duplicateOtherIds: string[] }

export async function makeQuestionBankBundle(): Promise<ImportBundle> {
  return buildQuestionBankBundle(false)
}

async function buildQuestionBankBundle(includeAllAudio: boolean): Promise<ImportBundle> {
  const [sets, questions, passages, allAudio] = await Promise.all([db.sets.toArray(), db.questions.toArray(), db.passages.toArray(), db.audio.toArray()])
  questions.sort(compareQuestionOrder)
  const audioIds = new Set(sets.flatMap((set) => set.audioId ? [set.audioId] : []))
  const audioAssets = includeAllAudio ? allAudio : allAudio.filter((asset) => audioIds.has(asset.id))
  const audio = await Promise.all(audioAssets.map(async (asset) => ({
    id: asset.id, name: asset.name, mimeType: asset.mimeType, size: asset.size,
    base64: await blobToBase64(asset.blob), createdAt: asset.createdAt,
  })))
  return { format: 'telc-c1-trainer', version: 1, exportedAt: now(), sets, questions, passages, audio }
}

export async function makeFullBackup() {
  const bank = await buildQuestionBankBundle(true)
  const [attempts, drafts, submissions, settings] = await Promise.all([db.attempts.toArray(), db.drafts.toArray(), db.submissions.toArray(), db.settings.toArray()])
  return { ...bank, backup: true as const, attempts, drafts, submissions, settings }
}

export async function previewImport(value: unknown): Promise<ImportPreview> {
  const bundle = ImportBundleSchema.parse(value)
  validateReferences(bundle)
  const [sets, questions, passages, audio] = await Promise.all([db.sets.toArray(), db.questions.toArray(), db.passages.toArray(), db.audio.toArray()])
  return {
    sets: bundle.sets.length, questions: bundle.questions.length, passages: bundle.passages.length, audio: bundle.audio.length,
    duplicateSetIds: bundle.sets.map((x) => x.id).filter((x) => sets.some((local) => local.id === x)),
    duplicateQuestionIds: bundle.questions.map((x) => x.id).filter((x) => questions.some((local) => local.id === x)),
    duplicateOtherIds: [...bundle.passages.map((x) => x.id), ...bundle.audio.map((x) => x.id)].filter((x) => passages.some((local) => local.id === x) || audio.some((local) => local.id === x)),
  }
}

export async function importQuestionBank(value: unknown, strategy: DuplicateStrategy): Promise<{ importedSets: number; importedQuestions: number; skippedSets: number; skippedQuestions: number }> {
  const bundle = normalizeBundleCategories(ImportBundleSchema.parse(value))
  return applyImport(bundle, strategy)
}

export async function restoreFullBackup(value: unknown, strategy: DuplicateStrategy) {
  const backup = FullBackupSchema.parse(value)
  validateReferences(backup)
  return applyImport(normalizeBundleCategories(backup), strategy, { attempts: backup.attempts, drafts: backup.drafts, submissions: backup.submissions, settings: backup.settings })
}

function normalizeBundleCategories(bundle: ImportBundle): ImportBundle {
  return { ...bundle, sets: bundle.sets.map((set) => StudySetSchema.parse({ ...set, categoryId: !set.categoryId || set.categoryId === 'reading123' || set.categoryId === 'listening123' ? categoryForSet(set.skill, set.part, set.title) : set.categoryId })) }
}

async function applyImport(bundle: ImportBundle, strategy: DuplicateStrategy, extras?: { attempts: Attempt[]; drafts: PracticeDraft[]; submissions: Submission[]; settings: (Settings & { id: string })[] }) {
  validateReferences(bundle)
  const result = { importedSets: 0, importedQuestions: 0, skippedSets: 0, skippedQuestions: 0 }
  await db.transaction('rw', [db.sets, db.questions, db.passages, db.audio, db.attempts, db.drafts, db.submissions, db.settings], async () => {
    let prepared = bundle
    let copiedSetIds: Map<string, string> | undefined
    let copiedAudioIds: Map<string, string> | undefined
    if (strategy === 'copy') { copiedSetIds = new Map<string, string>(bundle.sets.map((set) => [set.id, id()])); copiedAudioIds = new Map<string, string>(bundle.audio.map((audio) => [audio.id, id()])); prepared = remapBundle(bundle, copiedSetIds, copiedAudioIds) }
    const existingSetIds = new Set(await db.sets.toCollection().primaryKeys() as string[])
    const blocked = new Set<string>()
    for (const set of prepared.sets) {
      if (strategy === 'skip' && existingSetIds.has(set.id)) { blocked.add(set.id); result.skippedSets++; continue }
      if (strategy === 'replace' && existingSetIds.has(set.id)) await db.questions.where('setId').equals(set.id).delete()
      await db.sets.put(set)
      result.importedSets++
    }
    const existingQuestionIds = new Set(await db.questions.toCollection().primaryKeys() as string[])
    const nextOrder = new Map<string, number>()
    for (const question of await db.questions.toArray()) nextOrder.set(question.setId, Math.max(nextOrder.get(question.setId) ?? 0, (question.order ?? -1) + 1))
    for (const question of prepared.questions) {
      if (blocked.has(question.setId)) { result.skippedQuestions++; continue }
      if (strategy === 'skip' && existingQuestionIds.has(question.id)) { result.skippedQuestions++; continue }
      const order = nextOrder.get(question.setId) ?? 0
      await db.questions.put({ ...question, order })
      nextOrder.set(question.setId, order + 1)
      result.importedQuestions++
    }
    for (const passage of prepared.passages) {
      if (strategy !== 'skip' || !(await db.passages.get(passage.id))) await db.passages.put(passage)
    }
    for (const asset of prepared.audio) {
      if (strategy !== 'skip' || !(await db.audio.get(asset.id))) await db.audio.put({ id: asset.id, name: asset.name, mimeType: asset.mimeType, size: asset.size, createdAt: asset.createdAt, blob: base64ToBlob(asset.base64, asset.mimeType) })
    }
    if (extras) {
      for (const attempt of extras.attempts) {
        const value = strategy === 'copy' ? { ...attempt, id: id(), setId: copiedSetIds?.get(attempt.setId) ?? attempt.setId } : attempt
        const old = await db.attempts.get(value.id)
        if (strategy === 'skip' && old) continue
        await db.attempts.put(value)
      }
      for (const draft of extras.drafts) {
        const value = strategy === 'copy' ? { ...draft, id: id(), setId: copiedSetIds?.get(draft.setId) ?? draft.setId } : draft
        const old = await db.drafts.get(value.id)
        if (strategy === 'skip' && old) continue
        await db.drafts.put(value)
      }
      for (const submission of extras.submissions) {
        const value = strategy === 'copy' ? { ...submission, id: id(), audioId: submission.audioId ? copiedAudioIds?.get(submission.audioId) ?? submission.audioId : undefined } : submission
        const old = await db.submissions.get(value.id)
        if (strategy === 'skip' && old) continue
        await db.submissions.put(value)
      }
      for (const setting of extras.settings) {
        if ((strategy === 'skip' || strategy === 'copy') && await db.settings.get(setting.id)) continue
        await db.settings.put(setting)
      }
    }
  })
  return result
}

function validateReferences(bundle: ImportBundle) {
  const setIds = new Set(bundle.sets.map((item) => item.id))
  const passageIds = new Set(bundle.passages.map((item) => item.id))
  const audioIds = new Set(bundle.audio.map((item) => item.id))
  if (setIds.size !== bundle.sets.length) throw new Error('导入文件中有重复题组 ID。')
  if (new Set(bundle.questions.map((item) => item.id)).size !== bundle.questions.length) throw new Error('导入文件中有重复题目 ID。')
  for (const set of bundle.sets) {
    if (set.passageId && !passageIds.has(set.passageId)) throw new Error(`题组“${set.title}”引用了缺失的文章。`)
    if (set.audioId && !audioIds.has(set.audioId)) throw new Error(`题组“${set.title}”引用了缺失的音频。`)
  }
  for (const question of bundle.questions) if (!setIds.has(question.setId)) throw new Error(`题目“${question.prompt.slice(0, 30)}”没有对应题组。`)
}

function remapBundle(bundle: ImportBundle, setIds: Map<string, string> = new Map<string, string>(bundle.sets.map((set) => [set.id, id()])), audioIds: Map<string, string> = new Map<string, string>(bundle.audio.map((asset) => [asset.id, id()]))): ImportBundle {
  const passageIds = new Map(bundle.passages.map((passage) => [passage.id, id()]))
  const questionIds = new Map(bundle.questions.map((question) => [question.id, id()]))
  return {
    ...bundle,
    sets: bundle.sets.map((set) => StudySetSchema.parse({ ...set, id: setIds.get(set.id), passageId: set.passageId ? passageIds.get(set.passageId) : undefined, audioId: set.audioId ? audioIds.get(set.audioId) : undefined })),
    questions: bundle.questions.map((question) => QuestionSchema.parse({ ...question, id: questionIds.get(question.id), setId: setIds.get(question.setId) })),
    passages: bundle.passages.map((passage) => PassageSchema.parse({ ...passage, id: passageIds.get(passage.id) })),
    audio: bundle.audio.map((asset) => ({ ...asset, id: audioIds.get(asset.id)! })),
  }
}

export function parseCsvQuestions(csv: string, setIdValue?: string): { set: ReturnType<typeof StudySetSchema.parse>; questions: Question[] } {
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim(), transform: (value) => value.replace(/^'(?=[=+@\-])/, '') })
  if (parsed.errors.length) throw new Error(`CSV 格式错误：${parsed.errors[0]?.message ?? '无法解析'}`)
  if (!parsed.data.length) throw new Error('CSV 中没有题目。')
  const required = ['title', 'skill', 'part', 'questionType', 'prompt', 'correctAnswers']
  for (const key of required) if (!parsed.meta.fields?.includes(key)) throw new Error(`CSV 缺少列：${key}`)
  const first = parsed.data[0]!
  parsed.data.forEach((row, index) => {
    for (const field of ['title', 'skill', 'part', 'exam']) if (row[field] !== first[field]) throw new Error(`CSV 第 ${index + 2} 行的 ${field} 与首行不一致；一个 CSV 文件只能包含一个题组。`)
  })
  const deterministicSetId = setIdValue ?? `csv-${stableHash([first.title, first.skill, first.part].join('|'))}`
  const stamp = now()
  const skill = SkillSchema.parse(first.skill)
  const set = StudySetSchema.parse({ id: deterministicSetId, title: first.title, exam: first.exam || 'telc C1 Hochschule', skill, categoryId: categoryForSet(skill, first.part, first.title), part: first.part, instruction: first.instruction || '', createdAt: stamp, updatedAt: stamp })
  const questions = parsed.data.map((row, index) => {
    let options: unknown[] = []
    let correctAnswers: unknown = {}
    let acceptedAnswers: unknown = {}
    let matches: unknown[] = []
    try { options = row.options ? JSON.parse(row.options) as unknown[] : [] } catch { throw new Error(`第 ${index + 2} 行 options 不是有效 JSON。`) }
    try { correctAnswers = JSON.parse(row.correctAnswers) as unknown } catch { throw new Error(`第 ${index + 2} 行 correctAnswers 不是有效 JSON。`) }
    try { acceptedAnswers = row.acceptedAnswers ? JSON.parse(row.acceptedAnswers) as unknown : {} } catch { throw new Error(`第 ${index + 2} 行 acceptedAnswers 不是有效 JSON。`) }
    try { matches = row.matches ? JSON.parse(row.matches) as unknown[] : [] } catch { throw new Error(`第 ${index + 2} 行 matches 不是有效 JSON。`) }
    return QuestionSchema.parse({ id: id(), setId: deterministicSetId, order: index, prompt: row.prompt, title: row.questionTitle || '', questionType: row.questionType, points: Number(row.points || 1), options, correctAnswers, acceptedAnswers, matches, explanation: row.explanation || '', tags: row.tags ? row.tags.split('|').map((tag) => tag.trim()).filter(Boolean) : [], createdAt: stamp, updatedAt: stamp })
  })
  return { set, questions }
}

function stableHash(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619) }
  return (hash >>> 0).toString(36)
}

function compareQuestionOrder(a: Question, b: Question) {
  return a.setId.localeCompare(b.setId) || (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

export function exportQuestionsCsv(questions: Question[], setTitle: string, skill: string, part: string) {
  const rows = questions.map((question) => ({ title: setTitle, skill, part, questionType: question.questionType, prompt: question.prompt, options: JSON.stringify(question.options), correctAnswers: JSON.stringify(question.correctAnswers), acceptedAnswers: JSON.stringify(question.acceptedAnswers), matches: JSON.stringify(question.matches), points: question.points, explanation: question.explanation, tags: question.tags.join('|') })).map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'string' && /^[=+@\-]/.test(value) ? `'${value}` : value])))
  return Papa.unparse(rows)
}

export function downloadFile(filename: string, data: string, type = 'application/json') {
  const href = URL.createObjectURL(new Blob([data], { type }))
  const anchor = document.createElement('a')
  anchor.href = href; anchor.download = filename; anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(href), 1000)
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  return btoa(binary)
}
function base64ToBlob(base64: string, type: string) { return new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type }) }

export async function saveImportedQuestions(set: unknown, questions: unknown[]) {
  const checkedSet = StudySetSchema.parse(set)
  const checkedQuestions = questions.map((question) => QuestionSchema.parse(question))
  await db.transaction('rw', db.sets, db.questions, async () => {
    if (await db.sets.get(checkedSet.id)) throw new Error('该题组 ID 已存在。')
    await db.sets.add(checkedSet)
    await db.questions.bulkAdd(checkedQuestions)
  })
}
