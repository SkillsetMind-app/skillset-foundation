import { redirect } from "next/navigation";

// Was a second copy of /teach/reports — same <CreatorOpsHub />, different title.
// Kept as a redirect so old bookmarks and links still land somewhere real.
export default function TeacherOperationsPage() {
  redirect("/teach/reports");
}
