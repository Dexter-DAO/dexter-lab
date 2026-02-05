import express from 'express';
import { createX402Server, createTokenPricing, createDynamicPricing } from '@dexterai/x402/server';
import { toAtomicUnits } from '@dexterai/x402/utils';

const app = express();
app.use(express.json());

// Initialize x402 server
const server = createX402Server({
  payTo: '{{USER_WALLET}}', // User's Solana wallet - replaced at deploy
  network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', // Solana mainnet
});

// Token pricing for AI models
const gptPricing = createTokenPricing({
  model: 'gpt-5.2', // Latest GPT for high-quality output
  minUsd: 0.01,
  maxUsd: 10.00,
});

const codePricing = createTokenPricing({
  model: 'gpt-5.2-codex', // Best for code generation
  minUsd: 0.01,
  maxUsd: 25.00,
});

// Dynamic pricing for image generation
const imagePricing = createDynamicPricing({
  unitSize: 1, // Per image
  ratePerUnit: 0.50, // $0.50 per image
  minUsd: 0.50,
  maxUsd: 5.00,
});

// Health check endpoint (free)
app.get('/', (req, res) => {
  res.json({
    service: 'x402 AI Assistant',
    version: '1.0.0',
    endpoints: [
      { path: '/api/generate', method: 'POST', description: 'Generate text content' },
      { path: '/api/code', method: 'POST', description: 'Generate code' },
      { path: '/api/image', method: 'POST', description: 'Generate images' },
      { path: '/api/analyze', method: 'POST', description: 'Analyze Solana tokens' },
    ],
  });
});

// Text generation endpoint
app.post('/api/generate', async (req, res) => {
  const { prompt, style = 'professional', maxTokens = 2000 } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  const systemPrompt = `You are a helpful AI assistant. Write in a ${style} style. Be concise and informative.`;
  const paymentSig = req.headers['payment-signature'] as string;

  if (!paymentSig) {
    const quote = gptPricing.calculate(prompt, systemPrompt);
    const requirements = await server.buildRequirements({
      amountAtomic: quote.amountAtomic,
      resourceUrl: '/api/generate',
      description: `Generate text: ${quote.inputTokens.toLocaleString()} input tokens`,
    });

    res.setHeader('PAYMENT-REQUIRED', server.encodeRequirements(requirements));
    res.setHeader('X-Quote-Hash', quote.quoteHash);
    return res.status(402).json({
      inputTokens: quote.inputTokens,
      usdAmount: quote.usdAmount,
      model: quote.model,
    });
  }

  const quoteHash = req.headers['x-quote-hash'] as string;
  if (!gptPricing.validateQuote(prompt, quoteHash)) {
    return res.status(400).json({ error: 'Prompt changed, re-quote required' });
  }

  const result = await server.settlePayment(paymentSig);
  if (!result.success) {
    return res.status(402).json({ error: result.errorReason });
  }

  try {
    // Call OpenAI via proxy
    const llmResponse = await fetch('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.2',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        max_completion_tokens: maxTokens,
      }),
    });

    if (!llmResponse.ok) {
      throw new Error(`LLM error: ${llmResponse.status}`);
    }

    const llmData = await llmResponse.json();
    const content = llmData.choices[0].message.content;

    res.json({
      content,
      tokensUsed: llmData.usage.total_tokens,
      model: 'gpt-5.2',
      transaction: result.transaction,
    });
  } catch (error) {
    console.error('Generation error:', error);
    res.status(500).json({ error: 'Generation failed' });
  }
});

