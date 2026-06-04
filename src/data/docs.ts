export const docsParentCategories = [
  {
    slug: 'getting-started',
    name: 'Getting Started',
    description: 'Set up Compass, learn the content model, and publish your first docs updates.',
  },
  {
    slug: 'integrations',
    name: 'Integrations',
    description: 'Extend Compass with analytics, editorial systems, and optional tools around your docs workflow.',
  },
] as const;

export const docsCategories = [
  {
    name: 'Start Here',
    slug: 'start-here',
    parent: 'getting-started',
    description: 'Install the project, understand the file structure, and shape your first publishing workflow.',
    icon: 'flag',
  },
  {
    name: 'Compass Docs',
    slug: 'compass-docs',
    parent: 'getting-started',
    description: 'Manage article collections, sidebar structure, and search-friendly content patterns.',
    icon: 'file',
  },
  {
    name: 'Components',
    slug: 'components',
    parent: 'getting-started',
    description: 'Build reusable callouts, headings, and content blocks that make docs feel polished and consistent.',
    icon: 'spark',
  },
  {
    name: 'Channels & Apps',
    slug: 'channels-and-apps',
    parent: 'integrations',
    description: 'Cover analytics, CMS-backed editing, embedded support surfaces, and other tools around your docs.',
    icon: 'grid',
  },
] as const;

export type DocsParentSlug = (typeof docsParentCategories)[number]['slug'];
export type DocsCategorySlug = (typeof docsCategories)[number]['slug'];

export const docsParentMap = Object.fromEntries(
  docsParentCategories.map((category) => [category.slug, category]),
) as Record<DocsParentSlug, (typeof docsParentCategories)[number]>;

export const docsCategoryMap = Object.fromEntries(
  docsCategories.map((category) => [category.slug, category.name]),
) as Record<DocsCategorySlug, string>;

export const docsCategoryDataMap = Object.fromEntries(
  docsCategories.map((category) => [category.slug, category]),
) as Record<DocsCategorySlug, (typeof docsCategories)[number]>;

export function getParentForCategory(categorySlug: string) {
  return docsCategories.find((category) => category.slug === categorySlug)?.parent;
}

export function getCategoriesForParent(parentSlug: string) {
  return docsCategories.filter((category) => category.parent === parentSlug);
}

export function getCategoryHref(categorySlug: string) {
  const parentSlug = getParentForCategory(categorySlug);
  return parentSlug ? `/${parentSlug}/${categorySlug}` : `/${categorySlug}`;
}

export function getArticleHref(categorySlug: string, articleSlug: string) {
  return `${getCategoryHref(categorySlug)}/${articleSlug}`;
}

export function getCleanDocSlug(docId: string) {
  return docId.split('/').at(-1) ?? docId;
}

type SearchSuggestionSource = {
  id: string;
  data: {
    title: string;
    description?: string;
    category: string;
    order?: number;
  };
};

export type SearchSuggestion = {
  title: string;
  excerpt: string;
  category: string;
  url: string;
};

export function getSuggestedSearchArticles(
  docs: SearchSuggestionSource[],
  { limit = 4, category = 'start-here' }: { limit?: number; category?: string } = {},
): SearchSuggestion[] {
  return docs
    .filter((doc) => doc.data.category === category)
    .sort((a, b) => (a.data.order ?? 100) - (b.data.order ?? 100))
    .slice(0, limit)
    .map((doc) => ({
      title: doc.data.title,
      excerpt: doc.data.description ?? '',
      category: docsCategoryDataMap[doc.data.category as keyof typeof docsCategoryDataMap]?.name ?? doc.data.category,
      url: getArticleHref(doc.data.category, getCleanDocSlug(doc.id)),
    }));
}
