import { z } from 'zod'

export const SkillSchema = z.enum(['reading', 'listening', 'writing', 'speaking'])
export type Skill = z.infer<typeof SkillSchema>

export const StudyCategorySchema = z.enum(['reading1', 'reading2', 'reading3', 'listening1', 'listening2', 'listening3', 'reading123', 'listening123', 'other'])
export type StudyCategoryId = z.infer<typeof StudyCategorySchema>
export function defaultCategoryForSkill(skill: Skill): StudyCategoryId {
  if (skill === 'reading') return 'reading1'
  if (skill === 'listening') return 'listening1'
  return 'other'
}
export function categoryForSet(skill: Skill, part: string, title = ''): StudyCategoryId {
  if (skill !== 'reading' && skill !== 'listening') return 'other'
  const match = `${part} ${title}`.match(/(?:teil|part|阅读|听力)\s*([123])|(?:^|\D)([123])(?:\D|$)/i)
  const number = match?.[1] ?? match?.[2] ?? '1'
  return `${skill}${number}` as StudyCategoryId
}

export const QuestionTypeSchema = z.enum([
  'single-choice',
  'multiple-choice',
  'matching',
  'true-false-not-stated',
  'text-reconstruction',
  'gap-fill',
])
export type QuestionType = z.infer<typeof QuestionTypeSchema>

const OptionSchema = z.object({ id: z.string().min(1), text: z.string().min(1) })
const MatchSchema = z.object({ id: z.string().min(1), prompt: z.string().min(1), answer: z.string().min(1).optional() })
const ImportedAudioSchema = z.object({ id: z.string().min(1), name: z.string().min(1), mimeType: z.string().min(1), size: z.number().int().positive().max(25 * 1024 * 1024), base64: z.string().regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/), createdAt: z.string() }).superRefine((audio, ctx) => {
  if (!['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/aac'].includes(audio.mimeType)) ctx.addIssue({ code: 'custom', message: '导入音频格式不支持', path: ['mimeType'] })
  if (audio.base64.length > 35 * 1024 * 1024) ctx.addIssue({ code: 'custom', message: '导入音频过大', path: ['base64'] })
})
const BaseQuestionSchema = z.object({
  id: z.string().min(1),
  setId: z.string().min(1),
  title: z.string().default(''),
  prompt: z.string().min(1),
  questionType: QuestionTypeSchema,
  points: z.number().positive().default(1),
  options: z.array(OptionSchema).default([]),
  matches: z.array(MatchSchema).default([]),
  correctAnswers: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.record(z.string(), z.string())])).default({}),
  acceptedAnswers: z.record(z.string(), z.array(z.string())).default({}),
  explanation: z.string().default(''),
  tags: z.array(z.string()).default([]),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  scoringRules: z.object({ partialCredit: z.boolean().default(false), ignoreCase: z.boolean().default(true), trim: z.boolean().default(true) }).default(() => ({ partialCredit: false, ignoreCase: true, trim: true })),
  order: z.number().int().nonnegative().optional(),
  isFavorite: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const QuestionSchema = BaseQuestionSchema.superRefine((question, ctx) => {
  const error = (message: string) => ctx.addIssue({ code: 'custom', message, path: ['questionType'] })
  if (new Set(question.options.map((option) => option.id)).size !== question.options.length) error('选项 ID 不能重复')
  if (new Set(question.matches.map((match) => match.id)).size !== question.matches.length) error('匹配项 ID 不能重复')
  if (['single-choice', 'multiple-choice'].includes(question.questionType)) {
    if (question.options.length < 2) error('选择题至少需要两个选项')
    const ids = question.options.map((option) => option.id)
    const answers = question.correctAnswers.selectedOptionIds
    if (!Array.isArray(answers) || !answers.length || answers.some((id) => !ids.includes(id))) error('正确选项必须引用已有选项')
    if (question.questionType === 'single-choice' && Array.isArray(answers) && answers.length !== 1) error('单选题只能有一个正确选项')
  }
  if (['matching', 'text-reconstruction'].includes(question.questionType)) {
    if (!question.matches.length) error('匹配题至少需要一组对应关系')
    const answers = question.correctAnswers.pairs
    if (!answers || Array.isArray(answers) || typeof answers !== 'object') error('匹配题需要配置对应答案')
    else if (question.matches.some((match) => {
      const selected = (answers as Record<string, string>)[match.id]
      return !selected || !(question.options.some((option) => option.id === selected) || question.matches.some((option) => option.answer === selected))
    })) error('每个匹配项都必须设置有效的正确答案')
    if (question.options.length && new Set(question.options.map((option) => option.id)).size !== question.options.length) error('选项 ID 不能重复')
    if (question.questionType === 'text-reconstruction' && question.matches.some((match) => !question.prompt.includes(`{{${match.id}}}`))) error('文本重构题的题干需要为每个匹配项添加对应空格标记，例如 {{match-1}}')
  }
  if (question.questionType === 'true-false-not-stated' && !['true', 'false', 'not-stated'].includes(String(question.correctAnswers.value))) error('请设置判断题答案')
  if (question.questionType === 'gap-fill' && !Object.keys(question.acceptedAnswers).length) error('填空题需要至少一个空格及可接受答案')
})
export type Question = z.infer<typeof QuestionSchema>

