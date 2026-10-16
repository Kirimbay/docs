import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/nunito/500.css'
import '@fontsource/nunito/700.css'
import '@fontsource/nunito/800.css'
import '@fontsource/nunito/900.css'
import { App } from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
