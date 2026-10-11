import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react'
import { HashRouter, Link, NavLink, Outlet, Route, Routes } from 'react-router-dom'
import { db, deleteSubmission, saveAudio, saveSubmission } from './data/database'
import { SettingsSchema, SubmissionSchema, FullBackupSchema, now, id, type Attempt, type Settings, type Submission, type StudySet } from './domain/model'
import './styles.css'

const Library = lazy(() => import('./features/Library').then((module) => ({ default: module.Library })))
const Practice = lazy(() => import('./features/Practice').then((module) => ({ default: module.Practice })))

export function App() {
  return <HashRouter><Suspense fallback={<div className="page">正在载入…</div>}><Routes><Route element={<Layout />}>
    <Route index element={<Dashboard />} />
    <Route path="library" element={<Library />} />
    <Route path="practice/:setId" element={<Practice />} />
    <Route path="history" element={<History />} />
    <Route path="writing" element={<Writing />} />
    <Route path="settings" element={<SettingsPage />} />
    <Route path="*" element={<NotFound />} />
  </Route></Routes></Suspense></HashRouter>
}

function Layout() {
  const [usage, setUsage] = useState<string>('')
  useEffect(() => {
    void navigator.storage?.estimate().then((estimate) => {
      if (estimate?.quota && estimate.usage !== undefined) setUsage(`${(estimate.usage / 1024 / 1024).toFixed(0)} MB / ${(estimate.quota / 1024 / 1024).toFixed(0)} MB`)
    }).catch(() => setUsage(''))
  }, [])
  return <div className="shell">
    <aside className="sidebar">
      <Link to="/" className="brand"><span className="brand-mark">T</span><span>TELC C1 <small>TRAINER</small></span></Link>
      <p className="nav-caption">LERNEN</p>
      <nav aria-label="Hauptnavigation" className="nav-list">
        <NavLink to="/" end className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}><span>⌂</span> Übersicht</NavLink>
        <NavLink to="/library" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}><span>▤</span> Meine Aufgaben</NavLink>
        <NavLink to="/history" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}><span>◷</span> Lernverlauf</NavLink>
        <NavLink to="/writing" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}><span>✎</span> Schreiben & Sprechen</NavLink>
      </nav>
      <div className="sidebar-bottom"><NavLink to="/settings" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}><span>⚙</span> Einstellungen</NavLink><div className="storage-note">本地浏览器存储{usage && <small>{usage}</small>}</div></div>
    </aside>
    <main className="main-area"><Outlet /></main>
  </div>
}

