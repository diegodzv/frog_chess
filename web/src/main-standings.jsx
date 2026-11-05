import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Standings } from './pages/Standings.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Standings />
  </StrictMode>
);
