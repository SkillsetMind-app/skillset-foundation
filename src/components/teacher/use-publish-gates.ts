import { useEffect, useState } from "react";

import type { PlanId } from "@/data/plans";
import type { CourseReadinessAccount } from "@/domain/course-readiness";
import { fetchRequireCreatorVerification } from "@/lib/data/creator-verification";
import { subscribeToUserProfile } from "@/lib/data/user-profiles";

// As travas de publicacao que sao do professor, nao do curso: payouts do
// Stripe e verificacao profissional. So o Manage as carregava, entao a
// porcentagem dele nunca batia com a do construtor num curso pago. O mesmo
// hook alimenta as duas telas para que a lista seja uma so.
export function usePublishGates(user: { uid: string } | null | undefined): {
  account: CourseReadinessAccount;
  planId: PlanId;
} {
  const [payoutsReady, setPayoutsReady] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState("none");
  const [requireVerification, setRequireVerification] = useState(false);
  const [planId, setPlanId] = useState<PlanId>("free");
  const uid = user?.uid;

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
        setVerificationStatus(profile?.creatorVerificationStatus ?? "none");
        setPlanId(profile?.currentPlanId ?? "free");
      },
      () => setPayoutsReady(false),
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
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return {
    account: {
      payoutsReady,
      verificationRequired: requireVerification,
      verificationApproved: verificationStatus === "approved",
    },
    planId,
  };
}
