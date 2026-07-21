

LINK-----https://pixel-pet-production.up.railway.app

# PixelPet 🐾

Turn your pet photo into a customizable pixel desktop companion.


Before → PixelPet → Desktop Companion

## What PixelPet Does

1. Upload a pet photo
2. Select and repair the pet
3. Customize its pixel appearance
4. Download PNG, sprite sheet and .petpack files

## Why PixelPet

- Pet photos are processed locally
- Multiple interface languages
- Exportable sprite sheets
- No pet photos stored on the server



This is the free feedback edition of PixelPet. After completing a pet, users must first submit a 1–5 star rating, nationality, and written review. PNG, sprite sheet, and `.petpack` downloads are unlocked only after the server confirms that the feedback has been saved successfully.

## Core Features

* Pet images are still processed locally in the browser and are never sent to the feedback server.
* Feedback is stored in the local SQLite database at `data/feedback.sqlite`.
* No third-party npm dependencies are required. The server uses Node.js built-in HTTP, Crypto, and SQLite modules.
* After feedback is submitted successfully, the server returns an HMAC-signed receipt. The browser stores this receipt and uses it to verify download access for up to 180 days.
* The administration dashboard supports statistics, search, filtering, and CSV export.
* The feedback interface supports Chinese, English, Spanish, French, Russian, and Arabic.
* Built-in protections include rate limiting, honeypot fields, input length restrictions, anonymized identifier hashing, and strict security response headers.

## Local Setup

Node.js 24 LTS is recommended. Node.js 22.13 or later is also supported.

### Windows

Double-click:

```text
启动网站和评价系统.bat
```

Alternatively, run the following command in the project directory:

```bash
node server.mjs
```

Then open:

```text
http://localhost:8787
```

Administration dashboard:

```text
http://localhost:8787/admin
```

When the server starts, the administrator token is displayed in the terminal. In the development environment, the automatically generated token is also stored in:

```text
data/secrets.json
```

## Production Environment Variables

Copy the values from `.env.example` into the environment-variable settings of your deployment platform. The server does not automatically load `.env` files. Environment variables must be injected through a system service, Docker, or the deployment platform.

The following variables are required:

```text
ADMIN_TOKEN
RECEIPT_SECRET
```

Random strings of at least 32 bytes are recommended.

## Database Fields

The server stores:

* Star rating: 1–5
* Nationality entered voluntarily by the user
* Written review
* Interface language
* Pet name
* Submission timestamp
* Anonymized client hash
* Anonymized network hash
* Consent status

The server does not store pet photos, skeleton data, `.petpack` files, or raw IP addresses.

## API

```text
POST /api/feedback
POST /api/feedback/verify
GET  /api/health
GET  /api/admin/feedback
GET  /api/admin/export.csv
```

Administration API requests require:

```http
Authorization: Bearer <ADMIN_TOKEN>
```

## Important Note

Downloadable files are generated locally in the user's browser. Therefore, the feedback requirement is intended primarily to guide the normal user flow and collect feedback; it is not a digital rights management system. Users who are familiar with front-end code may still be able to bypass the interface restriction.
