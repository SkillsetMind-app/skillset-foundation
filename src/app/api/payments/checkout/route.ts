import { paymentErrorResponse, requireUserId } from "@/lib/payments/server/auth";
import {
  createCourseCheckoutSession,
  type CourseCheckoutBody,
} from "@/lib/payments/server/course-checkout";

// POST /api/payments/checkout — opens a Stripe Checkout Session for a paid
// course, for the signed-in buyer. The session itself (price, offer, coupon,
// fee, lock, order row, direct charge) is built by createCourseCheckoutSession,
// which the guest checkout route shares.
export async function POST(request: Request) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (error) {
    return paymentErrorResponse(error);
  }
  const body = (await request.json().catch(() => ({}))) as CourseCheckoutBody;
  return createCourseCheckoutSession(userId, body);
}
