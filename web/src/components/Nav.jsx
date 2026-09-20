import { useEffect, useState } from 'react';
import { datasetKey, withDataset } from '../dataset.js';

const LINKS = [
  { href: 'index.html', label: 'Clasificación', key: 'standings' },
  { href: 'round.html', label: 'Rondas', key: 'round' },
  { href: 'bracket.html', label: 'Bracket', key: 'bracket' },
  { href: 'register.html', label: 'Inscripción', key: 'register' }
];

/** Lets you jump between the real data and any simulated tournament; only shown when sim data exists (local dev). */
function DatasetSwitcher() {
  const [datasets, setDatasets] = useState([]);

  useEffect(() => {
    fetch('./data/sim/index.json', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setDatasets(json?.datasets ?? []))
      .catch(() => {});
  }, []);

  if (datasets.length === 0) return null;

  const onChange = (event) => {
    const key = event.target.value;
    const url = new URL(window.location.href);
    if (key) url.searchParams.set('data', key);
    else url.searchParams.delete('data');
    window.location.href = url.toString();
  };

  return (
    <label className="dataset-switcher">
      Datos:{' '}
      <select value={datasetKey()} onChange={onChange}>
        <option value="">Reales</option>
        {datasets.map((d) => (
          <option key={d.key} value={`sim/${d.key}`}>
            Simulación · {d.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Nav({ current }) {
  return (
    <>
      <nav className="nav">
        <span className="nav-brand">🐸 Frog Chess</span>
        <div className="nav-links">
          {LINKS.map((link) => (
            <a key={link.key} href={withDataset(link.href)} className={link.key === current ? 'active' : ''}>
              {link.label}
            </a>
          ))}
        </div>
        <DatasetSwitcher />
      </nav>
      {datasetKey().startsWith('sim/') && (
        <p className="sim-banner">Estás viendo un torneo simulado (jugadores y resultados ficticios).</p>
      )}
    </>
  );
}