function Dashboard() {
  const [sets, setSets] = useState<StudySet[]>([])
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [count, setCount] = useState(0)
  useEffect(() => { void Promise.all([db.sets.toArray(), db.attempts.orderBy('completedAt').reverse().limit(5).toArray(), db.questions.count()]).then(([s, a, c]) => { setSets(s); setAttempts(a); setCount(c) }) }, [])
  const reading = sets.filter((set) => set.skill === 'reading').length
  const listening = sets.filter((set) => set.skill === 'listening').length
  const avg = attempts.length ? Math.round(attempts.reduce((sum, attempt) => sum + attempt.percentage, 0) / attempts.length) : 0
  return <div className="page">
    <header className="topbar"><div><div className="eyebrow">PERSÖNLICHER LERNRAUM</div><h1>Guten Tag <span className="serif">!</span></h1><p>Dein Weg zum telc C1 Hochschule beginnt mit einer guten Übung.</p></div><Link className="button button-dark" to="/library">＋ Aufgabe erstellen</Link></header>
    <section className="hero-card"><div className="hero-copy"><span className="pill pill-light">TELC C1 HOCHSCHULE</span><h2>Mit Ruhe. Mit System.<br /><em>Mit jedem Text besser.</em></h2><p>Dein persönlicher Ort, um Lesen, Hören, Schreiben und Sprechen strukturiert zu trainieren.</p><Link className="button button-cream" to="/library">Mit einer Aufgabe starten <span>→</span></Link></div><div className="hero-art" aria-hidden="true"><div className="art-sheet"><span>DE</span><div /><div /><div /><div /><b>ü</b></div><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><span className="art-star">✳</span></div></section>
    <section className="stats-grid"><StatCard label="AUFGABEN" value={String(count).padStart(2, '0')} hint="in deiner Sammlung" /><StatCard label="DURCHSCHNITT" value={`${avg}%`} hint="deiner letzten Übungen" /><StatCard label="LESESETS" value={String(reading).padStart(2, '0')} hint="für Lesen" /><StatCard label="HÖRSETS" value={String(listening).padStart(2, '0')} hint="für Hören" /></section>
    <div className="section-heading"><div><div className="eyebrow">DEINE FÄHIGKEITEN</div><h2>Womit möchtest du üben?</h2></div><Link to="/library" className="text-link">Alle Aufgaben ansehen →</Link></div>
    <div className="skill-grid"><SkillCard title="Lesen" subtitle="Leseverstehen trainieren" icon="Aa" tone="sage" to="/library?skill=reading" count={reading} /><SkillCard title="Hören" subtitle="Hörverstehen trainieren" icon="♫" tone="lavender" to="/library?skill=listening" count={listening} /><SkillCard title="Schreiben" subtitle="Texte & Kriterien sammeln" icon="✎" tone="peach" to="/writing" count={0} /><SkillCard title="Sprechen" subtitle="Antworten & Kriterien sammeln" icon="◉" tone="blue" to="/writing" count={0} /></div>
    <div className="section-heading recent-heading"><div><div className="eyebrow">DRANBLEIBEN</div><h2>Letzte Übungen</h2></div><Link to="/history" className="text-link">Zum Lernverlauf →</Link></div>
    {attempts.length ? <div className="recent-list">{attempts.map((attempt) => <Link key={attempt.id} to={`/practice/${attempt.setId}`} className="recent-row"><span className="recent-icon">{attempt.skill === 'reading' ? 'Aa' : '♫'}</span><span className="recent-title">{attempt.setTitle}<small>{attempt.skill === 'reading' ? 'Lesen' : 'Hören'} · {attempt.part} · {new Date(attempt.completedAt).toLocaleDateString()}</small></span><span className="score-badge">{attempt.percentage}%</span><span className="row-arrow">→</span></Link>)}</div> : <div className="empty-card"><span className="empty-icon">◷</span><div><strong>Deine Lernreise beginnt hier.</strong><p>Wenn du eine Übung abschließt, erscheint sie in deinem Verlauf.</p></div><Link to="/library" className="text-link">Aufgaben ansehen →</Link></div>}
  </div>
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) { return <div className="stat-card"><span>{label}</span><strong>{value}</strong><small>{hint}</small></div> }
function SkillCard({ title, subtitle, icon, tone, to, count }: { title: string; subtitle: string; icon: string; tone: string; to: string; count: number }) { return <Link to={to} className={`skill-card ${tone}`}><span className="skill-icon">{icon}</span><span className="skill-arrow">↗</span><strong>{title}</strong><small>{subtitle}</small><span className="skill-count">{count} {count === 1 ? 'Aufgabe' : 'Aufgaben'} <b>→</b></span></Link> }

