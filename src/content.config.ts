import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'zod';

const docs = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/docs' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    category: z.string(),
    order: z.number().optional().default(100),
    updatedAt: z.coerce.date().optional(),
  }),
});

export const collections = { docs };
