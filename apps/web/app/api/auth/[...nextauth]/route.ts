// Auth.js v5 catch-all route handler. The framework expects this exact path
// (`/api/auth/*`) for sign-in / callback / sign-out endpoints.

import { handlers } from "../../../../auth";

export const { GET, POST } = handlers;
