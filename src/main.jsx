import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './bootstrap.scss'
import App from './App.jsx'
import { initTheme } from './lib/utils.js'

initTheme()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)