import express from 'express';
import { createX402Server, createTokenPricing } from '@dexterai/x402/server';

const app = express();
app.use(express.json());

// Create x402 server instance
const server = createX402Server({
  payTo: '{{USER_WALLET}}',
  network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
});

// Use token-based pricing with GPT-5.2
const pricing = createTokenPricing({
  model: 'gpt-5.2',
  minUsd: 0.10,
  maxUsd: 5.00,
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'x402-cover-letter-generator',
    version: '1.0.0'
  });
});

// Pricing info endpoint
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

// Simple test endpoint
app.post('/api/test', (req, res) => {
  res.json({
    message: 'x402 Cover Letter Generator is running',
    timestamp: new Date().toISOString(),
    received: req.body
  });
});

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => {
  console.log(`x402 Cover Letter Generator running on port ${PORT}`);
  console.log(`Test endpoints:`);
  console.log(`  GET  http://localhost:${PORT}/health`);
  console.log(`  GET  http://localhost:${PORT}/api/pricing`);
  console.log(`  POST http://localhost:${PORT}/api/test`);
});