// The site normally reads ./data/*.json. For local review it can also read a
// simulated tournament copied by copy-data.mjs: open any page with
// ?data=sim/n40 and every JSON is fetched from ./data/sim/n40/ instead.

const SAFE_KEY = /^[\w-]+(\/[\w-]+)*$/;

export function datasetKey() {
  const key = new URLSearchParams(window.location.search).get('data') ?? '';
  return SAFE_KEY.test(key) ? key : '';
}

export function dataUrl(file) {
  const key = datasetKey();
  return key ? `./data/${key}/${file}` : `./data/${file}`;
}

/** Keeps the selected dataset when navigating between pages. */
export function withDataset(href) {
  const key = datasetKey();
  return key ? `${href}?data=${key}` : href;
}
