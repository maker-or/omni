import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "../blog" }),
  schema: z
    .object({
      title: z.string(),
      description: z.string(),
      date: z.coerce.date(),
      author: z.string().default("The Pipper Team"),
      category: z.string().default("Guides"),
      tags: z.array(z.string()).default([]),
      keywords: z
        .union([z.string(), z.array(z.string())])
        .default([])
        .transform((v) => (typeof v === "string" ? [v] : v)),
      slug: z.string(),
    })
    .passthrough(),
});

export const collections = { blog };
