import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import site from '../../site.config.mjs';
import { docsCategoryDataMap, getArticleHref, getCleanDocSlug, isPublicDoc } from '../data/docs';

export async function GET(context: { site?: URL }) {
  const docs = await getCollection('docs');

  const items = docs
    .filter(isPublicDoc)
    .filter((doc) => Boolean(doc.data.updatedAt))
    .filter((doc) => !doc.data.hideFromSearch)
    .sort((a, b) => b.data.updatedAt!.getTime() - a.data.updatedAt!.getTime())
    .map((doc) => {
      const categoryLabel =
        docsCategoryDataMap[doc.data.category as keyof typeof docsCategoryDataMap]?.name ?? doc.data.category;

      return {
        title: doc.data.title,
        description: doc.data.description ?? `${categoryLabel} update from ${site.name}.`,
        pubDate: doc.data.updatedAt!,
        link: getArticleHref(doc.data.category, getCleanDocSlug(doc.id)),
      };
    });

  return rss({
    title: `${site.name} Updates`,
    description: `Recent documentation updates from ${site.name}.`,
    site: context.site ?? site.siteUrl,
    items,
    customData: `<language>en-us</language>`,
  });
}
