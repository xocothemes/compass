type PagefindSearchResultData = {
  url: string;
  excerpt?: string;
  meta: {
    title?: string;
    category?: string;
    preview?: string;
  };
};

type PagefindSearch = {
  results: Array<{
    data: () => Promise<PagefindSearchResultData>;
  }>;
};

type PagefindApi = {
  debouncedSearch: (
    term: string,
    options?: Record<string, never>,
    debounceTimeoutMs?: number,
  ) => Promise<PagefindSearch | null>;
};

type SearchEntry = {
  title: string;
  excerpt: string;
  url: string;
};

type SearchElements = {
  input: HTMLInputElement;
  results: HTMLDivElement;
  submitButton: HTMLButtonElement | null;
  status: HTMLElement | null;
};

const MAX_RESULTS = 8;
const SEARCH_DEBOUNCE_MS = 150;
const PAGEFIND_BUNDLE_URL = '/pagefind/pagefind.js';
const SEARCH_PREVIEWS_SCRIPT_ID = 'docs-search-previews';

let pagefindPromise: Promise<PagefindApi | null> | undefined;
let searchPreviewsCache: Record<string, string> | undefined;
let searchShortcutsBound = false;

const stripTags = (value: string) => value.replace(/<[^>]*>/g, '').trim();

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getSearchTerms = (query: string) =>
  Array.from(
    new Set(
      query
        .trim()
        .split(/\s+/)
        .map((term) => term.trim())
        .filter(Boolean)
        .sort((left, right) => right.length - left.length),
    ),
  );

const appendHighlightedText = (element: HTMLElement, value: string, query = '') => {
  const terms = getSearchTerms(query);
  if (!value || terms.length === 0) {
    element.append(document.createTextNode(value));
    return;
  }

  const matcher = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  let lastIndex = 0;

  for (const match of value.matchAll(matcher)) {
    const matchIndex = match.index ?? 0;
    const matchedText = match[0];

    if (matchIndex > lastIndex) {
      element.append(document.createTextNode(value.slice(lastIndex, matchIndex)));
    }

    const mark = document.createElement('mark');
    mark.className = 'search-highlight';
    mark.textContent = matchedText;
    element.append(mark);

    lastIndex = matchIndex + matchedText.length;
  }

  if (lastIndex < value.length) {
    element.append(document.createTextNode(value.slice(lastIndex)));
  }
};

const normalizeSearchUrl = (value: string) => {
  try {
    const url = new URL(value, window.location.origin);
    return url.pathname.replace(/\/$/, '') || '/';
  } catch {
    return value.replace(/\/$/, '') || '/';
  }
};

const getPagefind = () => {
  if (!pagefindPromise) {
    pagefindPromise = import(/* @vite-ignore */ PAGEFIND_BUNDLE_URL)
      .then((module) => module as PagefindApi)
      .catch((error) => {
        console.error('Unable to load the Pagefind bundle.', error);
        return null;
      });
  }

  return pagefindPromise;
};

const getSearchElements = (root: HTMLElement): SearchElements | null => {
  const input = root.querySelector('[data-search-input]');
  const results = root.querySelector('[data-search-results]');
  const submitButton = root.querySelector('[data-search-submit]');
  const status = root.querySelector('[data-search-status]');

  if (!(input instanceof HTMLInputElement) || !(results instanceof HTMLDivElement)) {
    return null;
  }

  return {
    input,
    results,
    submitButton: submitButton instanceof HTMLButtonElement ? submitButton : null,
    status: status instanceof HTMLElement ? status : null,
  };
};

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
};

const getPreferredSearchInput = () => {
  const roots = Array.from(document.querySelectorAll<HTMLElement>('[data-docs-search]'));

  for (const root of roots) {
    if (root.offsetParent === null) continue;

    const elements = getSearchElements(root);
    if (!elements || elements.input.disabled) continue;

    return elements.input;
  }

  return null;
};

const focusSearchInput = () => {
  const input = getPreferredSearchInput();
  if (!input) return;

  input.focus();
  input.select();
};

const bindSearchShortcuts = () => {
  if (searchShortcutsBound) return;
  searchShortcutsBound = true;

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if (isEditableTarget(event.target)) return;

    const isSlashShortcut = event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey;
    const isCommandPaletteShortcut =
      event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey;

    if (!isSlashShortcut && !isCommandPaletteShortcut) return;

    event.preventDefault();
    focusSearchInput();
  });
};

