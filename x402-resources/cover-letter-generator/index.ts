import express from 'express';
import { createX402Server, createTokenPricing } from '@dexterai/x402/server';
import { z } from 'zod';

const app = express();
app.use(express.json());

// Create x402 server instance
const server = createX402Server({
  payTo: '{{USER_WALLET}}',  // User's Solana wallet - replaced at deploy
  network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',  // Solana mainnet
});

// Use token-based pricing with GPT-5.2 for high-quality cover letters
const pricing = createTokenPricing({
  model: 'gpt-5.2',  // Latest GPT model for excellent writing quality
  minUsd: 0.10,     // Minimum $0.10 per cover letter
  maxUsd: 5.00,     // Maximum $5.00 per cover letter
});

// Input validation schema
const CoverLetterSchema = z.object({
  jobTitle: z.string().min(1).max(200),
  company: z.string().min(1).max(200),
  jobDescription: z.string().min(10).max(5000),
  resume: z.string().min(10).max(10000),
  additionalInfo: z.string().max(2000).optional(),
  tone: z.enum(['professional', 'enthusiastic', 'confident', 'friendly']).default('professional'),
  length: z.enum(['concise', 'standard', 'detailed']).default('standard'),
});

type CoverLetterInput = z.infer<typeof CoverLetterSchema>;

// Helper function to build the system prompt
function buildSystemPrompt(tone: string, length: string): string {
  const lengthInstructions = {
    concise: 'Keep the cover letter brief and to the point, around 250-300 words.',
    standard: 'Write a standard-length cover letter, around 350-450 words.',
    detailed: 'Write a comprehensive cover letter, around 500-650 words.',
  };

  return `You are an expert cover letter writer with years of experience helping job seekers land their dream positions. Your task is to write a compelling, personalized cover letter that:

1. Highlights relevant experience and skills from the resume that match the job requirements
2. Shows genuine enthusiasm for the specific role and company
3. Demonstrates understanding of the company's needs and how the candidate can add value
4. Uses a ${tone} tone throughout
5. ${lengthInstructions[length as keyof typeof lengthInstructions]}
6. Follows professional cover letter format with proper greeting, 3-4 body paragraphs, and closing
7. Avoids generic phrases and creates unique, memorable content
8. Includes specific examples and achievements when relevant

Remember to:
- Address the hiring manager professionally (use "Dear Hiring Manager" if name unknown)
- Open with a strong hook that grabs attention
- Connect the candidate's background directly to the job requirements
- Show knowledge of the company and role
- Close with a clear call to action`;
}

// Helper function to build the user prompt
function buildUserPrompt(input: CoverLetterInput): string {
  let prompt = `Please write a cover letter for the following position:

Job Title: ${input.jobTitle}
Company: ${input.company}

Job Description:
${input.jobDescription}

My Resume:
${input.resume}`;

  if (input.additionalInfo) {
    prompt += `\n\nAdditional Information to Include:
${input.additionalInfo}`;
  }

  return prompt;
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'x402-cover-letter-generator',
    version: '1.0.0'
  });
});

// Main cover letter generation endpoint
app.post('/api/generate', async (req, res) => {
  try {
    // Validate input
    const validationResult = CoverLetterSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Invalid input',
        details: validationResult.error.flatten(),
      });
    }

    const input = validationResult.data;
    const paymentSig = req.headers['payment-signature'] as string | undefined;

    // Build prompts
    const systemPrompt = buildSystemPrompt(input.tone, input.length);
    const userPrompt = buildUserPrompt(input);

    // If no payment signature, return quote
    if (!paymentSig) {
      const quote = pricing.calculate(userPrompt, systemPrompt);
      const requirements = await server.buildRequirements({
        amountAtomic: quote.amountAtomic,
        resourceUrl: req.originalUrl,
        description: `Generate cover letter: ${input.jobTitle} at ${input.company} (${quote.inputTokens.toLocaleString()} tokens)`,
      });

      res.setHeader('PAYMENT-REQUIRED', server.encodeRequirements(requirements));
      res.setHeader('X-Quote-Hash', quote.quoteHash);

      return res.status(402).json({
        inputTokens: quote.inputTokens,
        estimatedOutputTokens: Math.round(quote.inputTokens * 0.8), // Estimate output
        usdAmount: quote.usdAmount,
        model: quote.model,
        jobTitle: input.jobTitle,
        company: input.company,
      });
    }

    // Validate quote hasn't changed
    const quoteHash = req.headers['x-quote-hash'] as string | undefined;
    if (!quoteHash || !pricing.validateQuote(userPrompt, quoteHash)) {
      return res.status(400).json({
        error: 'Input changed after quote. Please request a new quote.',
      });
    }

    // Verify and settle payment
    const result = await server.settlePayment(paymentSig);
    if (!result.success) {
      return res.status(402).json({
        error: result.errorReason || 'Payment verification failed',
      });
    }

    // Call OpenAI via proxy to generate the cover letter
    const llmResponse = await fetch('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.2',  // Use the same model as pricing
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,  // Some creativity but not too random
        max_completion_tokens: 2048,  // GPT-5 uses max_completion_tokens
      }),
    });

    if (!llmResponse.ok) {
      const error = await llmResponse.text();
      console.error('LLM API error:', error);
      return res.status(500).json({
        error: 'Failed to generate cover letter. Please try again.',
      });
    }

    const llmData = await llmResponse.json();
    const coverLetter = llmData.choices[0].message.content;

    // Generate a professional filename
    const filename = `cover-letter-${input.company.replace(/\s+/g, '-').toLowerCase()}-${input.jobTitle.replace(/\s+/g, '-').toLowerCase()}.txt`;

    res.json({
      coverLetter,
      metadata: {
        jobTitle: input.jobTitle,
        company: input.company,
        tone: input.tone,
        length: input.length,
        wordCount: coverLetter.split(/\s+/).length,
        tokensUsed: llmData.usage?.total_tokens || 0,
        filename,
      },
      transaction: result.transaction,
    });

  } catch (error) {
    console.error('Error generating cover letter:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Endpoint to get pricing information
app.get('/api/pricing', (req, res) => {
  res.json({
    model: 'gpt-5.2',
    description: 'AI-powered cover letter generation',
    pricing: {
      minimum: '$0.10 USD',
      maximum: '$5.00 USD',
      basis: 'Based on input length (resume + job description)',
      averagePrice: '$0.25 - $0.50 for typical cover letters',
    },
    features: [
      'Personalized to your resume and the specific job',
      'Multiple tone options (professional, enthusiastic, confident, friendly)',
      'Adjustable length (concise, standard, detailed)',
      'Highlights relevant experience and achievements',
      'Professional formatting and structure',
      'Unique content - no generic templates',
    ],
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    availableEndpoints: [
      'GET /health',
      'GET /api/pricing',
      'POST /api/generate',
    ],
  });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => {
  console.log(`x402 Cover Letter Generator running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Pricing info: http://localhost:${PORT}/api/pricing`);
});