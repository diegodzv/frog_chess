const LINKS = [
  { href: 'index.html', label: 'Clasificación', key: 'standings' },
  { href: 'round.html', label: 'Ronda actual', key: 'round' },
  { href: 'bracket.html', label: 'Bracket', key: 'bracket' },
  { href: 'register.html', label: 'Inscripción', key: 'register' }
];

export function Nav({ current }) {
  return (
    <nav className="nav">
      <span className="nav-brand">🐸 Frog Chess</span>
      <div className="nav-links">
        {LINKS.map((link) => (
          <a key={link.key} href={link.href} className={link.key === current ? 'active' : ''}>
            {link.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
