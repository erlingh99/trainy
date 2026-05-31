# Training Planner Backend

- `GET    /api/users`
- `POST   /api/users`               body: `{ "name": "..." }`
- `DELETE /api/users/{id}`
- `GET    /api/sessions?user=<name>&from=YYYY-MM-DD&to=YYYY-MM-DD`
- `POST   /api/sessions`
- `PATCH  /api/sessions/{id}`
- `DELETE /api/sessions/{id}`
- `GET    /api/summary/week?user=<name>&iso_week=YYYY-Www`
- `GET    /api/summary/month?user=<name>&yyyymm=YYYY-MM`
