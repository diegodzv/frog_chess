// Parses the auto-generated markdown body of a GitHub Issue Form into
// { fieldLabel: value } pairs. GitHub renders each field as:
//
//   ### Field label
//
//   value (possibly multi-line)
//
// Empty selections are rendered as "_No response_".

export function parseIssueForm(body) {
  const fields = {};
  const sectionRegex = /^### (.+)$/gm;
  const matches = [...body.matchAll(sectionRegex)];

  for (let i = 0; i < matches.length; i++) {
    const label = matches[i][1].trim();
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : body.length;
    const value = body.slice(start, end).trim();
    fields[label] = value === '_No response_' ? '' : value;
  }
  return fields;
}
