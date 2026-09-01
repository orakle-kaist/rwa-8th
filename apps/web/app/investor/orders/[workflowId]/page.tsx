import { InvestorJourney } from "../../investor-journey";
import { resolveProfile } from "../../profile";

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ workflowId: string }>;
  searchParams: Promise<{ profile?: string; backstage?: string }>;
}) {
  const [{ workflowId }, query] = await Promise.all([params, searchParams]);
  return (
    <InvestorJourney
      initialProfile={await resolveProfile(Promise.resolve(query))}
      screen="order"
      workflowId={workflowId}
      autoOpenBackstage={query.backstage === "1"}
    />
  );
}
