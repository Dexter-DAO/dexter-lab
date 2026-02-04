/**
 * Dexter Lab Skills Module
 *
 * Provides dynamic loading of skill files from the /skills directory.
 * Skills are Markdown files with YAML frontmatter that get injected
 * into the AI's system prompt.
 */

export {
  loadSkill,
  loadAllSkills,
  formatSkillsForPrompt,
  getSkills,
  getSkillsPromptSection,
  clearSkillCache,
  type Skill,
  type SkillMeta,
} from './loader';
