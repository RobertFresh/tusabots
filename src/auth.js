import {
  login,
  signup,
  logout,
  getUser,
  handleAuthCallback,
  onAuthChange,
  AUTH_EVENTS,
  AuthError,
  MissingIdentityError
} from '@netlify/identity';

window.TusaAuth = {
  login,
  signup,
  logout,
  getUser,
  handleAuthCallback,
  onAuthChange,
  AUTH_EVENTS,
  AuthError,
  MissingIdentityError
};
