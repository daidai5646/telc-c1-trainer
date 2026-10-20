import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { loadPublicQuestionBank } from './data/seed'

async function start() {
  try { await loadPublicQuestionBank() } catch (error) { console.error('线上题库初始化失败', error) }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode><App /></React.StrictMode>,
  )
}

void start()
