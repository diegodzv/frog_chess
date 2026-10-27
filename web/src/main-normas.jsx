import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Normas } from './pages/Normas.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Normas />
  </StrictMode>
);
