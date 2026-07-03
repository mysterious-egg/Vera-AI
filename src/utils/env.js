/**
 * env.js — loads and validates environment variables.
 * Import this module before anything else that reads process.env.
 */

import 'dotenv/config';

/**
 * Required environment variables.
 * Add entries here in later checkpoints (e.g. 'GEMINI_API_KEY' in CP2).
 */
const required = [];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
};
