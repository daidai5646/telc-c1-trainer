import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { db, saveAudio, deleteStudySet } from '../data/database'
import { downloadFile, exportQuestionsCsv, importQuestionBank, parseCsvQuestions, previewImport, type DuplicateStrategy, type ImportPreview } from '../data/exchange'
import { ImportBundleSchema, QuestionSchema, StudySetSchema, categoryForSet, defaultCategoryForSkill, id, now, type Question, type QuestionType, type StudyCategoryId, type StudySet } from '../domain/model'

export function Library() {
  const [params] = useSearchParams()
  const skillFilter = params.get('skill')
  const [sets, setSets] = useState<StudySet[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({ reading1: true, reading2: true, reading3: true, listening1: true, listening2: true, listening3: true, other: true })
  const [setEditor, setSetEditor] = useState<StudySet | 'new' | null>(null)
  const [questionEditor, setQuestionEditor] = useState<{ set: StudySet; question?: Question } | null>(null)
  const [error, setError] = useState('')
  const [importValue, setImportValue] = useState<unknown>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [strategy, setStrategy] = useState<DuplicateStrategy>('skip')
  const [message, setMessage] = useState('')
  const [defaultExam, setDefaultExam] = useState('telc C1 Hochschule')

  async function refresh() {
    const [allSets, allQuestions] = await Promise.all([db.sets.orderBy('updatedAt').reverse().toArray(), db.questions.toArray()])
    allQuestions.sort(compareQuestionOrder)
    const nextOrder = new Map<string, number>()
    const backfilled: Question[] = []
    for (const question of allQuestions) {
      const order = question.order ?? nextOrder.get(question.setId) ?? 0
      nextOrder.set(question.setId, Math.max(nextOrder.get(question.setId) ?? 0, order + 1))
      if (question.order === undefined) { question.order = order; backfilled.push(question) }
    }
    if (backfilled.length) await db.questions.bulkPut(backfilled)
    allQuestions.sort(compareQuestionOrder)
    setSets(allSets); setQuestions(allQuestions)
  }
  useEffect(() => { void refresh(); void db.settings.get('main').then((settings) => { if (settings?.defaultExam) setDefaultExam(settings.defaultExam) }).catch(() => setError('无法读取设置。')) }, [])
  const visibleSets = useMemo(() => skillFilter ? sets.filter((set) => set.skill === skillFilter) : sets, [sets, skillFilter])
  const resolvedCategory = (set: StudySet): StudyCategoryId => !set.categoryId || set.categoryId === 'reading123' || set.categoryId === 'listening123' ? categoryForSet(set.skill, set.part, set.title) : set.categoryId
  const setCount = (setId: string) => questions.filter((question) => question.setId === setId).length
  const categories = useMemo(() => ([
    { id: 'reading1' as const, title: '阅读1', sets: visibleSets.filter((set) => resolvedCategory(set) === 'reading1') },
    { id: 'reading2' as const, title: '阅读2', sets: visibleSets.filter((set) => resolvedCategory(set) === 'reading2') },
    { id: 'reading3' as const, title: '阅读3', sets: visibleSets.filter((set) => resolvedCategory(set) === 'reading3') },
    { id: 'listening1' as const, title: '听力1', sets: visibleSets.filter((set) => resolvedCategory(set) === 'listening1') },
    { id: 'listening2' as const, title: '听力2', sets: visibleSets.filter((set) => resolvedCategory(set) === 'listening2') },
    { id: 'listening3' as const, title: '听力3', sets: visibleSets.filter((set) => resolvedCategory(set) === 'listening3') },
    { id: 'other' as const, title: '其他题组', sets: visibleSets.filter((set) => resolvedCategory(set) === 'other') },
  ]), [visibleSets])

  function renderSetCard(set: StudySet) {
    const setQuestions = questions.filter((question) => question.setId === set.id)
    const isOpen = expanded === set.id
    return <article className={`set-card ${isOpen ? 'set-open' : ''}`} key={set.id}>
      <div className="set-main"><button className="set-toggle" onClick={() => setExpanded(isOpen ? null : set.id)} aria-expanded={isOpen}><span className={`set-icon ${set.skill}`}>{set.skill === 'reading' ? 'Aa' : set.skill === 'listening' ? '♫' : '✎'}</span><span className="set-title"><strong>{set.title}</strong><small>{set.skill === 'reading' ? 'Lesen' : set.skill === 'listening' ? 'Hören' : set.skill} · {set.part} · {setQuestions.length} 道题</small></span><span className="set-chevron">{isOpen ? '⌃' : '⌄'}</span></button><div className="set-actions"><Link className="button button-small button-sage" to={`/practice/${set.id}`}>开始练习 →</Link><button className="text-link" onClick={() => { setError(''); setSetEditor(set) }}>编辑</button><button className="text-link" onClick={() => void exportCsv(set)}>CSV</button><button className="danger-link" onClick={() => void removeSet(set)}>删除</button></div></div>
      {isOpen && <div className="set-expanded"><div className="set-meta"><span>{set.exam}</span>{set.instruction && <p>{set.instruction}</p>}</div>{set.passageId && <PassagePreview passageId={set.passageId} onEdit={() => setSetEditor(set)} />}{set.audioId && <AudioPreview audioId={set.audioId} />}<div className="question-list">{setQuestions.map((question, index) => <div className="question-row" key={question.id}><span className="question-number">{String(index + 1).padStart(2, '0')}</span><div className="question-row-copy"><strong>{question.title || question.prompt}</strong><small>{questionTypeName(question.questionType)} · {question.points} 分 · {question.difficulty}</small></div><button className="text-link" onClick={() => setQuestionEditor({ set, question })}>编辑</button><button className="text-link" onClick={async () => { const copy = QuestionSchema.parse({ ...question, id: id(), title: `${question.title || '题目'}（副本）`, createdAt: now(), updatedAt: now() }); await db.questions.add(copy); await refresh() }}>复制</button><button className="danger-link" onClick={async () => { if (window.confirm('删除这道题？历史练习中的题目快照会保留。')) { await db.questions.delete(question.id); await refresh() } }}>删除</button></div>)}</div><div className="set-footer"><span>{set.passageId ? '✓ 已关联文章' : '尚无文章'}　{set.audioId ? '✓ 已关联音频' : '尚无音频'}</span><button className="button button-small button-outline" onClick={() => setQuestionEditor({ set })}>＋ 添加题目</button></div></div>}
    </article>
  }

  async function handleImportFile(file?: File) {
    if (!file) return
    setError(''); setPreview(null); setImportValue(null)
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error('导入文件需小于 30 MB。')
      if (file.name.toLowerCase().endsWith('.csv')) {
        const parsed = parseCsvQuestions(await file.text())
        const value = { format: 'telc-c1-trainer', version: 1, exportedAt: now(), sets: [parsed.set], questions: parsed.questions, passages: [], audio: [] }
        const result = await previewImport(value)
        setImportValue(value); setPreview(result); return
      }
      const value: unknown = JSON.parse(await file.text())
      const checked = ImportBundleSchema.parse(value)
      const result = await previewImport(checked)
      setImportValue(checked); setPreview(result)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '文件读取失败。') }
  }

  async function runImport() {
    if (!importValue) return
    try { const result = await importQuestionBank(importValue, strategy); setMessage(`导入完成：题组 ${result.importedSets}，题目 ${result.importedQuestions}；跳过题组 ${result.skippedSets}、题目 ${result.skippedQuestions}。`); setPreview(null); setImportValue(null); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '导入失败；现有题库未更改。') }
  }

  async function exportBank() {
    try { const { makeQuestionBankBundle } = await import('../data/exchange'); downloadFile('telc-c1-question-bank.json', JSON.stringify(await makeQuestionBankBundle(), null, 2)); setMessage('JSON 题库已导出。') }
    catch (cause) { setError(cause instanceof Error ? cause.message : '导出失败。') }
  }
  async function exportCsv(set: StudySet) {
    const qs = questions.filter((question) => question.setId === set.id)
    if (!qs.length) { setError('此题组还没有题目。'); return }
    downloadFile(`${set.title.replace(/[^a-z0-9-_]/gi, '-')}.csv`, exportQuestionsCsv(qs, set.title, set.skill, set.part), 'text/csv;charset=utf-8')
  }
  async function removeSet(set: StudySet) {
    if (!window.confirm(`删除题组“${set.title}”及其题目？既有练习记录会保留。`)) return
    await deleteStudySet(set.id); if (expanded === set.id) setExpanded(null); await refresh()
  }

  return <div className="page">
    <header className="topbar"><div><div className="eyebrow">DEINE SAMMLUNG</div><h1>Meine Aufgaben</h1><p>题组按阅读1、阅读2、阅读3、听力1、听力2和听力3分类；JSON 导入时按考试部分自动归组。</p></div><button className="button button-dark" onClick={() => { setError(''); setSetEditor('new') }}>＋ 新建题组</button></header>
    <section className="toolbar-card"><div><strong>题库工具</strong><small>JSON 完整题库 · CSV 平面客观题 · 音频随 JSON 导入导出</small></div><div className="button-row"><button className="button button-outline" onClick={() => void exportBank()}>导出 JSON</button><label className="button button-outline file-button">导入 JSON / CSV<input type="file" accept="application/json,.json,text/csv,.csv" onChange={(e) => void handleImportFile(e.target.files?.[0])} /></label></div></section>
    {error && <div className="alert error-alert" role="alert">{error}<button onClick={() => setError('')} aria-label="关闭">×</button></div>}{message && <div className="alert success-alert" role="status">{message}<button onClick={() => setMessage('')} aria-label="关闭">×</button></div>}
    {preview && <div className="editor-card import-preview"><div className="editor-top"><div><span className="pill">IMPORT VORSCHAU</span><h2>导入预览</h2></div><button className="icon-button" onClick={() => { setPreview(null); setImportValue(null) }}>×</button></div><p>文件包含 {preview.sets} 个题组、{preview.questions} 道题、{preview.passages} 篇文章和 {preview.audio} 个音频。重复 ID：题组 {preview.duplicateSetIds.length}、题目 {preview.duplicateQuestionIds.length}、文章/音频 {preview.duplicateOtherIds.length}。</p><p>导入时会按 JSON 中的考试部分或题组名称，归入对应的六个阅读 / 听力组。</p><label>重复数据处理<select value={strategy} onChange={(e) => setStrategy(e.target.value as DuplicateStrategy)}><option value="skip">跳过重复（默认）</option><option value="replace">覆盖重复题组 / 题目</option><option value="copy">作为新副本导入</option></select></label><div className="button-row"><button className="button button-dark" onClick={() => void runImport()}>校验并导入</button><button className="button button-outline" onClick={() => { setPreview(null); setImportValue(null) }}>取消</button></div></div>}
    <div className="library-summary"><span>{skillFilter ? (skillFilter === 'reading' ? 'LESEN' : 'HÖREN') : 'ALLE FÄHIGKEITEN'}</span><strong>{visibleSets.length} 个题组</strong><small>· {visibleSets.reduce((sum, set) => sum + setCount(set.id), 0)} 道题</small>{skillFilter && <Link to="/library" className="text-link">清除筛选</Link>}</div>
    {!visibleSets.length && <div className="empty-card"><span className="empty-icon">▤</span><div><strong>题库还是空的。</strong><p>导入题组后，阅读和听力会分别归到对应分类。</p></div><button className="button button-dark" onClick={() => setSetEditor('new')}>创建第一个题组</button></div>}
    <div className="category-list">{categories.filter((category) => category.sets.length > 0 || (category.id !== 'other' && !skillFilter)).map((category) => {
      const isOpen = openCategories[category.id]
      const questionCount = category.sets.reduce((sum, set) => sum + setCount(set.id), 0)
      return <section className="category-section" key={category.id}><button className="category-heading" aria-expanded={isOpen} onClick={() => setOpenCategories((current) => ({ ...current, [category.id]: !current[category.id] }))}><span className="category-heading-copy"><strong>{category.title}</strong><small>{category.sets.length} 个题组 · {questionCount} 道题</small></span><span className="category-chevron">{isOpen ? '⌃' : '⌄'}</span></button>{isOpen && (category.sets.length ? <div className="set-list">{category.sets.map(renderSetCard)}</div> : <div className="category-empty">还没有题组。导入对应技能的 JSON 后，题组会自动归入这里。</div>)}</section>
    })}</div>
    {setEditor && <SetEditor initial={setEditor === 'new' ? undefined : setEditor} defaultExam={defaultExam} onClose={() => setSetEditor(null)} onSave={async (set) => { await db.sets.put(set); setSetEditor(null); await refresh(); setMessage('题组已保存。') }} onError={setError} />}
    {questionEditor && <QuestionEditor key={`${questionEditor.set.id}-${questionEditor.question?.id ?? 'new'}`} set={questionEditor.set} initial={questionEditor.question} onClose={() => setQuestionEditor(null)} onSave={async (question) => { if (!questionEditor.question) { const existing = await db.questions.where('setId').equals(question.setId).toArray(); question.order = Math.max(existing.length, existing.reduce((next, item) => Math.max(next, (item.order ?? -1) + 1), 0)) } await db.questions.put(question); setQuestionEditor(null); await refresh(); setMessage('题目已保存。') }} />}
  </div>
}

