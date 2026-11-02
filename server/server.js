import app from './app.js';

const PORT = process.env.PORT || 3000;

// Start server if not running in a serverless environment
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(`🚀 ReadCast Article-to-EPUB SaaS Server running!`);
    console.log(`📍 Web Dashboard: http://localhost:${PORT}`);
    console.log(`📡 API Base:      http://localhost:${PORT}/api`);
    console.log(`==================================================\n`);
  });
}

export default app;
