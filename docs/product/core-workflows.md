# CORE WORKFLOWS
## User journeys and product loops

> **Version:** 0.1.0
> **Updated:** 2026-05-25
> **Status:** Living document

---

## Teacher Workflow

### Step 1: Account And Onboarding

**What:** Teacher signs up, selects the teacher path, and completes onboarding.

**Why:** Skillset must know whether the user wants to learn, teach, or do both.

**System outcome:** User profile has role, onboarding answers, and route destination.

### Step 2: Studio

**What:** Teacher lands in the studio dashboard.

**Why:** The dashboard should explain business status, courses, revenue, and required actions.

**System outcome:** Teacher can navigate to course builder, media library, payouts, plans, and settings.

### Step 3: Course Builder

**What:** Teacher creates a draft course, configures details, adds modules, lessons, content, materials, pricing, and preview.

**Why:** This is the core supply-side product.

**System outcome:** A `courses/{courseId}` document exists with builder data and a course asset subcollection.

### Step 4: Professional Verification And Launch Checks

**What:** Skillset verifies the professional. The builder checks product completeness, pricing, content, category, terms, and payout readiness.

**Why:** Marketplace trust comes from credentialed professionals and deterministic product safeguards without making every course wait for manual approval.

**System outcome:** An approved professional with a complete product can publish directly. Incomplete or ineligible products remain private drafts.

### Step 5: Publish And Sell

**What:** Teacher publishes the course and it becomes publicly visible immediately.

**Why:** Learners can only buy complete published courses from verified professionals.

**System outcome:** Course status becomes `published`; checkout or free enrollment becomes available.

---

## Learner Workflow

### Step 1: Discover

**What:** Learner browses marketplace or course detail page.

**System outcome:** Learner sees course summary, creator, price, curriculum, and trust signals.

### Step 2: Enroll Or Buy

**What:** Learner enrolls in a free course or pays through Stripe Checkout.

**System outcome:** Enrollment record is created after free enrollment or payment success.

### Step 3: Learn

**What:** Learner accesses classroom, watches lessons, downloads materials, and tracks progress.

**System outcome:** Lesson progress and completion data update under the learner account.

### Step 4: Credential

**What:** Learner receives or verifies completion credential when eligibility is met.

**System outcome:** Certificate record can be issued and verified through a public verification endpoint.

---

## Admin/Ops Workflow

| Workflow | Purpose |
|----------|---------|
| Professional verification | Resolve credential exceptions and appeals that automation cannot verify. |
| Marketplace compliance | Review reports and monitor published programs without automatic unpublishing. |
| Payment oversight | Inspect orders, payouts, refunds, and Stripe readiness. |
| Support | Respond to account, billing, and learning issues. |
| Moderation | Handle community reports and unsafe content. |

---

## Core Product Loop

1. Teacher creates valuable course.
2. Skillset verifies the professional; the teacher publishes a complete product.
3. Learner buys or enrolls.
4. Learner completes lessons and receives value.
5. Teacher earns revenue.
6. More teachers join because the platform looks trustworthy and functional.

