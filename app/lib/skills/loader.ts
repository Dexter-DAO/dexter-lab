/**
 * Dexter Lab Skill Loader
 *
 * Loads skill files from /skills directory and prepares them for injection
 * into the system prompt. Skills are Markdown files with YAML frontmatter.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';

export interface SkillMeta {
  name: string;
  description: string;
  version?: string;
  author?: string;
  tags?: string[];
}

export interface Skill {
  meta: SkillMeta;
  content: string;
  path: string;
}

/**
 * Parse YAML frontmatter from skill file
 */
function parseFrontmatter(content: string): { meta: Record<string, any>; body: string } {
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { meta: {}, body: content };
  }

  const [, yamlStr, body] = match;
  const meta: Record<string, any> = {};

  // Parse YAML key-value pairs
  const lines = yamlStr.split('\n');
  let currentKey: string | null = null;
  let arrayItems: string[] = [];

  for (const line of lines) {
    // Check for array item (indented with -)
    if (line.match(/^\s+-\s+/)) {
      const item = line.replace(/^\s+-\s+/, '').trim().replace(/^['"]|['"]$/g, '');
      arrayItems.push(item);
      continue;
    }

    // If we were collecting array items, save them
    if (currentKey && arrayItems.length > 0) {
      meta[currentKey] = arrayItems;
      arrayItems = [];
      currentKey = null;
    }

    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();

    // Empty value means array follows
    if (value === '') {
      currentKey = key;
      continue;
    }

    // Handle inline arrays [item1, item2]
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1);
      meta[key] = value.split(',').map(v => v.trim().replace(/^['"]|['"]$/g, ''));
    }
    // Handle quoted strings
    else if ((value.startsWith('"') && value.endsWith('"')) ||
             (value.startsWith("'") && value.endsWith("'"))) {
      meta[key] = value.slice(1, -1);
    }
    // Plain value
    else {
      meta[key] = value;
    }
  }

  // Save any remaining array items
  if (currentKey && arrayItems.length > 0) {
    meta[currentKey] = arrayItems;
  }

  return { meta, body: body.trim() };
}

/**
 * Load a single skill file
 */
export function loadSkill(skillPath: string): Skill | null {
  try {
    const content = readFileSync(skillPath, 'utf-8');
    const { meta, body } = parseFrontmatter(content);

    return {
      meta: {
        name: meta.name || 'unknown',
        description: meta.description || '',
        version: meta.version,
        author: meta.author,
        tags: meta.tags || [],
      },
      content: body,
      path: skillPath,
    };
  } catch (error) {
    console.error(`[skills] Failed to load skill from ${skillPath}:`, error);
    return null;
  }
}

/**
 * Load all skills from the skills directory
 */
export function loadAllSkills(skillsDir?: string): Skill[] {
  // Default to project root /skills directory
  // Use __dirname to resolve relative to this file, then go up to project root
  const dir = skillsDir || resolve(__dirname, '../../../../skills');

  if (!existsSync(dir)) {
    console.warn(`[skills] Skills directory not found: ${dir}`);
    return [];
  }

  const skills: Skill[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Look for SKILL.md in subdirectory
        const skillFile = join(dir, entry.name, 'SKILL.md');
        if (existsSync(skillFile)) {
          const skill = loadSkill(skillFile);
          if (skill) {
            skills.push(skill);
          }
        }
      } else if (entry.name.endsWith('.md') && entry.name !== 'README.md') {
        // Load standalone skill file
        const skill = loadSkill(join(dir, entry.name));
        if (skill) {
          skills.push(skill);
        }
      }
    }
  } catch (error) {
    console.error(`[skills] Failed to read skills directory:`, error);
  }

  console.log(`[skills] Loaded ${skills.length} skills:`, skills.map(s => s.meta.name));
  return skills;
}

/**
 * Format skills for injection into system prompt
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) {
    return '';
  }

  const sections = skills.map(skill => {
    return `
<skill name="${skill.meta.name}" description="${skill.meta.description}">
${skill.content}
</skill>`.trim();
  });

  return `
<dexter_lab_skills>
The following skills provide specialized knowledge for building x402 paid API resources.
Use these skills when relevant to the user's request.

${sections.join('\n\n')}
</dexter_lab_skills>`.trim();
}

// Cached skills (loaded once at startup)
let cachedSkills: Skill[] | null = null;

/**
 * Get all skills (cached)
 */
export function getSkills(): Skill[] {
  if (cachedSkills === null) {
    cachedSkills = loadAllSkills();
  }
  return cachedSkills;
}

/**
 * Get formatted skills string for prompt injection
 */
export function getSkillsPromptSection(): string {
  return formatSkillsForPrompt(getSkills());
}

/**
 * Clear the skill cache (useful for hot reloading in development)
 */
export function clearSkillCache(): void {
  cachedSkills = null;
}
