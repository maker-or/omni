import type { APIRoute } from "astro";
import { getCollection } from "astro:content";

export const prerender = true;

export const GET: APIRoute = async () => {
  const posts = (await getCollection("blog")).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf(),
  );

  const header = `# Pipper Code — Full Site Text

Pipper is a free desktop app for running, directing, and improving multiple AI coding agents — Claude Code, Codex, Cursor, OpenCode, Copilot, Grok — from a single interface instead of a wall of terminals. It is an AI agent interface and harness built on the Agent Client Protocol (ACP). Your prompts, code, and agent activity stay local to your machine.

Key pages: Homepage https://www.pipper.dev/ | Download https://www.pipper.dev/download/ | Blog https://www.pipper.dev/blog/

`;

  const body = posts
    .map((post) => {
      const front = [
        `# ${post.data.title}`,
        `Published: ${post.data.date.toISOString()}`,
        `Author: ${post.data.author}`,
        `Category: ${post.data.category}`,
        `URL: https://www.pipper.dev/blog/${post.data.slug}/`,
        "",
      ].join("\n");
      return `${front}\n${post.body.trim()}\n\n`;
    })
    .join("---\n\n");

  return new Response((header + body).trimEnd() + "\n", {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
