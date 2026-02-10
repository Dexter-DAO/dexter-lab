import ignore from 'ignore';
import type { ProviderInfo } from '~/types/model';
import type { Template } from '~/types/template';
import { STARTER_TEMPLATES } from './constants';
import { createScopedLogger } from '~/utils/logger';

const templateLogger = createScopedLogger('selectStarterTemplate');

/**
 * Dexter x402 template selection prompt.
 * Eight templates covering all x402 payment patterns.
 */
const x402TemplateSelectionPrompt = (templates: Template[]) => `
You are Dexter, the x402 resource deployment assistant. Your job is to pick the best x402 resource template for a user's project.

x402 is a protocol for internet-native payments — buyers pay sellers per request using USDC cryptocurrency, with no API keys, no accounts, and no monthly plans. Dexter Lab lets users deploy x402-powered resources in seconds.

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

Rules — pick the FIRST match from top to bottom:
1. AI/LLM/generation/chat/writing/code/analysis/translation/summarization → "x402 AI Resource"
2. Proxy/gateway/monetize existing API/wrapper/wrap/forward → "x402 API Gateway"
3. Files/downloads/media/documents/digital goods/PDF/CSV/images → "x402 File Server"
4. Webhooks/notifications/inbound events/callbacks/receive data → "x402 Webhook Receiver"
5. Session/subscription/unlimited access/RPC/throughput/time-limited/pass → "x402 Access Pass"
6. Streaming/real-time/live feed/SSE/WebSocket/push/alerts/price feed → "x402 Stream"
7. Articles/blog/paywall/news/publishing/reading/newsletter/pay-per-article/magazine/editorial/essays → "x402 Content Paywall"
8. Everything else (data, quotes, lookups, trivia, weather, games, facts) → "x402 Data API"

When in doubt, pick "x402 Data API" — it is the simplest starting point and the AI agent can always add complexity.

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
