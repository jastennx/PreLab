const path = require('path');

function required(name, fallback = '') {
  const value = process.env[name] || fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const isVercel = process.env.VERCEL === '1';

const config = {
  port: Number(process.env.PORT || 3000),
  isVercel,
  frontendUrl: process.env.FRONTEND_URL || '*',
  supabaseUrl: required('SUPABASE_URL'),
  supabaseAnonKey: required('SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '',
  studyMaterialsBucket: process.env.STUDY_MATERIALS_BUCKET || 'study-materials',
  openRouterApiKey: process.env.OPENROUTER_API_KEY || required('AI_API_KEY'),
  openRouterModel: process.env.OPENROUTER_MODEL || 'openrouter/auto',
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3000',
  rootDir: path.resolve(__dirname, '..')
};

if (!config.supabaseServiceRoleKey) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY)');
}

module.exports = config;
