"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useEffect, useRef } from "react";

import { useUser } from "@/hooks/useUser";

/**
 * Fires `user_signed_up` for OAuth registrations.
 *
 * The email path captures the event inline in the signup form, but a social
 * sign-up redirects to the provider and back, so the signup page is gone by the
 * time the account exists. better-auth sends brand-new accounts to
 * `newUserCallbackURL` with `?signup_method=<provider>` (see SocialAuthButtons);
 * this reads that param wherever the user lands, emits the same event, and
 * strips the param so a refresh can't double-count.
 *
 * Mounted at the root, so the `/user/me` lookup stays gated on the param being
 * present — otherwise every marketing pageview would pay for a session fetch.
 */
export function SignupMethodTracker() {
	const posthog = usePostHog();
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const signupMethod = searchParams.get("signup_method");
	const { user } = useUser({ enabled: Boolean(signupMethod) });
	const tracked = useRef(false);

	useEffect(() => {
		if (!signupMethod || !user || tracked.current) {
			return;
		}
		tracked.current = true;

		// useUser already identifies the person; this only adds the event.
		posthog.capture("user_signed_up", {
			email: user.email,
			name: user.name,
			method: signupMethod,
		});

		const params = new URLSearchParams(searchParams.toString());
		params.delete("signup_method");
		const query = params.toString();
		router.replace(query ? `${pathname}?${query}` : pathname);
	}, [signupMethod, user, posthog, searchParams, router, pathname]);

	return null;
}
