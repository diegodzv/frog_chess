import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Stats } from './pages/Stats.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Stats />
  </StrictMode>
);
