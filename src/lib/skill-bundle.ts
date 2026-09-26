/**
 * Every skill Pipper ships, bundled into the renderer at build time.
 *
 * A skill is a markdown file under `skills/<group>/<name>.md` with a YAML
 * frontmatter `name` and `description`. The glob below picks up any new file
 * automatically, so adding or updating a skill is a markdown edit and a
 * rebuild — no import to register. Skills are attached to a prompt at the
 * moment they are used; agents never read them from disk.
 *
 * Files whose name starts with `_` (e.g. `skills/git/_common.md`) are shared
 * preambles for their group, not standalone skills.
 */
const FILES = import.meta.glob<string>("../../skills/*/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

export interface BundledSkill {
  /** `<group>/<name>`, e.g. `git/commit`. */
  id: string;
  group: string;
  name: string;
  description: string;
  /** Markdown body with the frontmatter removed. */
  body: string;
  /** True for a `_`-prefixed group preamble. */
  shared: boolean;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** Drop a leading `---` YAML frontmatter block; the agent only needs the body. */
export function stripFrontmatter(text: string): string {
  const match = FRONTMATTER.exec(text);
  return (match ? text.slice(match[0].length) : text).trim();
}

/** Read the flat `key: value` pairs of a frontmatter block. */
function readFrontmatter(text: string): Record<string, string> {
  const match = FRONTMATTER.exec(text);
  const fields: Record<string, string> = {};
  if (!match) return fields;
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([\w-]+):\s*(.*)$/.exec(line);
    if (pair) fields[pair[1]] = pair[2].trim();
  }
  return fields;
}

/** Parse one skill file. Throws on a file that is not a well-formed skill. */
export function parseSkill(path: string, text: string): BundledSkill {
  const match = /(?:^|\/)skills\/([^/]+)\/([^/]+)\.md$/.exec(path);
  if (!match) throw new Error(`Skill must live at skills/<group>/<name>.md: ${path}`);
  const [, group, file] = match;
  const shared = file.startsWith("_");
  const name = shared ? file.slice(1) : file;
  const meta = readFrontmatter(text);
  if (meta.name !== name) {
    throw new Error(`Skill ${path}: frontmatter name "${meta.name ?? ""}" must be "${name}".`);
  }
  if (!meta.description) throw new Error(`Skill ${path}: frontmatter needs a description.`);
  const body = stripFrontmatter(text);
  if (!body) throw new Error(`Skill ${path}: body is empty.`);
  return { id: `${group}/${name}`, group, name, description: meta.description, body, shared };
}

const SKILLS = new Map<string, BundledSkill>();
for (const [path, text] of Object.entries(FILES)) {
  const skill = parseSkill(path, text);
  SKILLS.set(skill.shared ? `${skill.group}/_${skill.name}` : skill.id, skill);
}

/** Every bundled skill, preambles included, sorted by id. */
export function listSkills(group?: string): BundledSkill[] {
  return [...SKILLS.values()]
    .filter((skill) => !group || skill.group === group)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** A standalone skill by id (`git/commit`). Throws when it is not bundled. */
export function getSkill(id: string): BundledSkill {
  const skill = SKILLS.get(id);
  if (!skill || skill.shared) throw new Error(`Skill not bundled: ${id}`);
  return skill;
}

/** The group's shared preamble (`skills/<group>/_common.md`), when it has one. */
export function getGroupPreamble(group: string): BundledSkill | null {
  return SKILLS.get(`${group}/_common`) ?? null;
}
