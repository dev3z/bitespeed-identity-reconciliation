# Bitespeed Identity Reconciliation Service

## Tech Stack

- **Runtime**: Node.js
- **Language**: TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Middleware**: CORS, dotenv
- **Dev Tools**: Nodemon, ts-node

## Test Cases

1. **Single Email Contact**
   - POST `/identify` with only email parameter
   - Expected: Creates new primary contact

2. **Single Phone Contact**
   - POST `/identify` with only phoneNumber parameter
   - Expected: Creates new primary contact

3. **Email and Phone Together**
   - POST `/identify` with both email and phoneNumber
   - Expected: Links as primary/secondary contacts

4. **No Email/Phone Provided**
   - POST `/identify` with empty body
   - Expected: Returns 400 error

5. **Multiple Primaries Merge**
   - POST `/identify` with email/phone matching different primary contacts
   - Expected: Merges primaries, oldest becomes primary

6. **Secondary Contact Creation**
   - POST `/identify` with new email/phone for existing family
   - Expected: Creates secondary contact linked to primary

7. **Duplicate Contact Detection**
   - POST `/identify` with exact same email and phone
   - Expected: Returns existing contact without duplication
