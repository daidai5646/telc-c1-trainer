import type { Question } from './model'

export type UserAnswer = Record<string, string | string[]>
export interface Grade { earnedPoints: number; maxPoints: number; percentage: number; isCorrect: boolean; correctAnswers: Question['correctAnswers'] }

const normalize = (value: string, question: Question) => {
  const trimmed = question.scoringRules.trim ? value.trim() : value
  return question.scoringRules.ignoreCase ? trimmed.toLocaleLowerCase() : trimmed
}
const asSet = (values: string[]) => [...new Set(values)].sort()

export function gradeQuestion(question: Question, answer: UserAnswer): Grade {
  let ratio = 0
  if (question.questionType === 'single-choice' || question.questionType === 'multiple-choice') {
    const expected = question.correctAnswers.selectedOptionIds
    const actual = answer.selectedOptionIds
    const expectedIds = Array.isArray(expected) ? expected : []
    const actualIds = Array.isArray(actual) ? actual : typeof actual === 'string' ? [actual] : []
    const exact = JSON.stringify(asSet(expectedIds)) === JSON.stringify(asSet(actualIds))
    ratio = exact ? 1 : question.scoringRules.partialCredit && expectedIds.length ? asSet(actualIds.filter((id) => expectedIds.includes(id))).length / expectedIds.length : 0
  } else if (question.questionType === 'matching' || question.questionType === 'text-reconstruction') {
    const expected = question.correctAnswers.pairs
    const pairs = expected && !Array.isArray(expected) && typeof expected === 'object' ? expected : {}
    const keys = Object.keys(pairs)
    ratio = keys.length ? keys.filter((key) => answer[key] === pairs[key]).length / keys.length : 0
  } else if (question.questionType === 'true-false-not-stated') {
    ratio = answer.value === question.correctAnswers.value ? 1 : 0
  } else if (question.questionType === 'gap-fill') {
    const slots = Object.entries(question.acceptedAnswers)
    ratio = slots.length ? slots.filter(([key, variants]) => {
      const value = answer[key]
      const entered = typeof value === 'string' ? value : ''
      return variants.some((candidate) => normalize(candidate, question) === normalize(entered, question))
    }).length / slots.length : 0
  }
  const earnedPoints = Math.round(question.points * ratio * 100) / 100
  return { earnedPoints, maxPoints: question.points, percentage: Math.round(ratio * 100), isCorrect: ratio === 1, correctAnswers: question.correctAnswers }
}

export function gradeSet(questions: Question[], answers: Record<string, UserAnswer>) {
  const grades = questions.map((question) => ({ questionId: question.id, ...gradeQuestion(question, answers[question.id] ?? {}) }))
  const maxPoints = grades.reduce((sum, grade) => sum + grade.maxPoints, 0)
  const earnedPoints = grades.reduce((sum, grade) => sum + grade.earnedPoints, 0)
  return { grades, maxPoints, earnedPoints, percentage: maxPoints ? Math.round((earnedPoints / maxPoints) * 100) : 0 }
}
