# Data model and import format

## Records

- **StudySet** describes an exam section and skill. It may refer to one `passageId` and one shared `audioId`.
- **Passage** stores article title and body once. Sets reference it by ID.
- **AudioAsset** stores the original browser `Blob` in IndexedDB, with MIME type and byte size. A set or a speaking submission references it by ID.
- **Question** belongs to one set through `setId`. It stores prompt, question type, points, tags, difficulty, explanation, scoring settings, choices or matching pairs, and answers.
- **Attempt** stores the set name, skill, exam part, mode, time, score, and per-question user answer plus an immutable question/answer snapshot. Deleting or editing a bank question does not rewrite completed results.
- **PracticeDraft** stores an unfinished session's answers, mode, timer, and update time. It is keyed separately for full-set practice and wrong-answer redo sessions and survives page refresh.
- **Submission** stores a writing draft or speaking note/transcript and its criteria, feedback, and optional self-assigned score.
- **Settings** stores the default exam, preferred language value, post-submit answer visibility, and exam duration.

Records are held in separate Dexie/IndexedDB tables. Browser-local IndexedDB is replaceable by a future storage adapter, but there is no server adapter in this version.

## Question types

| `questionType` | Type-specific fields | Scoring |
| --- | --- | --- |
| `single-choice` | `options[]`, `correctAnswers.selectedOptionIds` with one ID | Exact selected option |
| `multiple-choice` | `options[]`, one or more correct IDs | Exact set match; optional partial credit for selected correct options |
| `matching` | `matches[]` stores prompts, `options[]` stores the independent choice pool, and `correctAnswers.pairs` maps match IDs to option IDs | Correct matches divided by number of prompts |
| `true-false-not-stated` | `correctAnswers.value`: `true`, `false`, or `not-stated` | Exact value |
| `text-reconstruction` | Prompt contains `{{match-1}}` placeholders; `options[]` stores all choices (including distractors), and `correctAnswers.pairs` maps each blank ID to an option ID | Correct insertion per placeholder |
| `gap-fill` | Prompt may mark gaps as `{{gap1}}`; `acceptedAnswers` maps gap IDs to accepted strings | Per-gap match; trim and case behavior configurable |

All question types use deterministic objective scoring. Writing/speaking criteria are stored separately and are not automatically scored.

## JSON question bank

The import file is a UTF-8 JSON object with `format: "telc-c1-trainer"`, `version: 1`, and arrays of `sets`, `questions`, `passages`, and `audio`. For example, an audio item carries `id`, `name`, `mimeType`, `size`, `createdAt`, and base64-encoded bytes. See [`../examples/question-bank-template.json`](../examples/question-bank-template.json) and [`../examples/example-question-bank.json`](../examples/example-question-bank.json).

Import validates the whole bundle and its references before opening a write transaction. The default **skip** policy skips sets with an existing ID and their questions, and skips questions with existing IDs. **Replace** deletes current questions for a colliding set and writes imported versions; previous attempts remain unchanged. **Copy** generates new IDs and remaps set, passage, audio, and question references.

A full backup adds `backup: true`, `attempts`, `drafts`, and `settings` to the bank payload. Restore schema-checks the whole backup and imports all records in a transaction. Keep backups private: they can contain original audio and personal answers/history.

## CSV format

CSV has one row per question and one question set per file. Required columns are `title`, `skill`, `part`, `questionType`, `prompt`, and `correctAnswers`. `options`, `matches`, and `acceptedAnswers` cells contain JSON; tags are separated with `|`. Article and audio references are not supported in CSV. See [`../examples/questions.csv`](../examples/questions.csv).

Question set IDs are derived from title, skill, and part so repeating the same CSV import is recognized as a duplicate. Reuse a different title or part for a distinct set.
