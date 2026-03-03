const path = require('path');

function normalizeEnv(value) {
  if (value === undefined || value === null) return '';
  const trimmed = String(value).trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function env(name, fallback = '') {
  const value = normalizeEnv(process.env[name]);
  if (value) return value;
  return normalizeEnv(fallback);
}

function required(name, fallback = '') {
  const value = env(name, fallback);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const isVercel = env('VERCEL') === '1';

const config = {
  port: Number(env('PORT', 3000)),
  isVercel,
  frontendUrl: env('FRONTEND_URL', '*'),
  supabaseUrl: required('SUPABASE_URL'),
  supabaseAnonKey: required('SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SERVICE_KEY'),
  studyMaterialsBucket: env('STUDY_MATERIALS_BUCKET', 'study-materials'),
  groqApiKey: env('GROQ_API_KEY') || env('AI_API_KEY') || env('OPENAI_API_KEY'),
  groqModel: env('GROQ_MODEL') || env('AI_MODEL') || 'llama-3.3-70b-versatile',
  appBaseUrl: env('APP_BASE_URL', 'http://localhost:3000'),
  rootDir: path.resolve(__dirname, '..')
};

module.exports = config;