export const StudySetSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  exam: z.string().default('telc C1 Hochschule'),
  skill: SkillSchema,
  categoryId: StudyCategorySchema.optional(),
  part: z.string().min(1),
  instruction: z.string().default(''),
  passageId: z.string().optional(),
  audioId: z.string().optional(),
  modeDefaultSeconds: z.number().int().positive().optional(),
  tags: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type StudySet = z.infer<typeof StudySetSchema>

export const PassageSchema = z.object({ id: z.string().min(1), title: z.string().min(1), body: z.string(), createdAt: z.string(), updatedAt: z.string() })
export type Passage = z.infer<typeof PassageSchema>

export const AudioAssetSchema = z.object({ id: z.string().min(1), name: z.string(), mimeType: z.string(), size: z.number().int().positive(), blob: z.instanceof(Blob), createdAt: z.string() })
export type AudioAsset = z.infer<typeof AudioAssetSchema>

export const AttemptAnswerSchema = z.object({ questionId: z.string(), answer: z.record(z.string(), z.union([z.string(), z.array(z.string())])), earnedPoints: z.number(), maxPoints: z.number(), isCorrect: z.boolean(), questionSnapshot: z.object({ prompt: z.string(), questionType: QuestionTypeSchema, options: z.array(OptionSchema), matches: z.array(MatchSchema), correctAnswers: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.record(z.string(), z.string())])), acceptedAnswers: z.record(z.string(), z.array(z.string())), explanation: z.string(), tags: z.array(z.string()), difficulty: z.enum(['easy', 'medium', 'hard']) }) })
export const AttemptSchema = z.object({ id: z.string(), setId: z.string(), setIds: z.array(z.string()).optional(), setTitle: z.string(), skill: SkillSchema, part: z.string(), mode: z.enum(['practice', 'exam']), startedAt: z.string(), completedAt: z.string(), durationSeconds: z.number().nonnegative(), answers: z.array(AttemptAnswerSchema), earnedPoints: z.number().nonnegative(), maxPoints: z.number().nonnegative(), percentage: z.number().min(0).max(100) })
export type Attempt = z.infer<typeof AttemptSchema>

export const PracticeDraftSchema = z.object({ id: z.string(), setId: z.string(), mode: z.enum(['practice', 'exam']), startedAt: z.number(), timeLeft: z.number().nonnegative(), answers: z.record(z.string(), z.record(z.string(), z.union([z.string(), z.array(z.string())]))), updatedAt: z.string() })
export type PracticeDraft = z.infer<typeof PracticeDraftSchema>

export const SettingsSchema = z.object({ defaultExam: z.string().default('telc C1 Hochschule'), language: z.enum(['zh', 'de']).default('zh'), showAnswersAfterSubmit: z.boolean().default(true), defaultExamSeconds: z.number().int().positive().default(90 * 60) })
export type Settings = z.infer<typeof SettingsSchema>

export const SubmissionSchema = z.object({ id: z.string(), skill: z.enum(['writing', 'speaking']), title: z.string().min(1), response: z.string(), rubric: z.string().default(''), feedback: z.string().default(''), score: z.number().min(0).max(100).optional(), audioId: z.string().optional(), createdAt: z.string(), updatedAt: z.string() })
export type Submission = z.infer<typeof SubmissionSchema>

export const ImportBundleSchema = z.object({ format: z.literal('telc-c1-trainer'), version: z.literal(1), exportedAt: z.string(), sets: z.array(StudySetSchema), questions: z.array(QuestionSchema), passages: z.array(PassageSchema), audio: z.array(ImportedAudioSchema).default([]) })
export type ImportBundle = z.infer<typeof ImportBundleSchema>
export const FullBackupSchema = ImportBundleSchema.extend({ backup: z.literal(true), attempts: z.array(AttemptSchema), drafts: z.array(PracticeDraftSchema).default([]), submissions: z.array(SubmissionSchema).default([]), settings: z.array(SettingsSchema.extend({ id: z.literal('main') })) })
export type FullBackup = z.infer<typeof FullBackupSchema>

export const id = () => crypto.randomUUID()
export const now = () => new Date().toISOString()
