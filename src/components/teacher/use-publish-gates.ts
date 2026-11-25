import { useEffect, useRef, useState } from "react";

import type { PlanId } from "@/data/plans";
import type { CourseReadinessAccount } from "@/domain/course-readiness";
import {
  fetchCreatorActivationBlocked,
  fetchRequireCreatorVerification,
} from "@/lib/data/creator-verification";
import type { PublishGatesSeed } from "@/lib/data/server/studio-home";
import { subscribeToUserProfile } from "@/lib/data/user-profiles";
import { fetchCreatorPlanRequired } from "@/lib/data/creator-plan";

// The publish gates that belong to the teacher, not to the course: Stripe
// payouts and professional verification. Only Manage loaded them, so its
// percentage never matched the builder's on a paid course. The same
// hook feeds both screens so the list is a single one.
//
// `seed` is the same answers already read by the server for this page load
// (lib/data/server/studio-home): the hook starts from them instead of from
// "not loaded", and still reads everything itself, as before. A null field in
// it is a read that failed there, and starts as it always did.
export function usePublishGates(
  user: { uid: string } | null | undefined,
  seed: PublishGatesSeed | null = null,
): {
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
  const [payoutsReady, setPayoutsReady] = useState(seed?.payoutsReady ?? false);
  const [stripeConnectCountry, setStripeConnectCountry] = useState<string | null>(seed?.stripeConnectCountry ?? null);
  const [verificationStatus, setVerificationStatus] = useState<string | null>(seed?.verificationStatus ?? null);
  const [requireVerification, setRequireVerification] = useState(seed?.requireVerification ?? false);
  const [planId, setPlanId] = useState<PlanId>(seed?.planId ?? "free");
  const [profileLoaded, setProfileLoaded] = useState(seed !== null);
  const [flagLoaded, setFlagLoaded] = useState(typeof seed?.requireVerification === "boolean");
  const [activationBlocked, setActivationBlocked] = useState(seed?.activationBlocked ?? false);
  const uid = user?.uid;
  const [planGate, setPlanGate] = useState<{ uid: string; required: boolean } | null>(
    uid && typeof seed?.planRequired === "boolean" ? { uid, required: seed.planRequired } : null,
  );
  // Started from the server's answers, and whether the browser's own profile
  // read has answered since.
  const seeded = useRef(seed !== null);
  const profileAnswered = useRef(false);

  useEffect(() => {
    if (!uid) return;
    let active = true;
    // The same answer as the one held keeps the object, so nothing re-renders.
    const settle = (required: boolean) => {
      if (!active) return;
      setPlanGate((current) =>
        current && current.uid === uid && current.required === required ? current : { uid, required },
      );
    };
    const refresh = () => {
      void fetchCreatorPlanRequired()
        .then((required) => settle(required))
        .catch(() => settle(true));
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
        profileAnswered.current = true;
        setPayoutsReady(
          Boolean(profile?.stripeConnectChargesEnabled && profile?.stripeConnectPayoutsEnabled),
        );
        setVerificationStatus(profile ? profile.creatorVerificationStatus ?? "none" : null);
        setStripeConnectCountry(profile?.stripeConnectCountry ?? null);
        setPlanId(profile?.currentPlanId ?? "free");
        setProfileLoaded(true);
      },
      () => {
        // What the server read moments ago stays: a re-read that fails is no
        // reason to tell a creator their payouts and verification are gone.
        if (seeded.current && !profileAnswered.current) return;
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
