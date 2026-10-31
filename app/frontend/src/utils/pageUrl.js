// Pages carry the library, version and dependent in the address
// (?library=...&version=...), so a page can be linked, bookmarked and reloaded.

// Path with the given values as query parameters (empty values left out)
export const pageUrl = (path, params) => {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value)
  ).toString();
  return query ? `${path}?${query}` : path;
};

// A value from the navigation state, else from the address
export const pageParam = (location, name) =>
  location.state?.[name] || new URLSearchParams(location.search).get(name) || undefined;
