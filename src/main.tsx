import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './css/design-system.css'
import { ReviewProvider } from './components/ReviewContext.tsx'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ReviewProvider>
      <App />
    </ReviewProvider>
  </StrictMode>,
)
