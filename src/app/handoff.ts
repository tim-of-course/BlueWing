export interface HandoffDocument {
  name: string;
  status: 'Draft' | 'Complete' | 'Status not supplied';
  html: string;
}

/** Parse inertly; only the isolated viewer executes document scripts. */
export function prepareHandoff(name: string, html: string): HandoffDocument {
  const document = new DOMParser().parseFromString(html, 'text/html');
  let status: HandoffDocument['status'] = 'Status not supplied';
  const metadata = document.querySelectorAll(
    'script#bluewing-handoff[type="application/json"]',
  );
  if (metadata.length === 1) {
    try {
      const value: unknown = JSON.parse(metadata[0]?.textContent ?? '');
      if (value && typeof value === 'object' && 'draft' in value) {
        if (value.draft === true) status = 'Draft';
        else if (value.draft === false) status = 'Complete';
      }
    } catch {
      // Unrecognized metadata never prevents viewing an otherwise useful file.
    }
  }
  // Embedded content stays usable without loading app, network, or local assets.
  const policy = document.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  document
    .querySelectorAll('base, meta[http-equiv="refresh" i]')
    .forEach((node) => {
      node.remove();
    });
  document.head.prepend(policy);
  return {
    name,
    status,
    html: `<!doctype html>\n${document.documentElement.outerHTML}`,
  };
}
