import { redirect } from "next/navigation";

// The profile page moved into the dashboard shell so the sidebar nav persists
// across dashboard/profile navigations. Keep the old URL as a redirect for
// existing bookmarks and external links.
export default function ProfilePage() {
	redirect("/dashboard/profile");
}
