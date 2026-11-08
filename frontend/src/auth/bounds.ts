// Input limits copied from the backend's auth schemas (backend/app/schemas/auth.py), so the forms
// can answer as the user types. They are input limits, not game rules, and the server still
// checks them.

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
export const USERNAME_PATTERN = /^[A-Za-z0-9_]+$/;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

// A loose shape check. The server does the full email validation.
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