function SetEditor({ initial, defaultExam, onClose, onSave, onError }: { initial?: StudySet; defaultExam: string; onClose: () => void; onSave: (set: StudySet) => Promise<void>; onError: (message: string) => void }) {
  const [passageText, setPassageText] = useState('')
  const [passageTitle, setPassageTitle] = useState('Lesetext')
  const [audioName, setAudioName] = useState('')
  const [removeAudio, setRemoveAudio] = useState(false)
  const [busy, setBusy] = useState(false)
  const [categoryId, setCategoryId] = useState<StudyCategoryId>(initial?.categoryId && !['reading123', 'listening123'].includes(initial.categoryId) ? initial.categoryId : categoryForSet(initial?.skill ?? 'reading', initial?.part ?? 'Teil 1', initial?.title))
  useEffect(() => { if (initial?.passageId) void db.passages.get(initial.passageId).then((passage) => { setPassageText(passage?.body ?? ''); setPassageTitle(passage?.title ?? 'Lesetext') }); if (initial?.audioId) void db.audio.get(initial.audioId).then((audio) => setAudioName(audio?.name ?? 'Audio verknüpft')) }, [initial])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); onError('')
    try {
      const data = new FormData(event.currentTarget); const stamp = now(); const passageId = initial?.passageId ?? id()
      let audioId = removeAudio ? undefined : initial?.audioId
      const file = (event.currentTarget.elements.namedItem('audio') as HTMLInputElement).files?.[0]
      const value = StudySetSchema.parse({ id: initial?.id ?? id(), title: data.get('title'), exam: data.get('exam'), skill: data.get('skill'), categoryId: data.get('categoryId'), part: data.get('part'), instruction: data.get('instruction'), passageId: passageText.trim() && ['reading', 'listening'].includes(String(data.get('skill'))) ? passageId : undefined, audioId, modeDefaultSeconds: Number(data.get('minutes')) > 0 ? Number(data.get('minutes')) * 60 : undefined, tags: String(data.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean), createdAt: initial?.createdAt ?? stamp, updatedAt: stamp })
      if (file) audioId = (await saveAudio(file)).id
      if (file) value.audioId = audioId
      if (passageText.trim() && (initial?.skill === 'reading' || initial?.skill === 'listening' || data.get('skill') === 'reading' || data.get('skill') === 'listening')) await db.passages.put({ id: passageId, title: passageTitle || '文章 / 听力原文', body: passageText, createdAt: initial?.createdAt ?? stamp, updatedAt: stamp })
      await onSave(value)
    } catch (cause) { onError(cause instanceof Error ? cause.message : '无法保存题组。') } finally { setBusy(false) }
  }
  return <div className="modal-backdrop" role="presentation"><form className="editor-card modal" onSubmit={(e) => void submit(e)}><div className="editor-top"><div><span className="pill">AUFGABENSET</span><h2>{initial ? '编辑题组' : '新建题组'}</h2></div><button type="button" className="icon-button" onClick={onClose}>×</button></div><div className="form-grid"><label>题组名称<input name="title" required defaultValue={initial?.title} placeholder="例如：Teil 1 · Nachhaltigkeit" /></label><label>考试类型<input name="exam" defaultValue={initial?.exam ?? defaultExam} /></label><label>技能<select name="skill" defaultValue={initial?.skill ?? 'reading'} onChange={(event) => setCategoryId(defaultCategoryForSkill(event.currentTarget.value as 'reading' | 'listening' | 'writing' | 'speaking'))}><option value="reading">Lesen</option><option value="listening">Hören</option><option value="writing">Schreiben</option><option value="speaking">Sprechen</option></select></label><label>所属分类<select name="categoryId" value={categoryId} onChange={(event) => setCategoryId(event.currentTarget.value as StudyCategoryId)}><option value="reading1">阅读1</option><option value="reading2">阅读2</option><option value="reading3">阅读3</option><option value="listening1">听力1</option><option value="listening2">听力2</option><option value="listening3">听力3</option><option value="other">其他题组</option></select></label><label>考试部分<input name="part" required defaultValue={initial?.part ?? 'Teil 1'} placeholder="Teil 1" /></label></div><label>练习说明<textarea name="instruction" rows={2} defaultValue={initial?.instruction} /></label><label>标签（逗号分隔）<input name="tags" defaultValue={initial?.tags.join(', ')} placeholder="Wissenschaft, Bildung" /></label><details className="attachment-details" open={initial?.skill === 'reading' || initial?.skill === 'listening' || !initial}><summary>文章 / 听力原文（可选）</summary><label>文章标题<input value={passageTitle} onChange={(e) => setPassageTitle(e.target.value)} /></label><label>文章正文<textarea rows={6} value={passageText} onChange={(e) => setPassageText(e.target.value)} placeholder="在此粘贴德语文章或听力原文……" /></label></details><details className="attachment-details" open={initial?.skill === 'listening' || Boolean(initial?.audioId)}><summary>听力音频（可选）</summary><p className="muted">仅接受音频格式，最大 25 MB，保存在当前浏览器。</p><input type="file" name="audio" accept="audio/mpeg,audio/wav,audio/ogg,audio/webm,audio/mp4,audio/aac" />{audioName && <div className="button-row"><span className="file-name">已关联：{audioName}</span><button type="button" className="danger-link" onClick={() => { setRemoveAudio(true); setAudioName('') }}>移除关联</button></div>}</details><label>考试模式时长（分钟，可选）<input type="number" name="minutes" min="1" defaultValue={initial?.modeDefaultSeconds ? initial.modeDefaultSeconds / 60 : ''} /></label><div className="button-row modal-actions"><button className="button button-dark" disabled={busy}>{busy ? '保存中…' : '保存题组'}</button><button type="button" className="button button-outline" onClick={onClose}>取消</button></div></form></div>
}

