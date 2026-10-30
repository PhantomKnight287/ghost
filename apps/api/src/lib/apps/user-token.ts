import { randomAlphanumeric } from './installation-token.js';

/** GitHub's user-to-server token shape: an app acting as the user who signed in to it. */
export const USER_TOKEN = /^ghu_[A-Za-z0-9]{36}$/;

export const generateUserToken = () => `ghu_${randomAlphanumeric(36)}`;

export const generateUserRefreshToken = () => `ghr_${randomAlphanumeric(76)}`;

export { hashInstallationToken as hashUserToken } from './installation-token.js';
