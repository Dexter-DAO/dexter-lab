import ignore from 'ignore';
import type { ProviderInfo } from '~/types/model';
import type { Template } from '~/types/template';
import { STARTER_TEMPLATES } from './constants';
import { createScopedLogger } from '~/utils/logger';

const templateLogger = createScopedLogger('selectStarterTemplate');

/**
 * x402-focused template selection prompt.
 * Only two choices -- Data API vs AI Resource -- so the LLM decision is fast and deterministic.
 */
const x402TemplateSelectionPrompt = (templates: Template[]) => `
You help choose the right x402 resource template for a user's project.

Available templates:
${templates
  .map(
    (template) => `
<template>
  <name>${template.name}</name>
  <description>${template.description}</description>
  ${template.tags ? `<tags>${template.tags.join(', ')}</tags>` : ''}
</template>
`,
  )
  .join('\n')}

Rules:
- If the user wants AI, LLM, generation, chat, writing, code generation, analysis, translation, or summarization features, pick "x402 AI Resource"
- For everything else (data serving, quotes, trivia, lookups, weather, games, content libraries, jokes, facts), pick "x402 Data API"
- When in doubt, pick "x402 Data API" -- it's simpler and the AI can always add complexity

Response Format:
<selection>
  <templateName>{exact template name}</templateName>
  <title>{a short title for the resource}</title>
</selection>

Important: Respond ONLY with the selection tags. No other text.
MOST IMPORTANT: YOU DONT HAVE TIME TO THINK JUST START RESPONDING BASED ON HUNCH
`;

const parseSelectedTemplate = (llmOutput: string): { template: string; title: string } | null => {
  try {
    const templateNameMatch = llmOutput.match(/<templateName>(.*?)<\/templateName>/);
    const titleMatch = llmOutput.match(/<title>(.*?)<\/title>/);

    if (!templateNameMatch) {
      return null;
    }

    return { template: templateNameMatch[1].trim(), title: titleMatch?.[1].trim() || 'Untitled Resource' };
  } catch (error) {
    console.error('Error parsing template selection:', error);
    return null;
  }
};

export const selectStarterTemplate = async (options: { message: string; model: string; provider: ProviderInfo }) => {
  const { message, model, provider } = options;

  const requestBody = {
    message,
    model,
    provider,
    system: x402TemplateSelectionPrompt(STARTER_TEMPLATES),
  };

  try {
    const response = await fetch('/api/llmcall', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    });
    const respJson: { text: string } = await response.json();

    const { text } = respJson;
    const selectedTemplate = parseSelectedTemplate(text);

    if (selectedTemplate) {
      templateLogger.info('Selected template:', selectedTemplate.template, '| Title:', selectedTemplate.title);
      return selectedTemplate;
    }
  } catch (error) {
    templateLogger.error('Template selection failed:', error);
  }

  // Fallback to Data API (simpler scaffold)
  templateLogger.info('Falling back to x402 Data API template');

  return {
    template: 'x402 Data API',
    title: '',
  };
};

const getGitHubRepoContent = async (repoName: string): Promise<{ name: string; path: string; content: string }[]> => {
  try {
    const response = await fetch(`/api/github-template?repo=${encodeURIComponent(repoName)}`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const files = (await response.json()) as any;

    return files;
  } catch (error) {
    console.error('Error fetching release contents:', error);
    throw error;
  }
};

export async function getTemplates(templateName: string, title?: string) {
  const template = STARTER_TEMPLATES.find((t) => t.name == templateName);

  if (!template) {
    return null;
  }

  /*
   * Inline files: if the template has files embedded directly, use them
   * instead of fetching from GitHub. This is faster and avoids external deps.
   */
  if (template.files) {
    const inlineFiles = Object.entries(template.files).map(([path, content]) => ({
      name: path.split('/').pop() || path,
      path,
      content,
    }));

    const assistantMessage = `
Dexter is initializing your x402 resource with the ${template.name} template.
<boltArtifact id="imported-files" title="${title || 'Create x402 resource scaffold'}" type="bundled">
${inlineFiles
  .map(
    (file) =>
      `<boltAction type="file" filePath="${file.path}">
${file.content}
</boltAction>`,
  )
  .join('\n')}
</boltArtifact>
`;

    const userMessage = `[CONTINUE]`;

    templateLogger.info('=== INLINE TEMPLATE OUTPUT ===');
    templateLogger.info('Template name:', template.name);
    templateLogger.info('Files count:', inlineFiles.length);

    return {
      assistantMessage,
      userMessage,
    };
  }

  /*
   * GitHub-hosted templates: fetch files from the repo.
   * This path is kept for backwards compatibility with any future GitHub-hosted templates.
   */
  const githubRepo = template.githubRepo;
  const files = await getGitHubRepoContent(githubRepo);

  let filteredFiles = files;

  filteredFiles = filteredFiles.filter((x) => x.path.startsWith('.git') == false);
  filteredFiles = filteredFiles.filter((x) => x.path.startsWith('.bolt') == false);

  const templateIgnoreFile = files.find((x) => x.path.startsWith('.bolt') && x.name == 'ignore');

  const filesToImport = {
    files: filteredFiles,
    ignoreFile: [] as typeof filteredFiles,
  };

  if (templateIgnoreFile) {
    const ignorepatterns = templateIgnoreFile.content.split('\n').map((x) => x.trim());
    const ig = ignore().add(ignorepatterns);
    const ignoredFiles = filteredFiles.filter((x) => ig.ignores(x.path));

    filesToImport.files = filteredFiles;
    filesToImport.ignoreFile = ignoredFiles;
  }

  const assistantMessage = `
Dexter is initializing your x402 resource with the ${template.name} template.
<boltArtifact id="imported-files" title="${title || 'Create x402 resource scaffold'}" type="bundled">
${filesToImport.files
  .map(
    (file) =>
      `<boltAction type="file" filePath="${file.path}">
${file.content}
</boltAction>`,
  )
  .join('\n')}
</boltArtifact>
`;
  let userMessage = ``;
  const templatePromptFile = files.filter((x) => x.path.startsWith('.bolt')).find((x) => x.name == 'prompt');

  if (templatePromptFile) {
    userMessage = `
TEMPLATE INSTRUCTIONS:
${templatePromptFile.content}

---
`;
  }

  if (filesToImport.ignoreFile.length > 0) {
    userMessage =
      userMessage +
      `
STRICT FILE ACCESS RULES - READ CAREFULLY:

The following files are READ-ONLY and must never be modified:
${filesToImport.ignoreFile.map((file) => `- ${file.path}`).join('\n')}

Permitted actions:
✓ Import these files as dependencies
✓ Read from these files
✓ Reference these files

Strictly forbidden actions:
❌ Modify any content within these files
❌ Delete these files
❌ Rename these files
❌ Move these files
❌ Create new versions of these files
❌ Suggest changes to these files

Any attempt to modify these protected files will result in immediate termination of the operation.

If you need to make changes to functionality, create new files instead of modifying the protected ones listed above.
---
`;
  }

  userMessage += `[CONTINUE]`;

  templateLogger.info('=== GITHUB TEMPLATE OUTPUT ===');
  templateLogger.info('Template name:', template.name);
  templateLogger.info('Files count:', filesToImport.files.length);

  return {
    assistantMessage,
    userMessage,
  };
}
