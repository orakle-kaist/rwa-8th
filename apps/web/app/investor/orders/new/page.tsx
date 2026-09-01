import { InvestorJourney } from "../../investor-journey";
import { resolveProfile } from "../../profile";

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ profile?: string }>;
}) {
  return <InvestorJourney initialProfile={await resolveProfile(searchParams)} screen="primary" />;
}