const setResultsVisibility = (_input: HTMLInputElement, results: HTMLDivElement, isVisible: boolean) => {
  results.classList.toggle('hidden', !isVisible);
  results.setAttribute('aria-hidden', String(!isVisible));
};

const areResultsVisible = (results: HTMLDivElement) =>
  !results.classList.contains('hidden') && results.getAttribute('aria-hidden') !== 'true';

const getResultLinks = (results: HTMLDivElement) =>
  Array.from(results.querySelectorAll<HTMLAnchorElement>('[data-search-result-link]'));

const announceStatus = (status: HTMLElement | null, message = '') => {
  if (status) {
    status.textContent = message;
  }
};

const hideResults = (input: HTMLInputElement, results: HTMLDivElement, status?: HTMLElement | null) => {
  results.replaceChildren();
  setResultsVisibility(input, results, false);
  announceStatus(status ?? null, '');
};

const renderEmptyState = (
  input: HTMLInputElement,
  results: HTMLDivElement,
  status: HTMLElement | null,
  message: string,
) => {
  const emptyState = document.createElement('p');
  emptyState.className = 'px-4 py-4 text-sm text-[var(--color-text-muted)]';
  emptyState.textContent = message;

  results.replaceChildren(emptyState);
  setResultsVisibility(input, results, true);
  announceStatus(status, message);
};

const renderResults = (
  input: HTMLInputElement,
  results: HTMLDivElement,
  status: HTMLElement | null,
  entries: SearchEntry[],
  label = 'Search results',
  query = '',
) => {
  const list = document.createElement('ul');
  list.className = 'divide-y divide-[var(--color-border)]';
  list.setAttribute('aria-label', label);

  entries.forEach((entry, index) => {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = entry.url;
    link.className = 'search-result-link block px-4 py-3 transition-colors hover:bg-[var(--color-hover-surface)]';
    link.dataset.searchResultLink = 'true';
    link.id = `${input.id}-result-${index}`;

    const title = document.createElement('div');
    title.className = 'search-result-title text-sm font-medium text-[var(--color-accent)]';
    appendHighlightedText(title, entry.title, query);
    link.append(title);

    if (entry.excerpt) {
      const excerpt = document.createElement('div');
      excerpt.className = 'mt-1 text-xs leading-5 text-[var(--color-text-muted)]';
      appendHighlightedText(excerpt, entry.excerpt, query);
      link.append(excerpt);
    }

    item.append(link);
    list.append(item);
  });

  results.replaceChildren(list);
  setResultsVisibility(input, results, true);
  announceStatus(status, `${entries.length} ${entries.length === 1 ? 'result' : 'results'} available.`);
};

