import { Buffer } from 'buffer'
window.Buffer = Buffer
globalThis.Buffer = Buffer

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { DecentraChatProvider } from './DecentraChatContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <DecentraChatProvider>
      <App />
    </DecentraChatProvider>
  </StrictMode>,
)