function History() {
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [submissions, setSubmissions] = useState<Submission[]>([])
  useEffect(() => { void Promise.all([db.attempts.orderBy('completedAt').reverse().toArray(), db.submissions.orderBy('updatedAt').reverse().toArray()]).then(([a, s]) => { setAttempts(a); setSubmissions(s) }).catch(() => {}) }, [])
  const totalSeconds = attempts.reduce((sum, attempt) => sum + attempt.durationSeconds, 0)
  const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : undefined
  const skillStats = (['reading', 'listening', 'writing', 'speaking'] as const).map((skill) => {
    const values = skill === 'reading' || skill === 'listening' ? attempts.filter((attempt) => attempt.skill === skill).map((attempt) => attempt.percentage) : submissions.filter((submission) => submission.skill === skill && submission.score !== undefined).map((submission) => submission.score!)
    return { skill, score: average(values), count: values.length }
  })
  const partMap = new Map<string, number[]>()
  for (const attempt of attempts) { const key = `${attempt.skill} · ${attempt.part}`; partMap.set(key, [...(partMap.get(key) ?? []), attempt.percentage]) }
  const parts = [...partMap.entries()].map(([label, values]) => ({ label, score: average(values)! })).sort((a, b) => a.score - b.score)
  const weakMap = new Map<string, number>()
  for (const attempt of attempts) for (const answer of attempt.answers) if (!answer.isCorrect) {
    const label = answer.questionSnapshot.tags[0] || answer.questionSnapshot.prompt.slice(0, 54)
    weakMap.set(label, (weakMap.get(label) ?? 0) + 1)
  }
  const weaknesses = [...weakMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
  return <div className="page">
    <header className="topbar"><div><div className="eyebrow">FORTSCHRITT</div><h1>Lernverlauf</h1><p>Übungen und gespeicherte Schreib- und Sprechentwürfe.</p></div></header>
    <section className="stats-grid history-stats"><StatCard label="ÜBUNGEN" value={String(attempts.length)} hint="abgeschlossene Aufgaben" /><StatCard label="GESAMTLERNZEIT" value={`${Math.floor(totalSeconds / 3600)}h ${Math.floor(totalSeconds % 3600 / 60)}m`} hint="gemessene Übungszeit" /><StatCard label="DURCHSCHNITT" value={`${average(attempts.map((a) => a.percentage)) ?? 0}%`} hint="objektive Aufgaben" /><StatCard label="ENTWÜRFE" value={String(submissions.length)} hint="Schreiben und Sprechen" /></section>
    <div className="section-heading"><div><div className="eyebrow">FÄHIGKEITEN</div><h2>Leistung nach Skill</h2></div></div>
    <div className="performance-grid">{skillStats.map(({ skill, score, count }) => <div className="performance-card" key={skill}><strong>{skill === 'reading' ? 'Lesen' : skill === 'listening' ? 'Hören' : skill === 'writing' ? 'Schreiben' : 'Sprechen'}</strong><span>{score === undefined ? '—' : `${score}%`}</span><small>{count ? `${count} Bewertungen` : 'Noch keine Bewertung'}</small></div>)}</div>
    <div className="section-heading"><div><div className="eyebrow">EXAMSTEILE</div><h2>Leistung nach Prüfungsteil</h2></div></div>
    {parts.length ? <div className="weak-list">{parts.map((part) => <div className="weak-row" key={part.label}><span>{part.label}</span><div className="mini-progress"><i style={{ width: `${part.score}%` }} /></div><strong>{part.score}%</strong></div>)}</div> : <p className="muted">Sobald du Übungen abschließt, erscheinen hier deine Prüfungsteile.</p>}
    <div className="section-heading"><div><div className="eyebrow">DARAUF ACHTEN</div><h2>Häufige Fehler</h2></div></div>
    {weaknesses.length ? <div className="weak-list">{weaknesses.map(([label, count]) => <div className="weak-row" key={label}><span>{label}</span><strong>{count}× falsch</strong></div>)}</div> : <p className="muted">Noch keine Fehler erfasst. Fehler werden aus abgeschlossenen Übungen zusammengefasst.</p>}
    <div className="section-heading"><div><div className="eyebrow">AUTOMATISCH BEWERTET</div><h2>Übungsergebnisse</h2></div></div>
    {attempts.length ? <div className="table-wrap"><table><thead><tr><th>Aufgabe</th><th>Modus</th><th>Datum</th><th>Zeit</th><th>Ergebnis</th></tr></thead><tbody>{attempts.map((a) => <tr key={a.id}><td><Link to={`/practice/${a.setId}`} className="text-link">{a.setTitle}</Link><small className="table-sub">{a.skill === 'reading' ? 'Lesen' : 'Hören'} · {a.part}</small></td><td>{a.mode === 'exam' ? 'Prüfung' : 'Übung'}</td><td>{new Date(a.completedAt).toLocaleString()}</td><td>{Math.floor(a.durationSeconds / 60)} Min.</td><td><strong className={a.percentage >= 60 ? 'positive' : 'negative'}>{a.percentage}%</strong><small className="table-sub">{a.earnedPoints}/{a.maxPoints} Punkte</small></td></tr>)}</tbody></table></div> : <div className="empty-card"><div><strong>Es gibt noch keine abgeschlossenen Übungen.</strong><p>Starte eine Aufgabe, um hier deine Ergebnisse zu sehen.</p></div><Link to="/library" className="button button-dark">Aufgaben öffnen</Link></div>}
    <div className="section-heading"><div><div className="eyebrow">ENTWÜRFE</div><h2>Schreiben & Sprechen</h2></div></div>
    {submissions.length ? <div className="draft-list">{submissions.map((s) => <Link to="/writing" className="draft-row" key={s.id}><span>{s.skill === 'writing' ? '✎' : '◉'}</span><strong>{s.title}<small>{s.skill === 'writing' ? 'Schreiben' : 'Sprechen'} · {new Date(s.updatedAt).toLocaleDateString()}</small></strong><small>{s.score !== undefined && `${s.score}/100`}</small></Link>)}</div> : <p className="muted">Noch keine gespeicherten Entwürfe.</p>}
  </div>
}
function Writing() {
  const [items, setItems] = useState<Submission[]>([])
  const [editing, setEditing] = useState<Submission | null>(null)
  const [message, setMessage] = useState('')
  const refresh = () => { void db.submissions.orderBy('updatedAt').reverse().toArray().then(setItems).catch((cause: unknown) => setMessage(cause instanceof Error ? cause.message : '读取记录失败。')) }
  useEffect(refresh, [])
  function begin(skill: 'writing' | 'speaking') { setEditing({ id: id(), skill, title: skill === 'writing' ? 'Mein Schreibentwurf' : 'Meine Sprechübung', response: '', rubric: '', feedback: '', createdAt: now(), updatedAt: now() }) }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return
    const data = new FormData(event.currentTarget)
    const scoreRaw = String(data.get('score') ?? '')
    const parsed = SubmissionSchema.safeParse({ ...editing, title: data.get('title'), response: data.get('response'), rubric: data.get('rubric'), feedback: data.get('feedback'), score: scoreRaw === '' ? undefined : Number(scoreRaw), updatedAt: now() })
    if (!parsed.success) { setMessage('Bitte gib einen Titel ein.'); return }
    try { await saveSubmission(parsed.data); setEditing(null); setMessage('Entwurf wurde lokal gespeichert.'); refresh() }
    catch (cause) { setMessage(cause instanceof Error ? `保存失败：${cause.message}` : '保存失败。') }
  }
  return <div className="page"><header className="topbar"><div><div className="eyebrow">SCHREIBEN · SPRECHEN</div><h1>Eigene Antworten</h1><p>Speichere Texte, Sprechtranskripte und deine Bewertungskriterien lokal.</p></div><div className="button-row"><button className="button button-outline" onClick={() => begin('writing')}>＋ Schreibentwurf</button><button className="button button-dark" onClick={() => begin('speaking')}>＋ Sprechentwurf</button></div></header><div className="notice-card"><span>◈</span><p>Deine Texte und Aufnahmen bleiben auf diesem Gerät. Eine KI-Bewertung ist nicht eingerichtet; es werden keine Inhalte an einen Dienst gesendet.</p></div>{message && <p className="success-line" role="status">{message}</p>}{editing && <form className="editor-card draft-editor" onSubmit={save}><div className="editor-top"><div><span className="pill">{editing.skill === 'writing' ? 'SCHREIBEN' : 'SPRECHEN'}</span><h2>Entwurf bearbeiten</h2></div><button type="button" className="icon-button" onClick={() => setEditing(null)} aria-label="Schließen">×</button></div><label>Titel<input name="title" defaultValue={editing.title} required /></label><label>{editing.skill === 'writing' ? 'Dein Text' : 'Transkript / Notizen'}<textarea name="response" rows={8} defaultValue={editing.response} placeholder="Schreibe oder füge deine Antwort ein …" /></label>{editing.skill === 'speaking' && <div className="recording-section"><h3>Antwort aufnehmen</h3><p className="muted">Die Aufnahme wird erst lokal gespeichert, wenn du sie beendest. Das Mikrofon wird nur nach Klick auf „Aufnahme starten“ angefragt.</p><SpeakingRecorder onSaved={(audioId) => setEditing((current) => current ? { ...current, audioId } : current)} />{editing.audioId && <SubmissionAudio audioId={editing.audioId} />}</div>}<label>Bewertungskriterien<textarea name="rubric" rows={3} defaultValue={editing.rubric} placeholder="z. B. Aufgabenbezug, Aufbau, Wortschatz, Grammatik" /></label><div className="form-grid"><label>自评得分（0–100，可选）<input type="number" name="score" min="0" max="100" defaultValue={editing.score ?? ''} /></label><label>自我反馈<textarea name="feedback" rows={2} defaultValue={editing.feedback} /></label></div><div className="button-row"><button className="button button-dark">Lokal speichern</button><button type="button" className="button button-outline" onClick={() => setEditing(null)}>Abbrechen</button></div></form>}{items.length ? <div className="draft-list">{items.map((item) => <article className="draft-row" key={item.id}><span>{item.skill === 'writing' ? '✎' : '◉'}</span><strong>{item.title}<small>{item.skill === 'writing' ? 'Schreiben' : 'Sprechen'} · geändert {new Date(item.updatedAt).toLocaleString()}</small></strong><button className="text-link" onClick={() => setEditing(item)}>Bearbeiten</button><button className="danger-link" onClick={async () => { try { await deleteSubmission(item.id); refresh() } catch (cause) { setMessage(cause instanceof Error ? cause.message : '删除失败。') } }}>Löschen</button></article>)}</div> : <div className="empty-card"><div><strong>Hier sammelst du eigene Antworten.</strong><p>Schreiben und Sprechen können hier ohne externe Dienste vorbereitet werden.</p></div><button className="text-link" onClick={() => begin('writing')}>Entwurf erstellen →</button></div>}</div>
}