function QuestionEditor({ set, initial, onClose, onSave }: { set: StudySet; initial?: Question; onClose: () => void; onSave: (question: Question) => Promise<void> }) {
  const [type, setType] = useState<QuestionType>(initial?.questionType ?? 'single-choice')
  const [error, setError] = useState('')
  const currentOptions = initial?.options ?? []
  const currentAnswerIds = initial?.correctAnswers.selectedOptionIds
  const currentIndexes = Array.isArray(currentAnswerIds) ? currentAnswerIds.map((optionId) => currentOptions.findIndex((option) => option.id === optionId) + 1).filter((index) => index > 0).join(', ') : ''
  const matchOptions = initial?.options.length ? initial.options : (initial?.matches ?? []).filter((match) => match.answer).map((match, index) => ({ id: `option-${index + 1}`, text: match.answer! }))
  const legacyPairs = initial?.correctAnswers.pairs
  const pairAnswers = legacyPairs && !Array.isArray(legacyPairs) && typeof legacyPairs === 'object' ? legacyPairs as Record<string, string> : {}
  const initialMatchPrompts = (initial?.matches ?? []).map((match) => match.prompt).join('\n')
  const currentMappings = (initial?.matches ?? []).map((match, index) => {
    const answer = pairAnswers[match.id]
    const choiceIndex = matchOptions.findIndex((option) => option.id === answer || option.text === answer)
    return `${index + 1} => ${choiceIndex >= 0 ? choiceIndex + 1 : ''}`
  }).join('\n')
  const currentGaps = Object.entries(initial?.acceptedAnswers ?? {}).map(([key, answers]) => `${key} = ${answers.join('|')}`).join('\n')
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); const data = new FormData(event.currentTarget); const stamp = now()
    const optionTexts = String(data.get('options') ?? '').split('\n').map((x) => x.trim()).filter(Boolean)
    const options = optionTexts.map((text, index) => ({ id: `option-${index + 1}`, text }))
    const indexes = String(data.get('correctIndexes') ?? '').split(',').map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x > 0 && x <= options.length)
    const matchPrompts = type === 'matching'
      ? String(data.get('matchPrompts') ?? '').split('\n').map((line) => line.trim()).filter(Boolean)
      : [...new Set([...String(data.get('prompt') ?? '').matchAll(/\{\{(match-[^}]+)\}\}/g)].map((match) => match[1]!))].map((key) => `(${key.replace('match-', '')})`)
    const matches = matchPrompts.map((prompt, index) => ({ id: `match-${index + 1}`, prompt }))
    const pairMap: Record<string, string> = {}
    for (const line of String(data.get('answerMap') ?? '').split('\n')) {
      const [left, right] = line.split('=>').map((part) => part.trim())
      if (!left || !right) continue
      const matchIndex = Number(left.replace(/^match-/, ''))
      const optionIndex = Number(right.replace(/^option-/, ''))
      const option = options[optionIndex - 1]
      if (Number.isInteger(matchIndex) && matchIndex > 0 && option) pairMap[`match-${matchIndex}`] = option.id
    }
    const acceptedAnswers = Object.fromEntries(String(data.get('accepted') ?? '').split('\n').map((line) => line.split('=')).filter((parts) => parts.length >= 2).map((parts) => [parts[0]!.trim(), parts.slice(1).join('=').split('|').map((answer) => answer.trim()).filter(Boolean)]))
    const correctAnswers = type === 'single-choice' || type === 'multiple-choice' ? { selectedOptionIds: indexes.map((index) => options[index - 1]!.id) } : type === 'matching' || type === 'text-reconstruction' ? { pairs: pairMap } : type === 'true-false-not-stated' ? { value: data.get('truth') } : {}
    const parsed = QuestionSchema.safeParse({ id: initial?.id ?? id(), setId: set.id, order: initial?.order, title: data.get('title'), prompt: data.get('prompt'), questionType: type, points: Number(data.get('points') || 1), options: ['single-choice', 'multiple-choice', 'matching', 'text-reconstruction'].includes(type) ? options : [], matches: ['matching', 'text-reconstruction'].includes(type) ? matches : [], correctAnswers, acceptedAnswers: type === 'gap-fill' ? acceptedAnswers : {}, explanation: data.get('explanation'), tags: String(data.get('tags') ?? '').split(',').map((x) => x.trim()).filter(Boolean), difficulty: data.get('difficulty'), scoringRules: { partialCredit: data.get('partialCredit') === 'on', ignoreCase: data.get('ignoreCase') === 'on', trim: true }, createdAt: initial?.createdAt ?? stamp, updatedAt: stamp })
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? '题目数据有误。'); return }
    void onSave(parsed.data).catch((cause) => setError(cause instanceof Error ? cause.message : '保存失败。'))
  }
  return <div className="modal-backdrop" role="presentation"><form className="editor-card modal" onSubmit={submit}><div className="editor-top"><div><span className="pill">{set.title}</span><h2>{initial ? '编辑题目' : '添加题目'}</h2></div><button type="button" className="icon-button" onClick={onClose}>×</button></div><label>题型<select value={type} onChange={(e) => setType(e.target.value as QuestionType)}><option value="single-choice">单选题</option><option value="multiple-choice">多选题</option><option value="matching">Zuordnung · 匹配题</option><option value="true-false-not-stated">Richtig / Falsch / Nicht im Text</option><option value="text-reconstruction">Textrekonstruktion · 文本重构</option><option value="gap-fill">填空题</option></select></label><label>题目标题（可选）<input name="title" defaultValue={initial?.title} /></label>{type !== 'gap-fill' && <label>题干 / 作答说明<textarea name="prompt" required rows={type === 'text-reconstruction' ? 9 : 3} defaultValue={initial?.prompt} placeholder={type === 'text-reconstruction' ? '粘贴全文，并在每个空位写 {{match-1}}、{{match-2}} 等。' : '输入题目和作答说明'} /></label>}{['single-choice', 'multiple-choice'].includes(type) && <><label>选项（每行一个）<textarea name="options" required rows={5} defaultValue={currentOptions.map((option) => option.text).join('\n')} placeholder={'Option A\nOption B\nOption C'} /></label><label>正确选项序号（逗号分隔，从 1 开始）<input name="correctIndexes" required defaultValue={currentIndexes} placeholder={type === 'single-choice' ? '1' : '1, 3'} /></label></>}{['matching', 'text-reconstruction'].includes(type) && <>
    {type === 'matching' && <label>待匹配项目（每行一个）<textarea name="matchPrompts" required rows={4} defaultValue={initialMatchPrompts} placeholder={'(1) Aussage 1\n(2) Aussage 2'} /></label>}
    <label>全部选项（每行一个，可包含干扰项）<textarea name="options" required rows={6} defaultValue={matchOptions.map((option) => option.text).join('\n')} placeholder={'A - Antworttext\nB - Antworttext\nC - Antworttext'} /></label>
    <label>标准答案映射（每行：匹配项编号 =&gt; 选项编号）<textarea name="answerMap" required rows={4} defaultValue={currentMappings} placeholder={'1 => 3\n2 => 1'} /></label><p className="field-hint">编号按上方各自列表的行序计算；可选项顺序不会影响判分。文本重构题的匹配项来自题干里的 {'{{match-1}}'} 占位符。</p></>}{type === 'true-false-not-stated' && <label>标准答案<select name="truth" defaultValue={String(initial?.correctAnswers.value ?? 'true')}><option value="true">Richtig（正确）</option><option value="false">Falsch（错误）</option><option value="not-stated">Nicht im Text（未提及）</option></select></label>}{type === 'gap-fill' && <><label>填空模板<textarea name="prompt" required rows={3} defaultValue={initial?.prompt} placeholder="Die {{gap1}} ist ein wichtiges Thema." /></label><label>可接受答案（每行 gapId = 答案|变体）<textarea name="accepted" required rows={4} defaultValue={currentGaps} placeholder={'gap1 = Forschung|Wissenschaft'} /></label></>}<div className="form-grid"><label>分值<input name="points" type="number" min="0.1" step="0.1" defaultValue={initial?.points ?? 1} /></label><label>难度<select name="difficulty" defaultValue={initial?.difficulty ?? 'medium'}><option value="easy">简单</option><option value="medium">中等</option><option value="hard">困难</option></select></label></div><label>标签（逗号分隔）<input name="tags" defaultValue={initial?.tags.join(', ')} placeholder="Bildung, Umwelt" /></label><label>解析<textarea name="explanation" rows={3} defaultValue={initial?.explanation} /></label>{type === 'multiple-choice' && <label className="check-label"><input type="checkbox" name="partialCredit" defaultChecked={initial?.scoringRules.partialCredit} />按已选正确项给部分分</label>}{type === 'gap-fill' && <label className="check-label"><input type="checkbox" name="ignoreCase" defaultChecked={initial?.scoringRules.ignoreCase ?? true} />忽略大小写</label>}{error && <div className="alert error-alert" role="alert">{error}</div>}<div className="button-row modal-actions"><button className="button button-dark">保存题目</button><button type="button" className="button button-outline" onClick={onClose}>取消</button></div></form></div>
}

