import { NextResponse } from "next/server";

import { isCoursePubliclySellable } from "@/domain/teacher-course";
import {
  getCourseRow,
  loadCourseProductOffers,
} from "@/lib/payments/server/stripe-helpers";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  try {
    const { courseId: rawCourseId } = await params;
    const courseId = rawCourseId.trim();
    if (!courseId || courseId.length > 160) {
      return NextResponse.json({ error: "Invalid course." }, { status: 400 });
    }

    const course = await getCourseRow(courseId);
    if (!course || !isCoursePubliclySellable(course.status)) {
      return NextResponse.json({ error: "Course not found." }, { status: 404 });
    }

    const response = NextResponse.json({
      offers: await loadCourseProductOffers(courseId),
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    console.error("[courses/offers]", error);
    return NextResponse.json(
      { error: "Offers are temporarily unavailable." },
      { status: 503 },
    );
  }
}
