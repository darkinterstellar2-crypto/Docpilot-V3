# Teams

**Page:** `teams.html` | **API:** `routes/teamRoutes.js`

DocPilot has a basic teams system for organizing users into groups. All team management operations require superadmin role.

## Data Storage

Teams are stored in `src/DataFiles/teams/teams.json`:

```json
[
  {
    "id": "team-1718000000000",
    "name": "Crew Alpha",
    "description": "Primary installation crew",
    "picture": "/src/DataFiles/teams/avatars/team-1718000000000.png",
    "members": [
      { "userId": "user-id-or-email", "role": "member" }
    ],
    "createdAt": "2026-06-01T10:00:00.000Z",
    "updatedAt": "2026-06-01T10:00:00.000Z"
  }
]
```

Team avatars are stored in `src/DataFiles/teams/avatars/`.

## API Endpoints

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/api/teams` | Any | List all teams (with resolved member names/avatars) |
| GET | `/api/teams/available-users` | Any | List users for member picker |
| GET | `/api/teams/:id` | Any | Get single team |
| POST | `/api/teams` | Superadmin | Create team |
| PUT | `/api/teams/:id` | Superadmin | Update name/description |
| DELETE | `/api/teams/:id` | Superadmin | Delete team |
| POST | `/api/teams/:id/members` | Superadmin | Add member |
| DELETE | `/api/teams/:id/members/:userId` | Superadmin | Remove member |
| POST | `/api/teams/:id/picture` | Superadmin | Upload team picture (max 5MB) |

## Member Resolution

When teams are returned from the API, member entries are enriched with user data from `users.json`:
- Name (falls back to email)
- Email
- Avatar
- Role in the team (currently just "member")

## Current Limitations

- Teams are informational only — they do not affect ACL/permissions
- No team-based project assignment
- No team roles beyond "member"
- Team pictures use a basic filename scheme (`teamId.ext`)
