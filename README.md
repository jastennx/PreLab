# PreLab (HTML/CSS/JS + Node/Express + Supabase + OpenRouter)

PreLab is an AI-powered study assistant MVP for students.

It lets users:
- sign up / sign in with Supabase Auth
- create modules from study material
- generate AI study explanations
- generate AI quizzes
- submit answers and get AI feedback
- chat with an assistant per module

## 1. Agile SDLC Approach

This project is organized in iterative modules:
1. Authentication + base UI shell
2. Module management (dashboard)
3. Study explanation generation
4. Practice quiz generation + submission
5. Feedback analytics + weak areas
6. Chatbot persistence and guidance

Each module is independently testable and can be improved in future sprints.

## 2. Folder Structure

```text
PreLab/
  api/
    index.js                    # Vercel serverless entry
  public/
    js/
      api.js                    # frontend API helper
      auth.js                   # Supabase auth wrapper
      config.js                 # runtime config loader
      dashboard.js              # dashboard logic
      feedback.js               # feedback rendering
      home.js                   # login/signup logic
      practice.js               # quiz runner logic
      study.js                  # explanation/chat logic
    pages/
      home.html
      home.css
      dashboard.html
      dashboard.css
      study.html
      study.css
      practice.html
      practice.css
      feedback.html
      feedback.css
  src/
    routes/
      apiRoutes.js              # REST routes
    services/
      aiService.js              # OpenRouter integration + evaluation logic
      supabaseClient.js         # Supabase admin client
    app.js                      # Express app
    config.js                   # env config
  supabase/
    schema.sql                  # SQL schema + RLS + trigger
  .env.example
  .gitignore
  package.json
  server.js                     # local dev entry
  vercel.json
```

## 3. System Architecture

### 3.1 Data Flow (text diagram)

```text
Browser (home/dashboard/study/practice/feedback)
   -> fetch('/api/...')
Express API (src/routes/apiRoutes.js)
   -> Supabase (Auth + PostgreSQL tables)
   -> OpenRouter API (content generation/evaluation)
   -> persist generated quiz/results/feedback/chat
Express API -> JSON response -> Browser UI update
```

### 3.2 REST API Routes

- `GET /api/health`
- `GET /api/public-config`
- `POST /api/modules`
- `GET /api/modules?userId=<uuid>`
- `GET /api/modules/:id`
- `DELETE /api/modules/:id`
- `POST /api/study/explain`
- `POST /api/practice/generate`
- `POST /api/practice/submit`
- `GET /api/results?userId=<uuid>`
- `GET /api/results/:id`
- `POST /api/chat`
- `GET /api/chat/:moduleId?userId=<uuid>`

## 4. Database Schema (Supabase)

Required tables are implemented in `supabase/schema.sql`:
- `users`
- `subjects`
- `modules`
- `quizzes`
- `results`
- `ai_feedback`

Additional table:
- `chat_messages` (for persistent chatbot context)

Also included:
- indexes
- auth trigger (`auth.users` -> `public.users`)
- RLS policies

## 5. Full Setup Guide

## 5.1 Create Supabase Project

1. Go to https://supabase.com and create a new project.
2. Open `SQL Editor`.
3. Copy and run the SQL in `supabase/schema.sql`.
4. In `Project Settings -> API`, copy:
- `Project URL` -> `SUPABASE_URL`
- `anon public` key -> `SUPABASE_ANON_KEY`
- `service_role` key -> `SUPABASE_SERVICE_ROLE_KEY`
5. Storage bucket:
- The provided `supabase/schema.sql` also creates bucket `study-materials` with RLS policies.
- If you already ran an older schema, re-run the latest file so upload policies are created.

## 5.2 Get Free AI API Key (OpenRouter)

1. Go to https://openrouter.ai/keys
2. Create a free API key.
3. Use it as `AI_API_KEY` (or `OPENROUTER_API_KEY`).

## 5.3 Local Node Setup

1. Install Node.js 18+.
2. In project root:

```bash
npm install
```

3. Create `.env` from `.env.example` and fill values:

```env
PORT=3000
FRONTEND_URL=*
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
STUDY_MATERIALS_BUCKET=study-materials
AI_API_KEY=...
OPENROUTER_MODEL=openrouter/auto
APP_BASE_URL=http://localhost:3000
```

4. Run:

```bash
npm run dev
```

5. Open `http://localhost:3000`

## 5.4 Frontend to Backend Connection

- Frontend calls relative routes (`/api/...`) via `public/js/api.js`.
- Backend serves JSON from Express in `src/routes/apiRoutes.js`.

## 5.5 AI Connection

- `src/services/aiService.js` sends prompts to the OpenRouter Chat Completions endpoint.
- Prompt types:
- explanation prompt -> `summary`, `key_points`, `study_tips`
- quiz prompt -> MCQ JSON
- feedback prompt -> encouragement + weak-area suggestions + next steps

## 6. How Each Page Works

- `home.html`: landing + sign in / sign up with Supabase Auth.
- `dashboard.html`: create modules and list existing modules.
- `study.html`: generate topic explanations and chat with assistant.
- `practice.html`: answer generated quiz and submit.
- `feedback.html`: review score, wrong answers, and AI guidance.

## 7. How Feedback Is Generated

1. User submits selected options.
2. Backend compares answers to `correct_index` in quiz JSON.
3. Calculates:
- `correct_count`
- `total_questions`
- `score`
- weak topics
4. Sends review summary to AI for personalized coaching.
5. Stores result in `results` and AI narrative in `ai_feedback`.

## 8. GitHub Setup (Mandatory)

1. Initialize repo (if needed):

```bash
git init
```

2. Add files:

```bash
git add .
```

3. Commit:

```bash
git commit -m "Initial PreLab MVP"
```

4. Create GitHub repository, then:

```bash
git remote add origin <your-repo-url>
git branch -M main
git push -u origin main
```

## 9. Vercel Deployment (Mandatory)

1. Create Vercel account: https://vercel.com
2. Click `Add New -> Project`.
3. Import this GitHub repo.
4. In project settings, add environment variables:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STUDY_MATERIALS_BUCKET` (`study-materials`)
- `AI_API_KEY`
- `OPENROUTER_MODEL` (optional)
- `APP_BASE_URL` (optional; your deployed URL, used for OpenRouter headers)
- `FRONTEND_URL` (optional; your deployed URL)
5. Deploy.
6. Vercel uses `api/index.js` for serverless backend and `public/` as static frontend.

## 10. Production Considerations

- CORS: controlled by `FRONTEND_URL` in backend config.
- Environment variables: keep all secrets in Vercel project settings only.
- API key safety: use AI key only in backend; do not expose private keys in frontend.
- Free-tier limits:
- Supabase free database/storage usage caps
- OpenRouter free-model quota/rate limits
- Vercel free execution limits for serverless functions
- Serverless model:
- Express app is exported via `api/index.js` for Vercel.
- Each `/api/*` request runs on a serverless function.
- Upload flow:
- Browser uploads PDF/DOCX directly to Supabase Storage.
- API receives only `storagePath`, downloads with service-role key, then extracts/analyzes text.
- This avoids Vercel request size limits for large files.

## 11. UI Mockup Alignment

The current pages follow the uploaded purple-gradient mockup style:
- top dark-purple nav
- centered hero/auth on home
- split dashboard module create + module list
- card-based quiz flow and summary feedback

If you want stricter pixel matching, provide exact spacing/typography constraints and I can do a second pass for 1:1 visual tuning.



