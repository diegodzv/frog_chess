import { marked } from 'marked';
import rules from '../../../NORMAS.md?raw';
import { Nav } from '../components/Nav.jsx';

// NORMAS.md (repo root) is the single source of the rules: GitHub shows it and this page renders it at build time.
const html = marked.parse(rules);

export function Normas() {
  return (
    <div className="page">
      <Nav current="normas" />
      <article className="prose" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
