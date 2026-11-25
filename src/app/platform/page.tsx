import { redirect } from "next/navigation";

// /platform was an internal showcase ("Platform overview") with no way back: a
// dead end (F15). Whoever lands here wants the catalog.
export default function PlatformPage() {
  redirect("/courses");
}
