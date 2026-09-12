import type { WorkspacePrComment } from "../../contracts/git.ts";

/**
 * Review bots post HTML (`<h3>`, `<details>`, `<code>`), which the sanitized
 * markdown renderer drops. Fold the common tags into markdown so a comment
 * reads the way it does on GitHub, and strip the rest.
 */
export function commentToMarkdown(body: string): string {
  return body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, text: string) => {
      return `\n${"#".repeat(Number(level))} ${text.trim()}\n`;
    })
    .replace(/<summary[^>]*>([\s\S]*?)<\/summary>/gi, "\n**$1**\n")
    .replace(/<\/?details[^>]*>/gi, "\n")
    .replace(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<(b|strong)>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(i|em)>([\s\S]*?)<\/\1>/gi, "_$2_")
    .replace(/<code>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<\/?(p|div|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|img|span)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** First meaningful line of a comment body, one line, capped. */
export function commentPreview(body: string, max = 140): string {
  const cleaned = commentToMarkdown(body)
    .replace(/[#*_`>|]+/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, max);
}

/**
 * Card title: `path:line` for inline review comments, else the comment's
 * own heading when it opens with one, else its first sentence.
 */
export function commentTitle(comment: Pick<WorkspacePrComment, "body" | "path" | "line">): string {
  if (comment.path) return `${comment.path}${comment.line ? `:${comment.line}` : ""}`;
  const markdown = commentToMarkdown(comment.body);
  const heading = markdown.match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.replace(/[*_`]/g, "").slice(0, 80);
  const firstLine =
    markdown
      .split("\n")
      .find((line) => line.trim())
      ?.trim() ?? "";
  const sentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? firstLine;
  return commentPreview(sentence, 80) || "Comment";
}

/** Comments grouped by author, in the order authors first appear. */
export function groupCommentsByAuthor(
  comments: WorkspacePrComment[],
): Array<{ author: string; avatarUrl: string | null; comments: WorkspacePrComment[] }> {
  const groups = new Map<
    string,
    { author: string; avatarUrl: string | null; comments: WorkspacePrComment[] }
  >();
  for (const comment of comments) {
    const group = groups.get(comment.author);
    if (group) {
      group.comments.push(comment);
      group.avatarUrl ??= comment.avatarUrl;
    } else {
      groups.set(comment.author, {
        author: comment.author,
        avatarUrl: comment.avatarUrl,
        comments: [comment],
      });
    }
  }
  return [...groups.values()];
}

export function sortComments(
  comments: WorkspacePrComment[],
  order: "latest" | "oldest",
): WorkspacePrComment[] {
  const stamp = (comment: WorkspacePrComment) => Date.parse(comment.createdAt) || 0;
  return [...comments].sort((a, b) =>
    order === "latest" ? stamp(b) - stamp(a) : stamp(a) - stamp(b),
  );
}