// Code generation endpoint
app.post('/api/code', async (req, res) => {
  const { prompt, language = 'typescript', context } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  const systemPrompt = `You are an expert ${language} developer. Generate clean, well-commented code following best practices. Only output the code, no explanations unless specifically asked.`;
  const fullPrompt = context ? `Context:\n${context}\n\nRequest: ${prompt}` : prompt;

  const paymentSig = req.headers['payment-signature'] as string;

  if (!paymentSig) {
    const quote = codePricing.calculate(fullPrompt, systemPrompt);
    const requirements = await server.buildRequirements({
      amountAtomic: quote.amountAtomic,
      resourceUrl: '/api/code',
      description: `Generate ${language} code: ${quote.inputTokens.toLocaleString()} tokens`,
    });

    res.setHeader('PAYMENT-REQUIRED', server.encodeRequirements(requirements));
    res.setHeader('X-Quote-Hash', quote.quoteHash);
    return res.status(402).json({
      inputTokens: quote.inputTokens,
      usdAmount: quote.usdAmount,
      model: quote.model,
      language,
    });
  }

  const quoteHash = req.headers['x-quote-hash'] as string;
  if (!codePricing.validateQuote(fullPrompt, quoteHash)) {
    return res.status(400).json({ error: 'Input changed, re-quote required' });
  }

  const result = await server.settlePayment(paymentSig);
  if (!result.success) {
    return res.status(402).json({ error: result.errorReason });
  }

  try {
    // Call OpenAI Codex via proxy
    const llmResponse = await fetch('/proxy/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.2-codex',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: fullPrompt },
        ],
        max_completion_tokens: 4096,
      }),
    });

    if (!llmResponse.ok) {
      throw new Error(`Codex error: ${llmResponse.status}`);
    }

    const llmData = await llmResponse.json();
    const code = llmData.choices[0].message.content;

    res.json({
      code,
      language,
      tokensUsed: llmData.usage.total_tokens,
      model: 'gpt-5.2-codex',
      transaction: result.transaction,
    });
  } catch (error) {
    console.error('Code generation error:', error);
    res.status(500).json({ error: 'Code generation failed' });
  }
});

// Image generation endpoint
app.post('/api/image', async (req, res) => {
  const { prompt, size = '1024x1024', style } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  const paymentSig = req.headers['payment-signature'] as string;
  const imageCount = 1; // Could make this configurable

  if (!paymentSig) {
    const quote = imagePricing.calculate(imageCount);
    const requirements = await server.buildRequirements({
      amountAtomic: quote.amountAtomic,
      resourceUrl: '/api/image',
      description: `Generate ${size} image`,
    });

    res.setHeader('PAYMENT-REQUIRED', server.encodeRequirements(requirements));
    res.setHeader('X-Quote-Hash', quote.quoteHash);
    return res.status(402).json({
      usdAmount: quote.usdAmount,
      size,
      model: 'gpt-image-1.5',
    });
  }

  const quoteHash = req.headers['x-quote-hash'] as string;
  if (!imagePricing.validateQuote(imageCount, quoteHash)) {
    return res.status(400).json({ error: 'Request changed, re-quote required' });
  }

  const result = await server.settlePayment(paymentSig);
  if (!result.success) {
    return res.status(402).json({ error: result.errorReason });
  }

  try {
    // Call DALL-E via proxy
    const imageResponse = await fetch('/proxy/openai/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-image-1.5', // Latest model with text rendering
        prompt: style ? `${prompt}, style: ${style}` : prompt,
        size,
        n: 1,
      }),
    });

    if (!imageResponse.ok) {
      throw new Error(`Image generation error: ${imageResponse.status}`);
    }

    const imageData = await imageResponse.json();
    const imageUrl = imageData.data[0].url;

    res.json({
      url: imageUrl,
      prompt,
      size,
      model: 'gpt-image-1.5',
      transaction: result.transaction,
    });
  } catch (error) {
    console.error('Image generation error:', error);
    res.status(500).json({ error: 'Image generation failed' });
  }
});

