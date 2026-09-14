import { Router } from 'express';
import { buildScorecardContract } from './src/utils/scorecardContract.js';

export const scorecardRouter = Router();

/** Public product contract. No user data. Scored by scripts/assert-scorecard-live.mjs. */
scorecardRouter.get('/api/scorecard/contract', (_req, res) => {
  res.json(buildScorecardContract());
});