const getSuggestions = (root: HTMLElement): SearchEntry[] => {
  const rawSuggestions = root.dataset.searchSuggestions;
  if (!rawSuggestions) return [];

  try {
    const parsed = JSON.parse(rawSuggestions) as SearchEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const getSearchPreviews = () => {
  if (searchPreviewsCache) return searchPreviewsCache;

  const previews = document.getElementById(SEARCH_PREVIEWS_SCRIPT_ID);
  if (!(previews instanceof HTMLScriptElement) || !previews.textContent) {
    searchPreviewsCache = {};
    return searchPreviewsCache;
  }

  try {
    const parsed = JSON.parse(previews.textContent) as Record<string, string>;
    searchPreviewsCache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    searchPreviewsCache = {};
  }

  return searchPreviewsCache;
};

const renderSuggestions = (
  root: HTMLElement,
  input: HTMLInputElement,
  results: HTMLDivElement,
  status: HTMLElement | null,
) => {
  const suggestions = getSuggestions(root);
  if (suggestions.length === 0) {
    hideResults(input, results, status);
    return;
  }

  renderResults(input, results, status, suggestions, 'Suggested articles');
  announceStatus(
    status,
    `${suggestions.length} suggested ${suggestions.length === 1 ? 'article' : 'articles'} available.`,
  );
};

const setSearchUnavailable = (
  input: HTMLInputElement,
  results: HTMLDivElement,
  status: HTMLElement | null,
  message: string,
) => {
  input.disabled = true;
  input.setAttribute('aria-disabled', 'true');
  renderEmptyState(input, results, status, message);
};

const searchPagefind = async (
  query: string,
  searchPreviews: Record<string, string>,
): Promise<SearchEntry[] | null | undefined> => {
  const pagefind = await getPagefind();
  if (!pagefind) return null;

  const search = await pagefind.debouncedSearch(query, {}, SEARCH_DEBOUNCE_MS);
  if (!search) return undefined;

  return Promise.all(
    search.results.slice(0, MAX_RESULTS).map(async (result) => {
      const data = await result.data();
      const normalizedUrl = normalizeSearchUrl(data.url);
      const preview = data.excerpt
        ? stripTags(data.excerpt)
        : (searchPreviews[normalizedUrl] ?? data.meta.preview ?? '');
      const title = data.meta.title ?? 'Untitled';

      return {
        title,
        excerpt: preview,
        url: data.url,
      };
    }),
  );
};

const attachSearch = (root: HTMLElement) => {
  const elements = getSearchElements(root);
  if (!elements) return;

  const { input, results, submitButton, status } = elements;
  const emptyMessage = root.dataset.searchEmpty ?? 'No matching articles found.';
  const errorMessage = root.dataset.searchError ?? 'Search is temporarily unavailable.';
  const searchPreviews = getSearchPreviews();
  let latestQuery = '';
  let activeResultIndex = -1;

  const setActiveResult = (index: number) => {
    const links = getResultLinks(results);
    if (links.length === 0) {
      activeResultIndex = -1;
      return;
    }

    activeResultIndex = (index + links.length) % links.length;

    links.forEach((link, linkIndex) => {
      const isActive = linkIndex === activeResultIndex;
      link.classList.toggle('is-active', isActive);

      if (isActive) {
        link.scrollIntoView({ block: 'nearest' });
      }
    });
  };

  const clearActiveResult = () => {
    activeResultIndex = -1;
    getResultLinks(results).forEach((link) => {
      link.classList.remove('is-active');
    });
  };

  const navigateToActiveResult = () => {
    const links = getResultLinks(results);
    const link = links[activeResultIndex] ?? links[0];
    if (!link) return false;

    window.location.href = link.href;
    return true;
  };

  const resetRenderedResults = () => {
    clearActiveResult();
  };

  const runSearch = async () => {
    const query = input.value.trim();
    latestQuery = query;

    if (!query) {
      renderSuggestions(root, input, results, status);
      resetRenderedResults();
      return;
    }

    const matches = await searchPagefind(query, searchPreviews);
    if (query !== latestQuery) return;

    if (matches === undefined) {
      return;
    }

    if (matches === null) {
      setSearchUnavailable(input, results, status, errorMessage);
      resetRenderedResults();
      return;
    }

    if (matches.length === 0) {
      renderEmptyState(input, results, status, emptyMessage);
      resetRenderedResults();
      return;
    }

    renderResults(input, results, status, matches, 'Search results', query);
    resetRenderedResults();
  };

  input.addEventListener('focus', () => {
    void getPagefind();
    if (!input.value.trim()) {
      renderSuggestions(root, input, results, status);
      resetRenderedResults();
    }
  });

  input.addEventListener('click', () => {
    if (!input.value.trim()) {
      renderSuggestions(root, input, results, status);
      resetRenderedResults();
    }
  });

  input.addEventListener('input', () => {
    clearActiveResult();
    void runSearch();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideResults(input, results, status);
      clearActiveResult();
      input.blur();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const links = getResultLinks(results);
      if (!areResultsVisible(results) || links.length === 0) return;

      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex =
        activeResultIndex === -1 ? (direction > 0 ? 0 : links.length - 1) : activeResultIndex + direction;
      setActiveResult(nextIndex);
      return;
    }

    if (event.key === 'Enter' && areResultsVisible(results) && getResultLinks(results).length > 0) {
      event.preventDefault();
      navigateToActiveResult();
    }
  });

  submitButton?.addEventListener('click', () => {
    input.focus();
    void runSearch();
  });

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (!root.contains(target)) {
      hideResults(input, results);
      clearActiveResult();
    }
  });

  root.addEventListener('focusout', (event) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && root.contains(nextTarget)) return;
    hideResults(input, results);
    clearActiveResult();
  });
};

const initDocsSearch = () => {
  bindSearchShortcuts();

  document.querySelectorAll<HTMLElement>('[data-docs-search]').forEach((root) => {
    if (root.dataset.searchBound === 'true') return;
    root.dataset.searchBound = 'true';
    attachSearch(root);
  });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDocsSearch, { once: true });
} else {
  initDocsSearch();
}