// Solana token analysis endpoint
app.post('/api/analyze', async (req, res) => {
  const { tokenAddress, analysisType = 'overview' } = req.body;

  if (!tokenAddress) {
    return res.status(400).json({ error: 'tokenAddress is required' });
  }

  const paymentSig = req.headers['payment-signature'] as string;
  const analysisPrice = analysisType === 'deep' ? 2.00 : 0.50; // $2 for deep, $0.50 for overview

  if (!paymentSig) {
    const requirements = await server.buildRequirements({
      amountAtomic: toAtomicUnits(analysisPrice, 6),
      resourceUrl: '/api/analyze',
      description: `${analysisType} analysis of ${tokenAddress.slice(0, 8)}...`,
    });

    res.setHeader('PAYMENT-REQUIRED', server.encodeRequirements(requirements));
    return res.status(402).json({
      usdAmount: analysisPrice,
      analysisType,
    });
  }

  const result = await server.settlePayment(paymentSig);
  if (!result.success) {
    return res.status(402).json({ error: result.errorReason });
  }

  try {
    // Fetch token data from multiple sources
    const [metadataResponse, priceResponse, securityResponse] = await Promise.all([
      // Get token metadata from Helius
      fetch(`/proxy/helius/token/${tokenAddress}`),
      // Get price data from Birdeye
      fetch(`/proxy/birdeye/defi/token_overview?address=${tokenAddress}`),
      // Get security info from Birdeye
      analysisType === 'deep'
        ? fetch(`/proxy/birdeye/defi/token_security?address=${tokenAddress}`)
        : Promise.resolve(null),
    ]);

    if (!metadataResponse.ok || !priceResponse.ok) {
      throw new Error('Failed to fetch token data');
    }

    const metadata = await metadataResponse.json();
    const priceData = await priceResponse.json();
    const securityData = analysisType === 'deep' && securityResponse
      ? await securityResponse.json()
      : null;

    // If deep analysis, also get AI insights
    let aiInsights = null;
    if (analysisType === 'deep') {
      const prompt = `Analyze this Solana token:
Name: ${metadata.name || 'Unknown'}
Symbol: ${metadata.symbol || 'Unknown'}
Price: $${priceData.data?.price || 0}
Market Cap: $${priceData.data?.marketCap || 0}
24h Volume: $${priceData.data?.volume24h || 0}
24h Change: ${priceData.data?.priceChange24h || 0}%
${securityData ? `
Security:
- Honeypot: ${securityData.data?.isHoneypot ? 'YES' : 'No'}
- Mintable: ${securityData.data?.isMintable ? 'Yes' : 'No'}
- Top 10 holders: ${securityData.data?.top10HolderPercent || 0}%
` : ''}

Provide a brief investment analysis including risks and opportunities.`;

      const llmResponse = await fetch('/proxy/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-5-mini', // Use cheaper model for analysis
          messages: [
            { role: 'system', content: 'You are a crypto analyst. Be objective and highlight both risks and opportunities.' },
            { role: 'user', content: prompt },
          ],
          max_completion_tokens: 500,
        }),
      });

      if (llmResponse.ok) {
        const llmData = await llmResponse.json();
        aiInsights = llmData.choices[0].message.content;
      }
    }

    res.json({
      token: {
        address: tokenAddress,
        name: metadata.name || 'Unknown',
        symbol: metadata.symbol || 'Unknown',
        decimals: metadata.decimals || 9,
      },
      price: {
        current: priceData.data?.price || 0,
        change24h: priceData.data?.priceChange24h || 0,
        volume24h: priceData.data?.volume24h || 0,
        marketCap: priceData.data?.marketCap || 0,
        liquidity: priceData.data?.liquidity || 0,
      },
      security: securityData?.data || null,
      aiInsights,
      analysisType,
      transaction: result.transaction,
    });
  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 8402;
app.listen(PORT, () => {
  console.log(`x402 AI Assistant running on port ${PORT}`);
  console.log('Available endpoints:');
  console.log('  POST /api/generate - Generate text content');
  console.log('  POST /api/code - Generate code');
  console.log('  POST /api/image - Generate images');
  console.log('  POST /api/analyze - Analyze Solana tokens');
});