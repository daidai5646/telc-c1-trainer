import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { db } from '../data/database'
import { gradeQuestion, gradeSet, type UserAnswer } from '../domain/grading'
import { now, type Attempt, type Question, type StudySet, type Settings, type Passage, type AudioAsset } from '../domain/model'

export function Practice() {
  const { setId } = useParams(); const navigate = useNavigate(); const [searchParams] = useSearchParams()
  const [set, setSet] = useState<StudySet | null>(null); const [questions, setQuestions] = useState<Question[]>([]); const [passage, setPassage] = useState<Passage | null>(null); const [audio, setAudio] = useState<AudioAsset | null>(null)
  const [answers, setAnswers] = useState<Record<string, UserAnswer>>({}); const [mode, setMode] = useState<'practice' | 'exam'>('practice'); const [startedAt, setStartedAt] = useState<number>(Date.now()); const [timeLeft, setTimeLeft] = useState(0); const [examSeconds, setExamSeconds] = useState(90 * 60); const [result, setResult] = useState<Attempt | null>(null); const [loading, setLoading] = useState(true); const [ready, setReady] = useState(false); const [isSubmitting, setIsSubmitting] = useState(false); const [error, setError] = useState('')
  const [showAnswers, setShowAnswers] = useState(true)
  const wrongIds = searchParams.get('wrong')?.split(',').filter(Boolean)
  const wrongKey = wrongIds?.slice().sort().join(',') ?? ''
  const currentDraftId = draftIdFor(setId ?? '', wrongKey)
  useEffect(() => {
    let alive = true
    async function load() {
      if (!setId) { setLoading(false); return }
      setLoading(true); setReady(false); setError(''); setResult(null); setSet(null)
      try {
        const found = await db.sets.get(setId)
        if (!found) { setError('没有找到这个题组。'); setLoading(false); return }
        const [allQuestions, article, audioAsset, savedSettings, draft] = await Promise.all([db.questions.where('setId').equals(setId).toArray(), found.passageId ? db.passages.get(found.passageId) : undefined, found.audioId ? db.audio.get(found.audioId) : undefined, db.settings.get('main'), db.drafts.get(currentDraftId)])
        if (!alive) return
        setSet(found); setQuestions(wrongIds ? allQuestions.filter((q) => wrongIds.includes(q.id)) : allQuestions); setPassage(article ?? null); setAudio(audioAsset ?? null)
        setShowAnswers((savedSettings as (Settings & { id: string }) | undefined)?.showAnswersAfterSubmit ?? true)
        const seconds = found.modeDefaultSeconds ?? (savedSettings as (Settings & { id: string }) | undefined)?.defaultExamSeconds ?? 90 * 60
        setExamSeconds(seconds); setTimeLeft(draft?.timeLeft ?? seconds); setStartedAt(draft?.startedAt ?? Date.now()); setMode(draft?.mode ?? 'practice'); setAnswers(draft?.answers ?? {}); setReady(true); setLoading(false)
      } catch (cause) { if (alive) { setError(cause instanceof Error ? cause.message : '载入题组失败。'); setLoading(false) } }
    }
    void load(); return () => { alive = false }
  }, [setId, wrongKey])

  const questionsRef = questions
  const setRef = set
  const answersRef = answers
  const modeRef = mode
  const startedAtRef = startedAt
  const draftIdRef = currentDraftId
  const submittingRef = useRef(false)
  const submit = useCallback(async () => {
    if (!setRef || !questionsRef.length || result || submittingRef.current) return
    submittingRef.current = true; setIsSubmitting(true)
    const graded = gradeSet(questionsRef, answersRef)
    const stamp = now()
    const attempt: Attempt = {
      id: crypto.randomUUID(), setId: setRef.id, setTitle: setRef.title, skill: setRef.skill, part: setRef.part,
      mode: modeRef, startedAt: new Date(startedAtRef).toISOString(), completedAt: stamp,
      durationSeconds: Math.max(0, Math.round((Date.now() - startedAtRef) / 1000)),
      answers: questionsRef.map((question) => {
        const grade = gradeQuestion(question, answersRef[question.id] ?? {})
        return { questionId: question.id, answer: answersRef[question.id] ?? {}, earnedPoints: grade.earnedPoints, maxPoints: grade.maxPoints, isCorrect: grade.isCorrect, questionSnapshot: { prompt: question.prompt, questionType: question.questionType, options: question.options, matches: question.matches, correctAnswers: question.correctAnswers, acceptedAnswers: question.acceptedAnswers, explanation: question.explanation, tags: question.tags, difficulty: question.difficulty } }
      }),
      earnedPoints: graded.earnedPoints, maxPoints: graded.maxPoints, percentage: graded.percentage,
    }
    try {
      await db.transaction('rw', [db.attempts, db.drafts], async () => { await db.attempts.add(attempt); await db.drafts.delete(draftIdRef) })
      setResult(attempt)
    } catch (cause) { setError(cause instanceof Error ? `保存练习记录失败：${cause.message}` : '保存练习记录失败。') }
    finally { setIsSubmitting(false); submittingRef.current = false }
  }, [setRef, questionsRef, answersRef, modeRef, startedAtRef, result, draftIdRef])

  useEffect(() => {
    if (!ready || !set || result) return
    const timer = window.setTimeout(() => { void db.drafts.put({ id: currentDraftId, setId: set.id, mode, startedAt, timeLeft, answers, updatedAt: now() }).catch((cause: unknown) => setError(cause instanceof Error ? `保存作答草稿失败：${cause.message}` : '保存作答草稿失败。')) }, 250)
    return () => window.clearTimeout(timer)
  }, [ready, set, result, currentDraftId, mode, startedAt, timeLeft, answers])

  useEffect(() => {
    if (mode !== 'exam' || result || !questions.length) return
    const timer = window.setInterval(() => setTimeLeft((seconds) => { if (seconds <= 1) { window.clearInterval(timer); void submit(); return 0 } return seconds - 1 }), 1000)
    return () => window.clearInterval(timer)
  }, [mode, result, questions.length, submit])

  function selectMode(next: 'practice' | 'exam') { setMode(next); setStartedAt(Date.now()); setAnswers({}); setResult(null); if (next === 'exam') setTimeLeft(examSeconds) }
  function updateAnswer(questionId: string, key: string, value: string | string[]) { setAnswers((current) => ({ ...current, [questionId]: { ...(current[questionId] ?? {}), [key]: value } })) }
  function restart() { setAnswers({}); setResult(null); setStartedAt(Date.now()); setTimeLeft(examSeconds) }
  function redoWrong() { if (!result) return; const ids = result.answers.filter((a) => !a.isCorrect).map((a) => a.questionId); if (ids.length) navigate(`/practice/${result.setId}?wrong=${ids.join(',')}`); else restart() }

  if (loading) return <div className="page"><p>题组载入中…</p></div>
  if (error && !set) return <div className="page"><div className="alert error-alert">{error}</div><Link to="/library" className="button button-dark">返回题库</Link></div>
  if (!set) return null
  const isListening = set.skill === 'listening'
  const hasListeningMatching = isListening && questions.some((question) => question.questionType === 'matching')
  const readableTime = `${Math.floor(timeLeft / 60).toString().padStart(2, '0')}:${(timeLeft % 60).toString().padStart(2, '0')}`
  return <div className="practice-page">
    <header className="practice-header"><Link to="/library" className="back-link">← Meine Aufgaben</Link><div className="practice-title"><div className="eyebrow">{isListening ? 'HÖRVERSTEHEN' : 'LESEVERSTEHEN'} · {set.part}</div><h1>{set.title}</h1></div><div className="practice-tools"><div className="mode-toggle" aria-label="练习模式"><button className={mode === 'practice' ? 'selected' : ''} onClick={() => selectMode('practice')}>练习</button><button className={mode === 'exam' ? 'selected' : ''} onClick={() => selectMode('exam')}>考试</button></div>{mode === 'exam' && <div className={`timer ${timeLeft < 300 ? 'timer-low' : ''}`} aria-live="polite">◷ {readableTime}</div>}</div></header>
    {set.instruction && <div className="instruction-strip"><span>AUFGABENSTELLUNG</span>{set.instruction}</div>}
    {error && <div className="alert error-alert" role="alert">{error}<button onClick={() => setError('')}>×</button></div>}
    {isListening && audio && <AudioPlayer asset={audio} />}
    {isListening && !audio && <div className="notice-card compact"><span>♫</span><p>该听力题组尚未关联音频。可返回“Meine Aufgaben”编辑题组并添加音频。</p></div>}
    {(set.skill === 'reading' || isListening) && passage && <article className={`passage-card ${hasListeningMatching ? 'listening-transcript-card' : ''}`}><div className="passage-heading"><span>{isListening ? 'HÖRTEXT / TRANSKRIPT' : 'LESETEXT'}</span><strong>{passage.title}</strong></div><div className="passage-body">{passage.body.split('\n').map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div></article>}
    {!questions.length ? <div className="empty-card"><div><strong>{wrongIds ? '这个练习没有错题。' : '题组中还没有题目。'}</strong><p>先在题库中添加题目，然后开始练习。</p></div><Link className="button button-dark" to="/library">编辑题组</Link></div> : result ? <ResultPanel attempt={result} showAnswers={showAnswers} onRedo={redoWrong} onRestart={restart} /> : <>
      <div className="question-progress"><span>{questions.length} 道题</span><div><span style={{ width: `${questions.length ? Object.keys(answers).filter((key) => Object.values(answers[key] ?? {}).some((value) => Array.isArray(value) ? value.length : Boolean(value))).length / questions.length * 100 : 0}%` }} /></div><small>{Object.keys(answers).filter((key) => Object.values(answers[key] ?? {}).some((value) => Array.isArray(value) ? value.length : Boolean(value))).length}/{questions.length} 已作答</small></div>
      <section className="practice-questions">{questions.map((question, index) => <QuestionCard key={question.id} question={question} number={index + 1} answer={answers[question.id] ?? {}} update={(key, value) => updateAnswer(question.id, key, value)} />)}</section>
      <div className="submit-bar"><span>答题内容会自动保存在本机；答完后提交查看分数、正确答案和解析。</span><button className="button button-dark" disabled={isSubmitting} onClick={() => void submit()}>{isSubmitting ? '正在保存…' : '提交答案　→'}</button></div>
    </>}
  </div>
}

function QuestionCard({ question, number, answer, update }: { question: Question; number: number; answer: UserAnswer; update: (key: string, value: string | string[]) => void }) {
  const selected = Array.isArray(answer.selectedOptionIds) ? answer.selectedOptionIds : typeof answer.selectedOptionIds === 'string' ? [answer.selectedOptionIds] : []
  function toggleOption(optionId: string) {
    if (question.questionType === 'single-choice') update('selectedOptionIds', [optionId])
    else update('selectedOptionIds', selected.includes(optionId) ? selected.filter((id) => id !== optionId) : [...selected, optionId])
  }
  return <article className="practice-question"><div className="question-card-header"><span className="question-number">{String(number).padStart(2, '0')}</span><span className="pill">{typeName(question.questionType)}</span><span className="question-points">{question.points} 分</span></div><h2><PromptWithInputs prompt={question.prompt} question={question} answer={answer} update={update} /></h2>
    {(question.questionType === 'single-choice' || question.questionType === 'multiple-choice') && <div className="answer-options">{question.options.map((option, index) => <label key={option.id} className={`answer-option ${selected.includes(option.id) ? 'option-selected' : ''}`}><input type={question.questionType === 'single-choice' ? 'radio' : 'checkbox'} name={`q-${question.id}`} checked={selected.includes(option.id)} onChange={() => toggleOption(option.id)} /><span className="option-letter">{String.fromCharCode(65 + index)}</span><span>{option.text}</span></label>)}</div>}
    {question.questionType === 'matching' && <div className="matching-list">{question.matches.map((match) => <label key={match.id}><span>{match.prompt}</span><select aria-label={`匹配 ${match.prompt}`} value={String(answer[match.id] ?? '')} onChange={(e) => update(match.id, e.target.value)}><option value="">请选择…</option>{matchChoices(question).map((option) => <option key={option.id} value={option.id}>{option.text}</option>)}</select></label>)}</div>}
    {question.questionType === 'true-false-not-stated' && <div className="truth-options">{[['true', 'Richtig'], ['false', 'Falsch'], ['not-stated', 'Nicht im Text']].map(([value, label]) => <label key={value} className={`truth-choice ${answer.value === value ? 'option-selected' : ''}`}><input type="radio" name={`truth-${question.id}`} value={value} checked={answer.value === value} onChange={() => update('value', value)} />{label}</label>)}</div>}
    {question.questionType === 'gap-fill' && <div className="gap-answer-list">{Object.keys(question.acceptedAnswers).map((key) => <label key={key}><span>{key}</span><input aria-label={`答案 ${key}`} value={String(answer[key] ?? '')} onChange={(e) => update(key, e.target.value)} /></label>)}</div>}
  </article>
}

function PromptWithInputs({ prompt, question, answer, update }: { prompt: string; question: Question; answer: UserAnswer; update: (key: string, value: string | string[]) => void }) {
  if (question.questionType !== 'text-reconstruction' && question.questionType !== 'gap-fill') return prompt
  const tokens = prompt.split(/(\{\{[^}]+\}\})/g)
  return <>{tokens.map((token, index) => { const match = token.match(/^\{\{(.+)\}\}$/); if (!match) return <span key={index}>{token}</span>; const key = match[1]!; if (question.questionType === 'gap-fill') return <span className="gap-slot" key={index}>[{key}]</span>; return <select className="inline-gap" key={index} aria-label={`插入 ${key}`} value={String(answer[key] ?? '')} onChange={(event) => update(key, event.target.value)}><option value="">请选择…</option>{matchChoices(question).map((option) => <option key={option.id} value={option.id}>{option.text}</option>)}</select> })}</>
}