function SpeakingRecorder({ onSaved }: { onSaved: (audioId: string) => void }) {
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const chunks = useRef<BlobPart[]>([])
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => {
    if (!recording) return
    const timer = window.setInterval(() => setSeconds((current) => current + 1), 1000)
    return () => window.clearInterval(timer)
  }, [recording])
  useEffect(() => () => { stream.current?.getTracks().forEach((track) => track.stop()) }, [])
  async function start() {
    setError(''); setMessage('')
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError('此浏览器不支持麦克风录音。'); return }
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.current = mediaStream; chunks.current = []; setSeconds(0)
      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
      const mimeType = candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate))
      const instance = new MediaRecorder(mediaStream, mimeType ? { mimeType } : undefined)
      recorder.current = instance
      let recordedBytes = 0
      instance.ondataavailable = (event) => { if (event.data.size) { recordedBytes += event.data.size; chunks.current.push(event.data); if (recordedBytes > 25 * 1024 * 1024 && instance.state === 'recording') { setError('录音超过 25 MB，已自动停止。'); instance.stop() } } }
      instance.onerror = () => { setError('录音失败，请检查浏览器麦克风权限。'); mediaStream.getTracks().forEach((track) => track.stop()); setRecording(false) }
      instance.onstop = () => {
        mediaStream.getTracks().forEach((track) => track.stop()); setRecording(false)
        const blob = new Blob(chunks.current, { type: instance.mimeType || mimeType || 'audio/webm' })
        const fileType = blob.type.split(';')[0] || 'audio/webm'
        const file = new File([blob], `speaking-${new Date().toISOString().replace(/[:.]/g, '-')}.${fileType.split('/')[1] ?? 'webm'}`, { type: fileType })
        void saveAudio(file).then((asset) => { onSaved(asset.id); setMessage(`录音已保存在本机：${asset.name}`) }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : '无法保存录音。'))
      }
      instance.start(1000); setRecording(true)
    } catch (cause) { stream.current?.getTracks().forEach((track) => track.stop()); setError(cause instanceof Error ? `无法访问麦克风：${cause.message}` : '无法访问麦克风。') }
  }
  return <div className="recorder"><div className="button-row"><button type="button" className="button button-dark" disabled={recording} onClick={() => void start()}>{recording ? '正在录音…' : '● Aufnahme starten'}</button><button type="button" className="button button-outline" disabled={!recording} onClick={() => recorder.current?.stop()}>停止并本地保存</button><span className="record-time">{Math.floor(seconds / 60).toString().padStart(2, '0')}:{(seconds % 60).toString().padStart(2, '0')}</span></div>{error && <p className="error-line" role="alert">{error}</p>}{message && <p className="success-line" role="status">{message}</p>}</div>
}

