import { useEffect, useState } from "react";

import type { PlanId } from "@/data/plans";
import type { CourseReadinessAccount } from "@/domain/course-readiness";
import {
  fetchCreatorActivationBlocked,
  fetchRequireCreatorVerification,
} from "@/lib/data/creator-verification";
import { subscribeToUserProfile } from "@/lib/data/user-profiles";
import { fetchCreatorPlanRequired } from "@/lib/data/creator-plan";

// The publish gates that belong to the teacher, not to the course: Stripe
// payouts and professional verification. Only Manage loaded them, so its
// percentage never matched the builder's on a paid course. The same
// hook feeds both screens so the list is a single one.
export function usePublishGates(user: { uid: string } | null | undefined): {
  account: CourseReadinessAccount;
  planId: PlanId;
  // The reads answered (with data or an error). Before that `account`
  // carries the initial false values, and whoever counts steps flickers.
  loaded: boolean;
  /** null until the read arrives, and when it fails: no status, no badge offer. */
  verificationStatus: string | null;
  /** Country of the Stripe Connect account (e.g. "MX"); null with no account or no read. */
  stripeConnectCountry: string | null;
} {
  const [payoutsReady, setPayoutsReady] = useState(false);
  const [stripeConnectCountry, setStripeConnectCountry] = useState<string | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<string | null>(null);
  const [requireVerification, setRequireVerification] = useState(false);
  const [planId, setPlanId] = useState<PlanId>("free");
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [flagLoaded, setFlagLoaded] = useState(false);
  const [activationBlocked, setActivationBlocked] = useState(false);
  const uid = user?.uid;
  const [planGate, setPlanGate] = useState<{ uid: string; required: boolean } | null>(null);

  useEffect(() => {
    if (!uid) return;
    let active = true;
    const refresh = () => {
      void fetchCreatorPlanRequired()
        .then((required) => { if (active) setPlanGate({ uid, required }); })
        .catch(() => { if (active) setPlanGate({ uid, required: true }); });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("focus", refresh); };
  }, [uid]);

  useEffect(() => {
    if (!uid) {
      return;
    }
    return subscribeToUserProfile(
      uid,
      (profile) => {
        setPayoutsReady(
          Boolean(profile?.stripeConnectChargesEnabled && profile?.stripeConnectPayoutsEnabled),
        );
        setVerificationStatus(profile ? profile.creatorVerificationStatus ?? "none" : null);
        setStripeConnectCountry(profile?.stripeConnectCountry ?? null);
        setPlanId(profile?.currentPlanId ?? "free");
        setProfileLoaded(true);
      },
      () => {
        setPayoutsReady(false);
        setVerificationStatus(null);
        setStripeConnectCountry(null);
        setProfileLoaded(true);
      },
    );
  }, [uid]);

  useEffect(() => {
    let active = true;
    fetchRequireCreatorVerification()
      .then((value) => {
        if (active) {
          setRequireVerification(value);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) {
          setFlagLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  // Same predicate as the publish trigger. A failed read fails open: with no answer
  // the item goes away and publish_teacher_course keeps refusing on the server.
  useEffect(() => {
    if (!uid) {
      return;
    }
    let active = true;
    fetchCreatorActivationBlocked()
      .then((value) => {
        if (active) {
          setActivationBlocked(value);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [uid]);

  return {
    account: {
      payoutsReady,
      verificationRequired: requireVerification,
      verificationApproved: verificationStatus === "approved",
      activationBlocked,
      planRequired: planGate && planGate.uid === uid ? planGate.required : true,
    },
    planId,
    loaded: profileLoaded && flagLoaded && Boolean(planGate && planGate.uid === uid),
    verificationStatus,
    stripeConnectCountry,
  };
}