function PassagePreview({ passageId, onEdit }: { passageId: string; onEdit: () => void }) {
  const [title, setTitle] = useState('文章')
  const [excerpt, setExcerpt] = useState('')
  useEffect(() => { void db.passages.get(passageId).then((passage) => { if (passage) { setTitle(passage.title); setExcerpt(passage.body.slice(0, 500)) } }) }, [passageId])
  return <div className="attached-preview"><strong>{title}</strong><p>{excerpt}{excerpt.length >= 500 ? '…' : ''}</p><button className="text-link" onClick={onEdit}>编辑文章</button></div>
}

function AudioPreview({ audioId }: { audioId: string }) {
  const [url, setUrl] = useState(''); const [name, setName] = useState('')
  useEffect(() => { let objectUrl = ''; void db.audio.get(audioId).then((asset) => { if (asset) { objectUrl = URL.createObjectURL(asset.blob); setUrl(objectUrl); setName(asset.name) } }); return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) } }, [audioId])
  return <div className="attached-preview"><strong>Hördatei {name && `· ${name}`}</strong>{url ? <audio controls preload="metadata" src={url}>该浏览器不支持音频播放。</audio> : <span className="muted">正在载入音频…</span>}</div>
}

function questionTypeName(type: QuestionType) { return ({ 'single-choice': '单选', 'multiple-choice': '多选', matching: '匹配', 'true-false-not-stated': '判断', 'text-reconstruction': '文本重构', 'gap-fill': '填空' })[type] }

function compareQuestionOrder(a: Question, b: Question) {
  return a.setId.localeCompare(b.setId) || (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}
