import { redirect } from "next/navigation";

// "Collaborators" was a "coming soon" sign in the menu. It left the menu; the route
// stays alive for old links and leads to the studio home.
export default function TeacherTeamPage() {
  redirect("/teach");
}