function ResultPanel({ attempt, showAnswers, onRedo, onRestart }: { attempt: Attempt; showAnswers: boolean; onRedo: () => void; onRestart: () => void }) {
  return <section className="result-panel"><div className="result-score"><span className="eyebrow">ERGEBNIS</span><strong>{attempt.percentage}<small>%</small></strong><span>{attempt.earnedPoints} / {attempt.maxPoints} Punkte</span><div className="result-bar"><span style={{ width: `${attempt.percentage}%` }} /></div><div className="result-actions"><button className="button button-dark" onClick={onRedo}>错题重做</button><button className="button button-outline" onClick={onRestart}>重新练习</button><Link to="/history" className="text-link">查看历史 →</Link></div></div>{showAnswers && <div className="result-review"><div className="section-heading"><div><div className="eyebrow">ANTWORTEN</div><h2>答案与解析</h2></div></div>{attempt.answers.map((answer, index) => <article className={`review-card ${answer.isCorrect ? 'review-correct' : 'review-wrong'}`} key={answer.questionId}><div className="review-heading"><span>{answer.isCorrect ? '✓ Richtig' : '× Falsch'}</span><small>{answer.earnedPoints}/{answer.maxPoints} 分</small></div><h3>{index + 1}. {answer.questionSnapshot.prompt}</h3><p><strong>正确答案：</strong>{formatAnswer(answer.questionSnapshot.correctAnswers, answer.questionSnapshot.options, answer.questionSnapshot.matches, answer.questionSnapshot.acceptedAnswers)}</p>{(!answer.isCorrect || answer.questionSnapshot.questionType === 'gap-fill') && <p><strong>你的答案：</strong>{formatAnswer(answer.answer, answer.questionSnapshot.options, answer.questionSnapshot.matches, answer.questionSnapshot.acceptedAnswers)}</p>}{answer.questionSnapshot.explanation && <p className="explanation"><strong>解析：</strong>{answer.questionSnapshot.explanation}</p>}</article>)}</div>}</section>
}

