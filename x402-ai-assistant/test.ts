// Simple test to verify the x402 resource structure
import express from 'express';

const app = express();

app.get('/test', (req, res) => {
  res.json({
    status: 'ok',
    message: 'x402 resource test endpoint',
    timestamp: new Date().toISOString()
  });
});

const PORT = 3003;
app.listen(PORT, () => {
  console.log(`Test server running on port ${PORT}`);
});