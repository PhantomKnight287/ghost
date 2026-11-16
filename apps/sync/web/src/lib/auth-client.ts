import { createAuthClient } from "better-auth/react";
import { API_URL } from "./api.ts";

/** Sessions live on the sync API; Ghost signs people in, GitHub is only ever linked. */
export const authClient = createAuthClient({ baseURL: `${API_URL}/api/auth` });

export const signInWithGhost = () => authClient.signIn.social({ provider: "ghost", callbackURL: window.location.origin });

export const linkGitHub = () => authClient.linkSocial({ provider: "github", callbackURL: window.location.href });
