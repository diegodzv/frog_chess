import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Round } from './pages/Round.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Round />
  </StrictMode>
);
