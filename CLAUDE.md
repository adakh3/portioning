# Portioning Calculator

Catering food portioning calculator — Django + DRF backend, Next.js + Tailwind frontend.

## Project Structure

- `backend/` — Django project with apps: `dishes`, `menus`, `rules`, `events`, `calculator`
- `frontend/` — Next.js app with Tailwind CSS
- `venv/` — Python virtual environment (not committed)

## Development Setup

### Backend
```bash
source venv/bin/activate
cd backend
pip install -r requirements.txt
python manage.py migrate
python manage.py loaddata seed.json  # Load all seed data (dishes, menus, tiers, rules, bookings, settings)
python manage.py runserver
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Key Conventions

- **Python**: Django 5.x, DRF, SQLite for dev, PostgreSQL for prod
- **Frontend**: Next.js App Router, TypeScript, Tailwind CSS
- **API prefix**: All endpoints under `/api/`
- **Calculation engine**: Pure logic in `calculator/engine/`, no Django ORM dependencies in core math
- **Rules in DB**: All portioning rules/constraints are DB-managed via Django admin, not hardcoded
- **Virtual env**: Always use `source venv/bin/activate` before running Python commands

## Important Rules

- **Any change to calculation logic** (engine, pools, categories, baselines, ceilings) **must also update PORTIONING_LOGIC.md** to keep documentation in sync with the code.
- **Any change to PORTIONING_LOGIC.md** must also update **`frontend/app/help/page.tsx`** — the help page is static content distilled from the logic doc.
- **Any change to seed data** (new dishes, menus, categories, rules, cost data, surcharges, etc.) **must regenerate `backend/seed.json`** by running: `cd backend && python manage.py dumpdata dishes menus rules bookings events --indent 2 -o seed.json`

## Running Tests
```bash
cd backend
python manage.py test
```

## Git
- Remote: https://github.com/adakh3/portioning.git
- Branch: main
- Don't commit `venv/`, `node_modules/`, `__pycache__/`, `.env`, `db.sqlite3`