function formatAnswer(answer: Record<string, string | string[] | Record<string, string>>, options: { id: string; text: string }[], matches: { id: string; prompt: string; answer?: string }[], accepted: Record<string, string[]>) {
  if (Array.isArray(answer.selectedOptionIds)) return answer.selectedOptionIds.map((id) => options.find((option) => option.id === id)?.text ?? id).join('、') || '未作答'
  if (typeof answer.value === 'string') return ({ true: 'Richtig', false: 'Falsch', 'not-stated': 'Nicht im Text' } as Record<string, string>)[answer.value] ?? answer.value
  if (answer.pairs && typeof answer.pairs === 'object' && !Array.isArray(answer.pairs)) return Object.entries(answer.pairs).map(([key, value]) => `${matches.find((item) => item.id === key)?.prompt ?? key}: ${options.find((option) => option.id === value)?.text ?? value}`).join('；')
  const values = Object.entries(answer).map(([key, value]) => { const pair = matches.find((item) => item.id === key); const label = pair?.prompt ?? key; const raw = typeof value === 'string' ? value : Array.isArray(value) ? value.join(', ') : JSON.stringify(value); const normalized = options.find((option) => option.id === raw)?.text ?? raw; const variants = accepted[key]; return `${label}: ${normalized || '未作答'}${variants?.length ? ` (${variants.join(' / ')})` : ''}` })
  return values.join('；') || '未作答'
}

function typeName(type: Question['questionType']) { return ({ 'single-choice': '单选题', 'multiple-choice': '多选题', matching: 'Zuordnung', 'true-false-not-stated': 'Richtig / Falsch / Nicht im Text', 'text-reconstruction': 'Textrekonstruktion', 'gap-fill': '填空题' })[type] }

function draftIdFor(setId: string, wrongKey: string) { return wrongKey ? `${setId}::wrong::${wrongKey}` : setId }

function matchChoices(question: Question) {
  return question.options.length ? question.options : question.matches.filter((match) => match.answer).map((match) => ({ id: match.answer!, text: match.answer! }))
}

function AudioPlayer({ asset }: { asset: AudioAsset }) {
  const [url, setUrl] = useState('')
  useEffect(() => { const objectUrl = URL.createObjectURL(asset.blob); setUrl(objectUrl); return () => URL.revokeObjectURL(objectUrl) }, [asset])
  return <div className="audio-player"><div className="audio-disc">♫</div><div><span>HÖRDATEI</span><strong>{asset.name}</strong></div>{url && <audio controls preload="metadata" src={url}>该浏览器不支持音频播放。</audio>}</div>
}