function SubmissionAudio({ audioId }: { audioId: string }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { let objectUrl = ''; void db.audio.get(audioId).then((asset) => { if (asset) { objectUrl = URL.createObjectURL(asset.blob); setUrl(objectUrl) } else setError('找不到关联录音。') }).catch(() => setError('读取录音失败。')); return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) } }, [audioId])
  return url ? <audio className="submission-audio" controls preload="metadata" src={url}>该浏览器不支持音频播放。</audio> : error ? <p className="error-line">{error}</p> : <p className="muted">正在载入录音…</p>
}

function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({ defaultExam: 'telc C1 Hochschule', language: 'zh', showAnswersAfterSubmit: true, defaultExamSeconds: 90 * 60 })
  const [message, setMessage] = useState('')
  useEffect(() => { void db.settings.get('main').then((saved) => { if (saved) setSettings(SettingsSchema.parse(saved)) }) }, [])
  async function store(next: Settings) { try { await db.settings.put({ ...next, id: 'main' }); setSettings(next); setMessage('设置已保存。') } catch (cause) { setMessage(cause instanceof Error ? `保存失败：${cause.message}` : '保存失败。') } }
  async function exportBackup() {
    try { const { makeFullBackup, downloadFile } = await import('./data/exchange'); downloadFile(`telc-c1-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await makeFullBackup(), null, 2)); setMessage('完整备份已导出。') } catch (error) { setMessage(error instanceof Error ? error.message : '导出失败。') }
  }
  return <div className="page"><header className="topbar"><div><div className="eyebrow">PERSÖNLICH ANPASSEN</div><h1>Einstellungen</h1><p>Deine Lernumgebung und lokalen Daten.</p></div></header><div className="settings-layout"><section className="editor-card settings-card"><h2>Übung</h2><label>Standardprüfung<input value={settings.defaultExam} onChange={(e) => void store({ ...settings, defaultExam: e.target.value })} /></label><label>界面语言<input readOnly value="简体中文（当前版本）" /></label><label>Standardzeit für Prüfungsmodus (Minuten)<input type="number" min="1" value={Math.round(settings.defaultExamSeconds / 60)} onChange={(e) => void store({ ...settings, defaultExamSeconds: Math.max(60, Number(e.target.value) * 60) })} /></label><label className="check-label"><input type="checkbox" checked={settings.showAnswersAfterSubmit} onChange={(e) => void store({ ...settings, showAnswersAfterSubmit: e.target.checked })} />提交后显示正确答案</label></section><section className="editor-card settings-card"><h2>本地数据与备份</h2><p>题库、文章、音频、作文和练习记录保存在本机浏览器 IndexedDB。浏览器可能会在存储压力或清理数据时删除本地内容，请定期下载完整备份。</p><button className="button button-dark" onClick={() => void exportBackup()}>下载完整 JSON 备份</button><div className="notice-card compact"><span>◈</span><p>无账号、无云同步、无 AI API 配置；内容不会自动上传。</p></div><p className="muted">导入完整备份可恢复题库、附件、练习记录和设置。备份包含音频，文件可能较大。</p></section></div><BackupRestore />{message && <p className="success-line" role="status">{message}</p>}</div>
}

function BackupRestore() {
  const [backup, setBackup] = useState<unknown>(null)
  const [summary, setSummary] = useState('')
  const [error, setError] = useState('')
  const [strategy, setStrategy] = useState<'skip' | 'replace' | 'copy'>('skip')
  async function selectFile(file?: File) {
    setBackup(null); setSummary(''); setError('')
    if (!file) return
    try {
      if (file.size > 100 * 1024 * 1024) throw new Error('完整备份文件不得超过 100 MB。')
      const value: unknown = JSON.parse(await file.text())
      const parsed = FullBackupSchema.parse(value)
      setBackup(parsed); setSummary(`备份包含 ${parsed.sets.length} 个题组、${parsed.questions.length} 道题、${parsed.audio.length} 个音频、${parsed.attempts.length} 条练习记录和 ${parsed.settings.length} 项设置。`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '备份文件无效。') }
  }
  async function restore() {
    if (!backup) return
    try { const { restoreFullBackup } = await import('./data/exchange'); const result = await restoreFullBackup(backup, strategy); setSummary(`恢复完成：导入题组 ${result.importedSets}，题目 ${result.importedQuestions}；跳过题组 ${result.skippedSets}、题目 ${result.skippedQuestions}。练习记录和设置已按重复策略处理。`); setBackup(null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '恢复失败；现有数据未更改。') }
  }
  return <section className="editor-card backup-restore"><h2>恢复完整备份</h2><p>先选择备份文件查看内容和重复 ID，再确认导入。校验或导入失败时会回滚本次更改。</p><label className="file-button button button-outline">选择 JSON 备份<input type="file" accept=".json,application/json" onChange={(e) => void selectFile(e.target.files?.[0])} /></label>{summary && <p className="success-line" role="status">{summary}</p>}{error && <div className="alert error-alert" role="alert">{error}</div>}{Boolean(backup) && <div className="backup-confirm"><label>重复数据处理<select value={strategy} onChange={(e) => setStrategy(e.target.value as typeof strategy)}><option value="skip">跳过重复 ID</option><option value="replace">覆盖重复 ID</option><option value="copy">题库复制为新题组</option></select></label><button className="button button-dark" onClick={() => void restore()}>确认恢复</button><button className="button button-outline" onClick={() => setBackup(null)}>取消</button></div>}</section>
}

function NotFound() { return <div className="page not-found"><div className="eyebrow">404 · NICHT GEFUNDEN</div><h1>Diese Seite gibt es hier noch nicht.</h1><p>Vielleicht findest du deinen Weg über die Startseite.</p><Link className="button button-dark" to="/">Zur Übersicht</Link></div> }
