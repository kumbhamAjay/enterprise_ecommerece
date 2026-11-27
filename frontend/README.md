# ShopEasy storefront (Next.js)

```bash
cp .env.example .env.local   # optional: API_URL defaults to http://127.0.0.1:5000
npm run dev                  # http://localhost:5001  (the Express API must be running on :5000)
```

- Browser requests to `/api/*` are proxied to the Express API (see `next.config.ts`).
- Admin screens (`/admin`) need the `ADMIN` role. Grant it in SQL, then sign in again:
  `INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.email = 'you@example.com' AND r.name = 'ADMIN';`
- API docs: http://localhost:5000/api/docs
