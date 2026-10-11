import { beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { db } from '../data/database'
import { Library } from './Library'
import { Practice } from './Practice'

beforeEach(async () => { await db.delete(); await db.open() })

describe('question bank to practice flow', () => {
  it('creates a set and question, submits an answer, and persists its result', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/library']}><Routes><Route path="/library" element={<Library />} /><Route path="/practice/:setId" element={<Practice />} /></Routes></MemoryRouter>)

    await user.click(screen.getByRole('button', { name: /新建题组/ }))
    await user.type(screen.getByLabelText(/题组名称/), 'Test reading set')
    await user.click(screen.getByRole('button', { name: '保存题组' }))
    const setButton = await screen.findByRole('button', { name: /Test reading set/ })
    await user.click(setButton)
    await user.click(screen.getByRole('button', { name: /添加题目/ }))
    await user.type(screen.getByLabelText('题干 / 作答说明'), 'Welche Antwort ist richtig?')
    await user.type(screen.getByLabelText(/选项（每行一个）/), 'Richtig\nFalsch')
    await user.type(screen.getByLabelText(/正确选项序号/), '1')
    await user.click(screen.getByRole('button', { name: '保存题目' }))

    const practiceLink = await screen.findByRole('link', { name: /开始练习/ })
    await user.click(practiceLink)
    await screen.findByText('Welche Antwort ist richtig?')
    await user.click(screen.getByText('Richtig'))
    await user.click(screen.getByRole('button', { name: /提交答案/ }))
    await screen.findByText('ERGEBNIS')
    await waitFor(async () => expect(await db.attempts.count()).toBe(1))
    expect((await db.attempts.toArray())[0]?.percentage).toBe(100)
  })

  it('restores an in-progress answer after refreshing the practice page', async () => {
    const set = { id: 'draft-set', title: 'Draft test', exam: 'telc C1 Hochschule', skill: 'reading' as const, part: 'Teil 1', instruction: '', tags: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    const question = { id: 'draft-question', setId: set.id, title: '', prompt: 'Choose the answer', questionType: 'single-choice' as const, points: 1, options: [{ id: 'a', text: 'Correct' }, { id: 'b', text: 'Wrong' }], matches: [], correctAnswers: { selectedOptionIds: ['a'] }, acceptedAnswers: {}, explanation: '', tags: [], difficulty: 'easy' as const, scoringRules: { partialCredit: false, ignoreCase: true, trim: true }, createdAt: set.createdAt, updatedAt: set.updatedAt }
    await db.sets.add(set); await db.questions.add(question)
    const user = userEvent.setup()
    const app = <MemoryRouter initialEntries={[`/practice/${set.id}`]}><Routes><Route path="/practice/:setId" element={<Practice />} /></Routes></MemoryRouter>
    render(app)
    await screen.findByText('Choose the answer')
    await user.click(screen.getByText('Correct'))
    await waitFor(async () => expect((await db.drafts.get(set.id))?.answers[question.id]?.selectedOptionIds).toEqual(['a']))
    cleanup()
    render(app)
    const restored = await screen.findByText('Correct')
    expect((restored.closest('label')?.querySelector('input') as HTMLInputElement | null)?.checked).toBe(true)
  })

  it('keeps matching prompts, choice pool, and answer key separate in the editor', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/library']}><Routes><Route path="/library" element={<Library />} /><Route path="/practice/:setId" element={<Practice />} /></Routes></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: /新建题组/ }))
    await user.type(screen.getByLabelText(/题组名称/), 'Matching set')
    await user.click(screen.getByRole('button', { name: '保存题组' }))
    await user.click(await screen.findByRole('button', { name: /Matching set/ }))
    await user.click(screen.getByRole('button', { name: /添加题目/ }))
    await user.selectOptions(screen.getByLabelText('题型'), 'matching')
    await user.type(screen.getByLabelText('题干 / 作答说明'), 'Zuordnung')
    await user.type(screen.getByLabelText(/待匹配项目/), '(1)\n(2)')
    await user.type(screen.getByLabelText(/全部选项/), 'Distractor\nCorrect one\nCorrect two')
    await user.type(screen.getByLabelText(/标准答案映射/), '1 => 2\n2 => 3')
    await user.click(screen.getByRole('button', { name: '保存题目' }))
    await user.click(await screen.findByRole('link', { name: /开始练习/ }))
    await screen.findByLabelText('匹配 (1)')
    await user.selectOptions(screen.getByLabelText('匹配 (1)'), 'option-2')
    await user.selectOptions(screen.getByLabelText('匹配 (2)'), 'option-3')
    await user.click(screen.getByRole('button', { name: /提交答案/ }))
    await screen.findByText('ERGEBNIS')
    expect((await db.attempts.toArray())[0]?.percentage).toBe(100)
  })
})
