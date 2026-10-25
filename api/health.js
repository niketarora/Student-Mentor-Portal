/**
 * GET /api/health
 * Liveness + configuration readiness. Reports which environment variables
 * are present, never their values.
 */
import { withApiDefaults, sendSuccess } from './_lib/http-response.js';
import { describeConfigHealth } from './_lib/environment.js';

export default withApiDefaults(['GET'], async (req, res) => {
  sendSuccess(res, 'SSMP API is running', {
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    configured: describeConfigHealth()
  });
});
