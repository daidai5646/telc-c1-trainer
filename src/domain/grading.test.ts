import { describe, expect, it } from 'vitest'
import { gradeQuestion } from './grading'
import type { Question } from './model'

function question(overrides: Partial<Question>): Question {
  return { id: 'q1', setId: 's1', title: '', prompt: 'Question', questionType: 'single-choice', points: 1, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], matches: [], correctAnswers: { selectedOptionIds: ['a'] }, acceptedAnswers: {}, explanation: '', tags: [], difficulty: 'medium', scoringRules: { partialCredit: false, ignoreCase: true, trim: true }, createdAt: '', updatedAt: '', ...overrides }
}

describe('deterministic grading', () => {
  it('marks a correct and incorrect single choice', () => {
    expect(gradeQuestion(question({}), { selectedOptionIds: ['a'] }).isCorrect).toBe(true)
    expect(gradeQuestion(question({}), { selectedOptionIds: ['b'] }).earnedPoints).toBe(0)
  })
  it('requires an exact multi-select by default', () => {
    const q = question({ questionType: 'multiple-choice', correctAnswers: { selectedOptionIds: ['a', 'b'] } })
    expect(gradeQuestion(q, { selectedOptionIds: ['a'] }).isCorrect).toBe(false)
    expect(gradeQuestion(q, { selectedOptionIds: ['b', 'a'] }).isCorrect).toBe(true)
  })
  it('scores matching and true/false/not stated answers', () => {
    const matching = question({ questionType: 'matching', matches: [{ id: 'm1', prompt: '1', answer: 'A' }, { id: 'm2', prompt: '2', answer: 'B' }], correctAnswers: { pairs: { m1: 'A', m2: 'B' } } as unknown as Question['correctAnswers'] })
    expect(gradeQuestion(matching, { m1: 'A', m2: 'X' }).percentage).toBe(50)
    const tf = question({ questionType: 'true-false-not-stated', correctAnswers: { value: 'not-stated' } })
    expect(gradeQuestion(tf, { value: 'not-stated' }).isCorrect).toBe(true)
  })
  it('scores text reconstruction blanks and configured partial credit', () => {
    const reconstruction = question({ questionType: 'text-reconstruction', prompt: 'Text {{match-1}}', matches: [{ id: 'match-1', prompt: 'Lücke 1', answer: 'A sentence' }], correctAnswers: { pairs: { 'match-1': 'A sentence' } } })
    expect(gradeQuestion(reconstruction, { 'match-1': 'A sentence' }).isCorrect).toBe(true)
    const multiple = question({ questionType: 'multiple-choice', correctAnswers: { selectedOptionIds: ['a', 'b'] }, scoringRules: { partialCredit: true, ignoreCase: true, trim: true } })
    expect(gradeQuestion(multiple, { selectedOptionIds: ['a'] }).percentage).toBe(50)
  })
  it('grades match-to-option IDs independently of option display order and supports distractors', () => {
    const matching = question({
      questionType: 'matching',
      options: [{ id: 'choice-a', text: 'Distractor' }, { id: 'choice-b', text: 'Correct one' }, { id: 'choice-c', text: 'Correct two' }],
      matches: [{ id: 'match-1', prompt: '(1)' }, { id: 'match-2', prompt: '(2)' }],
      correctAnswers: { pairs: { 'match-1': 'choice-b', 'match-2': 'choice-c' } },
    })
    expect(gradeQuestion(matching, { 'match-1': 'choice-b', 'match-2': 'choice-c' }).isCorrect).toBe(true)
    expect(gradeQuestion(matching, { 'match-1': 'choice-a', 'match-2': 'choice-c' }).percentage).toBe(50)
  })
  it('accepts case and whitespace normalized gap-fill variants', () => {
    const q = question({ questionType: 'gap-fill', correctAnswers: {}, acceptedAnswers: { g1: ['Universität', 'Uni'] } })
    expect(gradeQuestion(q, { g1: '  UNIVERSITÄT ' }).isCorrect).toBe(true)
  })
})
