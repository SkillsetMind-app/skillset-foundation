import { useEffect, useState } from "react";

import type { PlanId } from "@/data/plans";
import type { CourseReadinessAccount } from "@/domain/course-readiness";
import {
  fetchCreatorActivationBlocked,
  fetchRequireCreatorVerification,
} from "@/lib/data/creator-verification";
import { subscribeToUserProfile } from "@/lib/data/user-profiles";
import { fetchCreatorPlanRequired } from "@/lib/data/creator-plan";

// As travas de publicacao que sao do professor, nao do curso: payouts do
// Stripe e verificacao profissional. So o Manage as carregava, entao a
// porcentagem dele nunca batia com a do construtor num curso pago. O mesmo
// hook alimenta as duas telas para que a lista seja uma so.
export function usePublishGates(user: { uid: string } | null | undefined): {
  account: CourseReadinessAccount;
  planId: PlanId;
  // As leituras responderam (com dado ou erro). Antes disso `account`
  // traz os valores falsos iniciais, e quem conta passos pisca.
  loaded: boolean;
  /** null até a leitura chegar, e quando ela falha: sem status, sem oferta do selo. */
  verificationStatus: string | null;
  /** País da conta Stripe Connect (ex.: "MX"); null sem conta ou sem leitura. */
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

  // Mesmo predicado do gatilho de publicar. Leitura falha aberta: sem resposta
  // o item some e publish_teacher_course continua recusando no servidor.
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
