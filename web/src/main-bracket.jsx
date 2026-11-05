import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Bracket } from './pages/Bracket.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Bracket />
  </StrictMode>
);
