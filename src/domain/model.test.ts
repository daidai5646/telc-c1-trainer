import { describe, expect, it } from 'vitest'
import { QuestionSchema, StudySetSchema } from './model'

const base = { id: 'q', setId: 's', title: '', prompt: 'Question', points: 1, options: [], matches: [], correctAnswers: {}, acceptedAnswers: {}, explanation: '', tags: [], difficulty: 'medium', scoringRules: {}, createdAt: '2026-01-01', updatedAt: '2026-01-01' }

describe('question model validation', () => {
  it('validates single and multiple choice answers against existing options', () => {
    const valid = { ...base, questionType: 'single-choice', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctAnswers: { selectedOptionIds: ['a'] } }
    expect(QuestionSchema.safeParse(valid).success).toBe(true)
    expect(QuestionSchema.safeParse({ ...valid, correctAnswers: { selectedOptionIds: ['missing'] } }).success).toBe(false)
    expect(QuestionSchema.safeParse({ ...valid, questionType: 'multiple-choice', correctAnswers: { selectedOptionIds: [] } }).success).toBe(false)
  })
  it('requires type-specific matching, boolean and gap-fill keys', () => {
    expect(QuestionSchema.safeParse({ ...base, questionType: 'matching', matches: [], correctAnswers: { pairs: {} } }).success).toBe(false)
    const matching = { ...base, questionType: 'matching', matches: [{ id: 'match-1', prompt: '(1)' }], options: [{ id: 'option-1', text: 'Correct' }, { id: 'option-2', text: 'Distractor' }], correctAnswers: { pairs: { 'match-1': 'option-1' } } }
    expect(QuestionSchema.safeParse(matching).success).toBe(true)
    expect(QuestionSchema.safeParse({ ...matching, correctAnswers: { pairs: { 'match-1': 'missing-option' } } }).success).toBe(false)
    expect(QuestionSchema.safeParse({ ...base, questionType: 'true-false-not-stated', correctAnswers: { value: 'maybe' } }).success).toBe(false)
    expect(QuestionSchema.safeParse({ ...base, questionType: 'gap-fill', acceptedAnswers: {} }).success).toBe(false)
  })
  it('rejects unsupported skills and empty set metadata', () => {
    const set = { id: 's', title: 'Set', exam: 'telc C1 Hochschule', skill: 'reading', part: 'Teil 1', instruction: '', createdAt: 'x', updatedAt: 'x' }
    expect(StudySetSchema.safeParse(set).success).toBe(true)
    expect(StudySetSchema.safeParse({ ...set, skill: 'translation' }).success).toBe(false)
    expect(StudySetSchema.safeParse({ ...set, title: '' }).success).toBe(false)
  })
})
