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
  titleHtml?: string;
  excerpt: string;
  excerptHtml?: string;
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

let pagefindPromise: Promise<PagefindApi | null> | undefined;
let searchShortcutsBound = false;

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

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

const highlightText = (value: string, query: string) => {
  const terms = getSearchTerms(query);
  if (!value || terms.length === 0) {
    return escapeHtml(value);
  }

  const matcher = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  const highlighted = value.replace(matcher, '\u0000$1\u0001');

  return escapeHtml(highlighted)
    .replaceAll('\u0000', '<mark class="search-highlight">')
    .replaceAll('\u0001', '</mark>');
};

const sanitizeHighlightedHtml = (value: string) =>
  escapeHtml(value)
    .replaceAll('&lt;mark&gt;', '<mark class="search-highlight">')
    .replaceAll('&lt;/mark&gt;', '</mark>')
    .replaceAll('&lt;mark class=&quot;pagefind-highlight&quot;&gt;', '<mark class="search-highlight">')
    .replaceAll('&lt;mark class=&quot;search-highlight&quot;&gt;', '<mark class="search-highlight">');

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

const announceStatus = (status: HTMLElement | null, message = '') => {
  if (status) {
    status.textContent = message;
  }
};

const hideResults = (input: HTMLInputElement, results: HTMLDivElement, status?: HTMLElement | null) => {
  results.innerHTML = '';
  setResultsVisibility(input, results, false);
  announceStatus(status ?? null, '');
};

const renderEmptyState = (
  input: HTMLInputElement,
  results: HTMLDivElement,
  status: HTMLElement | null,
  message: string,
) => {
  results.innerHTML = `<p class="px-4 py-4 text-sm text-[var(--color-text-muted)]">${escapeHtml(message)}</p>`;
  setResultsVisibility(input, results, true);
  announceStatus(status, message);
};

const renderResults = (
  input: HTMLInputElement,
  results: HTMLDivElement,
  status: HTMLElement | null,
  entries: SearchEntry[],
  label = 'Search results',
) => {
  results.innerHTML = `
    <ul class="divide-y divide-[var(--color-border)]" aria-label="${escapeHtml(label)}">
      ${entries
        .map(
          (entry) => `
        <li>
          <a href="${escapeHtml(entry.url)}" class="block px-4 py-3 transition-colors hover:bg-[var(--color-hover-surface)]">
            <div class="search-result-title text-sm font-medium text-[var(--color-accent)]">${entry.titleHtml ?? escapeHtml(entry.title)}</div>
            ${entry.excerpt ? `<div class="mt-1 text-xs leading-5 text-[var(--color-text-muted)]">${entry.excerptHtml ?? escapeHtml(entry.excerpt)}</div>` : ''}
          </a>
        </li>
      `,
        )
        .join('')}
    </ul>
  `;
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

const getSearchPreviews = (root: HTMLElement) => {
  const rawPreviews = root.dataset.searchPreviews;
  if (!rawPreviews) return {} as Record<string, string>;

  try {
    const parsed = JSON.parse(rawPreviews) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
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
      const excerptHtml = data.excerpt
        ? sanitizeHighlightedHtml(data.excerpt)
        : preview
          ? highlightText(preview, query)
          : '';

      return {
        title,
        titleHtml: highlightText(title, query),
        excerpt: preview,
        excerptHtml,
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
  const searchPreviews = getSearchPreviews(root);
  let latestQuery = '';

  const runSearch = async () => {
    const query = input.value.trim();
    latestQuery = query;

    if (!query) {
      renderSuggestions(root, input, results, status);
      return;
    }

    const matches = await searchPagefind(query, searchPreviews);
    if (query !== latestQuery) return;

    if (matches === undefined) {
      return;
    }

    if (matches === null) {
      setSearchUnavailable(input, results, status, errorMessage);
      return;
    }

    if (matches.length === 0) {
      renderEmptyState(input, results, status, emptyMessage);
      return;
    }

    renderResults(input, results, status, matches);
  };

  input.addEventListener('focus', () => {
    void getPagefind();
    if (!input.value.trim()) {
      renderSuggestions(root, input, results, status);
    }
  });

  input.addEventListener('click', () => {
    if (!input.value.trim()) {
      renderSuggestions(root, input, results, status);
    }
  });

  input.addEventListener('input', () => {
    void runSearch();
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideResults(input, results, status);
      input.blur();
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
    }
  });

  root.addEventListener('focusout', (event) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && root.contains(nextTarget)) return;
    hideResults(input, results);
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
