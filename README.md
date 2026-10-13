# My Captain API

Node.js + TypeScript, Express 5, MongoDB (Mongoose), Redis, Socket.io, Cloudinary.

## Run locally

```bash
cp .env.example .env        # fill in the secrets
docker compose up -d        # MongoDB and Redis (or leave REDIS_URL empty to use the memory store)
npm install
npm run seed                # default rate card and the first admin
npm run dev                 # http://localhost:4000
```

```bash
npm test                    # 25 integration tests against an in-memory MongoDB
npm run build && npm start  # production build
```

Production refuses to start without `REDIS_URL`, Cloudinary keys and a real SMS provider.

## Roles

| Role | How they sign in | What they do |
|---|---|---|
| customer | phone + SMS code | book, pay, track, cancel, close |
| partner | email or phone + password (from the partner website) | company documents, staff, cars, assign staff |
| driver / guard | phone + password (created by their partner) | run assigned duties |
| admin | phone + password (seeded) | approve partners, rates, payments, assign companies |

## API (`/api/v1`)

**Auth**
- `POST /auth/otp/request` `{ phone, purpose: sign-in | sign-up }`
- `POST /auth/otp/verify` `{ phone, code, name?, email? }` → session
- `POST /auth/login` `{ identifier, password }` → session
- `POST /auth/refresh` `{ refreshToken }` → new session (old token is revoked)
- `POST /auth/logout` `{ refreshToken }`
- `GET /auth/me`, `PATCH /auth/me`, `POST /auth/password`

A session is `{ accessToken (15 min), refreshToken (30 days, single use), user }`. Send `Authorization: Bearer <accessToken>`.

**Partners**
- `POST /companies/applications` (public) → company + partner session
- `GET /companies/me`, `POST /companies/me/documents` (multipart `file`, `kind`)
- `GET|POST /companies/me/staff`, `PATCH /companies/me/staff/:id`, `POST /companies/me/staff/:id/documents`
- `GET|POST /companies/me/cars`, `PATCH /companies/me/cars/:id`
- Admin: `GET /companies?status=`, `GET /companies/:id`, `POST /companies/:id/review` `{ decision, note }`

**Bookings**
- `POST /bookings/quote`, `POST /bookings` (customer)
- `GET /bookings?status=a,b&page=`: scoped to the caller's role
- `GET /bookings/:id` → booking + the statuses the caller may move it to
- `POST /bookings/:id/status` `{ to, note? }`
- `POST /bookings/:id/assign-company` (admin), `POST /bookings/:id/assign-staff` (partner or admin)

Status flow: `pending_payment → paid → assigning → confirmed → arriving → on_duty → completed → closed`, with `cancelled` before the duty starts. Until Phase 4, an admin marks bookings paid.

**Catalog and other**
- `GET /rates`, `PUT /rates` (admin)
- `GET /cars?class=&city=`
- `POST /uploads` (multipart `file`, `purpose: evidence | avatar`)
- `GET /admin/overview`
- `GET /health`

Errors are always `{ error: { code, message, details? } }`.

## Live updates (Socket.io)

Connect with `io(API_URL, { auth: { token: accessToken } })`. Each socket joins its user room, its company room, and the admin room for admins.

| Event | Sent to |
|---|---|
| `booking:created`, `booking:updated` | customer, assigned staff, the partner company, admins, watchers |
| `booking:removed` | staff taken off a booking |
| `company:new`, `company:updated` | admins and the company |
| `rates:updated` | admins |

Emit `booking:watch` with a booking id (acknowledged with `{ ok }`) to follow one booking's live screen.

## Security

- Helmet headers, CORS allow list, JSON body limit, request limits per IP (Redis-backed in production)
- OTP: 6 digits, HMAC-hashed, 5 minute expiry, 30 s resend cooldown, 5 per hour, 5 attempts
- Passwords: bcrypt (cost 12); one generic error for wrong phone or password
- Access tokens carry a token version: password change or suspension signs out every device
- Every route checks the role and that the record belongs to the caller
- Prices are always calculated on the server from the admin rate card
- Uploads: 10 MB, JPG/PNG/WEBP/HEIC/PDF, content checked against the type; company and staff documents are private on Cloudinary and shown through short-lived signed links
- Customer and staff phone numbers are never included in booking responses
