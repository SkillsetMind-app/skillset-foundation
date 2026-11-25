import { redirect } from "next/navigation";

// Coupons live inside each product (product panel > Coupons). This
// route used to be just a sign saying so; now it goes straight to the product
// list.
export default function TeacherCouponsPage() {
  redirect("/teach/builder");
}
